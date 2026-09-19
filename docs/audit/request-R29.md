# R29 감사 요청서 — scikit-learn(Pyodide) 배선

> 앞 라운드: `docs/audit/request-R27.md` · `report-R27.md`
>
> 공통 규칙은 `docs/workflow.md` §3의 **"감사 국면은 어떻게 도는가"**부터 **"감사가
> 되풀이해 잡은 병"**까지다. **먼저 읽어라.** 금지 목록(커밋·`npm run lint`·디렉터리
> 단위 되돌리기·하위 에이전트)과 등급(A/B/C), 돌연변이 절차, 보고서 서식이 거기 있다.
>
> `git status --short`가 더러운 것은 정상이다 — 병렬 세션이 같이 돈다.

## 0. 이번 라운드의 방법과, 그 방법이 못 보는 것

**방법은 셋이다.**

1. **돌연변이** — 존재하는 코드 한 줄을 바꾸고 그 슬라이스의 스펙 + `vue-tsc`가 우는가.
2. **실측 상수 대조** — 이 라운드는 **숫자를 열일곱 개 새로 심었다.** 검사는 그 값이
   *맞는지*를 못 지킨다(그 값이 곧 기대값이므로). 그러니 **원본 실측 JSON과 상수를 눈으로
   맞춰라.** 값은 아래 §3에 있다.
3. **도달 경로 추적** — 잠금을 걷어낸 라운드다. *"이제 어디까지 닿는가"*가 바뀌었고,
   **새로 닿게 된 조합**이 이 라운드의 주된 위험이다.

**이 방법이 원리적으로 못 보는 것** (여기 시간 쓰지 마라):

- **진짜 브라우저에서만 나는 것.** 원격 모듈 import, 워커 경계의 구조화 복제, CDN 차단.
  `vitest`는 노드/jsdom이라 Pyodide를 아예 못 띄운다. 나는 **표 데이터 한 번만** 실물로
  돌려 봤다(붓꽃 18행, 의사결정트리, 크롬). **이미지 프로젝트는 실물로 안 돌려 봤다.**
- **화면 생김새와 문구 말투.** 사용자가 본다.

## 1. 대상 — 커밋 넷, `a404a8d..0c27d82`

```
6938659 docs: sklearn(Pyodide) 배선의 결정을 세우고 뒤집힌 자리를 고친다
e915714 feat: 실측 하니스가 sklearn을 띄우고, 그 값이 등록부의 칸을 채운다
cc745bf feat: 학습 워커가 scikit-learn을 원본에서 받아 띄운다
0c27d82 feat: scikit-learn 카드를 열고, 잠그는 대신 비용을 말한다
```

**결정문은 `docs/open-decisions/07-after-audit.md`의 "scikit-learn(Pyodide)은 원본에서
받고, 시동은 학습마다 낸다"다.** 코드를 읽기 전에 그것부터 읽어라 — 이 라운드의 코드는
전부 그 결정문의 귀결이다.

### 슬라이스

| # | 소유 경로 | 무엇인가 |
|---|---|---|
| S1 | `src/ml/engines/pyodide-runtime.ts` · `pyodide-sklearn.ts` | 띄우는 코드와 어댑터 |
| S2 | `src/ml/experiment.ts` · `src/ml/engines/index.ts` | `prepare`를 부르는 자리와 계약 |
| S3 | `src/ml/worker/{protocol,handler,client}.ts` · `src/composables/useTraining.ts` · `src/ml/training-status.ts` | 준비 국면이 화면까지 가는 길 |
| S4 | `src/ml/backend.ts` · `src/ml/selection.ts` · `src/views/train/{ModelAxes,ChosenModels}.vue` | 잠금 제거와 비용 표시 |
| S5 | `src/limits.ts` · `src/ml/algorithms.ts` | 새로 심은 상수 열일곱과 등록부 칸 |
| S6 | `frontend/tools/workloads.ts` · `frontend/scripts/{fetch-pyodide.mjs,notices.ts}` | 실측 하니스와 원격 감시·고지 |

## 2. 의심할 것 — 자리를 좁혀 준다

**아래는 내가 약하다고 아는 자리다. "더 있는지"만 봐라. 다만 내가 틀리게 알고 있으면
그건 새 항목이다.**

### 2.1 단정형 주석 넷 — 반증을 시도하라

이 라운드에서 내가 쓴 주석 중 **코드로 증명 안 한 것**들이다.

1. `errors.ts`의 `ENGINE_NOT_READY`: *"정상 경로로는 안 나온다"* — 정말 도달 불가인가?
   `pyodide-sklearn.ts`의 `fit`·`predict`가 `py === null`에서 던지는데, `prepare`가
   성공한 뒤 그 run이 실패하는 경로가 있는가(취소·워커 재사용·두 실험 사이).
2. `pyodide-runtime.ts`: *"모듈 상태가 워커 하나의 수명과 같다"* · *"메인 스레드에서는
   이 모듈이 로드될 일이 없다"* — `ml/engines/index.ts`를 import하는 곳을 전부 세어라.
   메인 번들에 이 모듈이 들어가면 그 말이 거짓이다.
3. `training-status.ts`의 `PREPARING_STATUS`: *"`EngineState`에 값이 하나 늘면 여기가
   컴파일에서 운다"* — 실제로 값을 하나 더해 봐라.
4. `backend.ts`: `preparation` 칸이 `TrainingEngine.prepare`와 짝이라는 주장
   (`tests/pyodide-runtime.spec.ts`가 문다고 적었다). **그 검사가 실제로 무는가.**

### 2.2 새로 닿게 된 조합

잠금이 없어졌으므로 **전에는 못 가던 곳에 간다.**

- **이미지 프로젝트 + sklearn.** 등록부는 일곱 알고리즘의 이미지 칸을 열어 두었다
  (`PYODIDE_IMAGE_*_ROW_LIMIT`). 임베딩 → sklearn 학습 경로가 실제로 서는가?
  **나는 실물로 안 돌려 봤다.**
- **상한 초과 + sklearn.** 자동 이동(`chooseRuntime`)이 mljs에서 넘친 run을 sklearn으로
  옮기는 경로가 열렸다. `tests/experiment.spec.ts`의 `tinyLimit`을 그래서 고쳤는데,
  **같은 병의 이웃이 더 있는지** `grep`으로 세어라.
- **상한 끄기 스위치 + sklearn** (`limits-switch.ts`). 꺼진 상태에서 sklearn 카드의
  판정과 문장이 어떻게 되는가.
- **재실행 대조 + sklearn**(`ml/reproduce.ts`). `engineStates`를 지웠다. 점검 화면이
  sklearn run을 만나면 무엇을 하는가 — `engineIsHere`가 버전 `'1'`로 맞춰 **대조를
  시도하고 실제로 Pyodide를 띄우려 드는가?** 교사 기기에서 27.3MB가 조용히 받아지는
  경로라면 A급이다.

### 2.3 기기 배수(교정)의 오염

`useTraining.ts`가 `ready`에서 `begunAt`을 다시 맞춘다. 그리고 `TrainView.vue`의
`onModelTimed`가 `runtime !== 'mljs'`를 거른다. **둘 중 하나만 있어도 통과하는가?**
하나를 지우고 남은 하나가 우는지 봐라 — 안 울면 그중 하나는 장식이다.

### 2.4 예상 시간이 sklearn 줄에서 틀린 수를 말하는 경로

`AlgorithmSpec.baseline`에 엔진 축이 **없다**(알고 있다, 로드맵 4단계). 화면 둘이
`mljs`만 예상을 내도록 막는다(`TrainView.vue`·`views/inspect/ReproducePanel.vue`).
**그 가드가 유일한가?** `baselineMs`·`estimateMs`·`hasEstimates`를 부르는 곳을 전부
세고, sklearn run이 mljs의 시간을 말하는 경로가 하나라도 있으면 **A급이다** — 사진
의사결정트리에서 그 차이가 24분 대 27초다.

### 2.5 검사 자체

- `tests/pyodide-runtime.spec.ts`는 **가짜 boot**로 순서만 본다. 그 가짜가 진짜보다
  관대한가? (이 저장소가 두 번 밟은 병이다)
- `tests/experiment.spec.ts`의 `offlineSklearn`이 진짜 엔진의 계약을 흉내내는가.
- `tests/bench-rules.spec.ts`의 새 규칙 다섯(`measurerFor`·`shapeFor`·`replyOf`·
  라벨·엔진 축 덮개)이 **겨냥한 것을 재는가** — 우는 이유가 다른 항목일 수 있다.

## 3. 실측 대조 — 검사가 못 지키는 자리

**이 라운드는 숫자 열일곱을 새로 심었다.** 검사는 그 값이 *맞는지*를 못 지킨다 — 그 값이
곧 기대값이기 때문이다. **그러니 여기는 눈으로 대조하는 자리다.**

**증인 셋을 서로 맞춰라.** 셋이 같은 말을 해야 하고, 갈리면 어느 쪽이 옮겨 적다 틀린 것이다.

1. **원본** — `docs/audit/r29-bench.json`. 2026-09-19에 사용자 크롬(8코어·8GB·Chrome 153)에서
   하니스 `tools/bench.html`의 [sklearn 훑기]가 낸 출력 그대로다. **다시 재면 재현된다.**
2. **상수와 그 주석** — `frontend/src/limits.ts`의 `PYODIDE_*_ROW_LIMIT` 열다섯 +
   `PYODIDE_DOWNLOAD_BYTES` · `PYODIDE_BOOT_MS`.
3. **결정문의 비교표** — `docs/open-decisions/07-after-audit.md`의 "scikit-learn(Pyodide)은
   원본에서 받고, 시동은 학습마다 낸다" 안의 표 둘(표·사진).

**어느 사다리가 어느 상수를 뒷받침하는지는 이름이 말한다** — `pyodide_image_svm`과
`pyodide_limit_image_svm`이 `PYODIDE_IMAGE_SVM_ROW_LIMIT`의 근거다. 상한 사다리
(`pyodide_limit_*`)가 그 알고리즘의 **가장 큰 점**을 들고 있다.

**특히 볼 것 넷.**

- **주석의 숫자가 원본과 같은가.** 열다섯 줄을 하나씩.
- **결정문 비교표의 배수가 실제로 나눠 맞는가** — 그 표는 `limits.ts`의 `MLJS_*_BASELINE_MS`와
  위 원본을 나눈 것이다. 예: *"사진 5,000장 의사결정트리 24분 → 27초, 53배"*.
- **시동 수치.** 나는 한 번 틀렸다 — 처음에 *"122회 중앙값 7,750"*이라고 적었는데
  원본을 세어 보니 **118회 · 중앙값 7,739**였다(`parts` 115 + `boots` 3). 같은 종류가
  더 있는지 봐라.
- **"실패 0건"이라는 주장.** 원본의 `failed`와 `stopped`가 비어 있는 것이 그 근거이고,
  거기서 **상한이 "깨지는 자리"가 아니라 "데이터 천장"이 된다**는 논리가 나온다.
  그 논리가 `limits.ts` 주석과 결정문에서 **같은 말을 하는가.** SVM만 20,000인 이유도.

## 4. 제외할 것

**설계 결정 넷은 사용자가 정했다. 반대 제안을 하지 마라.**

1. 시동을 학습마다 낸다(상주 워커를 안 만든다).
2. 준비를 켜는 단추를 따로 안 만든다([학습하기]가 선행한다).
3. 27.3MB는 원본이 서빙한다(Pages에 안 올린다).
4. `run.engine.version`에 sklearn 버전을 담고 재실행이 그 버전을 받는다(**아직 미구현**).

**이미 아는 부채 — 시간 쓰지 마라** (다만 *"틀린 수를 말한다"*면 그건 새 항목이다):

- 예상 시간의 엔진 축 없음 → 로드맵 4단계.
- 모델 직렬화기 없음 → sklearn run은 예측·재실행 대조가 막힌다. 로드맵 5단계.
- `run.engine.version`이 아직 `'1'` → 로드맵 6단계.
- 학교 PC·휴대폰 실측 없음 → `open-decisions.md` #3-1.

**그리고**: 버전 올리기 제안 금지. 문구 말투와 화면 생김새 금지(사용자가 본다).

## 5. 첫 돌연변이 다섯 — 여기서 시작하라

**심고 → 그 슬라이스 스펙 + `vue-tsc` → 즉시 파일 하나 경로로 되돌린다.**

1. `experiment.ts`의 `await engine.prepare?.(context.onPrepare)`를 지운다. (운다고 알고
   있다. **우는 이유가 겨냥한 것과 같은지** 봐라)
2. `pyodide-runtime.ts`의 `prepare`에서 `booting = null`(실패를 안 기억한다)을 지운다.
3. `useTraining.ts`의 `begunAt` 재설정을 지운다.
4. `backend.ts`의 `preparation` 칸을 `pyodide-sklearn`에서 뺀다.
5. `selection.ts`가 `preparation`을 실어 보내는 줄을 지운다.

**표에는 운 것까지 전부 적어라** — 안 운 것만 적으면 표본 크기를 모른다.

## 6. 규모

커밋 넷 · 신규 파일 셋(`pyodide-runtime.ts`·`fetch-pyodide.mjs`·`pyodide-runtime.spec.ts`) ·
대략 +2,400 / −400줄. 검사는 `npm run ci` 하나로 3,386개가 돈다(약 100초).
**`npm run lint`를 쓰지 마라** — 남의 작업 파일까지 고쳐 쓴다.
