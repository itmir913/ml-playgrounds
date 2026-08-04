# 아키텍처

`CLAUDE.md` §2의 상세 문서. 큐·워커·자원 관리·디렉터리 구조를 건드릴 때 읽는다.

```
                       Vue 3 (브라우저)
                            │
             ┌──────────────┴──────────────┐
             │                             │
      브라우저 내 학습                  WebSocket
      (소규모 데이터, V1.5)                 │
                                    FastAPI Gateway
                                            │
                                    Job Queue (추상화)
                                            │
                                      Worker Pool
                                            │
                                  scikit-learn / pandas
```

---

## 1. 작업 큐

큐는 반드시 인터페이스 뒤에 둔다.

```python
# backend/app/jobs/base.py
class JobQueue(Protocol):
    async def enqueue(self, job: JobSpec) -> JobId: ...
    async def get_status(self, job_id: JobId) -> JobStatus: ...
    async def cancel(self, job_id: JobId) -> None: ...
```

**V1 — `InProcessQueue`** (asyncio.Queue + ProcessPoolExecutor)

sklearn으로 수천 행 CSV를 학습하는 데는 대개 1초도 걸리지 않는다. 진짜 병목은 학습이 아니라
동시 업로드와 메모리다. Redis를 처음부터 넣는 것은 과설계다.

**V2 이후 — `CeleryQueue`** (Redis broker)

이미지·음성 등 장시간 작업이 들어오는 시점(V5 예정)에 전환한다.
전환 시 `JobQueue` 구현체만 갈아끼우면 되도록 지금 설계한다.

### 1.1 큐 라우팅

나누는 기준은 **작업 크기**와 **데이터 타입** 두 가지다.

- 크기: `small` / `large` — 작은 작업이 큰 작업 뒤에서 굶지 않게 한다.
- 타입: `tabular` / `image` / `audio` / `text` — 이미지 학습이 CSV 학습을 막지 않게 한다.

V1에서는 `tabular-small`, `tabular-large` 둘만 있으면 된다.
그러나 **라우팅 로직은 처음부터 넣는다.**

### 1.2 V1의 확장 한계 (알려진 제약)

`InProcessQueue`는 백엔드 프로세스 안에 큐가 있으므로 **워커 수평 확장이 불가능하다.**
또한 백엔드를 다중 인스턴스로 띄우면 WebSocket의 `jobId` 구독이 특정 인스턴스에 묶인다
(작업을 처리한 인스턴스만 진행 상황을 안다).

V1은 단일 백엔드 인스턴스를 전제한다. 이 전제를 깨야 할 때가 `CeleryQueue` 전환 시점이다.
그 전까지는 로드 밸런서에 스티키 세션을 걸지 말고, 아예 인스턴스를 늘리지 마라.

---

## 2. 자원 관리

### 2.1 업로드 수용 판단

업로드를 **받기 전에** 판단한다. 다 받고 나서 거부하면 이미 디스크를 쓴 것이다.

1. 클라이언트가 `Content-Length` 또는 사전 요청으로 예상 크기를 알린다.
2. 서버가 `shutil.disk_usage()`로 가용 공간을 확인한다.
3. `free - DISK_RESERVE_MB < 예상크기 × SAFETY_FACTOR` 이면 `SERVER_DISK_INSUFFICIENT` 반환.
4. 통과하면 수락하고 스트리밍으로 임시 디렉터리에 쓴다.

**주의: `Content-Length`는 클라이언트가 속일 수 있다.** 사전 확인만으로는 부족하다.
스트리밍 중에도 누적 바이트를 세고, 신고한 크기나 `MAX_UPLOAD_MB`를 넘는 순간
연결을 끊고 부분 파일을 삭제해야 한다.

### 2.2 세션 수명주기

**세션 = WebSocket 연결 하나.** 학생이 데이터를 한 번 올리고 설정을 바꿔가며
여러 번 학습하는 동안 전체가 하나의 세션이다.

```
업로드 → /tmp/mlp/{sessionId}/ → 학습 N회 (설정만 바꿔 반복) → WS 종료 → 전부 삭제
                                   └ 예측도 여기서 즉시 처리
```

세션 동안 서버가 들고 있는 것:

| 대상 | 이유 |
|---|---|
| 원본 데이터셋 파일 | 재업로드 회피 |
| 파싱된 DataFrame | 재파싱 비용 회피 (200,000행이면 무시 못 한다) |
| 직전 학습 모델 | 예측 요청을 즉시 처리 |

**세션 종료를 감지하는 네 가지 경로.** 하나만 믿으면 반드시 샌다.

1. WebSocket `close` 이벤트 → `try/finally`에서 즉시 정리
2. **heartbeat(ping/pong) 실패** → half-open 연결 정리.
   TCP만 믿으면 끊긴 줄 모르는 연결이 데이터를 붙들고 남는다
3. **유휴 타임아웃** → 연결은 살아 있으나 N분간 요청이 없으면 정리.
   탭을 열어두고 하교하는 학생을 막는다
4. **고아 파일 청소기** → 위 셋이 모두 실패했을 때의 안전망.
   기준 시각은 디렉터리의 마지막 접근 시각이지 생성 시각이 아니다

- 정리는 `try/finally`에서 수행한다. 실패해도 반드시 지운다.
- 컨테이너의 작업 볼륨은 크기 제한을 걸어라(tmpfs 또는 quota).
  코드 버그가 호스트 디스크를 채우면 안 된다.

**받아들인 대가**

- 브라우저 새로고침 = 세션 소실 = 데이터 재업로드. grace period로 재접속을 허용하는 방안은
  서버에 상태를 남기는 쪽으로 미끄러지므로 채택하지 않았다.
- **디스크 점유가 "작업 중"에서 "접속 중"으로 늘어난다.** 30명 학급이 각 50MB를 올리면
  1.5GB가 상주한다. 여러 학급이 겹치면 그만큼 곱해진다.
  → 세션 상한값을 반드시 걸어야 한다 (`open-decisions.md` #9)

### 2.3 상한값

> **이 표는 임시다.** `backend/app/config.py`(Pydantic Settings)를 구현하는 시점에
> 아래 값을 코드로 옮기고 **이 절은 삭제한다.** 이후 단일 출처는 `config.py`다.

| 항목 | 초기 기본값 | 환경 변수 |
|---|---|---|
| 업로드 최대 크기 | 50 MB | `MAX_UPLOAD_MB` |
| 최대 행 수 | 200,000 | `MAX_ROWS` |
| 최대 열 수 | 200 | `MAX_COLUMNS` |
| 학습 최대 시간 | 120 초 | `MAX_TRAIN_SECONDS` |
| 작업당 최대 메모리 | 2048 MB | `MAX_MEMORY_MB` |
| 디스크 예비 공간 | 2048 MB | `DISK_RESERVE_MB` |
| 동시 실행 작업 수 | CPU 코어 수 | `MAX_CONCURRENT_JOBS` |

시간·메모리 상한은 **워커 프로세스 수준에서** 강제한다
(별도 프로세스 + `resource.setrlimit`, 또는 컨테이너 제한).
파이썬 코드 안의 체크만으로는 막지 못한다.

**미해결 문제:** `MAX_MEMORY_MB` × `MAX_CONCURRENT_JOBS`가 호스트 메모리를 넘을 수 있다
(8코어면 16GB 요구). CLAUDE.md §1.5와 충돌한다. → `open-decisions.md`

---

## 3. 브라우저 내 학습 (V1.5, 설계만 미리)

소규모 데이터(예: 5,000행 이하)는 서버를 거치지 않고 브라우저에서 학습한다.
서버 부하와 개인정보 이슈가 동시에 사라지고, 교실 수요의 대다수가 여기 해당한다.

**핵심 제약: 서버 학습과 결과가 일치해야 한다.**
같은 설정으로 학습했는데 브라우저와 서버의 정확도가 다르면 학생과 교사 모두 혼란에 빠진다.

- **유력안: Pyodide + scikit-learn (WASM)** — 서버와 같은 라이브러리이므로 결과가 사실상 일치한다.
  대신 초기 다운로드가 크다(수 MB~10MB대). 지연 로딩과 캐싱으로 완화한다.
- 대안: TensorFlow.js / ml.js — 가볍지만 sklearn과 결과가 다르다. **비추천.**

**단, "동등성 보장"이라고 말하지 마라.** 같은 sklearn이라도 WASM과 네이티브는 BLAS 구현과
스레드 수가 달라 부동소수점 결과가 미세하게 갈릴 수 있다. 트리 계열은 `random_state` 고정 시
대개 동일하지만, SVM·LogisticRegression 같은 반복 최적화 알고리즘은 마지막 자리가 다를 수 있다.
UI에는 소수점 자릿수를 제한해 표시하고, 비교 테스트는 정확 일치가 아니라 허용 오차로 작성한다.

V1에서는 서버 학습만 구현하되, 학습 실행부를 `TrainingBackend` 인터페이스로 감싸
브라우저 구현체를 나중에 붙일 수 있게 한다.

---

## 4. 디렉터리 구조

> 골격 생성 후에는 **실제 디렉터리가 출처**다. 이 트리는 초기 골격을 만들기 위한 것이며,
> 구조가 바뀌어도 이 문서를 따라 고칠 의무는 없다.

```
ml-playgrounds/
├── CLAUDE.md
├── README.md
├── LICENSE
├── docs/
├── scripts/                      CI 검사 스크립트
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py
│   │   ├── config.py             환경 변수 → Pydantic Settings
│   │   ├── errors.py             에러 코드 StrEnum (단일 출처)
│   │   ├── api/                  routes_train / routes_predict / routes_verify / ws
│   │   ├── core/                 quota / diskguard / lifecycle / signing
│   │   ├── jobs/                 base(Protocol) / inprocess / celery_queue
│   │   ├── ml/                   registry / preprocess / train / evaluate
│   │   └── schemas/
│   └── tests/
└── frontend/
    ├── package.json
    ├── src/
    │   ├── main.ts
    │   ├── i18n.ts
    │   ├── locales/              en.json / ko.json
    │   ├── project/              format(zip) / schema / migrate / storage(IndexedDB)
    │   ├── ml/                   backend(interface) / server / browser(V1.5)
    │   ├── stores/
    │   ├── composables/
    │   ├── components/
    │   └── views/
    └── tests/
```

---

## 5. 로컬 개발

**도커는 필요 없다.** 도커 이미지·nginx 설정·`docker-compose.yml`은 배포 단계에서 만든다
(`open-decisions.md` #10).

```bash
# 백엔드 (backend/)
uv sync                                          # 최초 1회, uv.lock 생성
uv run uvicorn app.main:app --reload --port 8000
uv run ruff check . && uv run mypy . && uv run pytest

# 프런트엔드 (frontend/)
npm install
npm run dev
npm run lint && npm run typecheck && npm test
```

`package.json`과 `pyproject.toml`의 버전은 상한 없는 캐럿 범위다.
최초 `npm install` / `uv sync` 후 실제로 해결된 버전을 락파일로 고정한다.
**`uv.lock`과 `package-lock.json`은 커밋한다.** 재현성이 이 프로젝트의 요구사항이다.

---

## 6. 데이터 타입 확장 (V5~V7)

V1은 표 데이터만 다루지만, 최종 목표는 학생이 이미지·음성·텍스트로도 포트폴리오를
만드는 것이다. **표 데이터 전용 가정을 계약에 새겨 넣지 마라.**

이미 준비된 확장 지점:

| 지점 | 어떻게 확장되는가 |
|---|---|
| `manifest.dataType` | `tabular` / `image` / `audio` / `text` |
| 큐 라우팅 | 타입 축이 이미 있다. 이미지 학습이 CSV 학습을 막지 않는다 |
| `dataset/` 레이아웃 | 타입별 구조가 명세돼 있다 (`mlpx-spec.md` §1) |
| `registry` | 알고리즘을 등록만 하면 된다 |
| `TrainingBackend` | 실행 위치를 갈아끼운다 |

**아직 없는 확장 지점 — 만들 때 함께 설계할 것:**

- **지표 선택**: 현재는 분류 지표만 상정한다. `taskType`(classification / regression /
  clustering)에 따라 지표 집합이 완전히 달라진다. `evaluate.py`에도 알고리즘 registry와
  같은 방식의 **지표 registry**가 필요하다. `if taskType == ...` 분기를 만들지 마라.
- **전처리 파이프라인**: 표 데이터의 결측치·스케일링·인코딩은 이미지·음성에 그대로 대응되지
  않는다(리사이즈, 정규화, 특징 추출). `preprocess.py`를 dataType별 파이프라인으로 나눠야 한다.
- **업로드 형태**: 이미지·음성은 파일 하나가 아니라 라벨 디렉터리 묶음이다.
  `routes_train.py`의 요청 스키마가 단일 CSV를 전제하지 않도록 한다.

---

## 7. 운영 비용과 실행 위치 정책

이 프로젝트는 누군가가 백엔드를 계속 운영해야 한다. 기준 환경은
**Oracle Cloud Always Free ARM (Ampere A1): 4 OCPU / 24 GB RAM / 200 GB 디스크 / 월 10 TB 송신**이다.
MIT 라이선스이고 도커로 배포되므로 교사가 학교 컴퓨터실에 직접 설치할 수도 있지만,
**대부분은 공용 서버를 쓸 것으로 가정한다.**

### 7.1 이 서버가 버티는가

교실에서 실제로 쓰는 데이터는 작다. 붓꽃 5 KB, 타이타닉 60 KB, 학생이 만든 데이터도 대개 수 MB 이하다.
50 MB는 상한이지 전형값이 아니다. 학습도 수천 행이면 1초 미만이다.

| 상황 | 부하 | 판정 |
|---|---|---|
| 한 학급 30명, 각 1 MB, 동시 학습 | 메모리 수백 MB, CPU 몇 초 | 여유 |
| 한 학급 30명이 상한(50 MB)을 실제로 사용 | 세션 상주 메모리 6 GB 이상 | 위험 |
| 같은 교시에 100개 학급 = 3,000명 | 어떤 계산으로도 불가능 | **불가** |

한국 학교는 시간표가 정렬돼 있어 부하가 교시 시작에 몰린다.
**전국 단위로 퍼지면 서버 학습만으로는 구조적으로 버틸 수 없다.**

### 7.2 결론: 브라우저가 기본, 서버는 예외

비용을 "학습 횟수"가 아니라 "**꼭 서버여야 하는 횟수**"에 비례하게 만든다.

| 누가 | 무엇을 | 어디서 | 서버 비용 |
|---|---|---|---|
| 학생 | 대부분의 학습 (수천 행 이하) | 브라우저 | **0** |
| 학생 | 큰 데이터, 브라우저가 못 하는 알고리즘 | 서버 | 드물게 발생 |
| 교사 | 제출물 검증 | 서버 | 채점 시점에만 |

학생 30명이 수업 중 각자 20번씩 설정을 바꿔가며 학습해도(=600회) 서버는 아무 일도 하지 않는다.
교사가 나중에 30개 제출물을 검증할 때만 30회 학습이 일어난다. **부하가 1/20로 줄어든다.**

### 7.3 서버가 없을 때도 수업은 계속돼야 한다

서버에 연결되지 않는 경우는 흔하다. 우리 서버가 내려갔거나, 학교 방화벽에 막혔거나,
교사가 자체 설치를 하지 않았거나, 인터넷이 끊겼거나.

- 프런트엔드는 `/health`로 서버 상태를 확인하고 `ServerStatus`를 반응형으로 들고 있는다.
- 모델 선택 화면은 알고리즘마다 **실행 위치**를 함께 보여준다.
- 서버가 없으면 서버 실행 옵션을 비활성화하되 **왜 못 쓰는지 이유를 함께 보여준다.**
  이유 없이 회색으로 죽어 있는 버튼은 학생에게 고장으로 보인다.
- 판정 로직은 `frontend/src/ml/backend.ts`의 `locationOptions()`에 있다. 순수 함수이고 테스트로 덮여 있다.
- 확인 전 상태(`unknown`)는 서버를 열어 주지 않는다. 낙관적으로 켰다가 실패하는 것보다
  처음부터 브라우저로 가는 편이 낫다.

### 7.4 브라우저 학습 엔진의 전송량

Pyodide + scikit-learn(WASM)은 최초 로드가 10~25 MB다. 월 10 TB면 40만~100만 회 최초 로드에 해당하고,
브라우저 캐시가 재방문을 흡수하므로 여유가 있다. 그래도 두 가지를 고려한다.

- 불변 자산으로 긴 캐시 헤더를 붙인다. 학기 중 같은 학생이 반복 접속하는 패턴에 잘 맞는다.
- 공개 CDN으로 빼면 전송량이 0이 되지만, **학교 방화벽이 외부 CDN을 막는 경우가 있다.**
  자체 서빙을 기본으로 하고 CDN은 선택지로 둔다.

### 7.5 남는 문제: 브라우저 학습에는 서명이 없다

브라우저 결과는 `computedBy: "browser"`이고 서명이 없어 "미검증"으로 표시된다
(`mlpx-spec.md` §7). 브라우저를 기본으로 삼으면 **대부분의 제출물이 미검증**이 된다.

해법은 검증 시점을 옮기는 것이다. 교사가 제출물을 열고 "서버에서 검증"을 누르면,
서버가 `.mlpx`의 `dataset/`과 `settings.json`으로 재학습해 지표를 대조하고 서명본을 만든다.
학생의 반복 학습에는 비용이 들지 않고, 채점 한 번에만 비용이 든다.
이 흐름을 UI에서 자연스럽게 만드는 것이 교사용 화면의 핵심 요구사항이다.
