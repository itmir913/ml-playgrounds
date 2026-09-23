# R38-D55 감사 보고서 — 옵션 연쇄를 끊은 고침을 적대적으로 봤다

> 요청서 `docs/audit/request-R38-D55.md` · 함께 걸린 재확인 `verify-R38-2.md`의 회신은
> `report-R38-verify-2.md`. 결정문 55에 관한 것은 전부 여기 있고 저쪽은 가리킨다.
>
> **HEAD `8923382`.** 작업 트리는 시작할 때 깨끗했고 끝날 때도 `frontend/src`가 깨끗하다
> (`git diff --quiet -- frontend/src`, 돌연변이 묶음마다 확인). 임시 스펙 다섯
> (`tests/zz-d55-*.spec.ts` 넷 · `tests/zz-v2-target-empty.spec.ts`)을 심었다가 지웠다.
> 옛 판(`0.26.6`)은 `git archive`로 **저장소 밖 스크래치**에 풀어 `node_modules`를 정션으로
> 이어 돌렸다 — `package.json`·`package-lock.json`이 `0.26.6`과 HEAD 사이에 한 줄도 안 바뀌어
> 그대로 쓸 수 있었다.
>
> 기준선 `npm run ci` — **199파일 · 3,994 통과 · 3 건너뜀 · 129.1초, `build`까지 초록**
> (요청서의 수와 같다). sklearn은 백엔드 uv 환경의 **1.9.1**(파이썬 3.14.5)로 돌렸다.

---

## 0. 요약 — 뿌리 하나

> **층화 판정(`stratifyBlockFor`)이 "나눌 때"의 사유와 "뽑을 때"의 사유를 한 줄로 세우는데,
> 결정문 55가 그 판정을 학습이 무시하는 스위치로 승격시켰다.** 유형·표본 수·시험 비율 사유는
> 옳게 옮겨졌다(퍼즈 2,000개에서 `holdout`은 어긋남 0). **`provided`에서만 갈린다** — 거기서는
> 나누지 않으므로 "값이 1개뿐"은 층화를 막을 이유가 아닌데 판정은 막고, 계획은 그 판정을 믿고
> **층화 뽑기를 끈다.** 55 전에는 그 뽑기가 돌았다.

- **A-1.** 따로 받은 테스트 데이터 + 표본 뽑기 + 드문 범주에서 **드문 범주가 훈련 표본에서
  조용히 빠진다**(200 씨앗 중 83). 체크박스는 그 갈래에서 숨어 있어 이유가 아무 데도 안 선다.
  55 전의 배포본에서는 그 범주가 언제나 표본에 남았다 — **고침이 만든 퇴행**이다.
- **I6은 닿는다** — 0.26.6이 새 파일을 열면 정답이 특성으로 들어간다. 코드가 아니라 **옛 판을
  실제로 돌려 쟀다**: 잡음 표에서 결정트리 정확도 **1.0**(지금 판은 0.33). 처방은 코드 소유자의
  결정(`formatVersion`)이라 등급을 B로 둔다(B-1).
- **I1·I3·I4는 초록이다.** 살아 있는 `features`를 읽는 17자리를 전수로 갈랐고 학습에 들어가는
  길은 `plan.ts:196` 하나뿐이다. 행 수를 세는 자리가 타깃이 목록에 있든 없든 같은 행을 돌려준다는
  주석의 "사람 확인"은 **무작위 표 300개 × 결측 전략 여섯 = 1,800회로 재서 참**이었다. 왕복은
  바이트 단위로 같고, 잠긴 줄이 가운데 끼인 목록으로 **진짜 학습을 돌려** 상태가 제 줄에 앉는
  것을 봤다.
- **남은 연쇄는 둘, 반쪽은 셋이다**(§3). 파일에 남는 값을 고쳐 쓰는 연쇄는 **더 없다.**

**돌연변이 36개(대조 1 포함)** — 요청서 §6의 17개는 **전부 내 러너에서도 운다.** 새로 심은
18개 중 **11개가 조용하다**(§4). 조용한 것의 뿌리는 하나 — `option-cascade.spec.ts`가 함수를
물고 **학습 화면의 배선은 안 문다**(`rowStatuses`·`rowStartedAt`·`trainBlock`).

**등급 — A 1 · B 6 · C 9.**

---

## 1. 지적

### A-1. `provided`에서 층화 판정이 뽑기를 막고, 계획이 **층화 뽑기를 조용히 끈다**

**자리** `frontend/src/ml/selection.ts:687-692`(`stratifyBlockFor` — 뽑기 사유 → 값이 1개뿐
→ 시험 비율 순) → `ml/plan.ts:285-291`(`stratifyApplies(…, block)`이 `false`면 `sampleRows`가
층화 없이 뽑는다). `shareStratifyBlock`(`selection.ts:717`)만 `provided`를 비켜 가고
`lonelyValues`(`:690`)는 비켜 가지 않는다.

**주장.** 값이 1개뿐인 범주(`SPLIT_STRATIFY_IMPOSSIBLE`)와 1개뿐인 값이 여럿(`…_TARGET_CONTINUOUS`)은
**나눌 때**의 사유다 — 양쪽에 하나씩 보낼 수 없어서다. **`provided`는 나누지 않는다.** 뽑기는
그 입력을 받아들인다(`ml/sample.ts:40`의 바닥 `min(size, MIN_SPLIT_ROWS)`가 1개짜리 라벨에도
1을 남긴다). 그런데 판정은 그 사유로 막고, 55가 세운 규칙대로 계획은 막히면 층화를 **끈다.**
그러면 `sampleRows`가 `shuffled(rows).slice(0, nSamples)`로 뽑고, **드문 범주는 표본에 들 확률이
`nSamples / n`이다.**

**55 전에는 안 그랬다.** 옛 `stratifyApplies(taskType, stratify)`는 유형만 봤으므로 `provided`에서
층화 뽑기가 그대로 돌았고 드문 범주는 바닥 덕에 **언제나** 표본에 남았다. 이 자리는 결정문 55가
*"켜진 채 학습이 거부했다"*고 적은 자리가 아니다 — **거부한 적이 없는 입력**이 이제 무시된다.

**재현** (`tests/zz-d55-provided.spec.ts`, 지운 임시 스펙). 라벨 A×10 · B×10 · C×1, `provided`
테스트 표 3행, `nSamples` 12, `stratify: true`(기본값).

| | 판정 | `plan.sampled`에 C가 있는가 |
|---|---|---|
| `stratifyBlockFor(…, {method: 'provided'})` | `SPLIT_STRATIFY_IMPOSSIBLE` | — |
| 55 전의 동작(`sampleRows`에 `stratify: true`) · 씨앗 200개 | — | **200/200 있다** (길이 12) |
| 지금의 `planRun` · 씨앗 200개 | (층화 끔) | **117/200만 있다 — 83에서 빠진다** |

**퍼즈로 넓혔다** (`zz-d55-invariants.spec.ts` I2, 무작위 2,000개 — 범주 1~6종, 라벨 분포·뽑기·
시험 비율 일곱 값·`provided` 20%). *"판정이 `null`이면 뽑기·분할이 층화 사유로 안 던지고,
`null`이 아니면 층화를 억지로 켰을 때 던진다"*를 양방향으로 쟀다. **`holdout` 1,600여 개 —
어긋남 0.** `provided` 400여 개 — **어긋남 89, 전부 "막았는데 억지로 켜도 안 던진다"**이고
사유는 `SPLIT_STRATIFY_IMPOSSIBLE` 77 · `…_TARGET_CONTINUOUS` 12, 그중 **뽑기가 켜진 것이
47**이다(나머지는 뽑기가 없어 판정이 아무 일도 안 한다).

**틀리면 학생에게.** 표본 뽑기는 행이 상한을 넘는 표에서 카드를 여는 손잡이다(`open-decisions.md`
#22). 그런 표에서 *"기타"* 같은 한 줄짜리 범주는 흔하고, 학생이 테스트 파일을 따로 받은 상태면
**그 범주가 학습에서 빠진 채 학습이 되고, 테스트 표의 그 범주 행은 전부 틀린다.** 화면은 아무
말도 안 한다 — **`provided`에서는 층화 체크박스 자체가 숨는다**(`TabularPrepPanel.vue:803`의
`v-if="testChoice === 'holdout'"`, 이미지 판 `:514`도 같다). 파일에는 `stratify: true`가 그대로다.

**이웃.** 같은 판정을 부르는 자리는 셋(`plan.ts:289` · `TabularPrepPanel.vue:400`의 `stratifyBlock`
· `ImagePrepPanel.vue:76`)이고 **셋 다 같은 함수라 같은 값을 낸다** — 그래서 화면과 학습은 같은
말을 하는데(반쪽이 아니다) **그 말이 틀렸다.** 이미지 판은 표본 뽑기 손잡이가 없어 `nSamples`가
비므로 오늘은 안 닿는다(코드 확인).

**처방 — 넣어 봤다** (§4.3의 P1). `stratifyBlockFor`에서 뽑기 사유 다음에
`if (split.method !== 'holdout') return null`을 두어 **`provided`에서는 뽑기 사유만 보게** 했다.
결과는 §4.3에 있다. 함께 물을 것 하나: `provided`에서 뽑기가 켜져 있으면 `stratify`는 **뽑기의**
층화 손잡이인데 체크박스가 숨는다 — 뽑기 카드가 그 사실을 말하든, 그 갈래에서 체크박스를 보이든
결정이 필요하다(§3의 반쪽 R2).

### B-1. 옛 판(0.26.6)이 새 파일을 열어 학습하면 **정답이 특성에 들어간다** — 닿는다, 쟀다

**자리** 옛 `frontend/src/ml/plan.ts:174·181·225·313`(`data.features`를 그대로 씀) ·
옛 `project/settings.ts:99·114`(거르는 자리는 **쓰는 문** 둘뿐이고 **여는 길에는 없다** —
옛 `format.ts`·`schema.ts`·`migrate.ts`에 `features`를 만지는 줄이 0개다).

**재현 — 옛 판을 실제로 돌렸다.** 새 판(HEAD)에서 `writeProject`로 두 파일을 쓰고
(`zz-d55-write-mlpx.spec.ts`), `0.26.6` 트리의 임시 스펙이 `readProject` → `readDataset` →
`planRun` → `runExperiment`로 열어 학습했다.

| 파일 (새 판이 씀, `formatVersion` 2) | 0.26.6이 연 `features` | 0.26.6 전처리기 열 | 0.26.6 정확도 | **HEAD** 정확도 |
|---|---|---|---|---|
| 붓꽃 30행, `species`가 목록에 남음 | 5개 (`species` 포함) | **5** | 결정트리 0.833 · KNN 0.833 | 4열 · 0.833 · 0.833 |
| **잡음 표** 90행(특성 둘이 정답과 무관, 범주 셋) | 3개 (`label` 포함) | **3** | **결정트리 1.0 · KNN 0.889** | 2열 · **0.333 · 0.278** |

붓꽃은 특성이 이미 정답을 설명해 숫자가 안 갈리지만 **잡음 표가 그것을 드러낸다** — 우연 수준
(0.33)이어야 할 정확도가 1.0이다. 그리고 옛 판의 **실험 스냅샷에도 `label`이 특성으로 적힌다.**

**언제 닿는가.** 새 판에서 학생이 [전체 선택]을 누른 뒤 타깃을 고르면(교실에서 가장 흔한 순서다)
**그 파일의 `features`에는 언제나 타깃이 있다.** 옛 판에서 그 파일을 열어 **아무것도 안 건드리고
[학습하기]를 누르면** 위 표다. 옛 판의 `withFeatures`는 타깃을 거르므로 특성 하나를 껐다 켜면
스스로 낫는다 — 그래서 *"열어서 바로 학습"*이 닿는 길이다. 오늘 공식 배포는 Pages 하나라 옛 판이
사는 곳은 자가호스팅·옛 `dist`뿐이다 — 그것이 A가 아니라 B인 이유다.

**처방은 여기 안 적는다** — `formatVersion`은 코드 소유자의 결정이다(요청서 §5). 닿는다는 것과
다치는 것(정확도 1.0의 조용히 틀린 학습 · 스냅샷의 특성 목록)만 적었다. `mlpx-spec/01-structure.md
§3`의 문단(*"닿을 수 있다 … 사람 확인"*)은 이제 **실측이다.**

### B-2. 체크리스트의 `algorithmsChosen`이 **잠긴 줄을 센다** — 반쪽

**자리** `frontend/src/stores/project.ts:78`(`settings.selectedAlgorithms.length > 0`). 같은 파일의
`featuresChosen`은 55가 `featuresInUse`로 고쳤는데(`project/facts.ts:47`) 모델 쪽은 안 고쳤다.

**주장.** 담은 모델이 전부 지금 유형에 안 맞으면 학습 화면은 *"추가한 모델이 모두 … 학습할 수
없습니다"*(`train.nothingTrainable`)로 [학습하기]를 잠근다. 그런데 체크리스트는 *"모델 추가하기"*에
체크를 하고 다음 할 일을 *"학습하기"*로 가리킨다. **학습이 아무것도 안 하는데 체크리스트는 끝냈다고
한다** — 55가 특성에서 막은 그 반쪽(`M16`)의 모델 쪽이다.

**재현** (`zz-d55-invariants.spec.ts` §3). `irisProject(['linear_regression'])`(분류) →
`chosenModelBlocks` 전부 `['ALGORITHM_NOT_FOR_TASK_TYPE']`인데 `factsOf(file).algorithmsChosen === true`.

**처방.** `factsOf`가 `trainableSelections(selectedAlgorithms, taskType).length > 0`으로 세게
한다 — 특성과 같은 모양이다. 유형이 없을 때는 지금처럼 목록 길이로(그때는 아무것도 안 잠긴다).
**이웃은 한 군데뿐이다** — `steps.ts`는 사실만 읽는다.

### B-3. 잠긴 모델 줄의 **하이퍼파라미터 손잡이가 열려 있다** — 반쪽

**자리** `frontend/src/views/train/ChosenModels.vue:419`(`<details v-if="specsOf(row).length > 0 &&
!props.running">` — 잠긴 줄을 안 가른다).

**주장.** 55의 표는 *"B를 잠그고 이유를 말한다"*인데 잠긴 줄의 손잡이는 잠기지 않는다 — 학습이
무시하는 값을 학생이 고칠 수 있다. 값을 **지우지 않은 것은 옳다**(유형을 되돌리면 살아나야 한다).
요청서 §6이 *"잠긴 줄에서 손잡이가 열려 있는 것이 학생에게 거짓말인가"*라고 물은 자리다.
**결정이 필요하다** — 잠긴 줄의 `<details>`를 `disabled`로 두되 값은 보이게 하는 것이 55의 표와
맞다. 코드로만 봤다(N7 돌연변이가 조용한 것과 같은 자리 — 잠긴 줄의 표시를 무는 검사가 없다).

### B-4. 히스토그램의 **자동 체크박스가 학생이 고른 구간 수를 덮어쓴다** — 남은 연쇄(화면)

**자리** `frontend/src/views/data/charts/HistogramChart.vue:78-95`. `watch(auto)`가 켜지면
`applied = 'auto'`, 자동인 동안 `draft`가 numpy의 수를 비춘다. 학생이 20으로 [적용]한 뒤 자동을
켰다 끄면 **20이 아니라 자동이 고른 수에서 시작한다.**

**판정.** 요청서 §3의 정의 그대로다 — A(자동)를 바꾸는 한 번의 조작이 학생이 따로 고른 B(구간
수)를 다른 값으로 옮긴다. 화면 안에서만 살고 창을 닫으면 잊으므로 **B**다. 다만
`architecture.md §8.9.1.1`이 *"자동을 껐을 때 그 수에서 이어서 고치게 된다"*를 **규칙으로 적어
두었다** — 55와 그 규칙이 부딪히므로 문서가 먼저다. 55대로라면 자동인 동안 칸은 `readonly`로
자동의 수를 **보이되** 학생의 수는 따로 들고, 자동을 끄면 그 수로 돌아온다.

### B-5. 예측 화면의 필터가 **새 실험이 생기면 전부 켬으로 되돌아간다** — 남은 연쇄(화면)

**자리** `frontend/src/views/predict/TabularPredictPanel.vue:134-140` ·
`ImagePredictPanel.vue:179-185`(`watch(availableIds, () => filter = defaultFilter(models))`).

**판정.** 학생이 KNN만 켜 두고 학습 화면에 가서 한 번 더 학습하고 돌아오면 **필터가 전부 켜져
있다.** A(실험 집합)가 B(학생의 필터)를 기본값으로 되돌린다. 주석은 *"없어진 것을 계속 선택한
채로 두면 아무것도 안 보이는 필터가 생긴다"*고 이유를 적었는데 그것은 **없어진 것**의 사정이고,
**새로 생긴 것** 앞에서 고른 것을 버릴 이유는 아니다. 화면 값이라 **B**. 처방은 없어진 id만 떨구고
새 실험은 켜서 **더하는** 것이다(교집합 + 새 것).

### B-6. `provided` + 뽑기에서 **층화 체크박스가 숨는데 층화는 뽑기에 여전히 걸린다** — 반쪽

A-1의 짝이다. `provided`에서 `stratify`는 분할에는 뜻이 없지만 **뽑기에는 있다**(`sample.ts:150`).
화면은 그 갈래에서 체크박스를 안 그리므로(`TabularPrepPanel.vue:803`) 학생은 층화 뽑기가 켜져
있는지도, A-1로 꺼졌는지도 모른다. *"안 쓰면 잠그는 것이 아니라 안 그린다"*(`architecture.md`
§8.9)는 **정말 안 쓸 때**의 규칙이다. A-1의 처방과 함께 결정할 것.

---

## 2. 불변식 I1~I7 — 답

### I1. 정답은 어떤 길로도 특성이 되지 않는다 — **참. 세 갈래로 쟀다.**

**살아 있는 설정의 `features`를 읽는 자리 전수** (`grep '\.features\b' src`, 로케일 제외 — 엔진의
행렬 `input.features`·미리보기의 `column.features`는 다른 물건이라 뺐다):

| 자리 | 갈래 | 타깃을 빼는가 |
|---|---|---|
| `ml/plan.ts:196` (→ `:203`·`:210`·`:260`·`:352`) | **학습에 들어간다** | `featuresInUse` — **유일한 학습 길** |
| `ml/training-source.ts:119` | 기록(실험 스냅샷) | `featuresInUse` |
| `ml/training-source.ts:265` (`TRAINING_ROW_COUNTS`) | 세기(행 수) | 안 뺌 — **동치**(아래) |
| `ml/selection.ts:135` (`columnPlan`) | 화면(역할·`featureChosen`) | 역할 판정이 타깃을 먼저 본다 |
| `ml/selection.ts:755` (`stratifyBlock`) | 세기(`usableRows`) | 안 뺌 — **동치** |
| `project/facts.ts:47` | 세기(체크리스트) | `featuresInUse` |
| `project/dataset.ts:124·129` | 쓰기(`applyDataset`) | 해당 없음 |
| `project/settings.ts:105` | 쓰기 | 해당 없음 |
| `components/summary/TabularSummaryRows.vue:48` | 세기 | `featuresInUse` |
| `views/TrainView.vue:287` | 세기(예상 폭) | `featuresInUse` |
| `views/train/TabularTrainContext.vue:37` | 세기(`usableFeatures`) | 역할이 `feature`인 것만 센다 |
| `views/inspect/ReproducePanel.vue:214` | 세기(예상, **스냅샷의** 특성) | 기록 시점에 이미 걸러짐 |
| `views/preprocess/TabularPrepPanel.vue:89·194·289·319·406·441` | 세기 | 안 뺌 — **동치** |
| `views/preprocess/TabularPrepPanel.vue:215` (`featureSummary`) | 세기(문장) | **안 뺌 — C-4** |
| `views/preprocess/TabularPrepPanel.vue:249-250` | 쓰기 위해 읽음 | 해당 없음 |

**계획을 안 지나는 학습 길은 없다.** 재실행 대조는 `runExperiment`(→ `planRunOrThrow`)를 그대로
부르고 문서 설정을 한 글자도 안 읽는다(`reproduce.ts:133`). 예측은 run의 `preprocessor.columns`로
칸을 만든다(`predict.ts:113`). 교정은 합성 데이터다. 이미지는 `f0…`와 `label`로 설정을 짓고
`featuresInUse`가 거기서는 아무 일도 안 한다(`images.ts:170`). `provided` 테스트 표는
`plan.ts:203`에서 **걸러진** 특성으로 `usableRows`를 센다. 워커 손도 `runExperiment` 하나다
(`worker/handler.ts:39`).

**"안 불러도 같다"는 주석(`selection.ts:507`, 사람 확인)** — 무작위 표 300개(행 5~34, 빈 칸 25%)
× 결측 전략 여섯 × 특성 부분집합에서 `usableRows(…, [...features, target], target, m)`와
`usableRows(…, features, target, m)`가 **1,800회 전부 같다.** `trainableRowsOf`도 같다.

**군집.** `columnPlan`은 `wantsTarget`이 거짓이면 역할을 `feature`로 두고, 계획은
`featuresInUse(…, undefined)`로 안 거른다 — 같은 순간 같은 말이다. 다만 **N1 돌연변이(군집에서도
거름)가 조용하다**(§4) — 그 규칙을 무는 것은 `featuresInUse` 단위 검사뿐이고 계획을 지나는 검사가
없다(C-7).

**실험 기록으로 다시 돌리면 같은가.** 특성 목록에 타깃을 **가운데** 끼운 채 `trainingSourceOf` →
`runExperiment`로 학습하고 `reproduceExperiment`로 다시 돌렸다 — 기록의 특성은
`[sepal_length, sepal_width, petal_length, petal_width]`(순서 그대로), 전처리기 열도 같고,
두 run 모두 **`REPRODUCED`**.

### I2. 화면이 잠그는 것 ⇔ 학습이 무시하는 것

- **모델** — `chosenModelBlocks`와 `trainableSelections`가 같은 `algorithmsLosingMeaning`을 본다.
  등록부에 없는 알고리즘(안 잠그고 안 거른다 → 실패 run) · 같은 알고리즘의 여러 줄(전부 같이) ·
  유형 미정(안 잠그고, 학습은 유형 없이 못 시작한다) — 셋 다 같다. 코드와 M2·M3으로 확인.
- **층화** — 위 A-1. `holdout`은 퍼즈 1,600여 개에서 경계가 같다(뽑기 켬·`nSamples` > 행 수·
  시험 비율 일곱 값 포함). **`provided`에서 갈린다.** 이미지 판은 표와 같은 함수·같은 `split`을
  넘긴다(`ImagePrepPanel.vue:76`) — 라벨은 사진이 든 범주이고 계획의 라벨은 임베딩이 있는 사진의
  범주인데 `trainingSourceOf`가 먼저 전부 뽑으므로 같다(코드 확인, 화면으로는 안 쟀다 — N11·N22가
  조용한 자리).
- **특성** — `featureLocked`(역할이 `target`)와 계획의 `featuresInUse`(이름이 `target`)는 같은
  축이다. 55가 잠그는 조건은 셋(M9·N8·M15)이 문다.

### I3. A를 되돌리면 B가 처음 그대로다 — **바이트 단위로 참.**

`zz-d55-invariants.spec.ts` I3. 타깃 두 번 · 유형 세 번(회귀→군집→분류) · 특성 토글 · 스케일링을
섞어 되돌리고 `JSON.stringify(settings)`를 견줬다 — 같다. 표본 수와 시험 비율을 오가도 `stratify`가
그대로다. 타깃을 비웠다 다시 고르면 같다(`undefined` 키는 JSON에서 사라진다 — 파일도 같다).
되돌리기(undo)는 이 앱에 없다. 자동 저장은 값을 안 바꾼다(`stores/project.ts`의 `update`는 넘긴
값을 그대로 앉힌다).

### I4. 잠긴 줄을 사이에 둔 학습 — **진짜 학습으로 쟀다.**

`zz-d55-train-rows.spec.ts`. `[decision_tree, linear_regression, knn]`(분류)로 학습 화면을 띄우고
진짜 손(`handleRequest`)을 태운 워커 목이 **보고를 낼 때마다** `ChosenModels`의 `statuses`와 줄
글자를 찍었다.

| 워커 보고 | 줄 상태 (자리 0·1·2) |
|---|---|
| `prelude` · `calibrated` | `waiting · null · waiting` |
| `started` | `running · null · waiting` |
| `progress` | `done · null · waiting` |
| `started` | `done · null · running` |
| `progress` | `done · null · done` |
| `done` | `[]` |

잠긴 줄(자리 1)에는 어떤 보고에서도 상태가 안 앉고 배지도 안 선다. 실험의 run은 `decision_tree,
knn`, 기록의 `selectedAlgorithms`도 둘. **[멈추기]**는 코드로만 봤다 — 실험의 `selectedAlgorithms`가
`trainableSelections`를 지난 `requested`에서 만들어지므로(`experiment.ts:826-843`) 잠긴 줄은 실험에
아예 없고, `comparable()`의 자리 짝짓기는 실험 안에서 닫힌다. **도는 동안 못 바꾸는가** — 축은
`inert`, [제거]와 손잡이는 `!running`에 걸리고 라우터 가드가 막는다(`train-preparing.spec.ts`가
셋을 지킨다). 다른 탭은 탭 잠금이 막는다.

**그런데 이 배선을 무는 검사가 없다** — N18(`rowStatuses`를 자리 그대로)·N19(`rowStartedAt`)·
N6(`trainBlock`의 `every`→`some`)이 **조용하다**(§4). `option-cascade.spec.ts`는 `byChosenRow`를
단위로 물고 화면은 학습을 안 돌린다. 위 임시 스펙이 N6·N18을 **문다**(§4.3).

### I5. 문구가 참인가 — **닿는 길이 없다. 그래서 "마지막 방어선"이 죽은 줄이 됐다.**

`splitRows`·`sampleRows`를 부르는 곳은 `plan.ts:314·331` **둘뿐이다**(`src` 전수). 계획은 언제나
`stratifyApplies`를 먼저 지나고, 퍼즈가 보였듯 판정이 `null`이면 그 둘은 층화 사유로 안 던진다.
재실행은 `recordedSplit`으로 둘을 아예 건너뛴다(`plan.ts:307-335`). **그러므로 `split.ts:159·165·200`과
`sample.ts:74`의 던짐은 오늘 어떤 입력에서도 안 닿고, 그 자리의 새 문구가 거짓일 기회도 없다.**
대신 주석이 낡았다 — `split.ts:150-153`의 *"여기는 마지막 방어선이다 - 남의 .mlpx를 열어 다시
돌리는 경로에는 우리 화면이 없다"*와 `02-tabular.md:779-783`의 같은 문단은 **계획이 그 경로에도
앞선다는 사실**과 안 맞는다(C-1). `train.nothingTrainable`은 담은 줄이 있고 전부 잠길 때만 선다
(`TrainView.vue:520-523`) — 스펙과 N6으로 봤다(N6은 조용, §4).

### I6. 옛 판과의 호환 — **닿는다. B-1.**

### I7. sklearn과 갈린 자리 — **던진다. 결정문은 말하지 않는다.**

sklearn 1.9.1 `train_test_split(…, stratify=y)`:

| 입력 | sklearn | 우리(55) |
|---|---|---|
| 6행 3범주, `test_size` 0.3 (`experiment.spec` R18 B-4) | **던진다** `The test_size = 2 should be greater or equal to the number of classes = 3` | 층화를 무시하고 학습 |
| 한 범주가 1행 | **던진다** `The least populated classes in y have only 1 member` | 무시하고 학습 |
| 10범주 × 12행, 0.05 | **던진다** (`test_size = 6 … classes = 10`) | 무시하고 학습 |
| 30행 3범주 0.3 (대조) | 통과 | 층화 |
| 2/98을 0.05 (대조) | 통과 — 시험에 `b`만 남는다 | 층화 |

**결정문 55 본문에는 sklearn이 한 줄도 없다** — 그 사실은 `experiment.spec.ts:1730`의 주석과
커밋 메시지에만 있다. 발판 원칙(`CLAUDE.md` §2)에서 일부러 갈라선 자리는 결정문이 적어야 다음
사람이 *"sklearn에 맞추자"*고 되돌리지 않는다(C-2). 그리고 `split.stratify: true`가 층화 안 한
실험에 남는 것 — **점검 화면은 분할 설정을 아예 안 보인다**(`views/inspect`에 `stratify`·`testSize`
0건). 교사가 그것을 만나는 자리는 `runs.json`과 결과 화면의 변경 이력(`changes.ts:226`, 두 실험
사이에 값이 바뀌었을 때만)뿐이다. 결정문의 *"재실행 대조는 같은 판정을 다시 하므로 같은 분할을
낸다"*는 **부정확하다** — 재실행은 `recordedSplit`으로 판정 자체를 건너뛴다(C-3).

---

## 2′. C — 제안

- **C-1.** `split.ts:150-153`·`sample.ts:68-70`·`02-tabular.md:779-783`의 *"마지막 방어선"*은 이제
  닿지 않는 코드다(I5). 남길 거면 *"계획이 앞서므로 오늘은 안 닿는다"*로 고쳐 적을 것 — 다음 독자가
  그 던짐을 근거로 문구를 판단한다(이번 요청서가 그랬다).
- **C-2.** 결정문 55에 sklearn이 던지는 세 입력과 *"우리는 무시하고 학습한다"*를 적을 것(I7).
- **C-3.** 결정문 55의 *"재실행 대조는 같은 판정을 다시 하므로"*를 *"기록된 분할을 그대로 쓰므로"*로.
- **C-4.** `TabularPrepPanel.vue:215`의 `featureSummary`가 목록 길이로 세서 타깃이 목록에 있으면
  *"선택한 특성 5개 중 4개가 학습에 들어갑니다"*라고 말한다 — 그 문장은 인코딩으로 빠진 열을 위한
  것이고, 옆의 요약 행(`TabularSummaryRows`)은 4개라고 말한다. `featuresInUse`로 셀 것.
- **C-5.** `plan.ts:194`의 주석 *"`plan.spec.ts`의 '타깃과 같은 이름은 특성에서 빠진다'가 문다"* —
  **`plan.spec.ts`에 그 검사가 없다**(`grep '타깃과 같은' tests/plan.spec.ts` 0건). 무는 것은
  `option-cascade.spec.ts`의 *"학습 계획은 타깃과 같은 이름을 특성에서 뺀다"*이다(M5). 유창하게 틀린
  주석.
- **C-6.** 인코딩이 `none`일 때 문자 열은 학습에서 빠지는데(`fitPreprocessor`의 `excludedColumns`)
  체크박스는 안 잠기고 주의색 한 줄만 선다(`selection.ts:166`·`:236`). 55의 표대로라면 잠그고
  말할 자리다 — 반쪽이지만 화면과 학습이 **같은 말**을 하므로 C.
- **C-7.** 조용한 돌연변이 11개의 그물(§4.2): (가) 잠긴 줄을 끼운 **진짜 학습** 검사 하나가
  N6·N18·N19를 문다 — 위 임시 스펙이 그 모양이다. (나) 군집 계획이 저장된 타깃 이름의 열을
  특성으로 쓰는 검사(N1). (다) 이미지 판의 층화 잠금을 띄우는 검사(N11·N22). (라) 예상 폭·예상
  시간 숨김(N12·N7). (마) 등록부 밖 알고리즘이 학습에 넘어가는 검사(N14). N10은 닿지 않는 갈래라
  안 물어도 된다 — 대신 그 getter의 되돌림 가지를 지우는 편이 낫다.
- **C-8.** `BatchPredict.vue:463-473`은 보이는 모델(필터)만 바꿔도 쪽을 0으로 되돌린다 — 행은
  그대로인데. 화면 값이고 작다.
- **C-9.** `TabularPrepPanel.vue:487`의 `chooseHoldout`은 아직 붙이지 않은 테스트 파일 초안을
  묻지 않고 비운다(①을 고르면). 초안은 ②의 것이라 한 몸으로 봤지만 적어 둔다.

---

## 3. 전수 조사 — 남은 옵션 연쇄

**어떻게 셌나.** 요청서가 시킨 대로 `with*`의 호출처가 아니라 **문서를 돌려주는 순수 함수 전부**
(`project/settings.ts` 10 · `project/dataset.ts` 5 · `project/images.ts` 9 · `project/attach.ts` ·
`project/embeddings.ts` · `project/identity.ts` · `project/portfolio.ts`), **스토어 쓰기 전부**
(`project.update`·`project.save` 51자리 · 13파일), **`watch`·`watchEffect`·`onMounted` 전부**
(44자리 · 27파일, `views/`·`components/`·`composables/`), 계산값의 setter(`ChartDialog`·
`ScatterChart`), 파싱·마이그레이션·열기(`schema.ts`·`migrate.ts`·`format.ts:917-1034`), 초안
상태(`ModelAxes`·`TabularPanel`·`TabularPrepPanel`·`ImagePrepPanel`·`ImagePanel`·`BatchPredict`)를
읽었다. 읽은 파일은 §6.

### 3.1 연쇄 표

| 자리 | A | B | 사는 곳 | 판정 | 근거 |
|---|---|---|---|---|---|
| `HistogramChart.vue:78-95` | 자동 체크박스 | 학생이 고른 구간 수(`draft`·`applied`) | 화면 | **연쇄** (B-4) | 자동을 켜면 `applied='auto'`, 초안이 numpy 수로 덮인다. 끄면 안 돌아온다 |
| `TabularPredictPanel.vue:134` · `ImagePredictPanel.vue:179` | 실험 집합(새 학습·프로젝트 전환) | 필터 선택 | 화면 | **연쇄** (B-5) | `defaultFilter`로 전부 켬 |
| `BatchPredict.vue:463-473` | 보이는 모델·파일 | 쪽 번호·색 배정 | 화면 | **연쇄**, 작음 (C-8) | 필터만 바꿔도 0쪽 |
| `project/dataset.ts:124-131` | 주 데이터 교체 | 없어진 열의 타깃·특성 | 파일 | 데이터가 사라짐 | 토스트로 알린다. **요청서 §1의 둘째** — 동의 |
| `project/dataset.ts:146-155` | 주 데이터 교체 | 테스트·예측 데이터, `split.method`, 실험 | 파일 | 한 몸 | 열 전체와 대조한 파일이라 정본이 바뀌면 뜻을 잃는다 (spec §1) |
| `dataset.ts:245`·`:395` · `images.ts:272`·`:306` | 테스트 데이터 붙임/뗌 | `split.method` | 파일 | 한 몸 | **요청서 §1의 첫째** — 동의. 파일 없는 `provided`는 없다 |
| `TrainView.vue:386-394` | 모델 담기 | `settings.runtime` | 파일 | 파생값 (연쇄 아님) | **요청서 §1의 셋째** — 동의. 이 필드를 쓰는 손이 이것뿐이라 학생이 "따로 고른 값"이 아니다. 실험 스냅샷의 `runtime`이 그 값이라 변경 이력에 뜰 수는 있다 |
| `TabularPrepPanel.vue:487` | ① 고르기 | 아직 안 붙인 테스트 파일 초안 | 화면 | 한 몸 (C-9) | 초안은 ②의 것 |
| `TabularPanel.vue:148-157` | 새 파일 읽기 | 시트·머리글 초안 | 화면 | 한 몸 | 새 파일의 초안 |
| `TabularPredictPanel.vue:252` | 프로젝트 전환 | 입력값·답 | 화면 | 데이터가 사라짐 | 열 이름이 다르다 |
| `ImageGrid.vue:88` · `ImagePredictPanel.vue:115` | 사진 수 감소 | 쪽 번호 | 화면 | 데이터가 사라짐 | 빈 쪽 클램프 |
| `ResultsView.vue:42` | 실험 목록 변경 | 고른 실험 | 화면 | 데이터가 사라짐 | 없어졌을 때만 |
| `ExperimentDetail.vue:106` | 실험 바꿈 | 펼친 run | 화면 | 한 몸 | run은 실험의 것 |
| `ClusterResultPanel.vue:72·84` | 실험·run·군집 바꿈 | 펼친 군집·쪽 | 화면 | 한 몸 | |
| `ClusterNeighbors.vue:181` | 후보 목록 변경 | 고른 모델 | 화면 | 데이터가 사라짐 | 없어졌을 때만 |
| `ClusterScatter.vue:50-56` | 축 목록(다른 실험·모델) | 고른 축 둘 | 화면 | 한 몸 | 축 집합이 바뀐다 |
| `ImageClusterPanel.vue:87` | 배정 재계산 | 군집별 쪽 | 화면 | 한 몸 | |
| `ImagePanel.vue:158` | 사진 사라짐 | 고른 사진·기준점 | 화면 | 데이터가 사라짐 | R38 C-7 |
| `ImagePanel.vue:501-541` (`renameCategory`·`removeCategory`) | 범주 이름 변경·삭제 | 확인 판의 묶음·기준점 | 화면 | 정규화 | 새 이름으로 **따라간다** — 연쇄의 반대 |
| `InspectView.vue:168` | 명렬 교체 | 열어 둔 제출물 | 화면 | 데이터가 사라짐 | |
| `ExportButton.vue:36` | 프로젝트 전환 | 학번·이름 칸 | 화면 | 한 몸 | 그 파일의 값으로 |
| `WelcomeView.vue:98` | 만들기 폼의 종류 | `dataType` 초안 | 화면 | 한 몸 | |
| `settings.ts:146-148`·`:180` · `TabularPrepPanel.vue:326-358` | 범위 밖 입력 | `testSize`·`nSamples` | 파일 | 정규화(문) | 클램프가 아니라 무시(R33 A-1) |
| `format.ts:917-1034` · `migrate.ts:73-97` | 파일 열기 | 없는 모델·첨부 참조, 백본 이름 | 파일 | 정규화 | 열 때만 |
| `images.ts:256-312` · `attach.ts:76` | 테스트 사진 붙임/뗌 · 학습 끝 | 실험 목록 | 파일 | 데이터(spec §4.3) | |
| `ModelAxes.vue:49-73` | 모델 고르기 | 실행 방법 초안 | 화면 | 연쇄 아님 | `pickedRuntime`을 안 건드린다 — 안 되는 조합은 카드가 잠긴다(55와 같은 모양) |

**파일에 남는 학생의 값을 조용히 고쳐 쓰는 연쇄는 없다.** 55가 끊은 다섯 뒤에 남은 것은 화면 안의
둘(B-4·B-5)과 작은 하나(C-8)다.

### 3.2 거꾸로 된 반쪽 표

| 자리 | 학습은 | 화면은 | 판정 |
|---|---|---|---|
| `selection.ts:687-692` + `plan.ts:289` (`provided` + 뽑기) | 층화 뽑기를 **무시** | 잠그지도 보이지도 않음(`TabularPrepPanel.vue:803`) | **A-1 · B-6** |
| `stores/project.ts:78` (`algorithmsChosen`) | 전부 잠긴 목록으로 **아무것도 안 함** | 체크리스트가 ✓, [학습하기]는 잠금 | **B-2** |
| `ChosenModels.vue:419` (잠긴 줄의 손잡이) | 그 줄을 **무시** | 손잡이가 **열림** | **B-3** |
| `selection.ts:166`·`:236` (인코딩 `none`의 문자 열) | 그 열을 **뺌** | 주의색 한 줄, 체크박스는 **안 잠금** | C-6 |
| `TabularPrepPanel.vue:215` (`featureSummary`) | 4개로 학습 | *"5개 중 4개"* | C-4 |
| `TrainView.vue:314` (`targetIssue`) | 쓸 수 있는 행으로 판정 | 파일 전체로 말함 | R39의 몫 (요청서 §5) |

---

## 4. 돌연변이 표 — 전부

### 4.1 표

**36개를 심었다**(대조 C0 포함 — 주석만, 조용 ✓). 요청서 §6의 17개(M1~M17)는 **내 하니스에서
전부 운다** — 저쪽이 "끊었다"고 적은 줄과 같은 줄을 끊었다(자리는 §6의 표 그대로). 새로 심은
18개(N) 중 **욺 7 · 조용 11.** 스펙은 "그 파일을 싣는 것 + 55가 세운 것"으로 좁게 골랐고(칸에 적었다)
`vue-tsc`는 따로 안 돌렸다 — 전부 값·분기 돌연변이라 타입이 물 자리가 아니다.

| # | 자리 | 바꾼 것 | 결과 | 문 검사 |
|---|---|---|---|---|
| C0 | `selection.ts` | (대조) 주석만 | 조용 ✓ | — |
| M1 | `TrainView.vue:373` | 유형을 누르면 안 맞는 모델을 지움 | 욺 1 | `option-cascade` 유형 카드 왕복 |
| M2 | `training-source.ts:364` | 학습에 잠긴 줄도 넘김 | 욺 1 | `option-cascade` `trainingSourceOf` |
| M3 | `selection.ts:417-420` | 줄을 절대 안 잠금 | 욺 3 | `option-cascade` 셋 |
| M4 | `selection.ts:452-453` | 상태를 자리 그대로 | 욺 1 | `option-cascade` `byChosenRow` |
| M5 | `plan.ts:196` | 계획이 타깃을 특성으로 씀 | 욺 1 | `option-cascade` (plan.spec은 **안 문다**, C-5) |
| M6 | `training-source.ts:119` | 기록에 타깃을 남김 | 욺 1 | `option-cascade` 스냅샷 |
| M7 | `settings.ts:92` | `withTarget`이 다시 거름 | 욺 5 | `settings` · `option-cascade` |
| M8 | `settings.ts:105` | `withFeatures`가 다시 거름 | 욺 3 | `settings` · `option-cascade` |
| M9 | `ColumnPicker.vue:237` | 특성 칸을 역할로 그림 | 욺 1 | `option-cascade` 켜진 채 잠김 |
| M10 | `plan.ts:287-290` | 계획이 층화 판정을 무시 | 욺 7 | `plan` · `option-cascade` · `experiment` |
| M11 | `selection.ts:599` | 옛 잠금 규칙 | 욺 2 | `selection` · `option-cascade` |
| M12 | `selection.ts:692` | 시험 비율 사유를 안 봄 | 욺 2 | `selection` · `plan` |
| M13 | `ChartDialog.vue:55` | 창이 도구를 덮어씀(`watch` 복원) | 욺 1 | `option-cascade` 창 왕복 |
| M14 | `ScatterChart.vue:59` | 창이 세로축을 덮어씀(`watch` 복원) | 욺 1 | `option-cascade` |
| M15 | `TabularPrepPanel.vue:269` | [전체 선택]이 타깃 열을 떨굼 | 욺 1 | `option-cascade` |
| M16 | `facts.ts:47` | 체크리스트가 목록 길이로 셈 | 욺 1 | `option-cascade` (`steps`·`step-checklist`는 안 문다) |
| M17 | `TabularSummaryRows.vue:48` | 요약이 목록 길이로 셈 | 욺 1 | `option-cascade` |
| N1 | `plan.ts:196` | 군집에서도 타깃 이름을 거름 | **조용** | (`plan`·`option-cascade`·`clusters`·`experiment`) |
| N2 | `training-source.ts:364` | 잠긴 모델 거르기를 표에서만 | **조용** | (`option-cascade`·`training-source`·`image-training`) |
| N3 | `selection.ts:453` | `byChosenRow` 하나 어긋남(`++next`) | 욺 1 | `option-cascade` |
| N4 | `selection.ts:719` | `shareStratifyBlock`이 늘 `labels.length` | 욺 1 | `experiment` 가장 작은 표본 |
| N5 | `selection.ts:690-692` | 시험 비율 판정을 값이 1개뿐 판정 앞으로 | 욺 3 | `selection` 셋 |
| N6 | `TrainView.vue:522` | `trainBlock` `every`→`some` | **조용** | (`option-cascade`·`train-walk`) |
| N7 | `ChosenModels.vue:172` | 잠긴 줄에도 예상 시간 | **조용** | (`option-cascade`·`train-walk`·`estimate`) |
| N8 | `selection.ts:237` | `featureLocked`가 역할을 안 봄 | 욺 2 | `option-cascade` · `selection` |
| N9 | `TabularPrepPanel.vue:269` | `setAllFeatures`의 타깃 조건 뒤집음 | 욺 1 | `option-cascade` |
| N10 | `ScatterChart.vue:82-86` | 색 열 getter가 후보 밖이어도 고른 값 | **조용** | (`option-cascade`·`chart-handles`·`chart-dialog`) — 닿지 않는 가지 |
| N11 | `ImagePrepPanel.vue:76` | 이미지 판 층화 판정이 분할 설정을 안 봄 | **조용** | (`image-prep-drop`·`image-prep-fail`·`option-cascade`) |
| N12 | `TrainView.vue:287` | 예상 폭이 타깃을 안 뺌 | **조용** | (`option-cascade`·`estimate`·`train-walk`) |
| N14 | `selection.ts:436-437` | `trainableSelections`가 등록부 밖도 거름 | **조용** | (`option-cascade`·`training-source`·`selection`) |
| N15 | `selection.ts:585` | `stratifyApplies`가 판정을 무시 | 욺 7 | `selection` · `plan` · `option-cascade` |
| N18 | `TrainView.vue:247` | `rowStatuses`를 자리 그대로 넘김 | **조용** | (`option-cascade`·`train-walk`) |
| N19 | `TrainView.vue:249` | `rowStartedAt`을 자리 그대로 넘김 | **조용** | (`option-cascade`·`train-walk`) |
| N20 | `ChosenModels.vue:388-390` | 잠긴 이유를 줄에 안 그림 | 욺 1 | `option-cascade` |
| N22 | `ImagePrepPanel.vue:85` | 이미지 판이 층화를 절대 안 잠금 | **조용** | (`image-prep-drop`·`image-prep-fail`·`option-cascade`) |

### 4.2 조용한 11개 — 안 우는 이유

- **N6 · N18 · N19** — 검사가 없다. `option-cascade.spec.ts`는 `byChosenRow`를 **단위로** 물고,
  화면 검사는 잠긴 줄 **하나짜리** 목록에서 [학습하기]가 잠기는 것만 본다(`some`과 `every`가
  같다). 섞인 목록으로 학습을 돌리는 스펙이 없다. **N18은 상태가 다른 모델의 줄에 앉는 그
  결함**이다 — 55가 `byChosenRow`를 만든 이유가 그것인데 배선은 안 물린다.
- **N1** — 계획을 지나는 군집 검사가 없다. `featuresInUse` 단위 검사(`option-cascade`)만 있다.
- **N2** — 이미지 학습 검사에 유형에 안 맞는 모델이 섞인 것이 없다.
- **N7 · N12** — 요청서 §6이 이미 *"무는 검사가 없다"*고 적은 자리. 맞다.
- **N10** — 닿지 않는 가지다(창이 모달이라 후보가 안 바뀐다). 조용한 것이 맞고, 물 필요가 없다.
- **N11 · N22** — 이미지 전처리 판의 층화 잠금을 띄우는 스펙이 없다(요청서 §6 그대로).
- **N14** — 등록부 밖 알고리즘이 학습에 넘어가 실패 run이 되는 길을 지나는 스펙이 없다.

### 4.3 처방과 그물을 실측한 기록

둘째 묶음(9개, 같은 러너·같은 되돌리기 확인).

- **P1 — A-1의 처방.** `selection.ts`의 `stratifyBlockFor`에서 뽑기 사유 다음에
  `if (split.method !== 'holdout') return null` 한 줄을 넣었다. 임시 스펙 두 단언이 **의도대로
  뒤집혔다** — `provided`의 판정이 `null`이 되고, 드문 범주가 씨앗 200개 **모두**에서 표본에 남는다
  (`absent` 83 → 0). 함께 돌린 `selection`·`plan`·`option-cascade`·`experiment`·`tabular-prep-kind`·
  `image-prep-drop`·`image-prep-fail`과 퍼즈 **252개 초록**, `holdout` 경계는 그대로다. 되돌렸다.
  이 모양에서 `provided`에 남는 사유는 `SAMPLE_STRATIFY_IMPOSSIBLE` 하나이고 그때 층화를 끄는 것은
  맞다(뽑기가 그 입력에서 던진다). **B-6(숨은 체크박스)은 이것으로 안 닫힌다.**
- **N6b · N18b — C-7 (가)의 그물.** 잠긴 줄을 가운데 끼운 **진짜 학습** 임시 스펙
  (`zz-d55-train-rows`)에 N6과 N18을 다시 심었다 — **둘 다 운다.** N6은 섞인 목록에서 [학습하기]에
  `disabled`가 서고(`expected '' to be undefined`), N18은 잠긴 줄에 `waiting`이 앉는다
  (`prelude: expected 'waiting' to be null`). 이 스펙을 `option-cascade.spec.ts`로 옮기면 N19까지
  같은 줄에서 문다.
- **N1b — 넓혀도 조용.** `clusters`·`image-clusters`·`results-screen`·`option-cascade`·`reproduce`·
  `predict` 여섯 스펙 **258개**로 넓혀도 조용하다. 군집 계획을 지나는 검사가 정말 없다.
- 나머지 다섯(V9·VS1·VS2·VC1·VC2)은 재확인 요청서의 몫이라 `report-R38-verify-2.md` §2에 있다.

---

## 5. 못 한 것 · 확인 못 한 것

- **브라우저로 아무것도 안 봤다** — 켜진 채 잠긴 특성 칸·잠긴 모델 줄의 모양은 jsdom과 코드뿐이다.
- **[멈추기]로 끊은 학습의 자리 짝짓기**는 코드로만 봤다(I4).
- **이미지 프로젝트의 `provided` + 뽑기**는 안 쟀다 — 이미지 판에 뽑기 손잡이가 없어 오늘은 안
  닿는다고 코드로 봤다.
- **`vue-tsc`는 돌연변이마다 안 돌렸다.** 전부 값·분기 돌연변이라 타입이 잡을 자리가 아니라고
  봤다 — 확인은 안 했다.
- **옛 판은 학습 계층만 돌렸다.** 옛 판의 화면(전처리 판의 특성 칸이 어떻게 보이는지)은 안 띄웠다.
- **sklearn 대조는 다섯 입력**이다. 경계 전체를 훑지는 않았다.
- **A-1이 이미지에서도 나는지**는 `nSamples`가 비어 안 닿는다고 봤을 뿐, 손으로 고친 파일로는
  안 쟀다.

**"확정 불가"를 쓴 자리** — 없다. **"코드로만 봤다"** — [멈추기](I4), 이미지의 `provided`+뽑기,
B-3.

---

## 6. 어디까지 읽었는가 — 파일 단위

**전문을 읽었다** — `ml/plan.ts` · `ml/selection.ts` · `ml/training-source.ts` · `ml/split.ts` ·
`ml/sample.ts` · `ml/reproduce.ts` · `ml/images.ts` · `project/settings.ts` · `project/dataset.ts` ·
`project/attach.ts` · `project/migrate.ts` · `stores/project.ts` · `composables/useTraining.ts` ·
`views/TrainView.vue` · `views/train/ChosenModels.vue` · `views/train/ModelAxes.vue` ·
`views/train/TabularTrainContext.vue` · `views/preprocess/TabularPrepPanel.vue`(스크립트 전부, 템플릿은
손잡이·잠금·조건 줄) · `views/preprocess/ImagePrepPanel.vue`(스크립트 전부, 템플릿은 손잡이 줄) ·
`views/preprocess/ColumnPicker.vue`(스크립트) · `views/PreprocessView.vue`(스크립트) ·
`views/data/ChartDialog.vue`(스크립트) · `views/data/charts/{Scatter,Histogram,Box,Bar}Chart.vue`
(스크립트) · `tests/option-cascade.spec.ts` · `c357240`·`ad2162e`의 diff 전부.

**일부만 읽었다**(자리를 짚어서) — `ml/experiment.ts`(750-870, `comparable` 주변 grep) ·
`ml/predict.ts`(grep) · `ml/preprocess.ts`(`usableRows`·`detectKind`·`fitPreprocessor` 머리) ·
`project/schema.ts`(560-640, 1080-1093, grep) · `project/format.ts`(900-1040) ·
`project/images.ts`(256-312, 505-562, grep) · `project/facts.ts`(diff) · `router/steps.ts`(grep) ·
`views/data/TabularPanel.vue`(148-250, grep) · `views/data/ImagePanel.vue`(150-185, 416-560) ·
`views/data/ImageGrid.vue`(80-100, 186-194) · `views/predict/*`(모든 `watch` 본문 ±25줄, 스토어
쓰기 자리) · `views/results/*`(`watch` 본문) · `views/inspect/InspectView.vue`(98-215) ·
`views/inspect/ReproducePanel.vue`(160-240) · `views/PortfolioView.vue`(295-330, 대입 grep) ·
`views/portfolio/*`(`watch` 본문) · `views/WelcomeView.vue`·`components/ProjectName.vue`·
`components/ExportButton.vue`·`components/ClusterScatter.vue`(대입 grep, `watch` 본문) ·
`composables/useRoster.ts`(대입 grep) · `data/charts.ts`(grep) · `limits-switch.ts`(grep).

**안 읽었다** — `ml/engines/**` · `ml/worker/**`(`handler.ts:39`만) · `ml/metrics.ts` · `ml/clusters.ts` ·
`data/image/**` · `project/portfolio*.ts` · `project/roster.ts` · `project/storage.ts` ·
`project/tab-lock.ts` · `views/inspect/StudentEditor.vue` · `views/results/panels/*`(`watch` 없는 것) ·
`components/App*.vue` · 백엔드 전부. 이 목록이 곧 *"못 찾은 곳"*이다 — 그중 옵션을 고쳐 쓸 만한
자리는 `project/portfolio*.ts`(문항 답)뿐이라고 본다(`PortfolioView`의 쓰기는 `portfolio`만 만진다).
