# R30 감사 보고서 — sklearn 모델 직렬화와 배포판 못

> 요청서: `docs/audit/request-R30.md` · 공통 절반: `docs/workflow.md` §3
> 대상: `2623ec6..ae51cb1` (커밋 여덟) · 읽은 HEAD: `53a318d`
> 감사자는 아무것도 고치지 않았다. 심은 것은 전부 파일 하나의 정확한 경로로 되돌렸고,
> 임시 스펙은 지웠다. 끝난 뒤 `git status --short`는 이 보고서 하나만 보인다.

## 0. 한 줄

**옮기는 규칙은 맞고, 요청서의 수 여섯은 전부 재현됐다.** 파이썬 조각 일곱을 개발 환경의
sklearn 1.9.1에서 실제로 돌렸고 전부 그 이름, 그 모양이었다. 이번 라운드에 A급은 없다.

**틀린 것은 갈렸을 때의 말이다** — 원본이 옛 배포판을 안 주어 지금 판으로 돌면 화면의
줄은 전부 `대조할 수 없음`이고 토스트는 *"지금 배포판으로 대조했습니다"*다. 둘이 반대말을
한다(B-1). 그리고 **클래스 순서 그물(`agrees`)은 어떤 검사도 안 문다** — 요청서 §5-6의
예언 그대로 M6이 조용했고, 그 그물이 실제로 무는 입력(별 평면 글자)이 있었다(C-1).

돌연변이는 **열아홉 심어 열넷이 울고 다섯이 조용했다.** 조용한 다섯은 전부 *"검사가 없다"*
이지 *"코드가 틀렸다"*가 아니다.

## 1. 돌연변이 표 — 전체 (운 것 포함)

기준선: 슬라이스 스펙 15파일 → **565통과**, `npx vue-tsc --build` 초록. 심고 → 그 슬라이스
스펙 + `vue-tsc` → **즉시 편집 도구로 되돌렸다**(`git checkout --` 안 씀). "tsc만"은 vitest는
조용하고 타입만 운 것이라 조용한 쪽으로 센다.

| # | 무엇을 뭉갰나 | 돌린 스펙 | 결과 |
|---|---|---|---|
| M1 | `pyodide-serialize.ts:346` `sign`을 `1`로 굳힘 (요청서 #1) | 슬라이스 10 | **욺** 3건 — `multi`·`iris`의 `svm의 예측` + `다중 클래스는 부호를 뒤집어 담는다`. **이진 여섯 벌은 안 울었다** — 겨냥한 이유 그대로 |
| M2 | `:304-305` `half`·`bias`의 `/ 2` 둘 다 뺌 (요청서 #2) | 슬라이스 10 | **욺** 1건 — `이진은 한 줄을 ±절반 두 줄로 나눈다`만. **라벨 대조 여덟 벌은 조용** — 예언대로 계수 검사가 유일한 그물이고 그것이 문다 |
| M3 | `:152` `return middle` (요청서 #3) | `sklearn-serialize` `pyodide-sklearn` `models` `sklearn-parity` | **욺** 1건 — `sklearn이 왼쪽으로 보내는 값과 우리가 …같다`. 줄 대조는 조용(픽스처가 중점을 안 밟는다). tsc도 욺(`nextUpDouble` 미사용) |
| M4 | `reproduce.ts:222` `acceptsVersion?.(…) ??` 삭제 (요청서 #4) | `reproduce` inspect 셋 `pyodide-runtime` | **욺** 1건 — `sklearn은 판이 달라도 안 막고, 순수 JS는 막는다` |
| M5 | `experiment.ts:621` `engineStamp`가 `describe()`를 무시 (요청서 #5) | `experiment` `reproduce` `worker` `versions` | **욺** 1건 — `파일에 적히는 것은 등록부의 기본값이 아니라 뜬 판이다` |
| M6 | `pyodide-sklearn.ts:570` `agrees()`가 언제나 `true` (요청서 #6) | `sklearn-serialize` `pyodide-sklearn` `pyodide-runtime` `experiment` `hyperparams` `models` | **조용** (301통과 · tsc 초록) → C-1 |
| M7 | `tests/sklearn-serialize.spec.ts` `CASES`에서 `svm` 항목 삭제 (§2.6) | `sklearn-serialize` | **조용** — 71개가 **63개**로 줄고 초록 → C-2 |
| M8 | 같은 파일 `svm`의 `expected`를 `() => undefined`로 (§2.6) | `sklearn-serialize` | **욺** 9건 — `toBeDefined()`가 벌마다 문다 + `다섯을 굳혀 두었다` |
| M9 | `limits.ts:1219` K-평균 표의 50,000행을 2,815로 (표가 줄어듦) | `estimate` `limits-rules` `versions` | **욺** 1건 — `행이 늘 때 시간이 줄어드는 표가 없다` |
| M10 | `views/train/ModelAxes.vue:139` *"27.3MB와 9초"* → *"7초"* (`시동` 낱말 없이) | `pyodide-runtime` `ui-rules` `train-walk` | **조용** (388통과) → C-4 |
| M11 | `pyodide-runtime.ts:312-317` `attempt()`의 폴백 삭제 | `pyodide-runtime` `pyodide-sklearn` `sklearn-serialize` `experiment` `hyperparams` | **욺** 1건 — `그 배포판이 없으면 못 박은 것으로 한 번 더 부른다` |
| M13 | `ReproducePanel.vue:359` 같은 판이어도 토스트 | `inspect-reproduce-live` `inspect-modes` `ui-rules` | **욺** 1건 — `같은 판으로 돌았으면 아무 말도 안 한다` |
| M14 | `reproduce.ts:237` `enginePinsOf`가 빈 못을 냄 | `reproduce` `experiment` `inspect-reproduce-live` `sklearn-serialize` `models` | **욺** 2건 — `run의 엔진 판이 그대로 못이 된다` · `종류마다 하나씩 든다` |
| M15 | `pyodide-runtime.ts:285` `prepare`가 `wanted`를 무시 | `pyodide-runtime` `sklearn-serialize` `models` `experiment` | **욺** 2건 — `부른 배포판이 띄우는 쪽까지 간다` 등. tsc도 욺(`wanted` 미사용) |
| M17 | `pyodide-sklearn.ts:180` `TREE_DUMP_HELPER`의 `argmax` → `argmin` (파이썬 조각) | 위 M11과 같은 다섯 | **조용** (235통과 · tsc 초록) → C-3 |
| M19 | `pyodide-serialize.ts:410,413` 나이브 베이즈의 `theta`·`var` 맞바꿈 | `sklearn-serialize` `models` | **욺** 7건 — 분류 여덟 벌 중 일곱의 `naive_bayes의 예측` |
| M20 | `:471` 참조형의 `k`를 `k + 1`로 | `sklearn-serialize` `models` | **욺** 6건 — 여섯 벌의 `knn의 예측` |
| M21 | `reproduce.ts:360` `sameEngine`이 종류만 봄 (**처방 실측** — B-1의 한 갈래) | `reproduce` inspect 다섯 | **욺** 1건 — 옛 검사 `엔진이 다르면 대조하지 않는다 - 무고한 학생을 지목하지 않는다`(`mljs@999`) |
| M22 | `pyodide-sklearn.ts:539` `serialize()`의 클래스 정렬을 `.reverse()` | `pyodide-sklearn` `sklearn-serialize` `experiment` `hyperparams` `models` | **조용** (280통과) → C-1 |

**욺 14 · 조용 5.** 세는 검사 둘에 `SHOWME`를 심어 읽은 수는 §6에 있다(돌연변이로 안 센다).

### 재현용 임시 스펙 — 둘, 통과 (쓰고 지웠다)

`tests/zz-r30-scratch.spec.ts`로 **진짜 입구** `compareRun`을 불렀다.

| # | 무엇을 확인했나 | 결과 |
|---|---|---|
| S1 | `pyodide-sklearn@314.0.7`인 주장과 `@315.0.0`으로 다시 돈 run(지표 같음)을 `compareRun` | **`ENGINE_UNAVAILABLE`, `deltas` 없음** — 대조하지 않는다 |
| S2 | 같은 판이면 | `REPRODUCED` (대조군) |

### 파이썬 조각 실행 — 일곱, 전부 돌았다 (§2.1)

`pyodide-sklearn.ts`에서 `TREE_DUMP_HELPER`·`LINEAR_DUMP`·각 `dump`·`fixed`·`module/cls`를
정규식으로 뽑아 **어댑터의 `buildFitCode`·`buildDumpCode`와 같은 모양으로 조립**하고,
`_X_train_js.to_py()`만 스텁으로 두어 개발 환경(sklearn **1.9.1** · numpy 2.5.3)에서
`exec`했다. Pyodide의 1.8.0과는 배포판이 다르다 — 그 차이는 §7에 적었다.

| 알고리즘 | 돌았나 | `json.loads(_dump)`의 모양 |
|---|---|---|
| 의사결정트리 (2·3클래스) | ✓ | `trees` 1 · `classes` 2/3 |
| 로지스틱 회귀 (2·3클래스) | ✓ | `coef` (1,4)/(3,4) · `intercept` (1,)/(3,) · `classes` |
| 나이브 베이즈 (2·3클래스) | ✓ | `theta`·`var` (k,4) · `logPriors` (k,) · `classes` |
| SVM `kernel='linear'` (2·3클래스) | ✓ | `coef` (1,4)/(3,4) · `intercept` (1,)/(3,) · `classes` |
| 선형 회귀 | ✓ | `coef` (4,) · `intercept` `float` — `intercept_`가 0차원 넘파이라 `float()`이 **필요한 유일한 자리**다 |
| K-평균 (`n_init='auto'`) | ✓ | `centroids` (3,4) · `classes` **`[]`** — `_classes = []`와 `getattr(…, [])`가 같은 답이라 `agrees()`가 안 거절한다 |
| KNN | 직렬화기에 `dump`이 없다 | — |

`float()`로 안 감싼 자리(`intercept_.tolist()`)는 전부 1차원 배열이라 `tolist()`가 리스트를 준다 —
`json.dumps`가 넘파이 스칼라를 만나는 자리는 없다. `SVC.coef_`는 `kernel='linear'`가
`fixed`로 실제로 붙는 것을 위 실행이 보여 준다(안 붙으면 `AttributeError`로 섰을 것이다).

---

## 2. A급 — 없다

찾지 못했다. 학생이 지금 다치는 경로도, 거짓 초록도 없었다. 아래 B-1은 **원본이 옛 배포판을
더 안 서빙하는 날**에야 닿는 자리다.

## 3. B급

### B-1. 배포판이 갈려서 지금 판으로 돌면 — 줄은 `대조할 수 없음`, 토스트는 *"대조했습니다"*

**자리** `src/ml/reproduce.ts:356-361` (`sameEngine` — `kind`와 `version`이 둘 다 같아야 한다) ·
`:282-300` (`compareRun` — 다르면 `unavailable()`) · `src/views/inspect/ReproducePanel.vue:355-367`
(`announceEngineChange` — 다르면 `inspect.engineVersionFallback`) ·
`src/locales/ko.json:43` (*"…받을 수 없어 **지금 배포판으로 대조했습니다**"*).

**주장** 결정문 넷째 조항은 *"서빙이 끊긴 버전이면 최신을 받되 토스트로 알린다"*이고
`attempt()`가 그렇게 한다(M11이 문다). 그런데 다시 돈 run의 `engine.version`은 뜬 판이라
**주장과 다르고**, `compareRun`은 `sameEngine`이 거짓이면 숫자를 안 보고 `ENGINE_UNAVAILABLE`을
낸다(S1). 그래서 교사가 보는 것은 **run마다 `대조할 수 없음`**이고, 같은 화면에 뜬 토스트는
**"지금 배포판으로 대조했습니다"**다. 27.3MB를 받고 다시 학습한 결과를 **버리고 나서** 대조했다고
말한다.

**결정이 걸린다.** 결정문 안에서도 두 문장이 다른 쪽을 가리킨다 — *"조용히 다른 버전으로
대조하면 그 결과는 대조가 아니다"*(`07-after-audit.md:723`)와 *"다른 배포판으로라도 돌리고 그
사실을 말하는 편이 낫다"*(`pyodide-runtime.ts:302-303`). 어느 쪽인지 정해야 코드가 따른다.

- (a) **판정은 안 하되 숫자는 보인다** — `sameEngine`이 갈렸을 때 `NOT_JUDGED`로 `again`·`deltas`를
  실어 보내고, 토스트는 그대로. 그러면 M21이 깨뜨린 옛 검사(`mljs@999`는 지목하지 않는다)와
  **`acceptsVersion`으로 갈라야 한다** — 순수 JS는 지금처럼 `unavailable`, 받아 오는 엔진은 `NOT_JUDGED`.
- (b) **지금 모양을 지키고 말만 고친다** — 토스트를 *"…받을 수 없어 대조하지 못했습니다"*로.
  그러면 받고 다시 학습하는 비용이 **버려지는 것을 알고 내는 것**이 된다 — `engineIsHere`에서
  미리 거절하는 편이 싸다(그때는 `acceptsVersion`이 뜻을 잃는다).

**재현** S1(`compareRun` → `ENGINE_UNAVAILABLE`, `deltas` 없음). 실물 폴백은 원본이 배포판을 내려야
생기는 일이라 안 돌려 봤다.

**이웃** 판정이 `version`을 보는 자리는 `sameEngine` 하나이고, 이 갈림을 아는 자리(`acceptsVersion`)는
`engineIsHere` 하나가 쓴다. **둘이 같은 축을 안 본다** — 들어올 때는 배포판 이름이면 받고,
견줄 때는 정확히 같아야 한다. 한 군데뿐이다.

**처방은 넣어서 재지 않았다.** M21이 그 절반이다 — 종류만 보게 풀면 옛 검사 하나가 울고, 그
검사가 지키는 것(*"무고한 학생을 지목하지 않는다"*)은 옳다. (a)를 고르면 그 검사 옆에
*"받아 오는 엔진은 판이 갈려도 숫자를 보인다"*가 하나 더 서야 한다.

---

## 4. C급

### C-1. 클래스 순서 그물은 `agrees()` 하나인데 아무 검사도 안 문다 — 그리고 그 그물이 실제로 무는 입력이 있다

**자리** `src/ml/engines/pyodide-sklearn.ts:539` (우리 정렬) · `:554` (`agrees`) ·
`src/ml/engines/pyodide-serialize.ts:248-249` (나무만 스스로 다시 본다).

**주장** M6(`agrees`가 늘 참)과 M22(우리 정렬을 뒤집음)가 **둘 다 조용했다.** 나무는
`sklearnTreeModel`이 `dump.classes`를 다시 견주고 그 갈래에 검사가 있지만(`클래스 순서가 다르면 안
담는다`), **로지스틱·SVM·나이브 베이즈는 `dump.classes`를 안 본다** — 그 셋의 유일한 그물이
`agrees()`이고, `agrees()`를 지나는 검사는 `pyodide-sklearn.spec`의 가짜(`_dump = '0'`)뿐이라
**참이든 거짓이든 결과가 같다**(`sklearnTreeModel(0)`이 던져서 어차피 `undefined`다).

**그물이 실제로 무는 입력을 쟀다.** 요청서 §3의 *"숫자 라벨이면?"*은 안 터진다 — 어댑터가 라벨을
**문자열로** 넘기므로(`FitInput.target: string[]` → `to_py()` → `np.array`는 `<U`) sklearn도
문자열로 정렬한다. `np.unique(['1','10','2'])` = `['1','10','2']`이고 JS `sort()`도 같다(돌렸다).
**갈리는 자리는 따로 있다** — numpy는 코드포인트(UCS-4)로, JS `sort()`는 UTF-16 코드 유닛으로
견준다. 별 평면 글자(이모지)와 U+E000~U+FFFF(전각 글자·사설 영역)가 함께 있으면 순서가 뒤집힌다:

```
numpy : ['가', '０', '😀']     (U+AC00 < U+FF10 < U+1F600)
JS    : ['가', '😀', '０']     (AC00 < D83D < FF10)
```

그때 `agrees()`는 거짓이고 **모델은 조용히 안 담기며**(맞는 판단이다), 학생·교사가 보는 사유는
C-5의 *"serializer-missing"*이다. 라벨에 이모지와 전각 글자를 같이 쓰는 반은 드물지만 **0은
아니다.**

**처방** (1) `pyodide-sklearn.spec`에 `_dump`이 성한 JSON을 주되 `classes`가 뒤집힌 가짜를
넣어 `model === undefined`를 못 박는다 — M6·M22가 그때 운다. (2) `serialize()`의 정렬을 `mljs.ts`의
`labelCodec`과 **같은 함수**로 만든다(지금은 같은 식을 두 곳에 베껴 놓았다, `mljs.ts:266`).
(3) 순서를 numpy에 맞추려면 `localeCompare`가 아니라 **코드포인트 비교**(`[...a]`로 펼쳐 견줌)여야
한다 — 다만 그건 `labelCodec`·`reference.ts:160`의 동점 규칙까지 함께 옮기는 일이라 결정이 먼저다.

### C-2. `CASES` 등록부는 한 줄을 지워도 조용하다

**자리** `tests/sklearn-serialize.spec.ts:128-179` · `:183-193` (`다섯을 굳혀 두었다`가 `CASES`를
돈다). M7로 `svm`을 지우자 검사 수만 71 → 63으로 줄고 전부 초록이었다 — *"다섯"*이라는 제목이
거짓이 됐는데 아무것도 안 운다. **등록부의 크기를 등록부 자신이 세면 안 된다.** 처방:
`CASES.map(c => c.algorithm)`을 어댑터의 `serializer`가 있는 알고리즘 목록(`random_forest`를 뺀
일곱에서 회귀·군집을 뺀 다섯)과 맞추거나, 최소한 `toEqual(['decision_tree', …])`로 못 박는다.
`toBeDefined()`는 문다(M8).

### C-3. 파이썬 조각은 두 벌이고, 어댑터 쪽이 바뀌어도 아무 검사가 모른다

**자리** `src/ml/engines/pyodide-sklearn.ts:173-182` (`TREE_DUMP_HELPER`) ·
`scripts/generate_sklearn_fixtures.py:167-183` (`tree_dump` — **같은 다섯 줄의 파이썬 복사본**).
M17(`argmax` → `argmin`)이 조용했다. 픽스처의 `dump`은 생성기의 복사본이 만들므로 줄 대조는 어댑터
쪽 문자열을 **영영 안 지나간다** — 이 라운드가 "갈림값 두 벌"에서 넘어졌던 그 모양이 잎의 클래스
자리에 그대로 남았다. `LINEAR_DUMP`·나이브 베이즈·K-평균의 `dump` 문자열도 같다.

**오늘은 같다** — §1의 실행 표가 그 증거다. 처방: 생성기가 어댑터 파일에서 `TREE_DUMP_HELPER`와
`dump` 문자열을 **읽어서 `exec`**하거나(그러면 픽스처가 곧 어댑터의 조각으로 만들어진다), 검사 하나가
두 파일의 파이썬 본문을 글자로 대조한다. 첫째가 낫다 — `sklearnVersion`이 픽스처에 이미 있으니
*"어느 sklearn에서 이 조각이 돌았나"*까지 남는다.

### C-4. 시동 초의 그물 둘에 구멍이 있고, 하나는 이미 빠져나갔다

- **`시동 N초` 꼴만 본다.** M10(*"27.3MB와 7초"*)이 조용했다 — `시동` 낱말 없이 적은 수는
  `물려난 값`(`7.7초`)만 잡는다. **이미 빠져나간 것이 하나 있다**: `ModelAxes.vue:150`
  *"8.7초를 `7초`라고 말하면"* — 앞 수만 고치고 뒤 수(`floor(7.7) = 7`)는 못 고쳐 **8.7초를 7초로
  줄이는 계산은 없다.** `8초`여야 한다.
- **`counted > 8`.** 기준표는 **열셋**이다(`grep -c "^export const MLJS_.*_BASELINE_MS"`). 넷을
  이름만 바꿔 그물 밖으로 내도 통과한다. `toBe(13)`이거나, 더 낫게는 등록부의 `baseline` 칸에서
  세어 이름에 안 기댄다.
- `history`(0 · 15 · 15.4)와 `retired`(7.7초)는 지금 막아야 할 것을 통과시키지 않는다 —
  `tools/`·루트 `README.md`·`CONTRIBUTING.md`·`backend/`는 그물 밖인데 지금은 깨끗하다
  (`grep` 0건). 그물 밖이라는 사실만 적어 둔다.

### C-5. `modelOmittedDetail`이 "직렬화기가 없다"고 말하는데, 있고 거절한 것이다

**자리** `pyodide-sklearn.ts:512` — `serialize()`가 `undefined`를 내는 이유는 셋이다: 칸이 없다
(랜덤 포레스트) · `agrees()`가 거절했다 · `build`가 `null`이거나 던졌다. 셋 다 같은 원문
`serializer-missing:pyodide-sklearn:<algorithm>`이 파일에 남는다. 교사가 `.mlpx`를 열어 그 줄을
읽으면 **"이 알고리즘은 못 담는다"**로 읽는데, 실제로는 C-1의 거절이거나 파이썬이 다른 모양을 준
사고다. `pyodide-sklearn.spec:137`이 그 원문을 `toContain('serializer-missing')`으로 못 박아
**틀린 말을 지키고 있다.** 처방: `serializer-missing` / `serializer-refused:classes` /
`serializer-error:<원문>` 셋으로 가른다 — 원문은 이미 `catch`가 삼키고 있어 공짜다.

### C-6. 다중 클래스 SVM의 표 동점 규칙이 libsvm과 다르다 — 픽스처에는 그 행이 없다

**자리** `src/ml/models/svm.ts:116-122` — 득표가 같으면 **결정함수 합이 큰 쪽**. libsvm의
`svm_predict_values`는 `vote[i] > vote[vote_max_idx]`라 **번호가 작은 클래스**(정렬 순서가 앞선
쪽)다. 클래스 셋 이상에서 세 쌍이 순환할 때만 생긴다. **이 라운드의 기준으로는 "규약이 있는 자리에서
갈리는" 종류다**(포레스트를 안 담은 이유와 같은 축).

**쟀다.** 픽스처의 다중 클래스 두 벌(`multi` 60행 · `iris` 30행)을 생성기의 절차로 다시 학습해
(`coef_`가 픽스처와 `allclose`) `decision_function_shape='ovo'`로 표를 세니 **동점 행 0**이다.
그래서 줄 대조가 초록이고, 이 규칙 차이는 표본 밖이다. 처방은 결정이 먼저다 — sklearn에 맞춰
"정렬 순서가 앞선 클래스"로 바꾸면 **순수 JS 엔진의 파일**(같은 형식 `mlpx-svm-v1`)도 함께 바뀐다.
그쪽 원본(우리 SMO)이 어느 규칙으로 예측하는지 먼저 봐야 한다.

### C-7. K-평균 결정문의 배수 다섯은 부팅이 두 배로 부푼 세션의 sklearn 값 위에 서 있다

**자리** `docs/open-decisions/07-after-audit.md:790-800` · `frontend/src/limits.ts:709-713`.
*"1,000행 52배 · 5,000행 6.8배 · 20,000행 5.3배 · 50,000행 6.2배 · 100,000행 4.7배"*와
*"계산 쪽은 안 부풀었다(100,000행이 10,685 → 12,949ms로 21% 안)"*.

**반증** R29의 원본(`docs/audit/r29-bench.json`)의 `pyodide_k_means`는 1,000행 **773** ·
5,000행 1,573 · 20,000행 3,584 · 50,000행 6,421 · 100,000행 10,685ms다. 결정문이 *"sklearn 쪽
2,141ms"*라고 적은 1,000행은 R29의 **2.8배**이고, 그러면 배수는 52가 아니라 **19**다. 100,000행만
21% 안이고 작은 점일수록 부풀었다 — *"계산 쪽은 안 부풀었다"*는 **한 점(100,000행)을 잰 문장을
사다리 전체에 넓힌 것**이다(workflow §3 여덟 중 8). 순수 JS 열(41 · 393 · 1,286 · 1,615 ·
2,735)은 반복 수(19 · 23 · 25 · 15 · 17)로 나누면 2.2 · 17 · 51 · 108 · 161ms/반복으로 주석과
맞고, `MLJS_KMEANS_BASELINE_MS` 자체는 이 지적과 무관하다. R29 값으로 다시 나누면 19 · 4.0 ·
2.8 · 4.0 · 3.9배이고 **"가벼운 자리에서 진다"는 결론은 그대로 선다** — 틀린 것은 크기다.

**그 세션의 원본이 저장소에 없다** (§7). 처방: 배수 다섯을 R29 원본으로 다시 적거나, 그 세션의
JSON을 `docs/audit/`에 들이고 *"이 세션은 부팅이 두 배였다"*를 표 옆에 적는다.

### C-8. 문장 셋 — 과장·부정확

- *"`packages`는 교사가 파일만 보고 sklearn을 알게 한다"*(결정문 `:729-731`, `schema.ts:723-726`) —
  **화면이 `packages`를 읽는 자리가 없다** (`grep packages src/views src/components` 0건). 지금
  그 문장은 *"zip을 풀어 `runs.json`을 열면"*이다. 요청서 §3이 물은 그대로 과장이다.
- `pyodide-serialize.ts:325` *"`BaseLibSVM._fit`이 클래스가 둘인 `c_svc`에서만"* — sklearn 1.9.1의
  `BaseLibSVM.fit`은 `self._impl in ["c_svc", "nu_svc"]`다(§5 2.2에 원문). `SVC`는 `c_svc`라
  결론은 안 바뀌지만 문장은 좁다.
- `pyodide-runtime.ts:103-108` *"실제로 뜬 배포판"* — `Boot.version`은 **부른 것 중 성공한
  주소의 이름**이지 파이썬에게 물은 값이 아니다(`versions.pyodide`도 `"${version}"`으로 우리가
  적어 넣는다). Pyodide는 JS 쪽 `py.version`으로 자기 판을 말한다 — 물으면 "뜬 것"이 사실이 된다.

---

## 5. 요청서 §2에 대한 답

### 2.1 파이썬 조각

§1의 실행 표. 속성 이름은 sklearn 1.9.1에 전부 그 모양으로 있고, `tree_.value[:, 0, :]`는
(노드 × 1 × 클래스)라 `argmax(axis=1)`가 잎의 클래스다. `_classes`는 군집 쪽 `[]`와 `getattr`의
`[]`가 같아 `agrees()`가 통과한다(§1 표). `float()`은 선형 회귀 `intercept_`(0차원)에만 필요하고
나머지 `intercept_`는 1차원이라 `tolist()`가 리스트를 준다 — **판단이 맞다.** 다만 어댑터 쪽 조각을
지키는 검사는 없다(C-3, M17).

### 2.2 옮기는 규칙 — sklearn 1.9.1 원문으로 확인했다

1. **부호.** `BaseLibSVM.fit`: `if self._impl in ["c_svc", "nu_svc"] and len(self.classes_) == 2:
   self.intercept_ *= -1; self.dual_coef_ = -self.dual_coef_`. `BaseSVC._get_coef`는 이진이면
   **공개** `dual_coef_`(뒤집힌 것)로, 다중이면 `_one_vs_one_coef(self.dual_coef_, …)`로 `coef_`를
   만든다 — 다중에서는 공개와 내부가 같아 **안 뒤집힌 채**다. 그래서 *이진은 그대로, 다중은 뒤집어*가
   맞다. `nu_svc`도 같은 갈래이고, `decision_function_shape`는 `decision_function`의 모양만 바꾸지
   `coef_`·`predict`(libsvm 투표)는 안 건드린다 — **결론을 바꾸지 않는다.**
2. **쌍의 순서.** `_one_vs_one_coef`가 `for class1 in range(n_class): for class2 in range(class1 + 1,
   n_class)`로 쌓는다 — **클래스 수와 무관하게** `(0,1) (0,2) … (1,2) …`이고 `intercept_`도 같은
   순서다(`-rho`). 넷 이상에서도 같다(원문이 그렇다). 픽스처 최대가 셋이라 **실측은 셋까지**다.
3. **±절반.** M2가 답이다 — 라벨 대조 여덟 벌이 전부 조용하고 계수 검사 하나만 운다. **그 하나가
   충분한가**: 절반을 `[−w, +w]`로 담는 실수는 잡지만, `[−w/2, +w/2]`의 **줄 순서**(어느 줄이
   `classes_[1]`인가)는 그 검사가 안 본다 — 그건 라벨 대조가 본다(뒤집으면 이진 여섯 벌이 전부
   운다, M1의 이진 판과 같은 이유). 둘을 합치면 충분하다.

### 2.3 클래스 순서

- **KNN은 그 자리를 안 지나가도 된다.** 참조형은 라벨을 훈련 행에서 읽고(`reference.ts:150-158`)
  파일의 `classes`는 득표 동점의 순서에만 쓴다 — 그 순서도 같은 JS 정렬이라 sklearn의 `classes_`와
  무관하다. sklearn의 KNN 동점은 `mode`라 "정렬 순서가 앞선 클래스"이고 ours `label < best`
  (`:160-163`)와 같다 — **별 평면 글자에서만** 갈린다(C-1과 같은 이유).
- **`labelCodec`과 같은 순서인지 지키는 검사는 없다.** M22가 조용했다. 갈리면 `agrees()`가 거절해
  **틀린 예측이 아니라 조용한 누락**이 된다(C-1·C-5).

### 2.4 배포판 문자열

- `^\d+\.\d+\.\d+$`: JS의 `\d`는 `u` 플래그 없이 ASCII 숫자만이고 `$`는 `m` 없이 끝에서만 문다
  (파이썬과 달리 끝의 개행 앞에서 안 문다). 통과하는 것 중 주소로 쓸모없는 것은 **앞자리 0**
  (`0314.0.7`)과 **없는 판**(`999.0.0`)인데 둘 다 404 → `attempt()`가 못 박은 것으로 → 토스트.
  **빠져나가는 입력은 못 찾았다.**
- **막힌 뒤의 경로.** *"교사에게 아무 말도 안 한다"*는 절반만 맞다. 못 믿을 문자열은
  `engineIsHere`가 먼저 막아(`acceptsVersion` 거짓 → `ENGINE_MISSING`) `prepare`까지 못 간다.
  가는 길은 하나 — 성공 run이 섞인 실험(`claims.some`)에서 **첫 run**의 판이 못 믿을 문자열일 때
  (`enginePinsOf`는 실패 run도 센다). 그때 못 박은 것으로 조용히 바뀌지만, 다시 돈 run의 판이
  주장과 달라 **토스트는 뜬다** — 문장이 *"받을 수 없어"*라 틀린 이유를 말할 뿐이다.
- **`??`.** `engine.acceptsVersion?.(v) ?? engine.engine.version === v`는 `(a?.(v)) ?? (b === v)`로
  묶인다(`??`가 `===`보다 낮다). `mljs`는 `acceptsVersion`이 없어 `undefined ?? 정확일치`가 되고,
  sklearn이 `false`를 내면 `??`가 안 넘어간다. M4와 `sklearn은 판이 달라도 안 막고, 순수 JS는 막는다`
  (`mljs@2` → `ENGINE_MISSING`, `latest` → `ENGINE_MISSING`)가 세 갈래를 다 본다. **새지 않는다.**

### 2.5 스탬프의 시점

- sklearn run 뒤의 mljs run: `mljs`에는 `describe`가 없어 등록부 값 — 맞다(`ENGINES[0]`에 칸이
  없고 `pyodide-runtime.spec`의 `순수 JS는 정확히 같아야 한다`가 `describe`·`acceptsVersion`이
  없는 것을 못 박는다).
- `prepare` 성공 뒤 `fit` 실패: `booted`가 이미 차 있어 뜬 판이 적힌다 — **맞다**, 그 판에서
  실패했다. 검사는 `describe: () => undefined`인 실패만 본다(`못 띄운 run`)라 이 갈래는 안 본다.
- 메인 스레드에서 `runExperiment`를 부르는 곳: `reproduceExperiment`(`reproduce.ts:250`)뿐이고
  **`src/`에서 그것을 부르는 곳은 0건**이다(검사만 쓴다). 점검 화면은 워커다.

### 2.6 이 라운드가 세운 검사

- `CASES` 한 줄 삭제 → 조용(M7, C-2). `toBeDefined()` → 문다(M8).
- `counted > 8` → 표는 열셋(C-4).
- `history`(0·15·15.4)는 통과시켜야 할 것만 통과시킨다. 다만 정규식이 `시동 N초` 꼴만 보고
  (M10 조용), `retired`는 `7.7초` 한 줄이라 `ModelAxes.vue:150`의 `7초`가 남았다(C-4).
- "자기 파일을 뺀다"로 숨는 것: 그 파일 자신뿐이다. `audit/`은 역사라 맞다. 그물 **밖**은
  `frontend/tools`·루트 `md`·`backend`이고 지금은 깨끗하다.

---

## 6. 실측 대조 — 요청서 §3

| 무엇 | 요청서 | 재현 | 어떻게 |
|---|---|---|---|
| 포레스트가 갈리는 줄 | 387 중 12 | **8벌 · 12줄** | `SHOWME` — `{"counted":8,"diverged":12}` |
| KNN 동점 행 | 387 중 32 | **32** | `SHOWME` — `{"rows":387,"undecided":32,"diverged":1}` |
| KNN이 실제로 갈린 줄 | 1 | **1** | 같은 줄 |
| K-평균 기준표 | 41 · 393 · 1,286 · 1,615 · 2,735 | 같다 — 반복당 2.2·17·51·108·161ms로 주석과 맞음 | `limits.ts:1215-1221` · `open-decisions.md` 표 |
| K-평균 두 엔진 100,000행 | sklearn 4.7배 느림 | 12,949 / 2,735 = **4.73** | 결정문 표 |
| 시동 여섯 · 8,700 | 7,908~10,035 · 중앙값 8,526 | **원본이 저장소에 없다** | §7 |

**포레스트의 12줄이 "다수결 대 확률 평균"인지는 못 갈랐다** — 세는 검사는 갈린 줄만 세고 원인을 안
가른다. 잎마다 분포가 없으니(argmax만 실었다) 여기서 갈라 볼 수도 없다. 결정문의 설명은 그럴듯하지만
**잰 것은 "갈린다"까지다.**

**반증한 문장 셋.**

- *"sklearn은 `np.unique`로 정렬한다 — 숫자 라벨이면?"* — 안 터진다. 문자열이 양쪽에 간다(§5 2.3).
  터지는 자리는 다른 데 있다(C-1).
- *"한 실험의 run들은 같은 세션에서 만들어져 같은 판을 말한다"* — 실험 하나는 `runExperiment` 한 번이고
  워커 하나·부팅 하나라 **참이다.** 학기를 가로질러도 실험이 다르면 못이 다르고 워커가 다르다.
  run이 나중에 실험에 덧붙는 경로는 없다. 유일한 틈은 `enginePinsOf`가 **실패 run**까지 세어 첫 run의
  판을 쓰는 것인데, 실패 run도 같은 워커에서 났으니 판이 같다.
- *"`packages`는 교사가 파일만 보고 sklearn을 알게 한다"* — 과장이다(C-8).

---

## 7. 못 한 것 · 확정 불가 (고치는 쪽이 재야 할 자리)

- **Pyodide를 안 띄웠다.** 파이썬 조각은 CPython + sklearn **1.9.1**에서 돌렸고 Pyodide는 **1.8.0**이다.
  `tree_.value` 모양·`var_`·`class_prior_`·`coef_`는 1.4 이후 안 바뀐 API라 갈릴 이유를 못 찾았지만,
  1.8.0으로는 안 돌려 봤다.
- **폴백 실물.** B-1의 갈림은 원본이 배포판을 내려야 생긴다. `compareRun`까지만 재현했다(S1).
- **시동 여섯(7,908~10,035)과 K-평균 재측정 세션의 원본이 저장소에 없다.** `docs/audit/`에는
  `r29-bench.json`뿐이고, 커밋 `2ee6b05`·`985d21f`·`984093b`에 JSON이 없다. 8,700을 "방향으로 골랐다"는
  결정은 §4-5대로 안 건드렸지만, **여섯이 그 범위였다는 것도, 부팅 다섯이 16,576~17,480이었다는 것도
  다시 볼 방법이 없다.** C-7의 2,141ms도 같은 세션이다.
- **SVM 표 동점 행이 실제 학생 데이터에서 얼마나 나는지** — 픽스처 둘에서 0이었을 뿐이다(C-6).
- **처방은 넣어서 재지 않았다.** M21이 B-1 처방 (a)의 절반을 쟀고, 나머지는 결정이 먼저다.

## 8. 규모

읽은 것: 요청서 · 결정문 두 절 · 슬라이스 여섯의 소스 8파일 · 검사 9파일 · 생성기 · 픽스처 구조.
돌연변이 19(욺 14 · 조용 5) · 임시 스펙 2 · `SHOWME` 2 · 파이썬 실행 3회(조각 일곱 · SVM 동점 ·
정렬) · `vue-tsc` 17회.
