# 아키텍처 — 실행과 자원 (§1~§7)

> `architecture.md`에서 갈라져 나온 절이다. **절 번호는 안 바뀌었다.** 전체 차례는 허브(`../architecture.md`)에 있다.
> **규칙만 적는다.** 이유와 경위, 실측은 같은 절 번호로 `docs/cases/architecture.md`에 있다.

## 1. 작업 큐

큐는 반드시 인터페이스 뒤에 둔다.

```python
# backend/app/jobs/base.py
class JobQueue(Protocol):
    async def enqueue(self, job: JobSpec) -> JobId: ...
    async def get_status(self, job_id: JobId) -> JobStatus: ...
    async def cancel(self, job_id: JobId) -> None: ...
```

- **V1은 `InProcessQueue`**(asyncio.Queue + ProcessPoolExecutor), 장시간 작업이 들어오면 **`CeleryQueue`**(Redis)로
  구현체만 갈아끼운다.

### 1.1 큐 라우팅

- 나누는 기준은 **작업 크기**(`small`/`large`)와 **데이터 타입**(`tabular`/`image`/`audio`/`text`)이다.
- V1은 `tabular-small`, `tabular-large` 둘이지만 **라우팅 로직은 처음부터 넣는다.**

### 1.2 V1의 확장 한계 (알려진 제약)

- V1은 **단일 백엔드 인스턴스를 전제한다.** `CeleryQueue` 전환 전에는 인스턴스를 늘리지 마라.

---

## 2. 자원 관리

### 2.1 업로드 수용 판단

업로드를 **받기 전에** 판단한다.

1. 클라이언트가 `Content-Length` 또는 사전 요청으로 예상 크기를 알린다.
2. 서버가 `shutil.disk_usage()`로 가용 공간을 확인한다.
3. `free - DISK_RESERVE_MB < 예상크기 × SAFETY_FACTOR` 이면 `SERVER_DISK_INSUFFICIENT` 반환.
4. 통과하면 수락하고 스트리밍으로 임시 디렉터리에 쓴다.

- **스트리밍 중에도 누적 바이트를 세고**, 신고한 크기나 `MAX_UPLOAD_MB`를 넘는 순간 연결을 끊고 부분 파일을 삭제한다.

### 2.2 세션 수명주기

**세션 = WebSocket 연결 하나.**

```
업로드 → /tmp/mlp/{sessionId}/ → 학습 N회 (설정만 바꿔 반복) → WS 종료 → 전부 삭제
                                   └ 예측도 여기서 즉시 처리
```

- 세션 동안 서버가 드는 것: 원본 데이터셋 파일 · 파싱된 DataFrame · 직전 학습 모델.
- **세션 종료를 감지하는 네 경로를 모두 둔다.**
  1. WebSocket `close` 이벤트 → `try/finally`에서 즉시 정리
  2. **heartbeat(ping/pong) 실패** → half-open 연결 정리
  3. **유휴 타임아웃** → N분간 요청이 없으면 정리
  4. **고아 파일 청소기** → 기준 시각은 마지막 접근 시각이다
- 정리는 `try/finally`에서 한다. 작업 볼륨에는 크기 제한(tmpfs 또는 quota)을 건다.
- 새로고침 재접속을 위한 grace period는 두지 않는다. **세션 상한값을 반드시 건다** (`open-decisions.md` #9).

### 2.3 상한값

- 단일 출처는 `backend/app/config.py`(Pydantic Settings)다. 구현 전의 초기 기본값 표는
  `docs/cases/architecture.md` 같은 절에 있다.
- 시간·메모리 상한은 **워커 프로세스 수준에서** 강제한다(별도 프로세스 + `resource.setrlimit` 또는 컨테이너 제한).
- `MAX_MEMORY_MB` × `MAX_CONCURRENT_JOBS`가 호스트 메모리를 넘는 문제는 미해결이다 → `open-decisions.md`

---

## 3. 브라우저 내 학습 — V1의 기본 실행 위치

**공식 배포에는 서버가 없으므로 이것이 유일한 실행 위치다.**

### 3.1 결과 일치는 여전히 제약이다 — 자리가 옮겨졌을 뿐

- "Pages 결과 vs 도커 결과"가 갈리면 무고한 학생이 위조를 의심받는다. 이것을 최악의 실패로 다룬다.

### 3.2 그래서 재실행 대조는 엔진을 넘지 않는다

- 각 run에 **엔진 종류와 버전을 기록**하고(`mlpx-spec.md` §4), 대조는 그 run을 만든 엔진으로만 한다.
  다른 엔진밖에 없으면 **"대조할 수 없음"이지 "불일치"가 아니다.**
- 두 엔진의 일치가 검증된 뒤에도 이 규칙은 남는다.

### 3.3 엔진은 둘이다

- **순수 JS가 기본이고 scikit-learn은 학생이 켜는 선택지다** (`open-decisions.md` "브라우저 학습 엔진은 둘 다 간다").
- **무거운 엔진은 학생이 고른 뒤에만 내려온다.** 비용은 그 run 앞에서 든다
  (`open-decisions.md` "scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다").
- **"동등성 보장"이라고 말하지 마라.** UI는 자릿수를 제한해 표시하고, 대조는 **허용 오차**로 판정한다
  (`open-decisions.md` #12).
- 엔진 대조 숫자를 인용할 때는 `frontend/tests/fixtures/sklearn/`(붓꽃 150행, 120/30 분할, `randomState` 42)에서
  하고, **분할을 함께 적는다.**

### 3.4 학습은 Web Worker에서 돈다

**화면이 얼면 안 된다** (`open-decisions.md` "학습은 언제나 백그라운드다").

```
메인 스레드          Worker                    서버 (자가호스팅)
  [학습하기] 클릭  ──▶  postMessage        또는  ──▶ WebSocket
  진행률 표시  ◀──  progress 이벤트          ◀── progress 이벤트
  취소         ──▶  terminate                ──▶ cancel
```

- **두 경로의 모양이 같다.** `TrainingBackend`가 하나로 유지된다.
- 엔진 시동도 같은 워커에서 하고, 워커는 **학습마다** 새로 뜬다.
- **취소는 `terminate`로 한다.**

### 3.5 실행 방법은 하나의 목록이다

`computedBy`와 `engine.kind`는 직교하지만 **화면에는 하나의 목록으로 낸다.**

| 화면 | `computedBy` | `engine.kind` | 실행 방법 id |
|---|---|---|---|
| 순수 JS | `browser` | `mljs` | `mljs` |
| scikit-learn (내 컴퓨터) | `browser` | `pyodide-sklearn` | `pyodide-sklearn` |
| scikit-learn (학교 서버) | `server` | `sklearn` | `server-sklearn` |

```
실행 방법(기본):  ● 순수 JS   ○ scikit-learn(내 컴퓨터)   ○ 학교 서버

학습할 모델
  ☑ 의사결정트리        순수 JS ▾            ← 기본 그대로
  ☑ 랜덤포레스트     scikit-learn ▾       ← 학생이 바꿈
  ☑ SVM             학교 서버 ▾           ← 순수 JS에 없어서 자동으로 옮겨짐(표시된다)
```

- **실험 기본을 한 번 고르고, 바꾸고 싶은 모델만 개별로 바꾼다.**
- 판정은 `frontend/src/ml/backend.ts`의 순수 함수 하나가 하고, 상단 상태와 모델 선택 화면이 같은 결과를 본다.
- 자동 이동은 **그 칸의 기본값을 채우는 동작**이다. **콕 집어 고른 칸은 옮기지 않는다.**
- **같은 알고리즘을 여러 실행 방법으로 나란히 둘 수 있다.**
- 서버로 가는 모델이 섞이면 화면이 **몇 개가 서버로 가는지 요약한다.**

### 3.6 군집화는 분할하지 않는다 (V3, 2026-08-11)

- 전체 데이터로 학습하고 전체 데이터에 대해 지표를 낸다. `trainIndices`에 전체 행, `testIndices`는 빈 배열이다.
- 분할을 건너뛰는 것은 `ml/plan.ts`의 `planRun`이 `taskType === 'clustering'`으로 가른다.
  **이것은 등록이 아니라 분기이고, 등록으로 풀 것이 아니다** — 타깃이 있는가 없는가의 구조적 차이다.

### 3.7 군집 지표는 시그니처가 다르다 (V3, 2026-08-11)

- `ClusterEvaluator`를 별도 타입으로 두고 등록부를 분리한다(`EVALUATORS`와 `CLUSTER_EVALUATOR`).
- **가르는 것은 부르는 쪽이다**(`experiment.ts`). `evaluate()`에 군집을 넘기면 던진다.
- 지표는 **실루엣 계수**와 **이너셔** 둘이다 (`open-decisions.md` #29). 이너셔는 단독으로 "좋다"를 말하지 않는다.

---

## 4. 디렉터리 구조

**실제 디렉터리가 출처다.** 트리를 여기 그리지 않는다. 남기는 것은 경계다.

| 경계 | 규칙 |
|---|---|
| `backend/app/errors.py` | 에러 코드의 **유일한 출처**. 로케일·문서가 여기를 따른다 |
| `backend/app/jobs/` | `JobQueue` 뒤에 구현이 숨는다. 부르는 쪽은 어느 큐인지 모른다 |
| `frontend/src/ml/` | **Vue를 모른다.** 워커와 서버 학습 양쪽에 그대로 쓰이기 때문이다 |
| `frontend/src/project/` | `.mlpx`와 IndexedDB가 **같은 문**(마이그레이션→검증)을 지난다 (§8.10.2) |
| `frontend/src/composables/` | 프레임워크를 아는 이음매. `toRaw` 같은 것이 여기 산다 |
| `scripts/` | CI가 부르는 검사. 사람이 지키길 기대하지 않는 것들이다 |

---

## 5. 로컬 개발

**도커는 필요 없다** (`open-decisions.md` #10).

```bash
# 백엔드 (backend/)
uv sync                                          # 최초 1회. uv.lock은 커밋되어 있다
uv run uvicorn app.main:app --reload --port 8000
uv run python scripts/ci.py                      # ruff check · ruff format --check · mypy · pytest

# 프런트엔드 (frontend/)
npm install
npm run dev
npm run ci        # 관문 전부. 순서는 package.json의 ci 스크립트가 갖는다
npm run lint      # 고치는 쪽. 대상이 src/ tests/ scripts/ 전체라 남의 작업 파일도 건드린다
```

- **`uv.lock`과 `package-lock.json`은 커밋한다.**

---

## 6. 데이터 타입 확장 (이미지·음성·텍스트)

**표 데이터 전용 가정을 계약에 새겨 넣지 마라.**

| 지점 | 어떻게 확장되는가 |
|---|---|
| `manifest.dataType` | **프로젝트를 만들 때 정해지고 안 바뀐다.** 어휘에는 지금 되는 것만 있다 — 값을 더하는 것은 그 종류를 구현하는 커밋이다 (`open-decisions.md`) |
| 큐 라우팅 | 타입 축이 이미 있다. 이미지 학습이 CSV 학습을 막지 않는다 |
| `dataset/` 레이아웃 | 타입별 구조가 명세돼 있다 (`mlpx-spec.md` §1) |
| `registry` | 알고리즘을 등록만 하면 된다 |
| `TrainingBackend` | 실행 위치를 갈아끼운다 |

- 화면의 능력 선언은 **§9**가 정한다.
- 업로드 요청 스키마가 단일 CSV를 전제하지 않게 한다.

---

## 7. 운영 비용과 실행 위치 정책

**아무도 공용 백엔드를 운영하지 않는다.** 공식 배포는 GitHub Pages 정적 페이지이고, 백엔드는
**필요한 학교가 직접 설치한다**(CLAUDE.md §1.1).

### 7.1 공용 서버는 왜 불가능한가

- **전국 단위로 퍼지면 서버 학습만으로는 구조적으로 버틸 수 없다.** 인증 없는 공개 연산, 계정이 부르는 개인정보,
  그리고 **수행평가 도중 서버가 죽으면 그 실패는 교사가 뒤집어쓴다.** 부하 계산은 `docs/cases/architecture.md` 같은 절.

### 7.2 결론: 공식 배포는 정적, 서버는 학교가 설치

| 누가 | 무엇을 | 어디서 | 우리 서버 비용 |
|---|---|---|---|
| 학생 | 모든 학습 | 브라우저 | **0** |
| 학생 | 큰 데이터·무거운 알고리즘 | 학교가 설치한 서버 | **0** (학교 부담) |
| 교사 | 제출물 재실행 대조 | 브라우저 | **0** |

- 자가호스팅 서버는 세션 동안만 캐시한다(§2.2). **세션을 넘어선 영구 보관은 하지 않는다.**

#### 자가호스팅은 https가 아니다 (2026-08-14)

- **보안 컨텍스트에서만 존재하는 브라우저 API를 쓰지 마라** (`crypto.subtle`, `crypto.randomUUID` 등).
  **`tests/secure-context-rules.spec.ts`가 막는다.** 못 보는 것은 실기기로 확인한다.

### 7.3 서버가 없는 것이 기본 상태다

- 프런트엔드는 **같은 오리진**의 헬스 엔드포인트로 `ServerStatus`를 정한다. 탐지 타임아웃은 짧게 잡는다.
  **탐지는 아직 없다**(`ml/server.ts`) — 지금은 늘 `unknown`이라 서버 칸은 늘 이유와 함께 닫힌다.
- 모델 선택 화면은 알고리즘마다 **실행 위치**를 보여준다.
- 서버가 없으면 서버 옵션을 **이유와 함께** 비활성화한다.
- 판정은 `frontend/src/ml/backend.ts`의 `runtimeOptions()`다.
- 확인 전 상태(`unknown`)는 서버를 열어 주지 않는다.

### 7.4 브라우저 학습 엔진의 전송량

- scikit-learn 엔진은 **우리가 서빙하지 않는다** — Pyodide 원본(`cdn.jsdelivr.net`)에서 직접 받는다.
- **학교 PC 캐시를 전제로 설계하지 마라.** 시동 비용은 학습마다 든다.
- **화면이 그 비용을 미리 말한다**(§3.3). 준비를 켜는 단추를 따로 두지 않는다.

### 7.4.1 첫 화면이 받는 양 (2026-08-05 실측)

- **무거운 것은 첫 화면 뒤에 둔다.** 라우트는 첫 화면(`/`)을 빼고 전부 지연 임포트이고, 엑셀 라이브러리·
  학습 엔진도 `await import` 뒤에 있다. 앞으로 더하는 무거운 것도 같은 자리에 둔다.
- **첫 화면(`/`)만은 정적 임포트다.** 지연이면 앱 코드를 다 받은 뒤 그 조각을 받으러 한 번 더 왕복한다.
  컴퓨터실 PC는 리셋을 전제하므로 **매 수업이 첫 방문**이다.
- **상수나 작은 함수 하나 때문에 무거운 모듈을 첫 화면에서 들이지 않는다.** 그 상수는 말단 파일로 뗀다.
  첫 화면 그래프는 `tests/entry-chunks.spec.ts`가 문다. zip 처리(`fflate`)와 스키마 검증(`zod`)은 아직
  첫 화면에 있다 — 경위가 그 길을 적는다.
- 빌드의 경고 기준은 `vite.config.ts`가 갖는다.

### 7.4.2 이미지 백본이 받는 양 (2026-08-12 실측)

- 백본(TensorFlow.js + MobileNetV2 가중치)은 **첫 화면에 얹지 않고**, 이미지 실험을 학습하거나 예측할 때 받는다.
- 런타임 선택의 근거는 `open-decisions.md`의 **"백본 추론은 TensorFlow.js가 돌린다"**.

### 7.5 검증은 브라우저에서 끝난다

- 교사는 **재실행 대조**로 확인하고 그 계산은 교사의 브라우저에서 일어난다 (`mlpx-spec.md` §7).
- 대조는 **run을 만든 엔진으로만** 한다(§3.2).

---

### 7.6 주소로 백엔드를 건네는 방안 — 제안, 아직 결정 아님 (2026-08-05)

> **이 절은 결정이 아니다.** 현재 규칙은 **"백엔드 주소를 설정 가능하게 만들지 마라"**이다.
> 제안과 막히는 것 넷(혼합 콘텐츠·CORS·주소가 곧 신뢰·들러붙음)은 `docs/cases/architecture.md` 같은 절에 있다.
> 채택되면 `CLAUDE.md` §2를 함께 고친다. 그 전에는 구현하지 마라.

---
