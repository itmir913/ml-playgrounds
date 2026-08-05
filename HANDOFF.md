# 핸드오버 — 학습 화면의 [학습] 버튼부터

기준 커밋: `b4fb6c4` (main, clean, `npm test` 초록 709 통과 / 2 건너뜀)

> **이 파일은 임시다.** 다음 세션이 읽고 나면 지워라. 오래 남을 내용은 전부
> `docs/` 안에 이미 들어가 있고, 여기 있는 것은 "지금 어디까지 왔나"뿐이다.

## 먼저 읽어라

`CLAUDE.md` → `docs/architecture.md` §8 → `docs/roadmap.md` 구현 순서 7 →
`docs/open-decisions.md`

## 지난 세션에 무엇이 바뀌었나

**화면의 경계를 다시 그었다.** 이게 가장 큰 변경이고 문서에 근거가 있다
(`open-decisions.md` "기계학습 유형은 모델을 고르는 자리에서 고른다").

```
전처리   타깃 · 특성 · 결측치/스케일링/인코딩 · 학습용과 평가용 나누기   ← 데이터만
학습     기계학습 유형 → 모델 선정(+ 실행 방법) → [학습]              ← 모델만
```

- `manifest.taskType`이 **선택 항목**이 됐다. 기본값이 없다 — 학생이 고른 분류와
  아무도 안 고른 분류가 파일에서 구분돼야 한다.
- 잠금 조건도 할 일과 **같은 필터**를 지난다(`factAppliesTo`). `train`이
  `targetChosen`을 요구해도 군집화가 안 막힌다.
- 모델은 **(모델, 실행 방법) 쌍으로 쌓는다.** 순수 JS 결정트리와 sklearn 결정트리를
  한 실험에 나란히 놓을 수 있다.
- 전처리에 **"빈 칸을 그대로 두기"**와 **분할 끄기**가 생겼다. 둘 다 어휘가 늘었지만
  `formatVersion`은 1 그대로다 (아래 참조).
- 랜덤 포레스트 기본 나무 100 → **10** (오렌지3 기본값, 교실 속도).

## 새로 만든 계층 (전부 순수 함수 + 테스트)

| 파일 | 하는 일 |
|---|---|
| `ml/hyperparams.ts` | 손잡이 서술(이름·타입·범위·기본값), 확정, 눈금 밖 판정 |
| `ml/engines/mljs-params.ts` | 순수 JS 엔진의 손잡이 표. **엔진 본체와 파일이 갈라진 이유는 번들이다** |
| `ml/selection.ts` | 열 판정(타깃/특성 issue·caution), 유형이 바뀔 때 뜻을 잃는 모델 |
| `project/settings.ts` | `settings.json`을 고치는 순수 함수들 |
| `project/dataset.ts`의 `readDataset` | 정본 CSV 파싱을 바이트에 매달아 캐시 |

## 다음에 할 일

1. **학습 화면의 [학습] 버튼** ← 지금 할 것.
   워커 껍데기는 이미 서 있다(`ml/worker/`). 필요한 것은 실행·진행 표시·취소와
   결과를 `ProjectFile`에 쓰는 경로다. 진행 표시는 **모델 단위**다 (`mlpx-spec.md` §0.3).
   버튼은 `AppButton`의 `action`으로 준다.
2. **결과 화면** — 순위표가 아니라 **변경 이력**이다 (§8.9). `experiment.changed`가 이미 있다.
   **분할을 끈 실험에는 "학습에 쓴 데이터로 매긴 점수"를 지표 옆에 붙여야 한다.**
3. 예측 화면 → 나머지 모델 형식 셋 (`open-decisions.md` #21)
4. 포트폴리오 화면
5. 키보드 단축키 — 배포 직전
6. 패널 크기 조절 + 레이아웃 기억

## 사용자가 답을 기다리는 것 둘

지난 세션 마지막에 사용자가 물었고 **아직 답을 못 준 것들이다.** 다음 세션은 지시를
기다리되, 물어보면 아래를 근거로 답하라.

### 1. 오렌지3 기능 중 고급 사용자(대학생·심화 고교생)용으로 도입할 것

조사는 끝났다(출처는 아래). 내 추천 순위:

| 기능 | 왜 | 비용 |
|---|---|---|
| **라벨 섞기** (Orange Randomize) | "내 모델이 진짜 배운 게 맞나"의 대조군. 정확도가 1/클래스수로 무너지는 것을 보는 장면 | 거의 공짜 — 라벨만 셔플 |
| **특성 중요도** (Orange Rank) | `run.featureImportance`가 **이미 스키마에 있다.** 트리 계열은 계산됨 | 낮음 — 결과 화면에 그리기만 |
| **혼동 행렬에서 틀린 행 보기** | `run.confusionMatrix`가 이미 있다. "무엇을 틀렸나"가 지표보다 교육적 | 중간 |
| **반복 홀드아웃 / 교차검증** | 오렌지 기본은 5겹 교차검증. 우리는 홀드아웃 1회라 **작은 데이터에서 지표가 크게 흔들린다** | 높음 — 인덱스 모양이 바뀌어 `formatVersion`이 오른다 |
| **별도 테스트 데이터 업로드** | 오렌지의 "Test on test data". 사용자가 예측 화면에서 이미 언급 | 중간 |
| 이산화 / 파생 열 | 나이 → 연령대, BMI = 몸무게/키². 교육 가치 크지만 식 파서가 필요 | 높음 |

**추천 안 함**: PCA(V4 로드맵), SHAP, Scoring Sheet, CUR, leave-one-out(n번 학습이라
브라우저에서 감당 안 됨), 모델 기반 결측 대체(계층이 꼬인다).

숨기는 방식은 이미 있다 — 하이퍼파라미터가 쓰는 `<details>` 접기.

### 2. 전처리 화면에 타깃·특성 설명문

**내 추천: 표 머리에 짧은 부제를 늘 보이게 두고, 접히는 도움말은 지금 만들지 마라.**

- 접힌 것은 안 펼친다. 필요한 것은 "타깃"이라는 낱말 옆의 두 마디다 —
  `타깃 / 예측할 값`, `특성 / 예측에 쓸 값`.
- 접히는 도움말을 지금 쓰면 **이미지 데이터가 들어올 때 틀린 문장이 된다**("열"이라는
  말이 성립하지 않는다). 그건 데이터 종류 등록부가 문구를 갖게 되는 §8.10의 일이다.

## 지뢰 (다시 밟지 마라)

지난 세션에 실제로 밟은 것들이다.

- **배포 전에는 버전을 올리지 마라.** `formatVersion`도 `MLJS_ENGINE.version`도.
  그 값들이 지키는 것은 밖에 나간 파일과의 호환성인데 나간 파일이 없다
  (`mlpx-spec.md` §9). `tests/schema-version.spec.ts`가 양방향으로 막는다 —
  **첫 배포 커밋에서 그 파일의 `RELEASED`를 뒤집고 배포 워크플로가 그 값을 확인해야 한다.**
- **화면이 몇 px 튀는 원인은 대개 셋이다.** 스크롤 막대 자리(`scrollbar-gutter`),
  머리 높이가 내용에 따라 달라지는 것(`min-h` + `items-start`), 화면마다 다른 래퍼 `gap`.
  마지막 것은 `ui-rules.spec.ts`가 검사한다.
- **키를 옮기면 참조가 남는다.** `locales.spec.ts`가 소스의 정적 `t('a.b')`를 훑어 막는다.
- **`RouterLink`에 `route.params`를 쓰지 마라.** 가드가 프로젝트를 여는 시점에는 주소가
  아직 옛것이라 던지고, 한 칸이 던지면 앱 전체가 갱신을 멈춘다. 출처는 스토어다.
- **잠긴 칸을 `RouterLink`로 두지 마라.** 같은 이유. `v-else`로 `span`을 쓴다.
- **정리를 화면 생명주기에 맡기지 마라.** 라우터 가드가 한다.
- **네이티브 `popover` 속성은 앵커가 안 된다.** `AppPopover`가 `absolute`로 붙인다.
- **칸의 안쪽 폭이 상태에 따라 달라지면 안 된다.** 테두리는 늘 두고 색만 바꾼다.
- **`items-center` 아래 `break-words`는 `w-full` 없이는 안 먹는다.**
- **vitest에서 `vi.useFakeTimers()`를 통째로 켜면 fake-indexeddb가 멈춘다.**
  `toFake: ['setTimeout', 'clearTimeout']`로 좁혀라.
- **IndexedDB 테스트에서 레코드를 직접 심을 때**는 앱 경로로 한 번 저장해
  오브젝트 스토어를 먼저 만들어라.
- **파이썬 힙 문서에서 `\b`를 쓰지 마라.** 정규식을 파일에 쓸 때 백스페이스 문자가
  섞여 들어가 검사가 조용히 아무것도 안 잡는다. 실제로 겪었다.
- **셸의 작업 디렉터리가 리셋된다.** `frontend`에서 도는 명령은 매번 `cd`를 붙여라.

## 커밋 규칙 (CLAUDE.md §4, 예외 없음)

- `main`에서 순차적으로. 기능 브랜치 금지.
- **GPG 서명 필수.** 실패하면 우회하지 말고 멈추고 보고하라.
- 커밋 메시지에 도구 표기(`Co-Authored-By` 등) 금지.
- **스테이징 경로를 명시하라.** `git add .` / `-A` / `commit -a` 전부 금지.
- 커밋 전에 `npm run lint && npm run typecheck && npm test`.
  **`frontend`에서 돌려야 한다.**

## 조사 출처 (오렌지3)

- [Select Columns](https://orangedatamining.com/widget-catalog/transform/selectcolumns/) — 역할 넷, 유형 선택 없음
- [Test and Score](https://orangedatamining.com/widget-catalog/evaluate/testandscore/)
- [owtestandscore.py](https://raw.githubusercontent.com/biolab/orange3/master/Orange/widgets/evaluate/owtestandscore.py) — 5겹 교차검증 기본, 홀드아웃 66:34 10회, 층화 on
- [owrandomforest.py](https://raw.githubusercontent.com/biolab/orange3/master/Orange/widgets/model/owrandomforest.py) — `n_estimators = 10`
- [owtree.py](https://raw.githubusercontent.com/biolab/orange3/master/Orange/widgets/model/owtree.py) — `max_depth = 100`
- [Preprocess](https://orangedatamining.com/widget-catalog/transform/preprocess/)
- [Data Sampler](https://orangedatamining.com/widget-catalog/transform/datasampler/) — 비율/개수, 층화, `Remaining Data` 출력
