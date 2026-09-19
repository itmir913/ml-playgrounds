# R33 감사 보고서 — 우리가 만들 수 있는데 우리가 못 읽는 문서

> 요청서: `docs/audit/request-R33.md` · 대상: `1e4db66` 시점의 저장소 전체
> 관문: `npm run ci` **초록**(173 파일 · 3,555 통과 · 3 건너뜀, 약 100초).
> **그 초록불 아래에 A가 하나 살아 있다.**

## 0. 한 줄

**R32 A-1은 한 자리가 아니라 한 종류였다.** 같은 모양이 `settings.nSamples`에 그대로 또
있었고, 실물로 재현했다 — 3,222바이트로 저장되고 **파일도 IndexedDB 사본도 다시는 안
열린다.** 스키마 제약 스물여덟을 전수로 훑은 결과 **어길 수 있는 칸은 그 하나**였고,
나머지 스물일곱은 타입이거나 구조가 막는다.

등급: **A 1 · B 1 · C 4.**

---

## 1. A-1 — 한 줄짜리 표에서 뽑기를 건드리면 프로젝트가 죽는다

**자리**: `frontend/src/views/preprocess/TabularPrepPanel.vue:319`
(문은 `frontend/src/project/settings.ts:165` `withSampling`)

**주장.** 뽑기 칸의 클램프가 **바닥보다 천장을 나중에 적용한다.**

```ts
Math.min(Math.max(parsed, MIN_SPLIT_ROWS), usableRowCount.value)
```

`usableRowCount < MIN_SPLIT_ROWS`이면 `Math.min`이 바닥을 도로 깎는다. 스키마는
`nSamples: z.int().min(MIN_SPLIT_ROWS)`(`schema.ts:279`)이므로 그 값이 든 문서는
**읽는 문에서 거부된다.**

**같은 화면의 형제는 막혀 있다.** 같은 파일 `:299` `startSampling`은
`Math.max(usableRowCount.value, MIN_SPLIT_ROWS)`로 **바닥을 마지막에** 건다. 두 자리가
반대 순서이고, 안 막힌 쪽이 학생이 실제로 만지는 칸이다.

**재현 (진짜 입구로).** 임시 프로브 `tests/zz-probe-r33.spec.ts`(라운드 끝에 삭제):

| 단계 | 쓴 것 | 나온 값 |
|---|---|---|
| 천장 | `toDataset(parseCsvText(…datasetBytes…), true)` → `trainableRowCount(table, ['꽃받침'], '품종', 'drop', undefined)` | `rows: 1, usable: 1` |
| 클램프 | `Math.min(Math.max(2, 2), 1)` | `1` |
| 저장 | `withSampling(doc, 1)` → `writeProject` | **성공, 3,222바이트** |
| 열기(파일) | `readProject(bytes)` | `PROJECT_FILE_INVALID { path: 'settings.nSamples', issues: 1 }` |
| 열기(저장소) | `saveProject` → `loadProject` | **같은 코드, 같은 경로** |

천장 `1`은 **저장소 자신의 픽스처**에서 나왔다 — `tests/fixtures/project.ts:137`의
`datasetBytes`가 머리글 + 데이터 한 줄이다.

**도달 경로.** 업로드는 `grid.length === 0 || columns === 0`일 때만
`DATASET_EMPTY`로 막는다(`data/table.ts:152`) — **한 줄짜리 표는 정상적으로 들어온다.**
뽑기 라디오가 요구하는 것은 타깃 하나뿐이고(`samplingLocked`), 켜면
`startSampling`이 `2`를 박는다(유효). 그러나 숫자 칸의 표시값은
`sampleSummary.used = trainableRowCount(…, 2) = 1`이라 **화면은 이미 1을 보이고 있고**,
그 칸을 한 번 건드려 `change`가 뜨는 순간 `1`이 파일에 박힌다. 결측으로 행이 깎여
`usable`이 0이나 1이 되는 경로(`missing: 'drop'`)도 같다.

**주석이 이 경로를 정확히 부인하고 있었다.** `schema.ts:275`:

> *"화면이 그 밑으로 못 내려가는데 스키마만 1을 받으면, **손으로 고친 파일이** 열리기는
> 하고 …"*

화면이 그 밑으로 **내려간다.** 요청서가 말한 *"유창하게 틀린 주석"*이고, R32 A-1이 걸린
자리의 주석과 같은 성격이다.

**같은 병의 이웃 — `grep`으로 셌다.**

- `grep -rn "Math.min(Math.max\|Math.max(Math.min" src/` → **1건**(위 그 줄). 클램프
  순서가 뒤집힌 자리는 여기 하나뿐이다.
- 스키마 제약 스물여덟 중 화면 입력이 직접 값을 짓는 칸은 **둘**뿐이다 — `nSamples`와
  `split.testSize`. 뒤엣것은 `TEST_SIZE_RANGE = {min: 0.05, max: 0.5}`(`limits.ts:1009`)라
  `.gt(0).lt(1)`을 구조적으로 못 어긴다.

**처방 (실측했다).** 요청서 §4의 원칙대로 **값이 문서로 들어가는 문**에서 모양을
보장한다 — `withSampling`이 바닥을 올린다.

```ts
const floor = nSamples === undefined ? undefined : Math.max(nSamples, MIN_SPLIT_ROWS)
```

임시로 넣고 재니 프로브의 왕복이 **산다**(`nSamples`가 `2`로 열린다). 기존 검사도
안 깨진다 — `settings`·`sample`·`experiment`·`format` 네 스펙 **240개 통과**. 넣은 것은
즉시 되돌렸다.

**다만 문만 고치면 화면이 거짓말한다.** `setSampleRows`가 끝에
`input.value = String(next)`로 **자기 계산값**을 다시 쓰므로(`architecture.md` §8.15.1),
문이 2로 올려도 칸에는 1이 남는다. **둘을 함께 고쳐야 한다** — 화면 쪽은 클램프 순서를
`Math.max(Math.min(parsed, usable), MIN_SPLIT_ROWS)`로 뒤집으면 문과 같은 값이 나온다
(`usable = 1`에서 둘 다 2). **이 두 번째 절반은 DOM 주장이라 안 쟀다.**

---

## 2. §2.1 — 스키마 제약 스물여덟, 전수

`schema.ts`의 `.enum` 13 · `.int` 11 · `.min` 3 · `.max` 3 · `.nonnegative` 5 ·
`.positive` 2를 **칸 기준으로 합쳐 28줄**이다. 빈 줄은 없다.

| # | 칸 | 제약 | 그 값을 짓는 코드 자리 | 어길 수 있는가 | 어기면 무엇을 잃는가 |
|---|---|---|---|---|---|
| 1 | `manifest.formatVersion` | `.int().positive()` | `create.ts:108`(상수 `FORMAT_VERSION`) · `migrate.ts:138`(`version + 1`) | 못 한다 — 상수와 증가뿐 | — |
| 2 | `createdAt`·`updatedAt`·`run.trainedAt`·`experiment.startedAt` | `TIMESTAMP` 정규식 | 전부 `new Date().toISOString()` (`create.ts:75`, `experiment.ts:764`, 화면의 `now()` 넷) | 못 한다 — 밖에서 온 시각 문자열이 이 칸에 닿는 경로가 0건 | — |
| 3 | `manifest.taskType` | `.enum(TASK_TYPES)?` | `settings.ts`의 `withTaskType`, 인자 타입 `TaskType` | 못 한다 — 타입 | — |
| 4 | `manifest.dataType` | `.enum(DATA_TYPES)` | `create.ts`(`NewProject.dataType: DataType`) | 못 한다 — 타입 | — |
| 5 | `dataset.sourceEncoding` | `.enum(SOURCE_ENCODINGS)?` | `data/table.ts:99` `detectEncoding` → `SourceEncoding \| null`, `dataset.ts:139·234`가 `null`이면 키를 지운다 | 못 한다 — 타입 | — |
| 6 | `preprocessing.missing` | `.enum(MISSING_STRATEGIES)` | `withPreprocessing(Partial<Preprocessing>)` | 못 한다 — 타입 | — |
| 7 | `preprocessing.scaling` | `.enum(SCALING_METHODS)` | 동 | 못 한다 — 타입 | — |
| 8 | `preprocessing.categoricalEncoding` | `.enum(CATEGORICAL_ENCODINGS)` | 동 | 못 한다 — 타입 | — |
| 9 | `split.method` | `.enum(SPLIT_METHODS)` | `withSplit(Partial<Omit<Split,…>>)` | 못 한다 — 타입 | — |
| 10 | `split.randomState` | `.int()` | `create.ts:41` `crypto.getRandomValues(new Uint32Array(1))` | 못 한다 — 구조적으로 정수 | — |
| 11 | **`settings.nSamples`** | `.int().min(MIN_SPLIT_ROWS)` | `TabularPrepPanel.vue:319` → `settings.ts:165` | **할 수 있다 (A-1)** | **파일과 IndexedDB 사본이 둘 다 안 열린다** |
| 12 | `imageDatasetRef.path` | `.endsWith('/')` | `project/images.ts:412` `ROLE_REFERENCE[role].path` (상수) | 못 한다 — 상수 | — |
| 13 | `imageDatasetRef.canonicalSize` | `.int().positive()` | `project/images.ts:413` ← `limits.ts`의 정본 크기 | 못 한다 — 상수 | — |
| 14 | `imageDatasetRef.format` | `.enum(CANONICAL_FORMAT_IDS)` | `project/images.ts:414` `format.id` ← `data/image/formats.ts` 등록부 | 못 한다 — 타입 | — |
| 15 | `imageDatasetRef.quality` | `.gt(0).lte(1)` | `format.quality` ← `IMAGE_WEBP_QUALITY 0.65` · `IMAGE_JPEG_QUALITY 0.85` | 못 한다 — 상수 | — |
| 16 | `imageSnapshot.categoryCounts[]` | `.int().nonnegative()` | `ml/images.ts:187` `counts.get(category) ?? 0` (Map 세기) | 못 한다 — 세기의 결과 | — |
| 17 | `imageSnapshot.unlabeledCount` | `.int().nonnegative()` | `ml/images.ts:188` | 못 한다 — 세기의 결과 | — |
| 18 | `perClass.support` | `.int()` | `metrics.ts:78` 혼동 행렬 한 줄의 합 | 못 한다 — 세기의 결과 | — |
| 19 | `confusionMatrix.matrix[][]` | `.int()` | `metrics.ts:66–71` `row[column] + 1` | 못 한다 — 세기의 결과 | — |
| 20 | `modelRef.sizeBytes` | `.int().nonnegative()` | `attach.ts:119` `bytes.length` | 못 한다 — 구조적 | — |
| 21 | `run.computedBy` | `.enum(TRAINING_LOCATIONS)` | `experiment.ts:611` `runtime.location` (`RuntimeSpec.location: TrainingLocation`) | 못 한다 — 타입 | — |
| 22 | `run.status` | `.enum(RUN_STATUSES)` | `experiment.ts:703·738·916·924` 리터럴 넷뿐 | 못 한다 — 리터럴 | — |
| 23 | `run.modelOmitted` | `.enum(MODEL_OMISSION_REASONS)?` | `experiment.ts:718`(`ModelOmissionReason`) · `attach.ts:106`(리터럴) | 못 한다 — 타입 | — |
| 24 | `run.modelOmittedDetail` | `.max(MAX_FAILURE_DETAIL_LENGTH)` | `experiment.ts:729` `.slice(0, MAX_FAILURE_DETAIL_LENGTH)` | 못 한다 — 문에서 자른다(**M1이 운다**) | — |
| 25 | `experiment.settings.taskType` | `.enum(TASK_TYPES)` | `experiment.ts`의 prelude ← `context.taskType: TaskType` | 못 한다 — 타입 | — |
| 26 | `experiment.settings.trainIndices[]` | `.int().nonnegative()` | `experiment.ts:850` `[...split.trainIndices]` (행 번호) | 못 한다 — 구조적 | — |
| 27 | `experiment.settings.testIndices[]` | `.int().nonnegative()` | `experiment.ts:851` | 못 한다 — 구조적 | — |
| 28 | `portfolio.answerFormat` | `.enum(PORTFOLIO_ANSWER_FORMATS)` | `create.ts:139` · `PortfolioView.vue:70` 리터럴 | 못 한다 — 리터럴 | — |

**폼 전용 둘은 이 표 밖이다.** `studentIdInputSchema`·`studentNameInputSchema`
(`schema.ts:1050·1052`)의 `.min(1).max(...)`는 **문서에 안 닿는다** —
`manifest.student`의 두 칸은 제약 없는 `z.string()`이다. 상한을 넘는 학번이 든 남의
파일도 열려야 하기 때문이고, 그래서 이 둘로는 못 읽는 문서를 못 만든다.

**28 밖에서 함께 확인한 것 넷** (요청서의 여섯 종류에 안 들어가지만 같은 모양을 만든다):

- `split.testSize` `.gt(0).lt(1)` — 슬라이더가 `0.05~0.5`. 못 어긴다.
- `manifest.projectId` `z.uuid()` — `create.ts:55`가 버전·변형 니블을 규격대로 박는다.
- `runSchema`의 `.refine()` 둘(실패면 `failure`, 성공이면 `metrics`) — 네 생산 자리
  전부 짝을 함께 채운다.
- `run.metrics` `z.record(z.string(), z.number())` — **`NaN`이 가는 길은 닫혀 있다.**
  `metrics.ts:486·518`이 `Number.isFinite`로 막고, `perClass`는 전부 `ratio()`
  (분모 0이면 0)라 `NaN`이 나오면 `f1Macro`가 먼저 걸린다. 회귀의 `r2`는 분모 0을
  따로 처리한다.

### 요청서가 의심하라고 한 모양 셋에 대한 답

1. **바깥에서 온 문자열이 담기는 칸.** 실패 사유 원문은 `modelOmittedDetail` 하나이고
   R32가 문에서 잘랐다(#24). 나머지 바깥 문자열 — 열 이름·라벨·파일 이름·범주 이름 —
   은 전부 `userString = z.string()`이라 **제약이 걸린 칸과 안 겹친다.** 이것이
   설계다(`mlpx-spec.md` 10).
2. **수를 세어 넣는 칸.** `.int()`·`.nonnegative()`가 걸린 열한 칸에 **나눗셈이나 보간의
   결과가 들어가는 자리는 0건**이다 — 전부 세기(`+1`, `Map.get`, `length`), 배열 번호,
   `Uint32`, 상수다. 나눗셈이 사는 곳(`ratio`, `interpolate`, 배수)은 `z.number()` 칸이고
   거기에는 `Number.isFinite` 문이 따로 있다.
3. **`.enum()`의 어휘가 여러 곳에서 정해지는가.** 열셋 전부 `as const` 배열 하나에서
   타입이 나오고, 생산자는 그 타입을 받는다. **`modelOmitted`만 생산자가 둘**
   (`experiment.ts:718`, `attach.ts:106`)인데 둘 다 같은 타입이다.

---

## 3. §2.2 — 기본값을 세었다

**모집단을 바꿔 셌다.** `?? '…'`(문자열 기본값)만 보면 R32 B-1이 안 잡힌다 — 그것은
**선택 인자**였다. 그래서 `src`의 `??` **전부**를 세고 종류로 갈랐다.

| 갈래 | 수 |
|---|---|
| `src`의 `??` 전부 (주석 제외) | **478** |
| 인덱스·`Map.get` 가드 (`noUncheckedIndexedAccess`가 강제한다) | 235 |
| **나머지 (선택 인자·선택 필드·널 가능 값)** | **243** |
| 그중 세 조건을 다 만족하는 것 | **7** |
| 조건 (a)(b)는 맞고 (c)가 오늘은 안 닿는 것(잠재) | **8** |

`ml/`·`ml/engines/`의 옵셔널 필드는 요청서대로 **66개**이고, 그중 수·참거짓을 가르는
것은 **16개**다(`grep -rn "readonly [a-zA-Z]*?:" src/ml/*.ts src/ml/engines/*.ts`).

**고른 기준** — 셋을 다 만족해야 한다. ① 값이 계산이나 문구를 가른다(단순 표시 폴백이
아니다) ② 안 넘겨도 타입이 안 운다 ③ 틀린 값이 화면에 수나 문장으로 나간다.

### 걸러낸 7

| 자리 | 기본값 | 틀리면 학생이 무엇을 잘못 보는가 |
|---|---|---|
| `ml/preprocess.ts:465` | `toNumber(String(filled)) ?? 0` | 예측 표의 수치 열에 글자가 있으면 **그 줄이 0으로 예측된다.** 예측 표는 열 이름만 본다(`data/columns.ts:198`) |
| `ml/preprocess.ts:460` | `column.fill ?? ''` | 위와 한 경로. 대체값이 없으면 빈 칸 → 0 |
| `ml/algorithms.ts:518` | `relevant?.reason ?? 'ALGORITHM_NOT_AVAILABLE_HERE'` | 잠긴 이유가 *"여기서는 못 씁니다"*로 뭉개진다 |
| `ml/experiment.ts:328` | 동 | 실패한 run의 사유가 같은 문장으로 뭉개진다 |
| `ml/selection.ts:357` | 동 | 카드의 잠금 문구가 같은 문장으로 뭉개진다 |
| `views/predict/AnswerList.vue:144` | `model.reason ?? 'MODEL_FILE_INVALID'` | 이유를 모를 때 학생이 **"모델 파일이 깨졌다"**를 읽는다 |
| `ml/changes.ts:193` | `to.itemKind ?? from.itemKind ?? 'text'` | 변경 이력의 단위가 사진/열이 아니라 글로 적힌다 |

### 잠재 8 (오늘은 프로덕션에서 안 닿는다)

`ml/reproduce.ts:135`(`input.dataType ?? 'tabular'` — 유일한 프로덕션 호출자가
`props.dataType`을 넘기고 그 prop은 필수다) · `ml/engines/neural.ts:653`(`options.tol ?? TOL`,
`resolve`가 채운다) · `ml/calibration.ts:103`×2·`:111`(일감 목록이 상수 둘) ·
`ml/experiment.ts:764`(`options.now`) · `ml/estimate.ts:157`(백본 등록부의 기본 하나) ·
`project/storage.ts:289`(`quota === 0`을 바로 다음 줄이 `null`로 처리한다).

### 반대편도 쟀다 — 기본값인데 짝이 맞는 것

`ml/backend.ts:86`의 `limitRows: number = BROWSER_ROW_LIMIT`는 주석이 스스로
*"안 넘기면 화면이 5000이라고 말하고 3000에서 꺼진다"*고 경고한다. 세 호출자를 전부
확인했더니(`experiment.ts:927`, `ModelAxes.vue:97·163`) **사유와 `maxRows`가 같은 칸에서
짝으로 온다**(`algorithms.ts:518–524`, `selection.ts:319·330·341`). 그리고 `maxRows`가
없는 경우의 사유는 `ALGORITHM_NOT_AVAILABLE_HERE`인데 `isTooLarge()`가 거짓이라
**수 자체가 문장에 안 들어간다.** 여기는 결함이 아니다.

---

## 4. §2.3 — R32가 남긴 숙제 둘

### 4.1 `modelOmittedDetail`이 run에 실리는 검사는 **문다**

M2(`modelOmittedReason ?? …`를 상수로 고정)를 심으니
`experiment.spec.ts`의 *"엔진이 사유 어휘를 말하면 그것이 run에 실린다"*가 울었다
(`experiment.spec.ts:2391` 근처, `toContain(':too-large:')`). R32 §4-2가 *"안 쟀다"*고
적은 자리는 이제 실제로 잠겼다.

### 4.2 어댑터 뽑기의 **셋째 모양은 있다** — 앵커가 깊이를 안 본다 (C-1)

`scripts/adapter_python.py:96`(`_property`)의 앵커는 `^ +이름:`인데, **실물의 모든 값이
`serializer: {` 안(6칸 들여쓰기)에 있다.** 즉 오늘 이 앵커는 *"속성 자리"*가 아니라
*"들여쓰기가 하나라도 있는 아무 줄"*이고, **`re.search`가 먼저 만난 것을 가져간다.**

임시 프로브(저장소 파일은 안 건드렸다)로 세 모양을 쟀다.

| 모양 | 결과 |
|---|---|
| 형제 객체가 같은 이름을 **먼저** 들고 있다 | **`NESTED`를 가져간다** — 진짜 `dump`을 못 본다 |
| 값이 다음 줄로 내려간다 (`dump:\n  '…'`) | `None` — 조용히 빠진다 |
| 항목이 한 줄이다 (`knn: { … },`) | `_blocks`의 `^  (\w+): \{$`가 **경계로 안 잡는다** — 그 항목의 속성이 앞 항목의 몫이 된다 |

**오늘 실물에는 셋 다 0건이다**(한 줄 항목 0, 중첩된 동명 속성 0). 그래서 등급은 C다.
다만 셋 중 둘은 그물이 **반만** 있다 — `dumps()`는 `EXPECTED` 일곱이 빠지면 울지만,
`sizes()`는 **`random_forest` 하나만** 필수다(`adapter_python.py:146`). 둘째 알고리즘이
`size` 칸을 얻는 날 그 칸이 빠지면 아무도 안 운다(C-2).

**처방은 안 쟀다.** 앵커를 `^ {6}`으로 고정하는 것이 맞아 보이지만, 그러면 들여쓰기
깊이가 바뀌는 리팩터링마다 조용히 `None`이 된다 — **깊이를 고정하는 쪽과 `EXPECTED`를
넓히는 쪽 중 무엇이 나은지는 코드 소유자의 결정이다.**

---

## 5. 돌연변이 표 (다섯, **운 것까지 전부**)

| # | 심은 것 | 돌린 것 | 결과 |
|---|---|---|---|
| M1 | `experiment.ts`의 `.slice(0, MAX_FAILURE_DETAIL_LENGTH)` 제거 | `experiment.spec` + `format.spec` | **운다** — 단 `experiment.spec`만(`200 → 436`). **`format.spec`은 안 운다** → B-1 |
| M2 | `modelOmittedReason ?? …`를 `'engineUnsupported'`로 고정 | `experiment` + `format` + `pyodide-sklearn` | **운다** (`experiment.spec`) |
| M3 | `EstimateInput.runtime`을 다시 옵셔널 + `baselineMs`에서 `?? 'mljs'` | `vue-tsc` + `estimate` + `calibration` | **타입이 운다** (`estimate.ts:349`, `preparationMs`). **검사는 71개 전부 초록** |
| M3b | 위에 더해 `preparationMs(input.runtime ?? 'mljs')`까지 | 동 | **아무것도 안 운다** — `vue-tsc` 초록, 71개 초록 |
| M4 | `modelFactorKey`에서 실행 방법 제거 | `calibration` + `estimate` | **운다** (3개 실패) |
| M5 | `isCount`가 `Number.isFinite`를 안 본다 | `pyodide-sklearn` | **운다** (1개 실패) |

전부 **파일 하나의 정확한 경로**로 즉시 되돌렸고, 되돌린 뒤 `git status --short`가
비었음을 매번 확인했다.

**M3/M3b가 이 라운드에서 가장 값진 한 줄이다.** R32 B-1의 그물은 **타입 하나뿐이고,
검사는 0개다.** 타입이 무는 이유도 내가 겨눈 자리(기준표 조회)가 아니라 **두 번째
소비자**(`preparationMs`)였다 — 소비자를 전부 기본값으로 덮으면 3,555개가 전부 초록인
채로 R32 B-1이 되돌아온다. 그리고 **그런 검사는 원리적으로 못 쓴다**: 기본값은
*인자를 안 넘기는* 검사만 잡는데, `runtime`이 필수인 동안은 그런 검사를 쓸 수가 없다.
막는 방법은 검사가 아니라 **소비자 수를 세어 두는 것**(오늘 둘)이다.

---

## 6. B-1 — 이름이 재는 것보다 넓게 말하는 검사

**자리**: `frontend/tests/format.spec.ts:486–494`

**주장.** 검사 이름은 *"직렬화 사고의 원문이 **아무리 길어도** 파일이 다시 열린다"*인데,
본문이 **자기가 먼저 자른다**:

```ts
const detail = `pyodide-sklearn:random_forest:threw:${'x'.repeat(MAX_FAILURE_DETAIL_LENGTH)}`
  .slice(0, MAX_FAILURE_DETAIL_LENGTH)
```

그래서 **상한을 넘는 값이 이 검사를 한 번도 지나가지 않는다.** M1이 그것을 실측했다 —
문의 `.slice`를 지워도 이 스펙은 초록이다.

**같은 자리의 주석이 그 반대를 단정한다.** `experiment.ts:726–727`:

> *"`format.spec.ts`의 `직렬화 사고의 원문이 아무리 길어도 파일이 다시 열린다`와
> `experiment.spec.ts`의 … 가 문다."*

**둘 중 하나만 문다.** 요청서의 *"주석이 가리키는 검사가 실재하고 실제로 무는지까지
봐라"*가 겨눈 그 모양이고, 이 저장소에서 R7·R22에 이어 세 번째다.

**A가 아닌 이유**는 같은 성질을 `experiment.spec.ts`가 실제로 물기 때문이다 — 오늘
빠져나가는 결함은 없다. 잃은 것은 *"파일 계층에서도 막힌다"*는 둘째 층이다.

**처방(안 쟀다).** 자르지 않은 원문을 그대로 넣고 `readProject`가 **성공**하는지 보게
바꾸면 이름과 본문이 맞는다. 다만 지금 `writeProject`에는 자르는 문이 없으므로 그
검사는 **실패하는 것이 맞는 상태**가 된다 — 그러면 이 스펙이 주장할 것은
*"파일 계층은 안 자른다"*로 바뀌고, 그건 이름을 고치는 일이다. **어느 쪽이 맞는
주장인지는 코드 소유자의 결정이다.**

---

## 7. C 넷

| # | 자리 | 무엇 |
|---|---|---|
| C-1 | `scripts/adapter_python.py:96` | 앵커 `^ +`가 깊이를 안 본다. 형제 객체의 동명 속성이 먼저 오면 그것을 가져간다 (§4.2, 프로브로 재현) |
| C-2 | `scripts/adapter_python.py:146` | `sizes()`는 `random_forest` 하나만 필수다. 둘째가 `size`를 얻은 뒤 잃으면 조용하다 |
| C-3 | `src/ml/preprocess.ts:465` | 예측 입력의 글자가 조용히 `0`이 된다. 예측 표 검사는 **열 이름만** 본다 (`data/columns.ts:198`). **끝에서 끝까지는 안 쟀다** |
| C-4 | `src/views/preprocess/TabularPrepPanel.vue:299` vs `:319` | 같은 화면의 두 클램프가 바닥과 천장의 순서가 반대다. A-1을 고칠 때 **둘을 같은 모양으로** 맞춰야 다음 사람이 다시 안 고른다 |

---

## 8. 못 한 것 · 안 쟀다 · 안 읽었다

- **A-1의 두 번째 절반(화면)을 안 쟀다.** `input.value = String(next)`가 문의 값과
  갈리는지는 DOM 주장이고, 컴포넌트를 띄워 재지 않았다.
- **B-1과 C-1의 처방을 안 심었다.** 둘 다 *"무엇이 맞는 주장인가"*가 걸린 결정이라
  임의로 고르면 요청서 §4가 금지한 반대 제안이 된다.
- **§2.2의 243줄을 줄 단위로 읽었지, 자리마다 도달 경로를 증명하지 않았다.** 그래서
  **7은 "훑어서 고른 7"이지 "증명된 7"이 아니다.** 증명한 것은 A-1 하나뿐이다.
- **옵셔널 필드 66개를 하나씩 안 따라갔다.** 수·참거짓 16개만 봤고 나머지 50개
  (콜백·객체·문자열)는 세기만 했다.
- **이미지 경로의 실물 왕복을 안 돌렸다.** 표 14·15·16·17은 코드를 읽어 판정했고
  `.mlpx` 하나를 실제로 만들어 열지 않았다.
- **백엔드 관문(`uv run python scripts/ci.py`)을 안 돌렸다.** 이 라운드의 대상이 전부
  프런트엔드였다.
- **`experiment.spec.ts` 전수를 안 읽었다** — R26이 남긴 같은 숙제가 그대로 남는다.

---

## 9. 마지막 두 줄

**1. 이대로 배포해도 되는가 — 아니다.** A-1은 *"학생이 지금 다친다"*의 가장 나쁜
모양이다. 파일이 성공적으로 저장되고, 한 차시가 끝나고, **다음 시간에 안 열린다.**
고치고 나가라. 나머지 여섯은 배포를 막지 않는다.

**2. 같은 종류가 몇 개 더 남았는가 — 부류 1은 "0개"라고 답할 수 있고, 부류 2는 못 센다.**

- **부류 1(못 읽는 문서)은 셀 수 있었고, 답은 스물여덟 중 하나다.** 이 수가 믿을 만한
  이유는 모집단이 닫혀 있기 때문이다 — `parseProjectDocument`가 거부하는 조건은
  `schema.ts` 한 파일에 전부 있고, 각 칸의 생산자는 `grep` 한 번으로 닫힌다. 그
  하나를 고치면 **이 부류는 0이 된다.** 다만 *"제약이 늘면 모집단이 는다"* — 이 수는
  오늘의 스키마에 대한 수이지 영원한 수가 아니다.
- **부류 2(조용한 기본값)는 원리적으로 못 센다.** 조건 ③(*"화면에 수나 문장으로
  나간다"*)은 **도달 경로의 성질**이고, 도달 경로는 `grep`으로 안 닫힌다. 243자리
  각각에 대해 *"이 인자를 안 넘기는 호출자가 생길 수 있는가"*를 물어야 하는데, 그건
  오늘의 호출자 목록이 아니라 **내일의 호출자**에 대한 물음이다. M3b가 그것을 보였다 —
  타입이 필수를 요구해도 소비자 둘을 각각 기본값으로 덮으면 관문 전체가 초록이다.
  그래서 이 부류에 대해 셀 수 있는 것은 *"몇 개 남았나"*가 아니라
  **"한 값에 소비자가 몇인가"**이고, 그 수가 1을 넘는 자리가 R31 C-1 → R32 B-1 →
  M3b의 연속을 만들었다.

**그러므로 "언제 멈출 것인가"의 근거는 이것이다.** 모집단이 닫히는 부류(스키마 제약,
어휘, 상한)는 **전수로 세서 0을 확인하고 닫아라.** 모집단이 안 닫히는 부류(기본값,
도달 경로)는 세지 말고 **소비자 수를 1로 줄이는 쪽**으로 옮겨라 — 세는 일이 끝나지
않는 이유는 결함이 많아서가 아니라 **질문이 미래형이기 때문이다.**
