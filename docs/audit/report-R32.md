# R32 감사 보고서 — R31이 못 본 델타, 그리고 조용히 실패하는 갈래

> 요청서: `docs/audit/request-R32.md` · 공통 절반: `docs/workflow.md` §3
> 대상: `d351f34..ccd4e91` (커밋 넷) · 읽은 HEAD: `b10b92f`
> 감사자는 아무것도 고치지 않았다. 심은 것은 전부 파일 하나의 정확한 경로로 되돌렸고,
> 임시 스펙 다섯과 측정 스크립트는 지웠다. 끝난 뒤 `git status --short`는 이 보고서
> 하나만 보인다.

## 0. 한 줄 — 그리고 배포 판정

**이대로는 안 된다. 한 줄을 먼저 고쳐야 한다.**

**A-1: 파이썬 쪽이 한 번이라도 던지면 그 프로젝트는 다시 안 열린다.** 어댑터가 적는
`modelOmittedDetail`이 스키마 상한을 **36자 넘고**, 쓰는 길에는 검증이 없고 **읽는 길에만**
있다. 그래서 `.mlpx`는 멀쩡히 저장되고 **그 파일도, IndexedDB의 사본도, 다시는 안 열린다.**
실물 Pyodide 314.0.7을 띄워 쟀다 — **가장 짧은 예외조차 메시지가 321자**라 이 경로에는
"안 넘치는 경우"가 없다. 고침은 한 줄이고 실측했다.

**그 갈래가 존재하는 이유가 뒤집혔다.** `serialize()`의 `try`는 *"여기서 나는 어떤 사고도
학습을 죽이지 않는다"*를 위해 있는데, **지금은 그 `try`가 학습이 아니라 프로젝트를 죽인다.**

나머지는 배포를 막지 않는다.

**새 문 자체는 건강하다.** 하한은 **증명된 하한**이고(§3.2 — 대수로 닫히고 모양 120개에
반례 0), 세는 식은 **실물 sklearn의 모양 여덟에서 한 번도 안 어긋났다**(§3.3). 요청서가
걱정한 갈래 넷(`n_estimators=1` · 잎 하나짜리 나무 · 클래스 둘 · `estimators_` 없음)은
전부 옳게 셌다. `tooLarge` 어휘는 **왕복에서 안 샌다**(§3.1 — 요청서 §2.2가 물은 것).

**B-1은 내가 R31에서 놓친 것이다.** 요청서 §2.3-5가 *"다른 경로로 예상을 셈하는 자리가
남아 있는가 — `grep`으로 세라"*고 물었고, 남아 있다 — `TrainView.vue:88`이다. 순수 JS에서
잰 알고리즘 배수가 **엔진을 안 가리고** sklearn 줄의 수에 실린다. 병렬로 도는 알고리즘
셋에서는 방향이 **체계적으로 짧다**.

돌연변이는 **열셋 심어 아홉이 울고 넷이 조용했다.**

---

## 1. 돌연변이 표 — 전체 (운 것 포함)

기준선: `npm run ci` **173파일 3,546통과 · 3스킵 · exit 0**(약 100초), 백엔드
`uv run python scripts/ci.py` **33통과 · exit 0**. 끝난 뒤 앞의 것을 다시 돌려 같은 수를
확인했다.

**"lint만"·"tsc만"은 조용한 쪽으로 세지 않는다** — 관문이 서기 때문이다. 다만 어느 쪽이
울었는지는 적는다.

| # | 무엇을 뭉갰나 | 돌린 것 | 결과 |
|---|---|---|---|
| M1 | `experiment.ts:717` `modelOmittedReason ?? …`를 `'engineUnsupported'`로 고정 (요청서 #1) | 슬라이스 3 → `npm run ci` | **lint만 욺** (`no-unused-vars`) |
| M1b | 같은 자리를 쉼표 연산자로 (lint 회피) | `npm run ci` | **tsc만 욺** (TS2695) |
| M1c/d | **필드를 아예 안 받게** 하고 서식까지 맞춤 (lint·tsc 초록) | `npm run ci` | **조용** (3,546통과) → **C-1** |
| M2 | `tree.ts:179` v1 로더가 `classes.length + 1` (요청서 #2) | `models`·`tree-v2`·`sklearn-serialize` | **욺** 1건 — `범위 밖 잎은 예측할 때가 아니라 읽을 때 거부한다`. **겨냥한 자리와 같다** (R31 C-6 닫힘) |
| M3 | `estimate.ts:274` `sklearnHandleFactor`의 마지막 `return 1` → `2` (요청서 #3) | `npm run ci` | **욺** 1건 — `sklearn 의사결정트리의 예상은 기준표 그대로다` (R31 C-2 닫힘) |
| M4 | `reproduce.ts:410` `engineVersionFallback`에서 `versionIsFetched` 줄 삭제 (요청서 #4) | `reproduce`·`inspect-reproduce-live` | **욺** 3건 — `순수 JS는 판이 갈려도 아무 말도 안 한다` 외 둘. **`앞 줄이 순수 JS여도 sklearn 줄을 찾아 말한다`가 순서까지 본다** (R31 C-5 닫힘) |
| M5 | `models/index.ts:56` `minimumTreeV2Bytes` 재수출 삭제 (요청서 #5) | `vue-tsc --build` | **tsc 욺** 2건 (TS2305) |
| M6 | `refusedForSize`가 언제나 `undefined` (요청서 #6) | `pyodide-sklearn`·`sklearn-serialize` | **욺** 1건 — `하한이 상한을 넘으면 옮기지 않고 거절한다` |
| M7 | `minimumTreeV2Bytes`가 `nodes`를 무시 (요청서 #7 — *"안 울 것"*이라 적혀 있었다) | `sklearn-serialize` 외 | **욺 8건** — **요청서의 예상과 다르다.** 무는 것은 `toBeLessThanOrEqual`이 아니라 **`toBeGreaterThan(actual * 0.2)`** 쪽이다(`expected 690 to be greater than 1301.8`) → C-4 |
| M8 | `TREE_V2_MIN_BYTES_PER_NODE = 90` (요청서 #8) | `sklearn-serialize` | **욺 8건** |
| M8b | 같은 상수를 **`4`로** (하한이 더 낮아지는 방향) | `sklearn-serialize` | **조용** (95통과) → C-4 |
| M9 | `adapter_python.sizes()`의 `random_forest` 확인 삭제 **+ 어댑터의 `size` 칸 삭제** (요청서 #9) | `fixtures:check` | **욺** — `Stale fixtures: 여덟 벌` (그물이 둘이다) |
| M10 | `size` 식의 `children_left == -1` → `== -2` (요청서 #10) | `fixtures:check` | **욺** — `size.leaves: 73 != 0` 외 |
| M11 | `knn` 항목의 **꼬리 주석**에 옛 `dump:` 예시 한 줄 | `adapter_python.dumps()` | **뽑힌다** — `knn -> {"rows": _model._fit_X.tolist()}`. R31 C-7의 고침이 **줄머리 주석만** 지운다 → C-2 |

---

## 2. 지적

### A-1. 파이썬이 던지면 그 프로젝트는 저장은 되고 다시 안 열린다

**자리** `frontend/src/ml/engines/pyodide-sklearn.ts:620-622` (`omitted`) ·
`frontend/src/project/schema.ts:807` (`z.string().max(200)`)

**주장** 세 사실이 겹쳐 프로젝트가 죽는다.

1. **사유 문자열이 상한을 넘는다.** `failureDetail`은 메시지를 200자로 자르는데
   (`errors.ts:515`, `errors.spec.ts`가 그것을 못 박는다), `omitted()`가 그 **뒤에**
   접두사를 붙인다 — `pyodide-sklearn:<알고리즘>:threw:`가 26~42자다. 결과는 226~242자.
2. **쓰는 길에는 검증이 없다.** `parseProjectDocument`를 부르는 곳은 **읽는 길뿐**이다
   (`migrate.ts:185` 하나, 그리고 그것을 부르는 `readProject`와 `storage.ts:439`).
3. 그래서 **저장은 성공하고 열기는 실패한다.**

**재현 ① — 넘치는 것** (임시 스펙, 진짜 입구인 `fit()`으로)

```
파이썬 메시지 159자 → detail 201자 ❌넘음     (logistic_regression 기준 문턱)
파이썬 메시지 400자 → detail 242자 ❌넘음
svm 226자 · k_means 230자 · decision_tree 236자 · logistic_regression 242자
```

**재현 ② — "안 넘치는 경우"가 없다는 것** (실물 Pyodide **314.0.7**을 Node에 띄워 쟀다.
코어 5개 파일 12.9MB를 원본에서 받아 `loadPyodide({indexURL:'./'})`)

```
어댑터의 dump 줄 (_model 없음): PythonError · message 647자
짧은 예외 `raise ValueError("x")`: PythonError · message 321자
AttributeError:                    PythonError · message 365자
```

`PythonError`의 `message`는 **포맷된 트레이스백**이고(`pyodide.asm.mjs`의
`class PythonError extends Error { constructor(e, r, n) { super(r) … } }`), Pyodide의
`_pyodide/_base.py` 프레임이 언제나 들어가므로 **가장 짧은 예외도 321자다.** 문턱은
159자다. **이 경로에 안 넘치는 파이썬 예외는 없다.**

**재현 ③ — 그래서 무슨 일이 나는가** (임시 스펙, `writeProjectBytes` → `readProject`)

```
detail 길이 = 247
저장 성공: 2890 바이트
열기 실패: PROJECT_FILE_INVALID {"path":"runs.experiments.0.runs.0.modelOmittedDetail","issues":1}
```

**`.mlpx`만이 아니다.** `storage.ts:439`의 `loadProject`도 같은
`migrateProjectDocument`를 지나므로 **IndexedDB의 사본도 안 열린다.** 그리고
`stores/project.ts:139`가 그것을 받아 토스트를 띄우고 목록으로 돌려보낸다 —
**목록에는 그 프로젝트가 계속 보이고, 눌러도 영영 안 열린다.** 자동 저장이 학습 직후에
쓰므로 **내보내기 전에 이미 그렇다.**

**무엇이 뒤집혔나.** `serialize()`의 `try` 위에 이렇게 적혀 있다 —
*"여기서 나는 어떤 사고도 학습을 죽이지 않는다. … 던지면 그 run이 통째로 실패하고 학생은
학습을 다시 해야 한다 — 담을 것이 없는 것보다 나쁘다."* **지금은 그 반대다.** 던지게
두었으면 run 하나가 실패하고 끝인데, 삼켜서 **프로젝트 전체가 죽는다.**

**이웃을 셌다 — 한 군데뿐이다.** 스키마에서 `.max()`로 길이를 막는 문자열 칸은
`modelOmittedDetail` **하나뿐이고**(`grep -n "z.string().max(" src/project/schema.ts`),
그 값에 접두사를 붙이는 자리도 `pyodide-sklearn.ts:621` **하나뿐이다.** 순수 JS 쪽
(`mljs.ts`의 568·697·770·849)은 `failureDetail`의 결과를 **그대로** 넘기므로 200자를
안 넘는다.

**처방 (실측했다)** `omitted()`에서 한 번 자른다.

```ts
function omitted(algorithm: string, why: string): { readonly modelOmittedDetail: string } {
  return {
    modelOmittedDetail: `pyodide-sklearn:${algorithm}:${why}`.slice(0, MAX_FAILURE_DETAIL_LENGTH),
  }
}
```

심어서 다시 쟀다 — **400자 메시지에서도 detail이 정확히 200자**이고,
`pyodide-sklearn.spec.ts`·`sklearn-serialize.spec.ts` 109개가 그대로 초록이다.

**검사도 함께 세워라.** 지금 `errors.spec.ts`는 **생산자**(`failureDetail`)가 200자로
자르는 것만 본다. 필요한 것은 **소비자 쪽** — *"`fit()`이 내놓는 `modelOmittedDetail`은
언제나 `MAX_FAILURE_DETAIL_LENGTH` 이하다"*를 긴 메시지로 찌르는 검사 하나. 그게 없으면
접두사가 하나 더 붙는 날 같은 일이 난다.

> **덧 — 자르는 자리가 UTF-16이다.** `slice(0, 200)`은 코드 단위로 자르므로 서로게이트 쌍을
> 반으로 가를 수 있다. 스키마의 `.max()`도 코드 단위라 통과하고 `JSON.stringify`가
> `\udXXX`로 내보내므로 **파일은 깨지지 않는다.** 이 저장소가 UTF-16 대 코드포인트를
> 이미 아는 부채로 갖고 있어(§4) 여기 적어만 둔다.

---

### B-1. 순수 JS에서 잰 알고리즘 배수가 sklearn 줄의 예상에 실린다

**자리** `frontend/src/views/TrainView.vue:84-98` (`onModelTimed`) · 같은 파일 `:271`
(`modelFactors.value[row.algorithm] ?? factor`)

**주장** 요청서 §2.3-5가 *"다른 경로로 예상을 셈하는 자리가 남아 있는가"*를 물었다.
남아 있다 — **세 번째 자리는 `baselineMs`를 직접 부르는 `onModelTimed`다.**

```ts
if (runtime !== 'mljs' || dataType === undefined) return          // 순수 JS만 잰다
const expected = baselineMs({ algorithm, dataType, rows, columns, hyperparameters })
modelFactors.value = { ...modelFactors.value, [algorithm]: factorFromRun(elapsedMs, expected) }
```

**쓰는 쪽에는 엔진 축이 없다** — `modelFactors`는 **알고리즘 하나에 값 하나**이고,
`estimates`가 그 값을 **모든 줄에**, 즉 sklearn 줄에도 먹인다.

**이것이 그냥 기기 배수라면 옮겨도 된다. 그런데 아니다.** 이 값이 알고리즘마다 따로 있는
이유를 그 코드의 주석이 직접 말한다 — *"하나로 두면 **기준표가 크게 틀린 알고리즘**
(K-평균이 그랬다)의 오차가 다른 알고리즘의 예상으로 옮는다."* 즉 이 배수는 기기 속도만이
아니라 **그 (알고리즘 × 엔진)의 표 오차**를 흡수한다. 표 오차는 엔진마다 다르다.

**방향이 체계적이다.** `estimate.ts`의 머리글이 *"기준표는 직렬 시간이고, 그것이 맞다 …
코어가 여럿인 기기에서는 예상이 실제보다 길게 나온다"*고 적는다. 그래서 병렬로 도는 셋
(포레스트 1.95배 · KNN 2.36배 · 신경망 1.76배, `limits.ts:1642-1672`의 A/B)에서
**순수 JS의 측정 배수는 1보다 작아진다.** 그 값이 **병렬이 없는 Pyodide**(단일 스레드
WASM) 줄에 실리면 예상이 짧아진다 — 이 파일이 *"틀릴 때는 길게 틀린다"*로 금지한 방향이다.

**재현** (임시 스펙, 기기 배수는 1로 두고 알고리즘 배수만 실었다)

```
random_forest@100,000 : 옳은 수 63,657ms {minutes 2}  → 배수 0.51이면 36,883ms {seconds 40}
random_forest@20,000  : 옳은 수 17,093ms {seconds 20} → 배수 0.51이면 13,004ms {seconds 15}
knn@100,000           : 옳은 수 25,057ms {seconds 30} → 배수 0.42이면 15,631ms {seconds 20}
```

화면이 **`약 2분`이라고 말해야 하는 자리에서 `약 40초`**라고 말한다. 반대 방향(표가
실제보다 빨랐던 경우)도 같은 크기로 난다 — 배수 3이면 `약 2분`이 `약 3분`, 의사결정트리
20,000행은 `약 10초`가 `약 15초`다.

**닿는 조건** 학생이 **같은 알고리즘을 순수 JS로 한 번 돌린 뒤** sklearn 줄을 보는 것.
교실에서 *"순수 JS로 해 보고 scikit-learn으로 다시 해 보자"*는 흔한 순서이고,
`writeModelFactors`가 `localStorage`에 남기므로 **차시를 넘어서도 실린다.**

**내가 R31에서 놓쳤다.** R31 C-1은 화면 둘이 `runtime`을 안 넘기는 것을 잡았는데,
같은 화면의 **세 번째 계산 자리**를 안 셌다. 이번 요청서가 그것을 다시 물어서 나왔다.

**왜 B인가** 처방이 코드가 아니라 결정이다. 값이 다른 길이 셋이다.

1. **키에 실행 방법을 더한다** — `modelFactors[algorithm][runtime]`. `maxRows`·`baseline`이
   이미 그 모양이고(`AlgorithmSpec`), 이유도 같다. 대신 sklearn 줄은 **처음 한 번은
   교정이 없다**(sklearn run의 `elapsedMs`에는 시동 8.7초가 들어 있어 그대로 쓰면
   배수가 터진다 — 지금 `runtime !== 'mljs'` 가드가 그것을 막고 있다. 재려면 시동을 빼야
   하고, 그 값은 `RuntimeSpec.preparation.ms`에 이미 있다).
2. **sklearn 줄은 알고리즘 배수를 안 쓴다** — 전역 기기 배수만 먹인다. 한 줄이고,
   지금보다 반드시 낫다(틀린 보정 대신 보정 없음).
3. **아무것도 안 한다** — 배수가 결국 기기 속도에 수렴한다고 보는 판단.

**확인 못 한 것**: 처방 중 어느 것도 심어 보지 않았다. 1번은 저장 형식
(`localStorage`의 `modelFactors`)이 바뀌어 옛 값의 처리가 따라오고, 그건 결정 뒤의 일이다.

---

### C-1. `fit()`이 정한 사유 어휘가 run에 실리는지 아무도 안 본다

**자리** `frontend/src/ml/experiment.ts:717`

**주장** 요청서 #1의 돌연변이를 **lint와 tsc까지 통과하는 모양으로** 심으면
관문이 조용하다.

| 심은 모양 | 결과 |
|---|---|
| `modelOmittedReason ?? …` → `'engineUnsupported'` (구조 분해는 그대로) | lint 욺 (`no-unused-vars`) |
| 쉼표 연산자로 lint 회피 | tsc 욺 (TS2695) |
| **구조 분해에서 필드를 빼고 서식까지 맞춤** | **조용 — 3,546통과** |

즉 이 배선을 **없던 것으로 되돌려도** 검사가 하나도 안 운다. 두 조각은 각자 초록이다 —
엔진 쪽은 `pyodide-sklearn.spec.ts`가 `result.modelOmittedReason === 'tooLarge'`를 보고,
소비자 쪽은 요청서가 읽어서 확인했다. **잇는 자리만 비어 있다**(`workflow.md` §3의
되풀이하는 병 둘째).

**새는 것** 학생이 받는 지시가 뒤집힌다. `tooLarge`는 *"다시 학습해도 같으니, 나무
개수처럼 모델을 키우는 설정을 줄여 보세요"*이고 `engineUnsupported`는 *"여기서 학습한
모델은 아직 저장할 수 없어 점수만 남겼습니다"* — **하나는 할 일이 있고 하나는 없다.**

**이웃** `FitResult`에서 run으로 건너오는 칸은 여섯이다(`predict`·`predictBatch`·`model`·
`modelOmittedDetail`·`modelOmittedReason`·`warning`·`clusterResult`). `modelOmittedDetail`도
같은 상태인지 따로 안 쟀다 — **§4에 적는다.**

**처방** `experiment.spec.ts`에 가짜 엔진으로 *"엔진이 `tooLarge`라고 하면 run의
`modelOmitted`가 `tooLarge`다"* 한 줄. 그리고 짝으로 *"안 말하면 `engineUnsupported`다"*.
**심어 보지 않았다.**

---

### C-2. 주석 지우기가 **줄머리**만 지운다 — 꼬리 주석은 여전히 이긴다

**자리** `scripts/adapter_python.py:89`·`:120` (`re.sub(r"^\s*(//|\*|/\*).*$", …)`)

**주장** R31 C-7의 고침이 절반이다. 코드 줄 **끝에** 붙은 주석은 안 지워지고,
`dump: '…'`를 품고 있으면 그것이 뽑힌다.

**재현** `knn` 항목의 코드 줄 끝에 한 줄:

```ts
fixed: ["algorithm='brute'"], // 한때 dump: '{"rows": _model._fit_X.tolist()}' 였다
```
```
$ uv run --project backend python -c "…; print(adapter_python.dumps().get('knn'))"
{"rows": _model._fit_X.tolist()}
```

**오늘은 시끄럽다** — 뽑힌 식이 돌면 `expected.json`에 없던 `dump` 키가 생겨
`fixtures:check`가 여덟 벌을 전부 `Stale`로 세운다(R31에서 같은 모양을 쟀다). 조용해지는
것은 **뽑힌 식이 같은 JSON을 낼 때뿐**이라 위험은 낮다.

**같은 병의 이웃** 이 파일에 정규식으로 소스를 뽑는 자리가 **열 곳**이고
(`grep -c "re\.search\|re\.finditer\|re\.sub"` → 10), 블록을 쪼개고 주석을 지우는 **똑같은
네 줄이 `dumps()`와 `sizes()`에 두 벌**로 있다(`:78-89`와 `:113-120`). 다음에 이 정규식을
고칠 사람은 두 곳을 고쳐야 하고, 한 곳만 고치면 아무도 안 운다.

**처방** `dump:`/`size:`를 **속성 자리로 앵커**한다 — `^\s{6}(dump|size):`처럼 줄머리와
들여쓰기를 요구하면 꼬리 주석이 원천적으로 안 걸린다. 그리고 블록 쪼개기를 함수 하나로
합친다. **심어 보지 않았다.**

---

### C-3. `estimateMs`가 여전히 선택 인자로 열려 있다

**자리** `frontend/src/ml/estimate.ts:342`

**주장** R31 C-1의 고침은 화면 둘을 `browserEstimateMs`로 옮겼지만, **덫 자체는 그대로
있다** — `estimateMs`는 계속 내보내지고 `runtime`이 선택이라 **안 넘기면 조용히 순수 JS의
수가 나온다.** 새 화면이 `estimateMs`를 부르는 것을 막는 것이 아무것도 없다.

`browserEstimateMs`의 독스트링이 스스로 *"`runtime`이 필수인 것이 이 함수의 전부다"*라고
적는데, 그 말이 참이려면 **선택인 쪽이 화면에서 안 보여야** 한다.

**이웃** `src` 안에서 예상을 셈하는 자리는 셋이다 — `TrainView.vue:271`(고쳐짐) ·
`ReproducePanel.vue:216`(고쳐짐) · **`TrainView.vue:88`의 `baselineMs`(B-1)**.
`estimateMs`를 직접 부르는 화면은 지금 없다.

**처방** `tests/ui-rules.spec.ts`가 이미 `src/views`의 소스를 훑으므로 거기에 한 줄 —
*"화면은 `estimateMs`를 안 들여온다. 예상은 `browserEstimateMs`로 낸다."* 오늘 통과한다
(위 `grep`이 0건). **심어 보지 않았다.**

---

### C-4. `toBeGreaterThan(actual * 0.2)` — 문턱이 무는 자리와 지나가는 자리를 쟀다

**자리** `frontend/tests/sklearn-serialize.spec.ts:305`

**주장** 요청서가 *"0.2는 내가 고른 수다. 근거가 있는가"*라고 물었다. **근거는 없고,
자리는 나쁘지 않다.** 그리고 **요청서의 예상 하나가 틀렸다.**

**관측한 밴드** (벌 여덟, 임시 스펙)

```
origin      C=2 nodes=266  leaves=138 least=3084  actual=6509  비율 0.474
sum120      C=2 nodes=242  leaves=126 least=2808  actual=5920  비율 0.474
scale       C=2 nodes=138  leaves=74  least=1612  actual=3495  비율 0.461
overlap     C=2 nodes=1044 leaves=527 least=12031 actual=25307 비율 0.475
multi       C=3 nodes=874  leaves=442 least=10960 actual=22141 비율 0.495
iris        C=3 nodes=136  leaves=73  least=1735  actual=3555  비율 0.488
categorical C=2 nodes=758  leaves=384 least=8742  actual=18823 비율 0.464
missing     C=2 nodes=602  leaves=306 least=6948  actual=14622 비율 0.475
```

실측 밴드는 **0.461 ~ 0.495**이고 문턱은 그 절반 아래다.

**요청서는 M7(`nodes`를 무시)을 *"안 울 것"*이라고 적었는데 울었다** — 그리고 무는 것은
하한 쪽(`toBeLessThanOrEqual`)이 아니라 **이 0.2 문턱**이다. 그 모양의 비율이 0.106이라
문턱을 밑돈다.

**지나가는 것도 쟀다.** `TREE_V2_MIN_BYTES_PER_NODE`를 `9 → 4`로 낮추면 비율이 약 0.27이
되어 **조용히 통과한다**(95통과). 이것은 **해가 없는 방향**이다 — 하한이 더 낮아질 뿐
거절이 더 관대해지고, 113MB짜리 숲은 여전히 걸린다. 그래서 이 문턱이 지키는 것은
*"하한이 무의미해지는 것"* 하나이고, **그 목적에는 0.2가 실제로 작동한다.**

**처방** 값을 바꾸라는 것이 아니라 **그 수가 어디서 왔는지를 적어라.** *"실측 밴드가
0.46~0.50이고 문턱은 그 절반이다"* 한 줄이면 다음 사람이 이 수를 재지 않아도 된다.
지금 주석은 *"실제의 몇 할은 돼야"*라고만 적어 **몇 할인지 모른다.**

---

### C-5. `refusedForSize`의 숫자 판정이 `NaN`을 통과시킨다

**자리** `frontend/src/ml/engines/pyodide-sklearn.ts:642`

```ts
if (typeof nodes !== 'number' || typeof leaves !== 'number') return undefined
```

**주장** `NaN`은 `typeof`가 `'number'`다. 그러면 `minimumTreeV2Bytes`가 `NaN`을 내고
`NaN <= MAX_MODEL_BYTES`가 거짓이라 **거절 문자열이 만들어진다** — `too-large:NaN
nodes:NaN leaves:NaN bytes`. 즉 셀 수 없는 것을 *"너무 크다"*로 말한다.

```
minimumTreeV2Bytes(NaN, 1, 3) → NaN        (임시 스펙)
minimumTreeV2Bytes(-1, -1, 3) → -16
```

**닿는가 — 오늘은 아니다.** `size` 식이 `int(...)`로 감싸므로 파이썬이 `NaN`을 줄 수 없고,
줬더라도 `json.dumps`의 `NaN`은 `JSON.parse`가 거부해 `try`가 삼킨다. **그 자리에서
A-1이 난다.**

**처방** `Number.isFinite(nodes) && Number.isFinite(leaves)`로 바꾼다. 같은 줄 하나다.
**심어 보지 않았다.**

---

### C-6. `sizes()`는 백틱만 본다 — 조용히 빠지는 모양이 하나 있다

**자리** `scripts/adapter_python.py:121`

**주장** `dumps()`는 세 모양을 본다(`LINEAR_DUMP` · 작은따옴표 · 백틱). `sizes()`는
**백틱 하나**만 본다. 그래서 누가 `size: '…'`를 한 줄짜리 작은따옴표로 쓰면 뽑히지 않고,
`random_forest`가 아니면 **아무 소리도 안 난다**(`random_forest`만 확인한다).

**오늘은 칸이 하나뿐이라 해가 없다.** 다만 요청서 §2.5가 물은 *"`dumps()`의 `EXPECTED`와
모양이 다른데 둘 중 하나가 틀렸는가"*의 답은 **둘 다 맞다**이다 — `EXPECTED`는 일곱을
요구하고(`knn`은 이제 빠졌다, R31 C-3 닫힘), `sizes()`는 하나를 요구한다. 오늘 어댑터에
`size` 칸은 정확히 하나다.

**픽스처 여덟 벌이 전부 `size`를 갖는다** — 분류 벌 여덟 전부에 `random_forest.size`가
있고 회귀 벌(`regress`)에만 없다. 스펙의 반복이 회귀를 건너뛰므로 **그물이 비지 않는다.**

**처방** 없어도 된다. 굳이 한다면 `dumps()`와 같은 세 모양을 보게 맞춘다.

---

## 3. 재서 답한 것 — 지적이 안 된 것들

### 3.1 `tooLarge`는 왕복에서 **안 샌다** (요청서 §2.2)

요청서가 *"하나라도 찾으면 A급이고, 없으면 안 샌다고 적어라"*고 했다. **안 샌다.**
코드로 밟고 실물로 확인했다.

| 관문 | 무슨 일이 나나 |
|---|---|
| `attach.ts:103-107` | 모델이 없고 `run.modelOmitted !== undefined`라 **그대로 돌려준다** — 덮지 않는다 |
| `schema.ts:798` | `tooLarge`는 `MODEL_OMISSION_REASONS`의 항목이고 **`formatVersion` 1의 어휘 지문에 이미 있다**(`schema-version.spec.ts`) — 옛 앱도 받는다 |
| `format.ts:465-480` (읽을 때) | `run.model`이 없어 `reasonFor`를 안 부르고, `if (reason)`이 거짓이라 **파일에 적힌 값이 남는다** |

실물 왕복(임시 스펙, `writeProjectBytes` → `readProject`):

```
왕복 뒤: modelOmitted=tooLarge detail=short model=undefined
```

### 3.2 하한은 **하한이다** — 대수로 닫히고 반례가 없다 (요청서 §2.1-2)

*"이 문을 여는 유일한 근거"*를 반증하려 했고 못 했다. 최소 JSON 길이를 세면:

```
실제 ≥ [nodes 배열] + [leaves 배열]
     = (9·가지 + 12·잎 + (n−1)) + (L·(2C+1) + (L−1))
     = 9n + 3L + n − 1 + L(2C+1) + L − 1
     = 하한 + 4L + n − 2
```

가지는 `[0,0,1,2]`로 9자가 바닥이고 **잎은 `[-1,K,-1,-1]`이라 12자가 바닥인데 하한은
9로만 센다** — 잎마다 3자가 남는다. 잎의 줄은 `[0,0,…]`이 정확히 `2C+1`자이고 하한이
그 값이다 — 남는 것은 줄 사이 쉼표다. 머리글(`format`·`classes`·`featureCount`·`trees`의
대괄호)은 **아예 안 센다.** `n ≥ 1, L ≥ 1`이면 차이가 최소 3이고, 여기에 머리글
90자쯤이 더 붙는다. **C가 아무리 커도 비율이 1 아래로 안 내려간다.**

수로도 훑었다 — 나무 수 4 × 잎 수 5 × 클래스 수 6 = **모양 120개, 반례 0개**.
가장 아슬아슬한 자리는 `actual/least = 1.022`(나무 100 · 잎 50 · **클래스 200**).
퇴화 입력: `nodes=0, leaves=0 → 0`(거절 안 함) · `C=0`(회귀 모양) → `9n + L`(여전히 하한).

### 3.3 세는 식은 실물에서 한 번도 안 어긋났다 (요청서 §2.1-1, §2.1 끝줄)

`children_left == -1`이 잎을 맞게 세는지 **개발 환경의 진짜 sklearn(1.9.1)**에
어댑터의 `size` 식을 그대로 먹여 확인했다. 요청서가 걱정한 갈래 넷을 포함해 여덟 모양:

```
기본 100그루                    size={'nodes': 4642, 'leaves': 2371}   일치
n_estimators=1                 size={'nodes': 33,   'leaves': 17}     일치
max_depth=1 (잎 둘)              size={'nodes': 9,    'leaves': 6}      일치
한 클래스만 (잎 하나짜리 나무)       size={'nodes': 3,    'leaves': 3}      일치
클래스 둘                       size={'nodes': 67,   'leaves': 35}     일치
클래스 20                       size={'nodes': 707,  'leaves': 355}    일치
min_samples_leaf 크게            size={'nodes': 3,    'leaves': 3}      일치
max_leaf_nodes=2                size={'nodes': 9,    'leaves': 6}      일치

estimators_ 없는 모양 → AttributeError (CPython에서는 메시지 44자)
```

마지막 줄이 A-1로 이어진다 — **CPython에서 44자인 그 예외가 Pyodide에서는 365자다.**

### 3.4 새 문이 실제로 무는 지점 — **약 12,000행부터다**

거절이 얼마나 자주 나는지는 아무도 안 쟀기에 쟀다(개발 환경 sklearn, 8특성 3클래스,
sklearn 기본 100그루):

```
  5,000행 → 하한  2.30MB  담김
 10,000행 → 하한  4.54MB  담김
 12,000행 → 하한  5.40MB  거절
 15,000행 → 하한  6.67MB  거절
 20,000행 → 하한  8.79MB  거절
 50,000행 → 하한 21.75MB  거절
```

**행 상한이 100,000이므로 허용 범위의 대부분에서 sklearn 랜덤 포레스트는 지표만 남는다.**
**이것은 회귀가 아니다** — 이 문이 없었어도 `selectModels`가 같은 `tooLarge`로 떨어뜨렸고,
바뀐 것은 113MB를 만들었다 버리느냐뿐이다. 그리고 화면이 하는 말(*"나무 개수처럼 모델을
키우는 설정을 줄여 보세요"*)이 **실제로 통하는 조언이다** — 100그루를 10그루로 내리면
100,000행에서도 하한이 4.5MB라 담긴다.

### 3.5 단정 다섯 — **다섯 다 참이다** (요청서 §2.6)

| 문장 | 판정 |
|---|---|
| `limits.ts` *"가장 나쁜 칸의 오차 331ms는 총 9.35초의 3.5%"* | **맞다.** `r31-bench.json`의 나이브 베이즈 열 사다리가 `{4:265, 8:305, 16:423, 32:620}`이고 620/305 = **2.03**, 기준표의 50,000행 값 320ms × 2.03 = **651ms**, 오차 **331ms**, 시동을 얹어 **9,351ms**, 331/9,351 = **3.54%** |
| `limits.ts` *"코드가 실제로 곱하는 수로 1.39배 대 1.23배"* | **맞다.** `estimate.ts`의 `interpolate`를 실제로 돌렸다 — sklearn **1.394** · 순수 JS **1.230** (기준 k=3) |
| `tree.ts` *"sklearn은 `tree_.value`를 이미 정규화해서 준다 — 1.8과 1.9 둘 다"* | **맞다.** R31에서 `scikit-learn==1.8.0`을 별도 venv에 깔아 확인했다(줄 합이 전부 1.0) |
| `mlpx-spec.md` §5.3.1 *"12행이 12행 다 동점이고 네 벌에 흩어져 있다"* | **맞다.** R31이 전수로 셌다 — `origin` 1 · `overlap` 6 · `multi` 2 · `categorical` 3, 동점 12/12 |
| `pyodide-sklearn.ts` 머리글 *"여덟을 다 담는다 · 지금 빈 칸은 없다"* | **맞다.** `pyodide-sklearn.spec.ts`의 `직렬화기가 없는 알고리즘이 하나도 없다`가 등록부 여덟을 돌며 못 박는다 |

**그리고 R31이 열어 둔 §4-1이 닫혔다** — 특성 사다리 여덟과 손잡이 사다리 셋이
`docs/audit/r31-bench.json`에 들어왔고, `limits.ts`의 `PYODIDE_RANDOM_FOREST_TREES_MS`·
`PYODIDE_KMEANS_CLUSTERS_MS`와 `max_iter` 사다리(632·717·615·680)가 **한 글자도 안 다르다.**

### 3.6 회귀 — 순수 JS의 run은 안 달라졌다 (요청서 §2.3)

- **run 조립**(`experiment.ts`): 순수 JS는 `modelOmittedReason`을 안 주므로
  `?? 'engineUnsupported'`가 옛 동작 그대로다. 글자 하나 안 다르다.
- **`FitResult`의 새 칸**: 선택이고 순수 JS 트레이너 여섯은 안 채운다.
- **`models/index.ts`**: 늘어난 것은 함수 재수출 하나뿐이고 `INTERPRETERS`·
  `SUPPORTED_MODEL_FORMATS`는 안 움직였다(M5가 타입으로 운다).
- **`compile()`의 잎 범위**: v1이 넘기는 값은 `classes.length` 그대로이고, **읽을 때**
  거절한다는 것을 M2가 문다.

---

## 4. 확인 못 한 것 · 저장소에 없는 것

1. **처방 여섯 중 하나만 실측했다.** A-1의 `slice`는 심어서 재 봤다(200자, 109통과).
   **C-1·C-2·C-3·C-5의 처방과 B-1의 세 길은 심어 보지 않았다.**
2. **`modelOmittedDetail`이 run에 실리는지는 안 쟀다.** C-1은 `modelOmittedReason`만
   찔렀다. 같은 이음매에 있는 `modelOmittedDetail`을 지워도 조용한지는 **모른다.**
3. **브라우저에서 A-1을 재현하지 않았다.** 파이썬 쪽을 실제로 터뜨리려면 27.3MB를 받아야
   하고, 그 대신 **Pyodide 코어를 Node에 띄워 메시지 길이만** 쟀다. 그 길이가 A-1의 전부라
   결론은 서지만, *"학생 브라우저에서 저 정확한 문자열이 나온다"*는 안 봤다.
4. **A-1의 방아쇠 빈도를 모른다.** 파이썬이 던질 현실적인 이유를 하나도 확정하지
   못했다 — 원본이 어느 배포판에 다른 sklearn을 내주는 날, WASM 메모리 부족, 우리 조각의
   버그. **그래서 "얼마나 자주 나는가"가 아니라 "나면 무엇을 잃는가"로 등급을 매겼다.**
5. **113MB를 브라우저 워커에서 실제로 만들어 죽는 모양은 안 쟀다** — 요청서가 다음 주기
   몫으로 이미 적어 둔 자리다.
6. **사진 프로젝트의 거절 경로를 안 봤다.** 요청서 §3도 안 봤다고 적은 자리다. 표에서
   쟀고(§3.4) 사진은 차원만 다르다고 보지만 **재지 않았다.**
7. **`estimateMs`를 화면이 다시 부르게 되는 날을 막는 것이 없다**(C-3). 처방을 적었지만
   심어 보지 않았다.

---

## 5. 관문

기준선과 끝: `npm run ci` **exit 0 · 173파일 · 3,546통과 · 3스킵**, 두 번 다 같다.
백엔드 `uv run python scripts/ci.py` **exit 0 · 33통과**.
`npm run lint`와 `ruff format`은 쓰지 않았다. 심은 것은 전부 파일 하나의 정확한 경로로
되돌렸고, 임시로 만든 것(`tests/_r32_*.spec.ts` 다섯 · 루트의 측정 스크립트 ·
스크래치의 Pyodide 코어)은 전부 지웠거나 저장소 밖에 있다.

---

## 6. 이대로 배포해도 되는가

**아니다 — A-1 한 줄을 고치고 나가라.**

고칠 것은 `omitted()`의 `.slice(0, MAX_FAILURE_DETAIL_LENGTH)` 하나와, 그것을 지키는
검사 하나다. 둘 다 이 보고서에 적혀 있고 앞의 것은 실측했다. **그 한 줄이 없으면,
파이썬이 한 번 터진 학생은 자기 프로젝트를 다시 열 수 없다** — 제출도, 다음 차시도.

**나머지는 배포를 막지 않는다.** B-1은 화면의 수가 틀리는 것이고 학생의 결과물은
안전하다. C 여섯은 전부 검사와 문서의 몫이다.

**그리고 새 문은 건강하다.** 하한은 증명됐고, 세는 식은 실물에서 여덟 모양을 맞게 셌고,
어휘는 왕복에서 안 샌다. 이 라운드가 겨눈 *"감사를 닫으며 세운 것"* 셋(R31 C-2·C-5·C-6)은
**셋 다 제대로 물었다** — 그 점에서 이번 고침 라운드는 앞의 넷과 다르다.
