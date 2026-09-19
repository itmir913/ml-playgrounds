# R29 감사 보고서 — scikit-learn(Pyodide) 배선

> 요청서: `docs/audit/request-R29.md` · 공통 절반: `docs/workflow.md` §3
> 대상: `a404a8d..0c27d82` (커밋 넷, 42파일 · +2,422 / −265) · 읽은 HEAD: `1ffe2b3`
> 감사자는 아무것도 고치지 않았다. 심은 것은 전부 파일 하나의 정확한 경로로 되돌렸고,
> 끝난 뒤 `git status --short`는 이 보고서 하나만 보인다.

## 0. 한 줄

**숫자 열일곱은 원본과 전부 같았고, 배선 자체도 옳다. 틀린 것은 "어디까지 닿는가"를
말하는 문장들이다** — *"sklearn run은 재실행 대조가 막힌다"*는 거짓이고(점검 화면이
그 run을 막지 않고 교사 기기에서 27.3MB를 조용히 받는다, A-1), *"화면 둘이 mljs만
예상을 내도록 막아 두어 틀린 수를 말하지는 않는다"*도 한 경로에서 거짓이다(B-1).

돌연변이는 **스물하나 심어 열하나가 울고 열이 조용했다.** 조용한 열 중 여덟이 **이번
라운드가 새로 놓은 코드**다 — 준비 국면이 워커 → 화면으로 가는 길은 조각마다 초록인데
**잇는 검사가 없다**(M18·M22·M6). 결정문을 뒤집은 날의 주석 열셋이 옛 결정을 그대로
말하고 있다(C-3).

## 1. 돌연변이 표 — 전체 (운 것 포함)

기준선: 슬라이스 스펙 15파일 `npx vitest run …` → **521통과**, `npx vue-tsc --build` 초록.
심고 → 그 슬라이스 스펙 + `vue-tsc` → **즉시 파일 하나의 경로로 되돌렸다**(편집 도구로
역편집. `git checkout --`은 안 썼다). "tsc만"은 **vitest는 조용하고 타입만 운 것**이다 —
우는 이유가 겨냥한 것과 다르므로 조용한 쪽으로 센다.

| # | 무엇을 뭉갰나 | 돌린 스펙 | 결과 |
|---|---|---|---|
| M1 | `ml/experiment.ts:597` `await engine.prepare?.(…)` 삭제 (요청서 #1) | 슬라이스 15 | **욺** 4건 — `prepare가 fit보다 먼저다` 등 셋 + `나란히 고를 수 있다`(가짜 sklearn이 `fit`에서 `ENGINE_NOT_READY`로 죽어 코드가 바뀜). **겨냥한 이유 그대로다** |
| M2 | `engines/pyodide-runtime.ts:213` `booting = null` 삭제 (요청서 #2) | 슬라이스 15 | **욺** 2건 — 겨냥한 `실패한 뒤에는 다시 띄워 본다` + `못 띄우면 ENGINE_BOOT_FAILED다`(둘째 부름이 날것 `Error`를 받아 부수적으로 욺) |
| M3 | `composables/useTraining.ts:200-203` `ready`에서의 `begunAt` 재설정 삭제 (요청서 #3) | 슬라이스 15 + `train-walk` `train-fail` `ui-rules` | **조용** (768통과 · tsc 초록) |
| M3b | `views/TrainView.vue:83` `runtime !== 'mljs' \|\|` 삭제 (§2.3의 다른 한쪽) | 위 + `calibration` | **조용** (783통과 · tsc 초록) |
| M4 | `ml/backend.ts:211` `preparation` 칸 삭제 (요청서 #4) | 슬라이스 15 | **욺** 3건 — `무거운 브라우저 엔진에는 prepare가 있다`(pyodide-runtime.spec) · `무엇이 드는지 선언한다`(runtime-options) · selection.spec 1. tsc도 욺(안 쓰는 import) |
| M5 | `ml/selection.ts:344` `preparation` 실어 보내는 줄 삭제 (요청서 #5) | 슬라이스 15 + `ui-rules` | **욺** 1건 — selection.spec `서버가 없는 것은 정상 상태다`(`preparation?.bytes > 0`) |
| M6 | `ml/training-status.ts:93-94` `downloaded: 'downloading'` · `ready: 'waiting'`으로 뒤섞음 | 슬라이스 15 + `ui-rules` `train-walk` `train-fail` `predict-lines` | **조용** (772통과 · tsc 초록) |
| M7 | `ml/backend.ts:47` `ENGINE_STATES`에 `'installing'` 추가 (요청서 2.1-3) | `vue-tsc` + 4스펙 | **욺(tsc)** — `training-status.ts(90,7)` **과 `data/kinds.ts(269,5)`** 둘 다 TS2741. 주석의 단정이 참이다 |
| M8 | `pyodide-runtime.ts:203` 둘째 부름의 `onState?.('ready')` 삭제 | `pyodide-runtime` `experiment` `worker` `training` | **욺** 1건 — `두 번째 부름은 다시 안 띄운다` |
| M10 | `ml/experiment.ts` `prepare`를 `assertInRange` **앞으로** 옮김 | `pyodide-runtime` `experiment` `worker` `reproduce` `hyperparams` | **조용** (210통과 · tsc 초록) |
| M11 | `scripts/notices.ts:125` `numpy 2.4.6` → `2.4.5` | `pyodide-runtime` `notices` `backbones` `experiment` | **조용** (158통과 · tsc 초록) |
| M12 | `ml/algorithms.ts:150,237` 표 칸의 `PYODIDE_SVM_ROW_LIMIT` ↔ `PYODIDE_KNN_ROW_LIMIT` 맞바꿈 | `algorithms` `bench-rules` `runtime-options` `limits-rules` | **욺** 2건 — `tabular 칸의 sklearn 상수 이름` + `상한 사다리의 라벨` |
| M13 | `tools/workloads.ts:1228` KNN 상한 사다리 라벨이 `PYODIDE_SVM_ROW_LIMIT`을 말하게 | `bench-rules` `algorithms` | **욺** 1건 — `상한 사다리의 라벨이 등록부와 같은 수를 말한다`. tsc도 욺(안 쓰는 import) |
| M14 | `tools/workloads.ts:143-146` `measurePyodide`가 `shapeFor`를 안 보고 늘 지도 갈래로 | `bench-rules` | **조용(vitest 47통과)** · tsc만 욺 — `measureKMeansPyodide` 미사용(TS6133). **겨냥한 것(군집 사다리를 분류 데이터로 잼)은 아무 검사도 안 문다** → C-6 |
| M15 | `engines/pyodide-sklearn.ts:280` `fit`의 `if (!py) throw` 삭제 | `pyodide-sklearn` `experiment` `hyperparams` | **욺** 1건 — `Pyodide가 없으면 던진다`. tsc도 욺(`py` possibly null) |
| M16 | `limits.ts:695` `PYODIDE_BOOT_MS` 7700 → 770 | `runtime-options` `selection` `limits-rules` `versions` `pyodide-runtime` `ui-rules` `train-walk` | **조용** (433통과) — 실측 상수는 검사가 못 지킨다(요청서 §0 그대로) |
| M17 | `ml/worker/client.ts:133` `if (!finished)` 가드 삭제 | `worker` `training` | **조용** (46통과) — `취소한 뒤 도착한 준비 보고는 버린다`가 **다른 이유로 초록**이다 → C-7 |
| M18 | `ml/worker/handler.ts:43-44` `onPrepare → emit('preparing')` 삭제 | `worker` `training` `experiment` `train-walk` `train-fail` | **조용** (164통과 · tsc 초록) → C-5 |
| M19 | `views/inspect/ReproducePanel.vue:186` `run.engine?.kind !== 'mljs'` 가드 삭제 (§2.4) | inspect 스펙 7 + `reproduce` `ui-rules` `estimate` | **조용** (382통과 · tsc 초록) |
| M22 | `composables/useTraining.ts:199` `statuses.value = withPreparing(…)` 삭제 | `training` `training-status` `train-walk` `train-fail` `worker` `ui-rules` `predict-lines` | **조용(vitest 303통과)** · tsc만 욺(`withPreparing` 미사용) |
| M28 | `views/train/ModelAxes.vue:151` `Math.ceil` → `Math.floor` (8초 → 7초) | `train-walk` `train-fail` `ui-rules` `selection` `i18n` `train-preparing` | **조용** (336통과) — 화면 문구는 어떤 검사도 안 읽는다(`grep engineCost tests/` 0건) |

**욺 11 · 조용 10.** 안 심고 육안으로 판정한 것 하나: `bench-rules`의 ``` `ladderPoint`가 그
판정대로 고른다 ```는 소스에 `measurerFor(ladder)`와 `measurePyodide(` 문자열이 있는지만 보므로
**두 갈래를 맞바꾼 삼항**도 통과한다(`toContain`은 자리를 안 본다).

### 재현용 임시 스펙 — 셋, 전부 통과 (쓰고 지웠다)

`tests/zz-r29-scratch.spec.ts`를 세워 **진짜 입구**(`reproduceBlockers` ·
`reproduceInputOf` · `runExperiment`)로 돌렸다. 저장소에 남기지 않았다.

| # | 무엇을 확인했나 | 결과 |
|---|---|---|
| S1 | 성공 run의 `engine`을 `{kind:'pyodide-sklearn', version:'1'}`로 바꾼 실험에 `reproduceBlockers` | **`[]`** — `ENGINE_MISSING`이 안 붙는다. `reproduceInputOf`가 낸 `selectedAlgorithms[0].runtime`은 `'pyodide-sklearn'` |
| S2 | `selectedAlgorithms: [{ algorithm: 'random_forest' }]`(실행 방법 없음) · `settings.runtime: 'mljs'` · `context.rowCount: 60_000` · 가짜 sklearn 엔진 | run의 `engine.kind === 'pyodide-sklearn'`, 가짜 엔진 로그 `['prepare', 'fit:random_forest']` — **자동 이동이 sklearn에 내려앉아 `prepare`를 부른다** |
| S3 | 같은 조건에 `runtime: 'mljs'`를 콕 집음 | `failed`, 가짜 엔진 로그 `[]` — 콕 집은 줄은 안 옮긴다 |

---

## 2. A급

### A-1. 점검 화면이 sklearn run을 막지 않고, [대조]가 교사 기기에서 27.3MB를 **조용히** 받는다

**자리** `src/ml/reproduce.ts:207-211` (`engineIsHere`) · `:450` (`reproduceBlockers`) ·
`src/views/inspect/ReproducePanel.vue:112-125` (막는 것 목록 → 단추) · `:240-241`
(`train(request, { createWorker: spawnTrainingWorker, … })`) · `src/ml/worker/handler.ts:43-44`
→ `src/ml/experiment.ts:597` → `src/ml/engines/pyodide-runtime.ts:114-121`.

**주장** 결정문·요청서·로드맵 셋이 같은 말을 한다 — *"sklearn으로 학습한 run은 …
예측 화면과 재실행 대조가 둘 다 막힌다"*(`docs/open-decisions/07-after-audit.md:779-781`),
*"이것이 없으면 sklearn run은 예측도 재실행 대조도 못 한다"*(`docs/roadmap/02-v6-v10.md:66`),
요청서 §4 *"sklearn run은 예측·재실행 대조가 막힌다"*. **대조는 안 막힌다.**
`engineIsHere`는 `run.engine`을 등록부의 `{kind, version}`과 맞추는데 sklearn 엔진의
버전이 `'1'`이고 파일에도 `'1'`이 적히므로(`pyodide-sklearn.ts:132`) **정확히 맞는다**(S1).
막는 것 목록이 비면 [대조하기]가 열리고, 누르면 점검 화면이 학습 워커에 `train` 요청을
보내며(`ReproducePanel.vue:240`), 워커의 `handleTrain`은 학습과 같은 `runExperiment`라
`trainOne`이 `prepare`를 부르고 → `bootPyodide`가 **원본에서 27.3MB를 받고 7.7초를
띄운다.** 교사 기기에서다.

**조용한 이유 셋.** (1) `ReproducePanel.vue`에는 `onPreparing`이 없다(`grep onPreparing
src/views/inspect/` 0건) — 워커가 `preparing`을 보내지만 `client.ts:133`에서 버려진다.
(2) 비용 문구(`train.engineCost`)는 학습 화면의 `ModelAxes.vue`에만 있다 — 학생은
고르기 전에 27MB를 듣는데 교사는 누르기 전에 못 듣는다. (3) 예상 시간은 `알 수 없음`이다
(`ReproducePanel.vue:186`). 교사가 보는 것은 `대조 중 (0/N)`이 다운로드 + 시동 동안
멈춰 있는 것이다.

**등급의 근거** 요청서 §2.2가 *"교사 기기에서 27.3MB가 조용히 받아지는 경로라면 A급"*
이라고 미리 정했고, 그 경로가 실재한다. 다만 **받는 것 자체는 결정문 넷째 조항의 설계다**
(*"교사의 브라우저가 학생 파일이 말하는 배포판을 내려받아 대조한다"*) — 결함은 받는 것이
아니라 **말없이 받는 것**과 **문서가 "막힌다"고 적은 것**이다. 오늘은 파일의 버전이
`'1'`이라 *어느 배포판을 받을지*가 파일에 없고, 그래서 대조는 언제나 **오늘 것**(314.0.7)
으로 돈다 — 결정문 넷째 조항이 막으려던 *"조용히 오늘 것으로 도는 재실행"*이 지금 모양이다.

**실측** S1(`reproduceBlockers` → `[]`, 재실행 요청의 runtime → `pyodide-sklearn`).
**Pyodide를 실제로 받는 것까지는 안 돌려 봤다** — 워커 경로는 학습과 같은 함수이고 학습
쪽은 요청서 §0이 브라우저에서 확인했다고 적었다.

**이웃** 같은 조회를 쓰는 자리는 `engineIsHere` 하나이고 부르는 곳은 `reproduceBlockers`
하나다. `compareRun`은 `sameEngine`으로 한 번 더 보지만 그건 **돌린 뒤**다. 한 군데뿐이다.

**처방(결정이 걸린다 — 문서가 먼저)** 둘 중 하나를 결정문에 적고 코드가 따른다.
(a) 6단계(`run.engine.version`에 sklearn 배포판) 전까지 `reproduceBlockers`가 sklearn run에
새 사유(`ENGINE_VERSION_UNKNOWN` 같은)를 붙여 막는다 — 그러면 문서의 "막힌다"가 참이 된다.
(b) 지금처럼 열되 점검 화면이 `onPreparing`을 받아 `다운로드 중·준비 중`을 보이고, 누르기
전에 `preparation`(27MB · 8초)을 학습 화면과 같은 문구로 말한다. 어느 쪽이든
**`07-after-audit.md:779-781`·`02-v6-v10.md:66`·요청서 §4의 "막힌다"는 지운다.**
넣어서 재지 않았다.

---

## 3. B급

### B-1. 실행 방법이 안 적힌 줄이 sklearn으로 **자동 이동**하면 학습 화면은 mljs의 시간을 말한다

**자리** `src/ml/experiment.ts:231-247` (`chooseRuntime` — `explicit`가 아니면
`wanted ?? usable[0]`) · `src/views/TrainView.vue:199-205` (`chosen`이 `one.runtime ??
current.runtime`으로 채움) · `:266` (`row.runtime !== 'mljs'` — **요청한 축**으로 거른다) ·
`:80-83` (`onModelTimed`는 `onStarted`가 준 **실제** 축으로 거른다).

**주장** 로드맵이 *"화면 둘이 이미 `mljs`만 예상을 내도록 막아 두어 **틀린 수를 말하지는
않는다**"*(`02-v6-v10.md:61-63`)라고 적었다. 학습 화면의 예상은 **요청한 실행 방법**을
보는데 실제로 도는 것은 워커가 `chooseRuntime`으로 정한다. 둘이 갈리는 조합이 하나 있다:

- 줄에 `runtime`이 없고(`schema.ts:663` — 선택 항목. `TrainView.vue:193-197`의 주석대로
  *"옛 파일이나 남의 파일에 그런 줄이 있다"*), 실험 기본이 `mljs`이며,
- 그 알고리즘의 mljs 칸만 넘치고 sklearn 칸은 안 넘친다. **등록부에서 그런 칸은 하나다** —
  표의 랜덤 포레스트(`MLJS_RANDOM_FOREST_ROW_LIMIT` 50,000 < `PYODIDE_RANDOM_FOREST_ROW_LIMIT`
  100,000). 나머지 열넷은 두 칸이 같은 수다(SVM 20,000 = 20,000 포함).

그 줄은 화면에서 `mljs`로 보이고 예상은 mljs 기준표를 5만 행 위로 **외삽한 분 단위**를
말하며, 워커는 sklearn으로 옮겨 27.3MB를 받는다(S2). 비용 문구는 뜬 적이 없다 —
`ModelAxes.vue`의 `preparation`은 *지금 고른* 실행 방법만 본다.

**등급의 근거** 요청서 §2.4는 *"하나라도 있으면 A급"*이라 했다. **B로 내린 이유 둘**:
닿는 조건이 좁고(랜덤 포레스트 · 50,001~100,000행 · 실행 방법 없는 줄 — 학습 화면의
`addModel`은 늘 `runtime`을 적으므로 이 화면이 만든 파일로는 안 닿는다), 그리고 **결정이
걸린다** — *자동 이동이 `preparation`(비용)이 있는 실행 방법에 내려앉아도 되는가.*
요청서 §2.2가 이 경로를 *"열렸다"*고 알고 있지만 **화면이 그것을 말하지 않는다**는 것은
몰랐다. 화면을 몰아 보지는 않았다(S2는 워커 쪽 함수까지다).

**이웃** `tinyLimit`의 병(등록부를 mljs만 좁혀 실험을 돌리는 검사)은
`tests/experiment.spec.ts:1765` 한 군데뿐이다 — `grep "maxRows: {" tests/*.spec.ts` 중
`runExperiment`까지 가는 것은 그 하나다. 제품 코드의 이웃은 위 "칸 하나"다.

**처방(결정이 먼저)** (a) `chooseRuntime`의 자동 이동 후보에서 `preparation`이 있는
실행 방법을 빼고, 그 run은 `DATASET_TOO_LARGE_FOR_BROWSER`로 실패시킨다 — 학생이 sklearn을
콕 집으면 그때 비용을 듣고 돈다. 또는 (b) 이동을 허용하되 `chosen`이 `runtimeOptions`로
**실제로 돌 실행 방법**을 계산해 보이고 그 줄에 비용을 붙인다. (a)가 결정문 *"잠그지 않는
대신 미리 알린다"*와 맞는다. 넣어서 재지 않았다.

---

## 4. C급

### C-1. *"4,000장까지는 sklearn이 4.5배 빠르다(30.6초 대 137.8초)"*는 서로 다른 점을 나눈 수다

**자리** `frontend/src/limits.ts:633-634` · `docs/open-decisions/07-after-audit.md:739-740`.
**주장** 30.6초는 `pyodide_limit_image_svm@4000`(30,553ms)이고 137.8초는
`MLJS_IMAGE_SVM_BASELINE_MS`의 **5,000장**(137,798ms)이다 — 순수 JS 표에는 4,000장 점이
없다(`[500, 1000, 2000, 3000, 5000]`). 같은 점에서 나누면 3,000장이 31,785 / 13,330 =
**2.4배**이고 결정문의 표 자체가 그렇게 적었다. 그리고 두 증인이 다르다: 결정문은 *"30.5초
대 137초"*, 상수 주석은 *"30.6초 대 137.8초"* (원본은 30,553 · 137,798). **"5,000장에서
뒤집힌다"는 참이다**(137,798 < 155,370) — 틀린 것은 4.5배 하나다.
**이웃** 결정문 표 열한 줄을 전부 다시 나눴다(§6). 다른 줄은 전부 같은 점이다. 한 군데뿐이다.
**처방** 두 자리에서 "4.5배"를 지우고 3,000장의 2.4배(같은 점)로 바꾸거나, 4,000장은
순수 JS 점이 없다고 적는다.

### C-2. *"나이브 베이즈와 선형 회귀는 데이터 왕복이 지배한다"*는 그 사다리 자신이 반증한다

**자리** `docs/open-decisions/07-after-audit.md:743-745`.
**주장** 원본의 `pyodide_linear_regression`은 1,000행 **477** · 5,000행 **453** · 20,000행
559 · 50,000행 723 · 100,000행 1,003ms다. 데이터가 5배 늘어도 시간이 안 늘었으므로
**~450ms의 바닥은 데이터 왕복이 아니라 점마다 새로 무는 고정 비용**이다(왕복이면 8,000개와
40,000개가 같을 수 없다). 다른 사다리도 같은 바닥을 갖는다 — 의사결정트리 250~2,000행이
전부 641~644ms, SVM 250~1,000행이 497~509ms, 랜덤 포레스트 250행 1,059ms, 나이브 베이즈만
103ms. 알고리즘마다 바닥이 다르고 sklearn 하위 모듈의 무게 순서와 같다(`ensemble` >
`tree` ≈ `neighbors` > `svm` ≈ `linear_model` > `naive_bayes`). **기전은 추정이다**:
`bootPyodide`는 `import sklearn`까지만 미리 지나고(`pyodide-runtime.ts:135`), 어댑터의
`from sklearn.linear_model import LinearRegression`(`pyodide-sklearn.ts:213`)은 `fit` 안에서
처음 든다. Pyodide를 못 띄워 재지는 않았다.
**따라 틀리는 문장** `pyodide-runtime.ts:128-130` *"안 하면 이 4초가 첫 모델의 학습 시간으로
들어간다"* — 4초는 빠지지만 **0.1~1.1초는 여전히 첫(그리고 점마다 새 워커인 하니스에서는
모든) 학습 시간에 들어간다.** 100,000행 선형 회귀 1,003ms 중 ~450ms가 그것이라 *"2.4배
느림"*의 절반은 계산이 아니다.
**처방** 결정문의 "왕복이 지배한다"를 "점마다 드는 고정 비용(추정: 하위 모듈 임포트)이
지배한다. 재지 않았다"로 바꾸고, 재려면 `bootPyodide`의 워밍업에 여덟 클래스 임포트를
넣은 뒤 같은 사다리를 다시 돌려 바닥이 사라지는지 본다.

### C-3. 결정을 뒤집은 날의 주석 열셋이 옛 결정을 말한다 — **유창하게 틀린 주석**

전부 `grep -rn "26\.3MB\|15\.4초\|준비하세요\|needsPreparation\|isReady\|상태 점검에서\|여덟
줄이 전부\|상한 사다리는 아직 없다\|SVM이 먼저 깨질\|누르면 되고" frontend/src frontend/tests
frontend/tools`로 셌다(역사로 표시된 줄은 뺐다). **13곳 · 9파일.**

| 자리 | 무엇이 틀렸나 |
|---|---|
| `src/ml/engines/pyodide-sklearn.ts:9-12` | *"26.3MB + 시동 15.4초 … 학생이 상태 점검에서 '준비'를 눌렀을 때 … `runtimeOptions`가 `isReady`를 보므로 `fit()`이 불리는 일이 없다"* — 넷 다 오늘의 코드가 아니다. `:158-160` *"`setPyodide()`를 부르는 코드가 없어 도달하지 않지만"*도 이제 거짓이다 |
| `src/ml/engines/index.ts:100-101` | *"`RuntimeSpec.needsPreparation`과 짝이다 … `tests/runtime-options.spec.ts`가 운다"* — 그 필드는 없다(`preparation`이다). 무는 검사는 M4대로 `pyodide-runtime.spec.ts`가 먼저고 runtime-options는 둘째다 |
| `src/ml/engines/index.ts:109-110` · `src/ml/backend.ts:197-198` · `src/ml/engines/mljs.ts:4` | *"scikit-learn은 26.3MB에 시동 15.4초라 기본값이 될 수 없다"* — 27.3MB · 7.7초 |
| `src/ml/backend.ts:43-45` | *"실측 15.4초 … (open-decisions.md '무거운 엔진은 상태 점검에서 학생이 켠다')"* — 뒤집힌 결정문을 근거로 가리킨다 |
| `src/ml/backend.ts:375-377` | *"마지막이 엔진 준비 상태다. 데이터가 너무 크면 엔진을 준비해도 소용없으므로 크기가 준비 상태보다 앞에 온다"* — 그 가지는 이 라운드가 지웠다 |
| `src/ml/browser.ts:4-7` | *"학생이 상태 점검에서 켠다 … 로딩 시점을 자동으로 정하지 않는다. 교사가 부하 타이밍을 쥐어야 한다"* — 결정문이 정확히 반대로 뒤집었다 |
| `src/ml/experiment.ts:223, 290` | *"'엔진을 준비하세요'에는 학생이 할 일이 있다"* — 그 사유도, 할 일도 없어졌다 |
| `src/errors.ts:46` | `ENGINE_BOOT_FAILED` 설명의 *"저쪽(`ENGINE_NOT_READY`)은 누르면 되고"* — 누를 자리가 없다. 바로 위 `:36-38`이 그렇게 적었다 |
| `tools/workloads.ts:1014` | *"**상한 사다리는 아직 없다.**"* — 200줄 아래 `PYODIDE_LIMIT_LADDERS` 여섯이 있다 |
| `tools/workloads.ts:1214` | *"**SVM이 먼저 깨질 것이다.** N×N 커널이라 2만 행이면 3.2GB … 워커가 죽는 것으로 온다"* — 결정문이 *"그 예상은 틀렸다. 표 20,000행이 살아남았다"*고 적었다. 같은 라운드의 두 증인이 반대말을 한다 |
| `tests/bench-rules.spec.ts:206, 758` | *"sklearn 칸은 여덟 줄이 전부 `UNMEASURED`인데"* — 같은 라운드가 채웠다 |
| `tests/reproduce.spec.ts:566-569` | *"스냅샷대로 다시 돌리면 그 방법이 준비되지 않았다며 실패 run이 된다"* — 지금은 준비돼서 **돈다**(A-1의 경로) |
| `scripts/notices.ts:110` | *"두 값이 같은지는 `tests/notices.spec.ts`가 문다"* — 그 파일에 `RUNTIMES`도 `pyodide`도 없다(`grep` 0건). 무는 것은 `tests/pyodide-runtime.spec.ts:56-62`다 |

문서 쪽 이웃 둘은 역사 서술이라 안 셌지만 **가리키는 말이 없다**:
`docs/roadmap/01-v1-v5.md:158-167`(*"배선이 붙는 날 되돌리는 것은 한 줄이다: `preparable`을
참으로 …"* — 실제로는 잠금을 지웠다) · `:313`(*"`engineStates`가 지금 빈 객체다"* — 지웠다).

### C-4. *"메인 스레드에서는 이 모듈이 로드될 일이 없다"*(`pyodide-runtime.ts:21-22`)는 거짓이다

`ml/engines/index.ts`를 들여오는 곳(`grep -rn "from '.*engines'" src`): `ml/experiment.ts:44` ·
`ml/reproduce.ts:34`. `reproduce.ts`는 점검 화면(`views/inspect`)이 메인에서 쓰고,
`experiment.ts`는 `ml/worker/client.ts`가 `assembleExperiment`를 값으로 들여오므로 **메인
번들에 든다.** 해가 없는 이유는 같은 파일의 다음 문장(*"`prepare()`를 안 부르면 아무 일도
안 일어난다"*)이 참이어서다 — 원격 `import()`는 `bootPyodide` 안에만 있다. 앞 문장만 지우면
된다. 덤: `:147-160` *"파이썬이 스스로 답한 버전들. 우리가 적은 것이 아니라 물어본 것"* —
`"pyodide": "${PYODIDE_VERSION}"`은 우리가 적어 넣은 상수다(`pyodide.version`을 물을 수 있다).

### C-5. 준비 국면이 워커에서 화면까지 가는 길은 **조각마다 초록인데 잇는 검사가 없다**

세 조각의 검사가 각각 있다 — `runExperiment`가 `onPrepare`를 부른다(experiment.spec),
`preparing` 메시지가 `onPreparing`에 닿는다(worker.spec, **가짜 워커가 메시지를 직접 쏜다**),
줄 상태 표가 있다(training-status.ts). **사이가 비어 있다**:

- **M18** `handler.ts:43-44`(`onPrepare` → `emit({type:'preparing'})`) 삭제 → 조용. 워커가
  준비를 아예 안 알려도 아무 검사가 모른다.
- **M22** `useTraining.ts:199`(`onPreparing` → `withPreparing`) 삭제 → vitest 조용.
- **M6** `PREPARING_STATUS`를 `ready: 'waiting'`으로 뒤섞음 → 조용. 이러면 시동 뒤 학습 내내
  줄이 `대기 중`이고 시계도 안 돈다(`ChosenModels.vue:194-198`의 `ticking`이 `waiting`을 뺀다).
  `training-status.spec.ts`에 `withPreparing`이 한 줄도 없다.

세 곳을 한 검사로 잇는 것은 `useTraining`을 가짜 워커(`training.spec.ts`의 `harness`)로
돌려 `preparing` 메시지 → `statuses` 값(`downloading`·`starting`·`running`)까지 보는 것이다.
`handler.ts` 쪽은 `worker.spec.ts`의 워커 쪽 검사에 `prepare`가 있는 가짜 엔진을 넣어
`preparing`이 **emit되는지**를 본다.

### C-6. `bench-rules`의 군집 갈래 검사는 `shapeFor`를 재지 `measurePyodide`를 안 잰다

**자리** `tests/bench-rules.spec.ts` ``` `sklearn K-평균 사다리는 군집 갈래로 간다` ``` ·
``` `군집 갈래 판정이 알고리즘을 본다` ```. 둘 다 `shapeFor(job)`의 답만 본다. M14로
`measurePyodide`가 그 답을 안 보게 하자 vitest는 47개 전부 초록이었고 tsc만 *"함수를 안
쓴다"*로 울었다 — **`measureKMeansPyodide`를 다른 데서 한 번 부르기만 해도 아무것도 안
운다.** 검사의 머리말이 막으려던 것(R15-A-1, 군집 사다리를 분류 데이터로 잼)이 정확히
그 자리다. 소스 정규식으로 보든(``` `ladderPoint` ``` 검사처럼) `measurePyodide`를 가짜
`pyodideFit`으로 돌려 보든, **`measurePyodide` 몸통이 `shapeFor`를 지나는지**를 봐야 한다.

### C-7. `client.ts:133`의 `if (!finished)`는 죽은 가드이고, 검사는 다른 이유로 초록이다

`settle()`이 `worker.onmessage = null`을 먼저 한다(`client.ts:97-105`). 그래서 취소 뒤에는
`preparing`이 이 함수까지 **오지 않는다** — 같은 파일 `progress` 가지의 주석(*"지금은 여기
못 닿는다"*)이 그렇게 적었고, M17로 가드를 지워도 `취소한 뒤 도착한 준비 보고는 버린다`가
초록인 이유가 그것이다. 그런데 새로 쓴 주석은 *"취소한 뒤에 도착한 보고는 버린다"*고
가드가 하는 일처럼 적었다. 이웃: `started`·`prelude` 가지의 같은 가드도 같은 모양이다
(이번 라운드 것은 아니다). 가드를 남기려면 `progress` 가지처럼 *"못 닿는다"*로 적고, 검사는
`onmessage`를 떼기 **전에** 도착하는 경우(가짜 워커가 `cancel` 동기 안에서 쏘는 것)를
만들거나 지운다.

### C-8. `PYODIDE_SVM_ROW_LIMIT` 주석의 *"저쪽은 27.1분이 걸린 20,000"*은 다른 기계의 수다

**자리** `limits.ts:609`. 27.1분은 2026-09-10 **젠북 UM425I(교정 배수 0.88)**에서 잰 값이고
(`limits.ts:369-370`), 이쪽 30초는 2026-09-19 **개발 PC(8코어)**다. 같은 자리처럼 적혀
있다. 결정문 표의 SVM 줄(3,000행 14,671 대 1,019)은 같은 기계라 문제없다. 한 군데뿐이다.

### C-9. 검사 둘의 작은 구멍

- `tests/pyodide-runtime.spec.ts:115-126` `못 띄우면 ENGINE_BOOT_FAILED다` — 코드 확인이
  `catch` 안에만 있고 `expect.assertions`가 없다. 둘째 `prepare`가 안 던지면 **아무것도 안
  재고 초록**이다(같은 모양의 `pyodide-sklearn.spec.ts:123`은 `expect.assertions(2)`를 둔다).
- **M10** — `experiment.ts:595`의 *"눈금 검사보다 뒤다. 손잡이가 범위 밖이면 27MB를 받기
  전에 거절한다"*를 어떤 검사도 안 문다. 범위 밖 손잡이 + `prepare`가 기록하는 가짜 엔진
  하나면 된다.
- **M11** — 고지의 *"scikit-learn 1.8.0 · numpy 2.4.6 · scipy 1.18.0 · joblib 1.5.3 ·
  threadpoolctl 3.6.0"*(`notices.ts:125`)은 어떤 검사도 안 읽는다(`pyodide-runtime.spec`은
  Pyodide 버전 문자열만 본다). 오늘은 락 파일과 다섯 다 같다(`.cache/pyodide/pyodide-lock.json`
  으로 확인). `fetch-pyodide.mjs`의 `EXPECTED`에 joblib·threadpoolctl을 더하고 고지 문자열을
  그 표에서 조립하면 한 자리가 된다.

---

## 5. 요청서 §2에 대한 답

### 2.1 단정형 주석 넷

1. **`ENGINE_NOT_READY` "정상 경로로는 안 나온다" — 참.** `prepare`는 `trainOne` 안에서
   `fit` 바로 앞이고 같은 워커다(`experiment.ts:597-600`); 취소는 `terminate`라 워커째
   죽는다; `resetPyodide`·`resetPyodideRuntime`을 앱 코드가 부르는 곳은 0건(`grep src`);
   두 실험 사이에 워커가 살아남더라도 `booting`·`py`가 함께 살아 `ready`다. 닿는 것은
   가짜 엔진(M1이 보여 줬다)과 하니스뿐이다. 다만 로케일 문장 *"여기서 학습하려면 준비가
   먼저 끝나야 합니다"*는 나온다면 갈 곳이 없는 문이라, 그물이면 그물의 말(*"다시 시도"*)이
   맞다.
2. **"메인 스레드에서는 이 모듈이 로드될 일이 없다" — 거짓.** C-4.
3. **`PREPARING_STATUS`가 컴파일에서 운다 — 참.** M7: `training-status.ts(90,7)` TS2741. 덤으로
   `data/kinds.ts(269,5)`도 운다 — 그 표도 `Record<EngineState, …>`다.
4. **`preparation` ↔ `prepare` 짝을 `tests/pyodide-runtime.spec.ts`가 문다 — 참.** M4.

### 2.2 새로 닿게 된 조합

- **이미지 + sklearn.** 실물로는 못 돌렸다(§7). 정적으로는 선다: 사진 벡터는 `ml/images.ts:91,
  155, 226`에서 `String(value)` 칸의 표가 되고 `transform`이 `number[][]`로 되돌려
  `FitInput.features`에 실린다 — 어댑터의 `_X_train_js.to_py()`가 받는 모양이 하니스의
  `syntheticData`(1,280열 `number[][]`)와 같다. 이미지 칸은 열넷 전부 `MAX_IMAGE_COUNT`라
  **넘쳐서 자동 이동하는 경우는 없다.**
- **상한 초과 + sklearn.** B-1. 제품 코드에서 갈리는 칸은 랜덤 포레스트(표) 하나이고,
  검사의 이웃(`tinyLimit`)은 한 군데다.
- **상한 끄기 + sklearn.** `limitsOff`는 `runtimeOptions:411`의 한 가지만 끈다. 꺼지면
  넘치는 칸이 없으므로 자동 이동도 없고, sklearn 카드는 켜진 채 `preparation`을 든다.
  `runtime-options.spec`의 *"엔진이 안 왔으면 켜도 안 열린다"*를 지운 것이 맞다 — 잠길 일이
  없다. 문장은 안 바뀐다.
- **재실행 대조 + sklearn.** A-1.

### 2.3 기기 배수의 오염 — 둘 중 하나만 있어도 통과하는가

**둘 다 어떤 검사도 안 문다**(M3·M3b 조용). 코드로 읽으면: `TrainView.vue:83`의 필터는
`onStarted`가 준 **실제** 실행 방법을 보므로 **혼자서 충분하다**; `useTraining.ts:200-203`의
`begunAt` 재설정은 **혼자서는 부족하다**(sklearn의 계산 시간이 mljs 기준표의 배수로
들어간다 — 기준표에 엔진 축이 없다). 그리고 오늘은 **장식이다**: `prepare`가 있는 엔진은
sklearn뿐이고 sklearn은 필터가 버리므로 재설정이 무엇을 바꾸는 경로가 없다. 엔진 축이
붙는 날(로드맵 4단계) 살아나는 코드이니 지우자는 것은 아니다 — 다만 *"학생이 기다리는
시간은 여전히 둘의 합"*이라는 주석보다 *"지금은 필터가 먼저 버린다"*가 정확하다.

### 2.4 예상 시간이 sklearn 줄에서 틀린 수를 말하는 경로

부르는 곳 셋(`grep baselineMs\|estimateMs\|hasEstimates src`): `TrainView.vue:84`(`onModelTimed`,
실제 축) · `:272`(`estimates`, **요청한 축**) · `ReproducePanel.vue:187`(`run.engine.kind`,
실제 축). 가드는 셋 다 있으나 **축이 갈린다** — 같은 판정을 한 벌로 계산해도 좁히는 인자가
다른 그 병(workflow §3 여덟 중 6)이고, B-1이 그 틈이다. `ReproducePanel`의 가드는 M19에서
조용했다.

### 2.5 검사 자체

- **가짜 boot가 진짜보다 관대한 자리 둘.** (1) 동기로 즉시 성공한다 — 진짜는 7.7초 동안
  약속이 떠 있고, 그 사이 둘째 `prepare`는 **`ready`를 먼저 말하고 나서 기다린다**
  (`pyodide-runtime.ts:203-204`). 실험이 모델을 하나씩 돌아 지금은 못 닿지만 가짜는 이 순서를
  영영 못 본다. (2) `setPyodide`를 안 부른다 — `prepare` 성공 뒤 `fit`이 실제로 열리는지는
  이 파일이 안 본다(가짜의 계약이 `Boot`까지라 어쩔 수 없고, 그 대신 M1이 `offlineSklearn`의
  진짜 `fit`으로 그 문을 보여 줬다).
- **`offlineSklearn`은 진짜 엔진의 계약을 흉내낸다** — 진짜를 펼치고 `prepare`만 바꿨으므로
  `fit`·`resolve`·`parameters`가 진짜다. M1에서 `ENGINE_NOT_READY`가 튀어나온 것이 그
  증거다.
- **`bench-rules`의 새 규칙 다섯.** `measurerFor`·`replyOf`·라벨·엔진 축 덮개는 겨냥한
  것을 잰다(M12·M13이 라벨과 상수 이름 둘 다 물었다; 덮개는 자기 반례를 갖는다).
  **`shapeFor`는 아니다** — C-6. `ladderPoint` 검사는 문자열만 본다(§1 끝).

---

## 6. 실측 대조 — 증인 셋

원본 `docs/audit/r29-bench.json`을 파이썬으로 열어 셌다(값을 옮겨 적지 않고 계산했다).

**시동.** `parts` 115 + `boots` 3 = **118회** · 총합 중앙값 **7,739** · 범위 **7,549~8,732** ·
국면 중앙값 코어 **1,591** · 휠 **1,970.5** · 임포트 **4,172**. `limits.ts:684-686`(7,739 ·
7,549~8,732 · 1,591/1,970/4,172)과 결정문 `:674-675`(7.55~8.73 · 7.74 · 1.59/1.97/4.17) 둘 다
맞다. `PYODIDE_BOOT_MS` 7700은 중앙값을 내린 수이고 화면은 올림(8초)이라 문제없다.
*"122회 · 7,750"* 같은 종류는 더 없었다.

**상수 열다섯의 주석 숫자** — 전부 원본과 같다.

| 상수 · 주석의 수 | 원본(사다리@점) |
|---|---|
| `PYODIDE_DECISION_TREE` 100,000행 4.7초 | `pyodide_limit_decision_tree@100000` 4,677 |
| `PYODIDE_KNN` 16.4초 | `pyodide_limit_knn@100000` 16,357 |
| `PYODIDE_RANDOM_FOREST` 55.0초 | `pyodide_limit_random_forest@100000` 54,957 |
| `PYODIDE_NAIVE_BAYES` 0.5초 | `pyodide_naive_bayes@100000` 515 |
| `PYODIDE_LOGISTIC_REGRESSION` 1.4초(천장) | `pyodide_logistic_regression_ceiling@100000` 1,448 |
| `PYODIDE_LINEAR_REGRESSION` 1.0초 | `pyodide_linear_regression@100000` 1,003 |
| `PYODIDE_KMEANS` 10.7초 | `pyodide_k_means@100000` 10,685 |
| `PYODIDE_SVM` 20,000행 30.0초 | `pyodide_limit_svm@20000` 30,033 |
| `PYODIDE_IMAGE_DECISION_TREE` 27.1초 | `pyodide_image_decision_tree@5000` 27,122 |
| `PYODIDE_IMAGE_RANDOM_FOREST` 41.7초 | `pyodide_limit_image_random_forest@5000` 41,660 |
| `PYODIDE_IMAGE_SVM` 155.4초 · 4,000장 30.6초 | `pyodide_limit_image_svm@5000` 155,370 · `@4000` 30,553 |
| `PYODIDE_IMAGE_KNN` 4.2초 | `pyodide_image_knn@5000` 4,158 |
| `PYODIDE_IMAGE_NAIVE_BAYES` 1.9초 | `pyodide_image_naive_bayes@5000` 1,875 |
| `PYODIDE_IMAGE_LOGISTIC_REGRESSION` 22.4초(천장) | `pyodide_image_logistic_regression_ceiling@5000` 22,351 |
| `PYODIDE_IMAGE_KMEANS` 4.2초 | `pyodide_image_k_means@5000` 4,184 |

**결정문 비교표의 배수** — `MLJS_*_BASELINE_MS`의 같은 점으로 나눴다.

| 줄 | 순수 JS | sklearn | 나눈 값 | 표 |
|---|---|---|---|---|
| 나이브 베이즈 100,000 | 154 | 515 | 3.34배 느림 | 3.3 ✓ |
| 선형 회귀 100,000 | 414 | 1,003 | 2.42배 느림 | 2.4 ✓ |
| K-평균 100,000 | 13,181 | 10,685 | 1.23 | 1.2 ✓ (분자는 §7 참조) |
| KNN 10,000 | 2,249 | 872 | 2.58 | 2.6 ✓ |
| SVM 3,000 | 14,671 | 1,019 | 14.4 | 14 ✓ |
| 의사결정트리 20,000 | 160,179 | 1,154 | 138.8 | 139 ✓ · "2분 40초 → 1.2초" ✓ |
| 랜덤 포레스트 5,000 | 54,054 | 2,399 | 22.5 | 23 ✓ |
| 사진 의사결정트리 5,000 | 1,439,103 | 27,122 | 53.06 | 53 ✓ · "24분 → 27초" ✓ |
| 사진 랜덤 포레스트 2,000 | 1,838,443 | 10,266 | 179.1 | 179 ✓ · "31분 → 10초" ✓ |
| 사진 SVM 3,000 | 31,785 | 13,330 | 2.38 | 2.4 ✓ |
| 사진 SVM 5,000 | 137,798 | 155,370 | 0.89 | "sklearn이 더 느리다" ✓ · "4,000→5,000에서 5.1배" = 155,370/30,553 = 5.09 ✓ |
| 사진 SVM "4,000장까지 4.5배" | (4,000장 점 없음) | 30,553 | — | **✗ C-1** |

**"실패 0건".** `failed` `{}` · `stopped` `[]` · `running` `null` · `wentHidden` `false` ·
`measured` 23사다리(상한 사다리 6) — 결정문의 *"사다리 스물셋 · 상한 사다리 여섯 · 실패
0건 · 멈춘 사다리 0건"*과 같고, *"열다섯 사다리가 전부 끝까지"*(첫 훑기 8+7)도 맞다.
`limits.ts:534-545`와 결정문 `:762-772`가 **같은 논리**(안 깨졌고 위가 없으면 천장 · SVM만
사다리의 끝이라 20,000)를 같은 말로 한다. **SVM 20,000 위쪽을 안 열었다**는 것도 두 곳이
같다. 다만 `workloads.ts:1214`(C-3)는 반대말을 한다.

**그 밖에 같은 것.** 27.3MB = 5.95 + 16.8 + 4.60(결정문 표) · `BYTES_PER_KB`가 십진이라
`formatBytes`가 "27.3 MB"를 낸다 · 30명 × 27.3 = 819MB("820MB") · 락 파일의
python 3.14.2 / sklearn 1.8.0 / numpy 2.4.6 / scipy 1.18.0 / joblib 1.5.3 / threadpoolctl 3.6.0이
`versions`·`EXPECTED`·고지와 전부 같다 · `06-audit.md`의 총계 40 / 59 / 112 = 25+15 /
57+2 / 95+17.

---

## 7. 못 한 것 · 확정 불가 (고치는 쪽이 재야 할 자리)

- **Pyodide를 한 번도 띄우지 않았다.** 노드에는 브라우저가 없고 요청서 §0이 "여기 시간 쓰지
  마라"고 했다. 그래서 (a) 이미지 + sklearn은 타입과 모양까지만(§5 2.2), (b) A-1은
  `reproduceBlockers`가 안 막는 것과 요청의 runtime까지만 — **점검 화면에서 실제로 27.3MB가
  내려오는 것은 눈으로 확인하지 못했다**, (c) C-2의 기전(하위 모듈 임포트)은 **추정**이다.
- **화면을 몰아 보지 않았다.** B-1의 `chosen`·`estimates`는 코드 읽기다. M28처럼 화면 문구는
  어떤 검사도 안 읽으므로 사용자의 눈이 필요하다.
- **`MLJS_KMEANS_BASELINE_MS`의 `[50_000, 13181]`·`[100_000, 13181]`** — 두 점이 같은 수다.
  2026-09-01(`94b9679`)의 값이라 이 라운드 밖이지만, 결정문 표의 *"K-평균 1.2배 빠름"*의
  분모가 이 값이다. 옮겨 적다 겹친 것인지 실루엣 예산 바닥이 두 점을 같게 만든 것인지
  **확정 못 했다** — 그날의 원본 JSON이 저장소에 없다.
- **`ladderPoint` 삼항 맞바꾸기**(§1 끝)는 심지 않고 육안으로 판정했다.
- **처방은 하나도 넣어 재지 않았다.** A-1·B-1은 결정이 먼저라서고, C-5는 검사를 새로
  쓰는 일이라 감사의 몫이 아니다.

## 8. 규모

읽은 것: 요청서 · workflow §3 · 결정문 · 원본 JSON · 슬라이스 여섯의 소스 20파일 · 검사
13파일 · 도구 5파일 · 문서 diff 전부. 돌연변이 21(욺 11 · 조용 10) · 임시 스펙 3 ·
`vue-tsc` 21회. 걸린 시간의 대부분은 §6의 대조와 A-1의 경로 추적이었다.
