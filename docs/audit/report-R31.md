# R31 감사 보고서 — sklearn이 맞게 도는가, 순수 JS가 안 깨졌는가

> 요청서: `docs/audit/request-R31.md` · 공통 절반: `docs/workflow.md` §3
> 대상: `ae51cb1..cd60ccc` (커밋 열하나) · 읽은 HEAD: `d351f34`
> 감사자는 아무것도 고치지 않았다. 심은 것은 전부 되돌렸고 임시 스펙 둘(`_r31_probe`·
> `_r31_tie`)은 지웠다. 끝난 뒤 `git status --short`는 이 보고서 하나만 보인다.

## 0. 한 줄

**회귀는 없다.** 요청서 §2.1의 다섯 자리를 전부 찔렀고 순수 JS의 판정은 한 군데도
안 바뀌었다 — v1 로더가 넘기는 범위는 글자까지 그대로이고(`tree.ts:179`), `compareRun`은
`mljs@2` 파일을 지금까지처럼 거절하며(M3이 운다), `preparationMs`는 순수 JS에 0을 준다
(M2가 운다).

**A급이 하나 있고, 그것은 이번 라운드가 세운 검사가 아니라 이번 라운드가 *느슨하게 만든*
검사다.** `tests/estimate.spec.ts`의 "행이 늘 때 시간이 줄어드는 표가 없다"가 R30에서는
사다리 역전을 잡았는데(R30 M9), 이번에 문턱이 붙으면서 **의사결정트리 100,000행을
4,677 → 1,900ms로 뒤집어도 3,524개가 전부 초록이다.** 그 문턱이 안전하다고 적은 주석은
표의 아래쪽에서만 참이다 (A-1).

**가장 값이 큰 C는 이번 라운드의 기능 자체에 그물이 없다는 것이다.** 화면 둘에서
`runtime:` 한 줄을 지워도, 등록부에서 두 엔진의 기준표를 맞바꿔도 관문이 조용하다 —
그런데 그 오차는 의사결정트리 100,000행에서 **13.4초 대 5,387초(90분)**, 즉 400배다 (C-1).

**거짓 단정 다섯을 새로 찾았다** (C-3). 요청서가 겨눈 자리 셋이 그중 셋이다 — 시동 국면,
`dumps()`의 독스트링, 그리고 sklearn 1.8의 `tree_.value`. 마지막은 **재 봤고, 1.8도
정규화된 값을 준다.**

돌연변이는 **열여섯 심어 아홉이 울고 일곱이 조용했다.**

---

## 1. 돌연변이 표 — 전체 (운 것 포함)

기준선: `npm run ci` **173파일 3,524통과 · 3스킵 · exit 0** (약 100초). 끝난 뒤 같은 명령을
다시 돌려 같은 수를 확인했다. 심고 → 스펙 → **즉시 그 파일 하나만 되돌렸다.**

| # | 무엇을 뭉갰나 | 돌린 것 | 결과 |
|---|---|---|---|
| M1 | `tree.ts:179` v1 로더가 `classes.length` 대신 `nodes.length` (요청서 #1) | `models`·`tree-v2`·`sklearn-serialize` | **욺** 3건 — 전부 `다수결` 묶음. **겨냥한 이유가 아니다**: 잎 하나짜리 나무에서 범위가 *좁아져* 운 것이고, 넓히는 방향은 안 봤다 → M1b |
| M1b | 같은 줄을 `classes.length + 1`로 (**넓히기만**) | `npm run ci` 전체 | **조용** (3,524통과) → C-6 |
| M2 | `estimate.ts:283` `preparationMs`가 언제나 `PYODIDE_BOOT_MS` (요청서 #2) | `estimate` | **욺** 2건 |
| M3 | `reproduce.ts:382` `versionIsFetched`가 언제나 참 (요청서 #3) | `reproduce` + `vue-tsc` | **욺** 3건 |
| M4 | `TrainView.vue:280` `runtime: row.runtime` 삭제 (요청서 #4) | `npm run ci` 전체 | **조용** (3,524통과) → C-1 |
| M4b | `ReproducePanel.vue:219` `runtime,` 삭제 (같은 병의 이웃) | `npm run ci` 전체 | **조용** (3,524통과) → C-1 |
| M5 | `algorithms.ts` 의사결정트리 표의 두 엔진 칸을 통째로 맞바꿈 (요청서 #5) | `npm run ci` 전체 | **욺** 1건 — 다만 운 것은 `columns` 축(`linear`↔`flat`)이지 기준표가 아니다 → M5b |
| M5b | KNN의 **`ms` 표만** 두 엔진 사이에서 맞바꿈(`columns`는 그대로) | `npm run ci` 전체 | **조용** (3,524통과) → C-1 |
| M6 | `tree.ts` `softVote`가 분포 대신 argmax 다수결 (요청서 #6) | `tree-v2`·`sklearn-serialize`·`models` | **욺** 1건 — `겨우 이긴 둘보다 확실한 하나가 이긴다`. **우는 이유가 겨냥한 것과 같다.** 387행 줄 대조는 조용 — 그 파일이 스스로 내건 말 그대로다 |
| M7 | `tree.ts` `compileLeaves`의 `/ sum` 삭제 (요청서 #7) | `tree-v2`·`sklearn-serialize` | **욺** 1건 — `표본이 많은 나무가 더 크게 말하지 않는다`. 줄 대조는 조용 |
| M8 | `pyodide-serialize.ts:327` 잎 번호 재배열 삭제 (요청서 #8) | `sklearn-serialize`·`pyodide-sklearn` | **욺** 9건 |
| M9 | `adapter_python.py:69` `LINEAR_DUMP` 조회 실패를 안 세움 (요청서 #9) | `npm run fixtures:check` | **욺** — 다만 `AdapterParseError`가 아니라 `AttributeError: 'NoneType'`로 선다 |
| M10 | `generate_sklearn_fixtures.py` `CLUSTER_TIE_RTOL = 0` (요청서 #10) | `fixtures:check` | **조용** — **그 마스크가 지금 0행을 가리므로 정의상 조용하다**(결정문이 이미 그렇게 적었다) |
| M10b | 같은 상수를 `1e-2`로 (마스크를 **넓히는** 방향) | `fixtures:check` | **욺** — `Stale fixtures: origin, overlap, multi` |
| M11 | `limits.ts` `PYODIDE_DECISION_TREE_BASELINE_MS`의 100,000행 `4677 → 1900` (**진짜 역전 495ms**) | `npm run ci` 전체 | **조용** (3,524통과) → **A-1** |
| M12 | `limits.ts:1462` `PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR = 1 → 2` | `npm run ci` 전체 | **조용** (3,524통과) → C-2 |
| M13 | `pyodide-sklearn.ts` knn 항목의 **주석 안**에 `dump: '…'` 예시 한 줄 | `fixtures:check` | **욺** — 다만 추출기는 그 주석을 진짜 `dump`으로 뽑았고(`knn -> {"rows": …}`), 운 것은 픽스처가 달라져서다 → C-7 |

---

## 2. 지적

### A-1. `기준표의 모양` 검사가 이번 라운드에 느슨해져, R30이 잡던 역전을 통과시킨다

**자리** `frontend/tests/estimate.spec.ts:491-497` (문턱)·`:478-489` (그 문턱이 안전하다는 주석)

**주장** 이 검사는 `ae51cb1`까지 `if (ms < earlier)`였고, R30의 M9(K-평균 표의 한 점을
낮춤)가 여기서 울었다. 이번 라운드가 `if (earlier - ms >= floor)`로 바꾸면서
**`floor`(그 표의 최솟값)보다 작은 감소는 전부 통과**한다. 주석은 그것이 안전한 이유를
*"가장 작은 점은 거의 전부가 고정 비용이므로, 그보다 작은 감소는 그 고정 비용 안에서
흔들린 것"*이라고 적는데, **그 논증은 표의 아래쪽에서만 성립한다.** 표의 위쪽에서
`floor`는 값의 몇 %밖에 안 되고, 거기서 같은 크기의 감소는 잡음이 아니라 결함이다.

**재현** `PYODIDE_DECISION_TREE_BASELINE_MS`의 마지막 점을 `4677 → 1900`으로 (M11).
100,000행이 50,000행(2,395ms)보다 **495ms 빠르다**고 말하는 표인데,
`floor`가 641이라 `495 < 641`로 통과한다.

```
npm run ci   →  exit 0 · 173 files · 3524 passed
```

바꾸기 전의 검사(`ms < earlier`)라면 잡혔다. **그리고 값을 더 낮춰도 잡히지 않는다** —
`floor`가 그 표에서 다시 계산되므로 `X ∈ (1754, 2395)` 구간 전체가 통과한다.

**이웃** 같은 조건이 `limits.ts`가 내놓는 **표 스물여덟 전부**에 걸린다. 위쪽 점의 값에
대한 `floor`의 비율은 표마다 다르고, 가장 관대한 칸은 `PYODIDE_LINEAR_REGRESSION`
(453 / 1003 = **45%**)·`PYODIDE_IMAGE_KMEANS`(24%)·`PYODIDE_IMAGE_KNN`(17%)·
`PYODIDE_DECISION_TREE`(14%)다. 순수 JS 표도 같은 규칙 아래로 들어왔다
(`MLJS_NEURAL_NETWORK` 19%).

**처방 (실측했다)** 문턱을 없애고 **실측이 실제로 내려간 자리를 이름으로 적는다.**
지금 그런 자리는 **다섯뿐**이다:

```
PYODIDE_LINEAR_REGRESSION_BASELINE_MS: 1000행 477ms -> 5000행 453ms
PYODIDE_KNN_BASELINE_MS:               1000행 738ms -> 2000행 651ms
PYODIDE_DECISION_TREE_BASELINE_MS:      250행 644ms ->  500행 642ms
PYODIDE_DECISION_TREE_BASELINE_MS:     1000행 643ms -> 2000행 641ms
PYODIDE_SVM_BASELINE_MS:                500행 509ms -> 1000행 497ms
```

`MEASURED_DIPS` 집합을 만들어 `ms < earlier`인 자리를 그 집합과 대조하고, **쓰이지 않은
항목이 남으면 그것도 울린다**(낡은 예외가 조용히 사는 것을 막는다). 이 처방을 임시로
넣고 재 봤다 — **깨끗한 소스에서 초록(48통과)이고, M11을 다시 심으면 문다**:

```
× 행이 늘 때 시간이 줄어드는 표가 없다
+   "PYODIDE_DECISION_TREE_BASELINE_MS: 50000행 2395ms -> 100000행 1900ms"
```

문턱을 남기고 싶다면 **근거 있는 수가 필요하다**(`no-arbitrary-thresholds`). 위 다섯은
전부 상대 오차 11.8% 이하이고 M11은 20.7%라 상대 문턱도 가능하지만, **그 경계선의 값을
정할 실측이 지금 없다.** 목록 쪽이 지어낸 수가 없다.

---

### B-1. sklearn 랜덤 포레스트를 담기 시작했는데, 기본 손잡이 × 허용 행 수에서 모델이 113MB다

**자리** `frontend/src/ml/engines/pyodide-serialize.ts:296` (`sklearnForestV2Model`) ·
`frontend/src/limits.ts:573` (`PYODIDE_RANDOM_FOREST_ROW_LIMIT = MAX_DATASET_ROWS`) ·
`frontend/src/ml/engines/pyodide-sklearn-params.ts:33` (`n_estimators` 기본 **100**)

**주장** 요청서 §2.3이 *"사진(1,280차원)은 안 쟀다"*고 적은 자리를 쟀다. **사진은
괜찮고, 표가 안 괜찮다.** 개발 환경 sklearn 1.9.1에서 `pyodide-serialize.ts`와 같은
규칙(`splitBoundary` 포함)으로 옮겨 JSON 바이트를 쟀다:

| 일감 | 잎 합계 | `mlpx-tree-v1` | **`mlpx-tree-v2`** | 비 |
|---|---|---|---|---|
| 붓꽃꼴 120행 × 4특성 × 3클래스 (합성, 겹침) | 3,148 | 128.6 kB | 174.8 kB | 1.36 |
| 사진 2,000장 × 1,280차원 × 3클래스 (잘 갈림) | 6,798 | 297.2 kB | **396.8 kB** | 1.34 |
| 사진 5,000장 × 1,280차원 × **10클래스** (겹침) | 145,918 | 6.8 MB | **13.2 MB** | 1.92 |
| **표 100,000행 × 8특성 × 3클래스** | 1,811,874 | 83.0 MB | **113.0 MB** | 1.36 |

넷 다 `n_estimators=100`(sklearn 기본값)이고 마지막 둘은 **이 앱이 허용하는 최대 행/장
수**다. `MAX_MODEL_BYTES`는 5MB, `MODEL_BUDGET_BYTES`는 20MB다.

**넘을 때 화면은 맞는 말을 한다** — `selectModels`가 `tooLarge`로 떨어뜨리고 문구는
*"모델이 너무 커서 파일에 저장하지 못했습니다. … 나무 개수처럼 모델을 키우는 설정을
줄여 보세요"*다. 거기까지는 옳다.

**문제는 그 판정 전에 물건이 이미 메모리에 서 있다는 것이다.** `attach()`는
`encodeCompact(model)`을 **조건 없이** 부르고, 그전에 워커가 객체를 만들어 구조적 복제로
메인 스레드에 건넨다. 그 비용을 Node(v8)에서 같은 모양으로 쟀다:

```
node --max-old-space-size=4096 heap.mjs
  built:     253ms  heap +373.1 MB      # 객체 하나
  stringify: 808ms  101.6 MB (chars)    # heap 479.1 MB
  encode:    154ms  101.6 MB            # peak heap 479.1 MB
```

워커에 한 벌, 메인에 또 한 벌이면 **0.7~1GB**다. 컴퓨터실 PC와 휴대폰이 기준 기기라는
것이 이 저장소의 전제이고(`CLAUDE.md` §0), `내보내기는 무조건 성공해야 한다`가 이미
적혀 있는 규칙이다.

**이것이 순전히 새로운 것은 아니다.** 순수 JS도 `nEstimators` 최대가 500이라 같은 모양을
만들 수 있다. **바뀐 것은 기본값으로 닿는다는 점이다** — 순수 JS는 기본 10그루에 행 상한
50,000이라 기본 설정의 최악이 약 4MB(추산)로 `MAX_MODEL_BYTES` 바로 아래인데, sklearn은
기본 100그루에 상한 100,000이라 기본 설정의 최악이 **113MB로 그 27배**다. 그리고
`ae51cb1`까지는 이 조합이 아예 안 담겼다.

**왜 B인가** 처방이 코드가 아니라 결정이다. 고를 수 있는 길이 적어도 셋이고 값이 다르다.

1. **옮기기 전에 노드 수로 거절한다** — `sklearnForestV2Model`이 `Σ nodes`를 먼저 세고
   예산을 넘으면 `null`을 돌려 `shape-refused`로 적는다. 물건을 안 만드므로 메모리도 안
   든다. 대신 **학생은 "왜 안 담겼나"를 학습이 끝난 뒤에야 안다**(지금과 같다).
2. **고르기 전에 말한다** — `RuntimeSpec.preparation`이 27.3MB를 미리 말하는 것과 같은
   자리에, *"이 설정이면 모델이 파일에 안 들어갈 수 있습니다"*를 붙인다.
3. **아무것도 안 한다** — `tooLarge` 문구가 이미 맞는 말을 하고, 113MB를 만들다 죽는
   기기는 그 학습 자체도 못 돌렸을 것이라는 판단.

**재는 방법** 위 표는 `uv run --project backend python <스크립트> <행> <차원> <클래스>`로
다시 낼 수 있다. 스크립트는 남기지 않았다 — 필요하면 `splitBoundary`의 파이썬 판(단정도
`nextafter` 두 번)을 그대로 옮기면 된다.

---

### C-1. 이번 라운드가 만든 "엔진마다 다른 수"에 화면까지 이어지는 그물이 없다

**자리** `frontend/src/views/TrainView.vue:280` · `frontend/src/views/inspect/ReproducePanel.vue:219` ·
`frontend/src/ml/algorithms.ts`의 `baseline` 칸 서른두 개

**주장** 세 자리를 따로 뭉갰는데 셋 다 관문 전체가 조용하다.

| 심은 것 | 결과 |
|---|---|
| `TrainView.vue`가 `runtime: row.runtime`을 안 넘긴다 | 3,524통과 |
| `ReproducePanel.vue`가 `runtime,`을 안 넘긴다 | 3,524통과 |
| KNN 표의 `mljs`와 `pyodide-sklearn` 칸을 맞바꾼다 | 3,524통과 |

**오차의 크기** 첫 줄만 재 보면 이렇다(기기 배수 1, 특성 8):

```
decision_tree@1,000행    sklearn 9,343ms   ← runtime을 안 넘기면      378ms  (25배 짧게)
decision_tree@100,000행  sklearn 13,377ms  ← runtime을 안 넘기면 5,387,004ms (403배 길게)
random_forest@100,000행  sklearn 63,657ms  ← runtime을 안 넘기면 24,541,101ms
knn@1,000행              sklearn 9,438ms   ← runtime을 안 넘기면       26ms
naive_bayes@100,000행    sklearn 9,215ms   ← runtime을 안 넘기면      154ms
```

*"약 1초"*와 *"약 10초"*, *"약 14초"*와 *"약 90분"*이다. 결정문이 *"그 칸이 없으면 sklearn
줄이 순수 JS의 수를 자기 것처럼 말한다"*고 적은 바로 그 모양이고, **그 문장을 지키는
검사가 없다.**

`estimate.spec.ts`의 새 묶음 `실행 방법마다 다른 수를 말한다`는 `baselineMs`/`estimateMs`를
직접 부른다 — 계산은 덮지만 **부르는 쪽이 축을 태웠는지는 아무도 안 본다.** 그리고
등록부 쪽은 *"두 엔진이 다른 수를 낸다"*만 보므로(`.not.toBeCloseTo`) **어느 쪽이
어느 엔진인지는 뒤집혀도 통과한다.**

**이웃** `EstimateInput.runtime`을 넘기는 자리는 소스에 정확히 둘이고
(`grep -rn "runtime:" src/views | grep estimate` 계열로 확인), 둘 다 안 덮여 있다.
등록부 쪽은 알고리즘 아홉 × 종류 둘 × 엔진 둘 = **서른여섯 칸**이 같은 상태다.

**처방** 둘 다 필요하다.

1. **화면 쪽** — `TrainView`의 `estimates`와 `ReproducePanel`의 `estimate`는 지금
   컴포넌트 안의 `computed`다. `CLAUDE.md` §4의 *"검증 가능한 로직을 컴포넌트 밖으로
   빼라"*가 이 자리다. 순수 함수로 빼고 *"sklearn 줄과 순수 JS 줄이 다른 수를 낸다"*를
   스펙으로 못 박는다.
2. **등록부 쪽** — 칸과 상수를 **동일성으로** 묶는다. 예: 각 `baseline[type][runtime].ms`가
   `limits.ts`의 이름 규칙(`MLJS_*` / `PYODIDE_*`)에 맞는 상수와 `===`인지 훑는다.
   이름 규칙으로 잇는 그물은 이 저장소에 이미 있다(`기준표의 모양`의 `named` 대조).

---

### C-2. `PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR`가 sklearn **전체**의 기본 배수다

**자리** `frontend/src/ml/estimate.ts:264-265`

```ts
  // **로지스틱의 `max_iter`는 재 보니 평평했다.** 이 1은 짐작이 아니라 잰 값이다.
  return PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR
```

**주장** 이 `return`은 `random_forest`·`k_means`를 뺀 **나머지 여섯 알고리즘 전부**의
손잡이 배수다 — 의사결정트리·KNN·SVM·나이브 베이즈·선형 회귀·로지스틱. 이름은 로지스틱
하나를 가리키는데 코드는 전부에 건다. `같은 숫자는 같은 상수가 아니다`의 반대 모양이다:
**뜻이 다른 자리 여섯이 한 상수를 쓴다.**

**재현** `limits.ts:1462`를 `= 2`로 (M12).

```
npm run ci   →  exit 0 · 3524 passed
```

20,000행에서 의사결정트리 예상이 1,154 → 2,308ms로 **두 배가 되는데 아무도 안 운다.**
`estimate.spec.ts`의 `로지스틱 반복 횟수` 검사는 **비**(`.../one(...)`)를 보므로 크기가
변해도 1이다.

**이웃** 한 군데뿐이다 — 순수 JS 쪽 `handleFactor`의 마지막은 리터럴 `return 1`이다.

**처방 (실측했다)** 로지스틱 갈래를 명시하고 나머지는 리터럴 `1`로 돌린다.

```ts
  if (algorithm === 'logistic_regression') return PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR
  // 나머지는 곱할 손잡이가 없다.
  return 1
```

이 처방을 넣고 M12를 다시 심어 재 봤다 — 20,000행에서
`decision_tree=1154`(안 움직임) · `logistic_regression=1174`(=587×2, 움직임)이다.
**그리고 상수 자체의 값을 절대값으로 못 박는 검사가 하나 필요하다** — 비를 보는 검사는
구조적으로 이것을 못 본다.

---

### C-3. 거짓 단정 다섯

요청서 §2.2가 겨눈 것 셋이 여기 있고, 둘은 새로 찾았다.

#### (a) *"겹치는 자리는 셋뿐이다"* — **여섯이다**

**자리** `frontend/src/limits.ts:1255`

`r29-bench.json`의 사다리 스물셋을 `limits.ts`의 표 열다섯과 전수 대조했다.
**값은 한 점도 안 틀렸고**, 합치는 규칙(*"낮은 쪽 사다리의 값을 쓴다"*)도 여섯 자리
전부에서 지켜졌다. **틀린 것은 수뿐이다.**

```
PYODIDE_KNN@10000                872  (기본 872 · 상한 997)
PYODIDE_DECISION_TREE@20000     1154  (기본 1154 · 상한 1189)
PYODIDE_SVM@3000                1019  (기본 1019 · 상한 1094)
PYODIDE_RANDOM_FOREST@5000      2399  (기본 2399 · 상한 2487)
PYODIDE_IMAGE_RANDOM_FOREST@2000 10266 (기본 10266 · 상한 10221)
PYODIDE_IMAGE_SVM@3000          13330  (기본 13330 · 상한 13331)
```

**처방** `셋뿐이다` → `여섯이다`. 그리고 마지막 두 줄에서는 **상한 사다리가 더 작은데도
기본 쪽을 골랐다** — 규칙을 *"낮은 쪽 사다리"*(더 작은 값이 아니라 아래쪽 구간을 재는
사다리)라고 읽으면 맞지만, 그 두 줄이 있어서 규칙의 뜻이 헷갈릴 수 있다. 한 줄 덧붙일
값이 있다.

#### (b) *"시동의 절반 이상이 내려받기와 WASM 세우기다"* — **아니다**

**자리** `frontend/src/ml/estimate.ts:301` · 같은 문장이 `docs/open-decisions/07-after-audit.md:1002`
에도 있다(두 자리).

`r29-bench.json`의 `parts` 118표본과 `boots` 3표본이 답을 갖고 있다. 중앙값으로
**코어 1.59 + 휠 1.97 + 임포트 4.17 = 7.74초**다.

- 내려받기 + WASM 세우기 = 코어 + 휠 = 3.56초 = **46%**. 절반이 안 된다.
- 임포트 4.17초 = **54%**이고, `pyodide-runtime.ts`의 `BootParts.imports`가 스스로
  *"첫 `import sklearn` — **순수 CPU다.** 캐시가 절대 못 지우는 항목이 이것이다"*라고
  적는다. **한 저장소 안의 두 주석이 반대말을 한다.**
- **두 번째 학습부터는 더 심하다.** `backend.ts`가 *"다운로드는 두 번째부터 0초다"*라고
  적는데 시동은 8.7초 그대로다 — 그러면 내려받기 몫은 0에 가깝고 남는 것은 WASM 세우기
  일부(코어 1.6초 중 일부)뿐이다.

**이것이 근거를 대고 있는 결정은 "시동에 기기 배수를 안 먹인다"이다.** 시동의 과반이
CPU라면 그 결정은 느린 기기에서 **짧게** 틀리는 쪽이고, 그것은 이 파일이 피하겠다고
선언한 방향이다.

**처방 — 결정을 바꾸라는 말이 아니다**(그건 코드 소유자의 몫이다). **문장을 사실로
바꿔라.** 예:

> **기기 배수를 안 먹인다.** 시동의 절반 가까이가 내려받기와 WASM 세우기라 배수가 안
> 붙고(코어 1.6 + 휠 2.0초), 남는 임포트 4.2초는 CPU지만 **그쪽에 배수를 먹이면 느린
> 기기에서 시동만 두 배로 말하게 된다.** 두 쪽을 갈라 곱하는 안은 안 잰 값을 하나 더
> 만들므로 안 간다.

그리고 두 자리에 같은 문장이 있으니 **둘 다** 고쳐야 한다.

#### (c) `dumps()`의 독스트링이 랜덤 포레스트를 아직 "안 담는다"고 적는다

**자리** `scripts/adapter_python.py:64`

```
`dump` 칸이 없는 알고리즘(랜덤 포레스트, 참조형)은 빠진다 - 전자는 안 담기로 한 것이고
```

**재현** 같은 커밋 범위가 `random_forest`에 `dump`을 붙였다.

```
$ uv run --project backend python -c "...; print(sorted(adapter_python.dumps()))"
decision_tree k_means linear_regression logistic_regression naive_bayes random_forest svm
EXPECTED - found = {'knn'}
```

**빠지는 것은 `knn` 하나다.** 독스트링이 이름을 틀렸다.

**곁들여** `EXPECTED`(`:33`)는 *"`serializer.dump`이 있어야 하는 알고리즘"*이라고 선언하면서
`knn`을 담고, 그래서 아래에서 `- {"knn"}`으로 다시 뺀다. `knn`을 집합에서 빼면 그 예외도
사라진다.

#### (d) *"sklearn 1.9의 `tree_.value`가 이미 정규화된 값"* — **1.8도 그렇다**

**자리** `frontend/tests/tree-v2.spec.ts:22-25`

요청서 §2.2가 *"1.8은 확인 안 했다"*고 적은 자리다. **확인했다.** `scikit-learn==1.8.0`을
임시 venv에 넣고 브라우저와 같은 판으로 돌렸다:

```
sklearn 1.8.0
  root row: [0.28333333 0.31666667 0.4]  sum= 1.0
  n_node_samples root: 38
  all row sums ~1?  True
sklearn 1.9.1  → 같은 값, 같은 답
```

`RandomForestClassifier`의 나무도 `DecisionTreeClassifier`도 마찬가지다. 그러므로
`compileLeaves`의 정규화는 **sklearn이 준 파일에 대해서는 항등 연산**이고, *"1.8이 표본
수를 담으면"*은 일어나지 않는 가정이다.

**정규화를 지우라는 말이 아니다** — 손으로 고친 파일과 다른 엔진을 위한 방어선으로
남아야 하고, 그것을 지키는 검사(M7이 문다)도 맞다. **주석이 근거를 다시 대야 한다**:
*"1.8도 정규화한다(재 봤다). 그래도 나누는 것은 파일이 sklearn에서만 오지 않기
때문이다"*가 사실이다. 지금 문장은 **다음 사람에게 1.8이 위험하다고 말한다.**

#### (e) `mlpx-spec` §5.3.1의 동점 행 귀속이 벌 둘을 빠뜨렸다

**자리** `docs/mlpx-spec/02-model.md:247`

> 갈린 387행 중 12행을 벌마다 세어 보니 `overlap`의 6행과 `multi`의 2행이 **전부 표가
> 동점인 행**이었다

**재현** 임시 스펙으로 벌 여덟을 전부 세었다. 표는 v1 모델의 노드를 해석기와 **같은
규칙**(`x < t`)으로 걸어 표를 센 것이다.

```
origin:      rows=40  v1갈림=1 (동점 1)  v2갈림=0
sum120:      rows=60  v1갈림=0           v2갈림=0
scale:       rows=48  v1갈림=0           v2갈림=0
overlap:     rows=60  v1갈림=6 (동점 6)  v2갈림=0
multi:       rows=60  v1갈림=2 (동점 2)  v2갈림=0
iris:        rows=30  v1갈림=0           v2갈림=0
categorical: rows=48  v1갈림=3 (동점 3)  v2갈림=0
missing:     rows=41  v1갈림=0           v2갈림=0
합계:        387행 · v1갈림 12 · 그중 동점 12 · v2갈림 0
```

두 군데가 다르다.

1. **12행은 네 벌에 흩어져 있다** — `origin` 1 · `overlap` 6 · `multi` 2 · `categorical` 3.
   문장이 든 둘은 8행이고, `origin`과 `categorical`의 4행이 빠졌다.
2. **12행이 전부 동점이다.** 결정문의 *"대부분은 동점 규칙"*은 참이지만 **약하게 참**이고,
   사실은 **전부**다.

**그리고 그 사실이 이 라운드의 검사 설계를 뒷받침한다.** 픽스처 여덟 벌에서 v1과 sklearn이
갈리는 이유는 **동점 규칙 하나뿐**이고, *"확률 평균 대 다수결"*은 이 벌들에서 **한 행도
안 드러난다.** 즉 `tree-v2.spec.ts`가 스스로 적은 *"픽스처가 못 가르는 자리를 가르는 것이
이 파일의 전부"*가 정확히 맞다 — M6이 줄 대조를 조용히 통과하고 손 숲에서만 운 것이
그 증거다. **문장을 고치면 근거가 약해지는 게 아니라 강해진다.**

---

### C-4. 로드맵 5단계가 "랜덤 포레스트만 안 담는다"로 낡았다

**자리** `docs/roadmap/02-v6-v10.md:64-69`

> **5단계 · 모델 직렬화기 — 끝났다. 여덟 중 일곱을 담는다.** … **랜덤 포레스트만 안
> 담는다** — … 여는 길은 잎에 분포를 담는 `mlpx-tree-v2`다.

**주장** `cd60ccc`가 그 길을 갔다. 지금은 **여덟 중 여덟**이 담기고 랜덤 포레스트는
`mlpx-tree-v2`로 담긴다(`tests/pyodide-sklearn.spec.ts`의 `직렬화기가 없는 알고리즘이
하나도 없다`가 그것을 못 박는다). **같은 문단의 K-평균 문장은 이 범위에서 고쳐졌는데
포레스트 문장만 안 고쳐졌다.**

결정문(`07-after-audit.md`) 쪽은 사정이 다르다 — 제목과 본문 첫 줄이 "일곱"인 채로
아래 인용 블록이 뒤집는 것은 요청서 §1이 *"제목은 그대로이고 본문이 여덟으로 뒤집혔다"*고
밝힌 의도적 층이다. **로드맵은 그 층이 없고, 상태를 한 줄로 말하는 자리다** —
`CLAUDE.md` §5가 *"이 기능이 지금 범위인지 확인할 때"* 읽으라고 가리키는 문서다.

**이웃** 같은 목록의 0~4·6단계는 전부 지금 상태와 맞는다. **한 줄뿐이다.**

**처방** 5단계를 *"여덟 중 여덟을 담는다. 랜덤 포레스트만 `mlpx-tree-v2`다"*로.

---

### C-5. `announceEngineChange`가 엔진을 안 가려서, 순수 JS 줄에 scikit-learn 문장을 띄울 수 있다

**자리** `frontend/src/views/inspect/ReproducePanel.vue:357-369`

**주장** 이 루프는 `stored.kind === fresh.engine.kind && stored.version !== fresh.engine.version`인
**첫 run**에서 토스트를 띄우고 돌아온다. 엔진 종류는 안 본다. 그런데 이번 라운드가 고친
문구는 sklearn 전용이다:

> 이 실험을 만든 **scikit-learn 배포판**을 받을 수 없어 지금 배포판으로 돌렸고,
> **그래서 판정하지 않고 숫자만 보입니다** (파일 {stored} · 사용 {used}).

순수 JS는 그렇지 않다 — `versionIsFetched('mljs')`가 거짓이라 `compareRun`은
`unavailable()`을 내고 줄마다 `대조할 수 없음`이 뜬다. **숫자가 하나도 안 보인다.**
R30 B-1과 같은 모양의 모순이고, 이번에는 **엔진 이름까지 틀린다.**

**오늘은 안 닿는다.** `reproduceBlockers`(`reproduce.ts:511`)가
`if (!claims.some((claim) => engineIsHere(claim)))`로 막는데, 옛 `mljs@1`·`mljs@2` 실험은
그 `some`이 거짓이라 `[대조하기]` 자체가 안 열린다 — 그 줄의 주석이 *"이번 학기까지의
파일은 전부 여기 걸린다"*라고 적은 그대로다.

**닿는 날이 정해져 있다.** `some`이라 **run 하나만 지금 엔진이면 실험 전체가 열린다.**
`MLJS_ENGINE.version`이 `3 → 4`로 오르는 순간, `mljs@3` run과 `pyodide-sklearn@314.0.7`
run이 함께 든 실험은 열리고, 배열에서 mljs run이 앞이면 이 토스트가 **mljs를 두고
scikit-learn을 말한다.**

**같은 병의 이웃** *"판이 같은가"*를 판정하는 자리는 넷이다 — `sameEngine`·`engineIsHere`·
`versionIsFetched`(셋 다 `reproduce.ts`)와 이 루프. **앞 셋은 전부 등록부의
`acceptsVersion` 축을 보는데 이 루프만 안 본다.** 이번 라운드가 `versionIsFetched`를
만들면서 고친 것이 정확히 *"들어올 때와 견줄 때가 다른 축을 보면 안 된다"*이고, **네 번째
자리가 남아 있다.**

**처방** `reproduce.ts`가 `versionIsFetched`를 이름 붙여 내보내고(예:
`showsNumbersAcrossVersions(run)`), 이 루프가 그것으로 거른다. 그러면 문구와 화면이
같은 축 위에 선다. **확인 못 했다**: 이 함수는 SFC 안에 있어 스펙에서 직접 못 부른다 —
처방을 심어 돌려 보지 못했다. 컴포넌트 밖으로 빼는 것이 처방의 절반이다.

---

### C-6. v1 잎 범위를 **넓히는** 방향은 아무 검사도 안 문다

**자리** `frontend/src/ml/models/tree.ts:179`

**주장** 요청서 #1이 겨눈 *"범위가 느슨해지면 깨진 v1 파일이 그럴듯한 클래스를 낸다"*를
직접 찔렀다. 요청서가 적은 돌연변이(`nodes.length`)는 **울지만 다른 이유로 운다** —
잎 하나짜리 나무에서 범위가 오히려 *좁아져* `다수결` 묶음 셋이 깨진 것이다.

순수하게 넓히기만 하면(`classes.length + 1`) **관문 전체가 조용하다**(M1b, 3,524통과).

**다만 결과는 "그럴듯한 클래스"가 아니다.** 범위 밖 번호는 `classes[…]`에서 `undefined`가
되고 `invalid('classes')`가 같은 `MODEL_FILE_INVALID`를 던진다 — 실패 자리가 읽을 때에서
예측할 때로 옮겨갈 뿐, **조용히 틀린 답은 안 난다.** 그러니까 지금 v1을 지키는 것은
`compile`의 범위 검사가 아니라 그 뒤의 방어선이고, `tree.ts:189`의 주석이
*"여기 닿지 않는다"*고 적은 그 줄이 사실상 유일한 그물이다.

**처방** v1에 *"잎의 클래스 번호가 `classes` 밖이면 **읽을 때** 거부한다"*를 한 줄로
못 박는다(v2 쪽은 `tree-v2.spec.ts`의 `잎이 없는 분포를 가리키면 거부한다`가 이미 있다).
그리고 `:189`의 주석을 *"닿지 않는다"*에서 *"닿으면 여기가 유일한 그물이다"*로 고치거나,
검사를 세워 주석을 참으로 만든다.

---

### C-7. `adapter_python`의 `dump:` 추출이 주석 안의 글자도 뽑는다

**자리** `scripts/adapter_python.py:80-91`

**주장** 요청서 §2.4가 물은 *"엉뚱한 것을 뽑아 통과하는 모양이 있는가"*의 답이다.
블록 안을 `re.search`로 훑을 뿐이라 **주석이 이긴다.** `knn` 항목의 주석에 한 줄을 넣어
확인했다(M13):

```
// (한때 dump: '{"rows": _model._fit_X.tolist()}' 였다)
→ knn extracted -> {"rows": _model._fit_X.tolist()}
```

`dumps()`가 이것을 진짜 `dump`으로 돌려주고, 픽스처 생성기가 실제로 실행한다.

**오늘은 시끄럽다** — 뽑힌 식이 돌면 `expected.json`에 없던 `dump` 키가 생겨
`fixtures:check`가 여덟 벌 전부를 `Stale fixtures`로 세운다. **조용해지는 모양은 뽑힌
식이 기존과 같은 JSON을 낼 때뿐**이라 실제 위험은 낮다.

**곁들여 셋**

- `re.search(r"dump: LINEAR_DUMP", block)`이 **가장 먼저** 걸리므로, 블록 안 어디든
  그 일곱 글자가 있으면 다른 `dump`을 이긴다.
- `^  (\w+): \{$`는 `SKLEARN_CLASSES` 밖도 잡는다 — 지금 `pyodide-sklearn.ts:77`의
  `globals: {`가 걸린다. 그 블록에 `dump`이 없어서 해가 없을 뿐이다.
- `generate_sklearn_fixtures.py:56`의 `sys.path.insert(...)`는 `:42`의
  `import adapter_python`보다 **뒤에** 있다. 지금 통하는 이유는 스크립트 디렉터리가
  자동으로 `sys.path`에 들어가서이지 이 줄 덕분이 아니다.

**처방** `dump:`를 속성 자리로 앵커한다 — 예: `^\s{6}dump:`로 줄머리와 들여쓰기를
요구하고, `LINEAR_DUMP` 조회도 같은 앵커를 쓴다. 그리고 `starts`를
`SKLEARN_CLASSES = {` 이후로 잘라 낸다.

---

## 3. 요청서가 물은 것에 대한 답 — 지적이 안 된 것들

**§2.1.2 `isBrowserRuntimeId`가 `string`을 받게 넓어졌다 — 잃은 것이 있는가.** **없다.**
부르는 자리가 셋이고(`backend.ts:414`·`TrainView.vue:267`·`ReproducePanel.vue:211`),
뒤의 둘이 넘기는 값은 원래부터 `string`이다 — `ChosenModel.runtime`이
`selection.ts:283`에서 `string`이고 `RUNTIMES.find(...)?.id`는 `RuntimeId | undefined`다.
넓히지 않았으면 부르는 쪽이 `as`로 단언했을 자리이고, 지금 모양이 더 좁다.

**§2.1.3 `hasEstimates`가 두 실행 방법을 다 본다 — 사진에서 답이 바뀌는가.** **안 바뀐다.**
옛 규칙(mljs만)으로도 `tabular`·`image` 둘 다 참이다. 지금 차 있는 칸을 세면
`tabular/mljs` 9 · `tabular/sklearn` 8 · `image/mljs` 4 · `image/sklearn` 7이다.
**바뀐 것은 앞으로다** — 순수 JS 사진 표가 비어도 sklearn 표가 참을 만든다.

**§2.1.4 `estimateMs`가 시동을 더한다 — 순수 JS가 부푸는가.** 안 부푼다. M2가 운다
(`sklearn 줄의 예상에 시동이 들어 있다`가 양쪽을 다 본다).

**§2.1.5 순수 JS는 지금까지처럼 거절하는가.** 거절한다. M3이 운다.

**§2.1 `.mlpx` 왕복.** `SUPPORTED_MODEL_FORMATS`가 여덟로 늘었고 `versions.spec.ts`의
`PINNED_FORMATS`가 그것을 잠근다. 옛 v1 파일 경로는 `models.spec.ts`의 `다수결` 묶음이
실제로 지나간다 — M1이 거기서 울었다.

**§2.3 옛 앱이 새 파일을 만나면.** **시끄럽게 선다. 요청서가 적은 대로다.**
파일은 정상적으로 열리고(모델 형식은 파일 열기에 안 걸린다), 예측 화면이 그 run을
`MODEL_FORMAT_UNSUPPORTED`로 세워 *"이 버전에서는 이 모델을 실행할 수 없습니다.
(mlpx-tree-v2)"*라고 적는다(`predict.ts:423-431` · `client.MODEL_FORMAT_UNSUPPORTED`).
괄호에 형식 이름이 들어가므로 빈 괄호도 아니다.

**§2.3 `formatVersion`이 안 올라도 되는가 — 반증을 시도했고 못 했다.**
`VOCABULARY_BY_VERSION`(`tests/schema-version.spec.ts:80`)이 잠그는 어휘 열둘에 **모델
형식 이름이 없고**, `빠뜨린 어휘가 없다`가 훑는 것은 `z.enum(이름있는상수)`인데
`tree.ts`의 형식 칸은 `z.literal(TREE_V2_FORMAT)`이다. `CANONICAL_FORMAT_IDS`는 사진
포맷(`webp`/`jpeg`)이지 모델 형식이 아니다. **옛 파일은 v1 해석기가 그대로 읽고, 새
파일은 위처럼 시끄럽게 선다.** 선례도 있다 — `mlpx-linear-v2`가 같은 길을 갔다.
**근거가 맞다.**

**§2.3 의사결정트리를 v1에 남긴 판단.** 맞다. 픽스처 여덟 벌 387행에서 v1 의사결정트리의
갈림이 0이고(`sklearn-serialize.spec.ts`의 줄 대조가 매 벌 돈다), 나무가 하나면 분포의
argmax가 곧 그 잎의 클래스라 두 규칙이 같은 답을 낸다.

**§2.5 `tree-v2.spec.ts`의 손 숲이 규칙을 정말 가르는가.** **가른다.** M6(분포 → argmax)은
`겨우 이긴 둘보다 확실한 하나가 이긴다`만 깨뜨리고, M7(정규화 삭제)은 `표본이 많은 나무가
더 크게 말하지 않는다`만 깨뜨린다. **두 규칙이 서로 새지 않는다.** 그리고 둘 다 387행
줄 대조는 조용한데, C-3 (e)가 그 이유를 수로 보인다 — 픽스처의 12행은 전부 동점 행이라
확률 평균 규칙을 아예 안 밟는다.

**§2.5 `sklearn-serialize.spec.ts`의 `toBeGreaterThan(0)`이 그물로 충분한가.**
`divergedV1`은 **위 경계가 없다.** 12에서 387로 늘어도 통과한다. 다만 v1 경로의 진짜
소비자인 `decision_tree`는 같은 파일의 줄 대조가 전 행을 보므로, 이 느슨함으로 실제로
새는 자리는 못 찾았다. `toBe(12)`로 굳히면 sklearn 판이 바뀌는 날 깨지므로
`toBeLessThan(테스트 행 수 / 10)` 같은 상한이 값이 있어 보이지만 **그 수의 근거가
지금 없다.** 제안까지만 한다.

**§2.3 새로 닿게 된 조합 · 닿지 않게 된 조합.**

| 새로 닿는다 | |
|---|---|
| `mlpx-tree-v2` 해석기 | sklearn 랜덤 포레스트에서만 만들어진다 |
| `compareRun`의 `NOT_JUDGED` + 숫자 | sklearn run에서 판이 갈렸을 때 |
| `modelOmittedDetail` 어휘 넷 | `engine-gone`·`classes-differ`·`shape-refused`·`threw:*` |
| `EstimateInput.runtime = 'pyodide-sklearn'` | 기준표·손잡이 배수·시동이 전부 갈린다 |

| 안 닿게 됐다 | |
|---|---|
| sklearn 랜덤 포레스트의 `modelOmitted: engineUnsupported` | 이제 담긴다 |
| `serializer-missing` | 여덟이 다 직렬화기를 가져 **아무 알고리즘도 안 낸다** (검사가 못 박는다) |
| sklearn의 `sameEngine` 단독 거절 | `versionIsFetched`가 먼저 갈라진다 |

---

## 4. 확인 못 한 것 · 저장소에 없는 것

**다음 라운드가 재야 할 자리다.**

1. **특성 사다리 여덟과 손잡이 사다리 셋의 원본이 저장소에 없다.**
   `limits.ts:1230`은 *"원본은 `docs/audit/r29-bench.json`이다"*라고 적는데, 그 파일에는
   **행 사다리와 상한 사다리뿐**이다(`pyodide_*_columns`·`pyodide_random_forest_trees`·
   `pyodide_k_means_clusters`·`pyodide_logistic_regression_iterations` 어느 것도 없다).
   그래서 아래를 **확인하지 못했다**:
   - *"특성 4→32에 KNN 1.13 · 랜덤 포레스트 1.09 · … 나이브 베이즈 2.34 · K-평균 0.96배"*
   - *"가장 나쁜 칸(나이브 베이즈 50,000행 × 32열)의 315ms는 총 9.3초의 3%"*
     — **산술은 들어맞는다**(320 + 315 + 8,700 = 9,335ms이고 315/9,335 = 3.4%). 다만
     그러려면 8→32열이 1.98배여야 하고, 4→32가 2.34배라면 4→8이 1.18배라는 뜻이다.
     **사다리가 가속하면 성립하지만 그 사다리를 볼 수가 없다.**
   - *"20,000행에서 25·50·100·200회가 632 · 717 · 615 · 680ms"*
   - `PYODIDE_RANDOM_FOREST_TREES_MS`와 `PYODIDE_KMEANS_CLUSTERS_MS`의 여덟 점
     (표 안에서의 산술은 전부 맞다 — 고정 비용 784ms·그루당 4.19ms·0.687배·1.456배가
     표에서 그대로 나온다)

   **처방** 사다리 열하나를 돌린 출력을 `r29-bench.json` 옆에 남겨라. 행 사다리는 그렇게
   해 뒀고, 그래서 이 감사가 열다섯 표의 **모든 점**을 대조할 수 있었다.

2. **K-평균 군집 수 배수 1.42 / 1.26은 코드가 내는 수가 아니다.** 결정문의 표와
   `limits.ts`가 *"우리 1.42배 대 순수 JS 1.26배"*라고 적는데, 두 표에 `k=3` 점이 없어
   기준값을 보간해야 한다. `estimate.ts`의 로그-로그 보간으로 계산하면
   **sklearn 1.39 · 순수 JS 1.23**이고, 1.42/1.26은 **선형 보간**의 값이다.
   차이가 작아 지적으로 올리지 않았지만, *"코드가 실제로 곱하는 수"*를 적는 편이 맞다.

3. **브라우저에서 113MB 모델이 실제로 어떻게 죽는지 안 봤다.** B-1의 힙 수치는
   Node(v8) `--max-old-space-size=4096`에서 같은 모양의 객체를 세워 잰 것이다.
   워커 힙 한도·구조적 복제 비용·IndexedDB 자동 저장은 안 쟀다.

4. **폴백 경로를 실물로 안 봤다.** 요청서 §3도 안 봤다고 적은 자리다. C-5의 도달 조건
   (`mljs` 판이 오르는 날)은 코드를 읽어 세운 것이고, 토스트를 실제로 띄워 보지 않았다.

5. **`announceEngineChange`에 처방을 심어 보지 못했다.** SFC 안의 함수라 스펙에서
   못 부른다(C-5).

6. **사진 프로젝트의 sklearn 줄을 화면에서 안 봤다.** 예상 시간 계산은 스펙으로
   확인했지만(`image/pyodide-sklearn` 일곱 칸이 차 있다), 요청서 §3이 *"사진 프로젝트를
   안 봤다"*고 적은 자리는 그대로 남는다.

---

## 5. 관문

기준선과 끝: `npm run ci` **exit 0 · 173파일 · 3,524통과 · 3스킵**, 두 번 다 같다.
`npm run lint`와 `ruff format`은 쓰지 않았다. 심은 것은 전부
`git checkout -- <파일 하나>` 또는 편집 도구로 되돌렸고, 임시로 만든 파일
(`tests/_r31_probe.spec.ts` · `tests/_r31_tie.spec.ts` · 루트의 측정 스크립트)은 전부 지웠다.
