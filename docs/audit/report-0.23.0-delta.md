# `0.22.0`→`0.23.0` 델타 감사 보고서 — 관문이 못 보는 것을 봤다

> 요청서 `docs/audit/request-0.23.0-delta.md` · 앞 라운드 `report-R36.md`
>
> **HEAD `d7ea56d`** (소스는 `c057b38`과 같다). 작업 트리는 시작할 때 깨끗했고 끝날 때도
> 깨끗하다. 심은 것은 전부 즉시 되돌렸다(원본 바이트 대조 + `git diff --quiet` 파일 단위).
> 임시 스펙 일곱을 `frontend/tests/zz-*.spec.ts`에 심었다가 지웠다. **소스에 남은 것은 이
> 보고서 파일 하나다.**
>
> **관문 둘 다 돌렸다.** 백엔드 `uv run python scripts/ci.py` **초록**(33 통과). 프런트
> `npm run ci`는 **한 번 빨갰다** — `tests/compute-pools.spec.ts`의 `handleTrain` 하나가
> 5,050ms 시간 초과. **격리하니 11/11이 5.87초에 통과했다.** 감사자가 옆에서 `grep`을 돌리던
> 중이었고, 요청서 §8이 미리 적어 둔 그 모양이다. 나머지 175파일 · 3,609 통과 · 3 건너뜀.

---

## 0. 요약

**이 델타를 배포해도 되는가 — 된다. 다만 B-1을 먼저 고치는 것이 맞다.** 한 줄이고, 처방을
실측했다(§1 B-1).

**조용히 틀린 숫자는 없다.** 요청서가 본체라고 한 셋(§2.1 거절의 폭 · §2.2 정본 고쳐 쓰기 ·
§2.3 배포 관문)을 다 재고 나서 남은 것은 **"거절의 이름이 틀리는 자리 하나"**, **"결정문이
말한 화면이 실제로는 그렇지 않은 자리 하나"**, **"검사 픽스처의 모양이 갈래 하나를 원리적으로
안 지나는 자리"**다.

**등급 — A 0 · B 3 · C 4.**

**돌연변이 19 + 처방 실측 6.** 욺 13 · 조용 6. 조용한 여섯 중 **셋은 설계상 조용한 것**이고
(M2 · M23 · RXD는 고침 확인), **셋이 지적이 됐다**(M1 · M9 · M14). **내 처방 하나가 처음에는
안 물었다**(M14 — §3에 그대로 적었다).

**요청서가 틀리게 알고 있던 것 하나** — `0.23.0` 태그는 **로컬에도 원격에도 없다**(§5).

---

## 1. 지적

### B-1. 회귀에서 테스트 표의 타깃이 전부 비면 **`TEST_DATASET_NO_USABLE_ROWS`가 아니라 `TARGET_NOT_NUMERIC`이 된다** — 0.22.0에서 옳던 사유가 이 델타에서 틀려졌다

**자리** `frontend/src/ml/plan.ts:211-216` (V-1의 둘째 문).

**주장.** `providedTestRows`가 빈 배열이면 `targetValues(testDataset, [], target)`이 `[]`를
주고 **`detectKind([])`는 `'categorical'`을 돌려준다.** 회귀가 요구하는 것은 `numeric`이므로
`TARGET_NOT_NUMERIC`으로 막힌다 — *"타깃 열에 숫자가 아닌 값이 있습니다. 유형을 분류로
바꾸거나…"*. **실제 사정은 테스트 표에 쓸 수 있는 행이 0줄인 것**이고, 그 사유는 바로 뒤
`providedSplit`(`ml/split.ts:255`)이 정확히 말할 준비가 되어 있다. 이 문이 그 앞에 끼어들어
**틀린 사유로 먼저 선다.**

교실에서 닿는 모양: 학생이 *"테스트 파일에는 정답을 안 적는다"*고 생각하고 타깃 열을 비워
올린다. 그러면 화면이 **분류로 바꾸라고** 한다.

**재현** (임시 스펙, 12행 훈련 · 테스트 표 2행 타깃 공백 · `provided` · `regression`):

```
0.22.0 plan.ts  -> {"code":"TEST_DATASET_NO_USABLE_ROWS","params":{}}
HEAD    plan.ts  -> {"code":"TARGET_NOT_NUMERIC","params":{"target":"y"}}
테스트 표 0행     -> {"code":"TARGET_NOT_NUMERIC","params":{"target":"y"}}   (HEAD)
분류(같은 입력)   -> {"code":"TEST_DATASET_NO_USABLE_ROWS"}                   (HEAD)
```

`0.22.0`의 `plan.ts`를 `git show`로 꺼내 같은 입력을 나란히 돌렸다. **회귀에서만 갈린다** —
분류는 요구 kind가 `categorical`이라 빈 배열이 우연히 통과한다.

**같은 병의 이웃 — 한 군데 더, 그리고 그것은 이 델타 이전부터다.** `plan.ts:195`의 정본
타깃 검사도 같은 `detectKind([])`를 지난다. 정본의 타깃 열이 **전부 공백**인 회귀 프로젝트는
0.22.0에서도 `TARGET_NOT_NUMERIC`이라고 말한다(재 봤다 — 12행 전부 타깃 공백 · `holdout`
→ `TARGET_NOT_NUMERIC`). 뿌리는 **`detectKind`가 "빈 것"과 "범주"를 한 값으로 돌려주는
것**이고, `detectKind` 호출 자리는 소스에 넷이다(`columns.ts:122` · `plan.ts:195` ·
`plan.ts:213` · `preprocess.ts:311`). 앞의 둘은 값이 있을 때만 부르거나 빈 열을 따로
거절한다(`FEATURE_ALL_MISSING`).

**처방 (실측함).** V-1 문에 길이 조건을 붙인다:

```ts
if (required && testFromProvided && (providedTestRows?.length ?? 0) > 0) {
```

이 상태에서 `plan-not-number.spec.ts` 12 통과 + 위 재현 스펙(`TEST_DATASET_NO_USABLE_ROWS`
기대) 통과 = **13/13**. 빈 테스트 표는 그대로 `providedSplit`까지 흘러가 원래 사유로 선다.
`plan.ts:195` 이웃은 이 델타 밖이다 — 고칠지는 코드 소유자가 정한다(고치면
`SPLIT_TOO_FEW_ROWS`나 `TARGET_NOT_SELECTED` 중 무엇이 맞는지가 결정이다).

**등급 B로 둔 이유.** 숫자가 아니라 **안내가** 틀린다. 그러나 0.22.0에서 옳던 것이
틀려졌으므로, A로 올릴지는 코드 소유자의 몫이다.

---

### B-2. 결정문이 *"교사는 열 이름과 값을 읽는다"*고 적었는데, **점검 화면은 코드만 저장하고 파라미터를 버린다** — 문장이 `(: )`로 끝난다

**자리** `frontend/src/views/inspect/ReproducePanel.vue:93` (`Map<string, ClientErrorCode>`) ·
`:312` (`error.code`만 앉힌다) · `:486` (`t(errorMessageKey(failure))` — 파라미터 없음).
같은 모양이 `:409`와 `views/InspectView.vue:544`에도 있다.

**주장.** 결정문 *"채점하는 행렬은 학습 전에 거절한다"*의 재실행 항목이 예외를 안 두는
근거로 *"던지는 사유가 열 이름과 값을 짚으므로 교사는 왜 그 숫자를 못 믿는지까지 읽는다"*를
들었다. **코드는 그렇지 않다.** 워커 경계는 파라미터를 온전히 넘긴다
(`worker/handler.ts:62` → `worker/client.ts:169`, `ClientError(code, params)`로 다시
만든다). **버리는 것은 화면이다** — `failures`가 코드만 담는 맵이고, `t()`를 파라미터 없이
부른다.

**재현** (앱의 `i18n` 인스턴스로 그대로 렌더):

```
ko  FEATURE_NOT_NUMBER  파라미터 없음 → "…이 특성의 선택을 해제해 주세요. (: )"
ko  FEATURE_NOT_NUMBER  파라미터 있음 → "…해제해 주세요. (점수: 1,650)"
ko  TARGET_NOT_NUMERIC  파라미터 없음 → "…다른 열을 타깃으로 선택해 주세요. ()"
en  FEATURE_NOT_NUMBER  파라미터 없음 → "… in the preprocess step. (: )"
```

**같은 병의 이웃 — 셋, 전부 점검 화면이다.** `errorMessageKey(` 호출 아홉 중 파라미터를 안
넘기는 것이 `ReproducePanel.vue:409` · `:486` · `InspectView.vue:544` 셋이고, 나머지
다섯(`AnswerList` · `BatchPredict` · `TabularPrepSummary` · `ExperimentDetail` ·
`RunDetail`)은 넘긴다. **이 델타 이전부터 있던 모양**이지만, 이 델타의 결정문이 **그
화면이 파라미터를 보여 준다는 것을 근거로 삼았다.** 그래서 B — *"결정문과 부딪힌다"*.

**처방 (실측 안 함 — 화면 코드라 소유자 몫).** `failures`를 `Map<string, { code, params }>`로
바꾸고 `t(errorMessageKey(code), params)`로 부른다. `:409`의 `reproduction.failure`는
`Reproduction` 타입에 `params`가 있는지부터 봐야 한다 — 안 봤다(§4).

---

### B-3. `plan-not-number.spec.ts`의 픽스처가 **두 갈래를 원리적으로 안 지난다** — 범주 특성 가드와 열 번호 조회

**자리** `frontend/tests/plan-not-number.spec.ts:22-34` (픽스처) · `:131-136` ("범주 열의
글자는 안 막는다").

**주장 ①.** *"범주 열의 글자는 안 막는다 — 수치 열만 본다"*가 글자를 넣는 자리는
`table.rows[1][1]` = **타깃 열 `등급`**이다. 타깃은 `preprocessor.columns`에 **애초에
없다**(특성만 적합한다). 그래서 `unreadableNumericCell`의
`if (column.kind !== 'numeric') continue`를 **지워도** 이 스펙은 초록이다 — 검사가 말하는
것("범주 특성은 안 본다")과 검사가 지나는 길("타깃은 안 본다")이 다르다.
**돌연변이 M9: 조용 (12/12 통과).**

**주장 ②.** 픽스처의 수치 특성이 **언제나 0번 열**이다. `dataset.rows[row]?.[index]`를
`[0]`으로 바꿔도 초록이다. **돌연변이 M14: 조용 (12/12 통과).**

**처방 (둘 다 실측함).**

- ① 특성에 범주 열을 하나 더 넣고(`features: ['점수', '동아리']`), 테스트 표의 그 열에 처음
  보는 글자를 둔 뒤 `ok: true`를 기대한다. **M9 상태에서 운다**(1 failed).
- ② 수치 특성을 **둘째 열**에 둔 픽스처로 (a) 깨끗하면 통과, (b) `1,650`이 있으면
  `params`가 `{ feature: '점수', value: '1,650' }`인지까지 본다. **M14 상태에서 둘 다
  운다**(2 failed).

**내 첫 처방은 안 물었다.** ②를 처음에는 (b)만, 그것도 코드만 보게 썼다. M14 상태에서
0번 열의 `'가'`가 `toNumber`에 걸려 **어차피 `FEATURE_NOT_NUMBER`를 던지므로** 초록이었다 —
우는 이유가 겨냥한 것과 달랐다. `toEqual(params)`와 "깨끗하면 통과"를 더해서야 물었다.
요청서 §3이 말한 그 모양이다.

---

### C-1. 정규식은 잘 서 있다. 다만 **`0,123`은 푼다** — 결정문의 "애매하면 안 건드린다"와 어긋나는 한 칸

**자리** `frontend/src/data/serialize.ts:28` (`THOUSANDS_GROUPED`).

**전수로 찔렀다** — 31개. 전부 멱등(`canonicalCell(canonicalCell(x)) === canonicalCell(x)`).

| 입력 | 결과 | 판정 |
|---|---|---|
| `1,650` · `1,234,567` · `-1,650` · `+1,650` · `1,650.5` · `1,650.50` · `12,345` · `123,456` · `1,000,000,000,000` | 푼다 | 맞다 |
| `--1,650` · `+-1,650` · `1,234,56` · `1,650.` · `1,650.5.5` · `1,650e3` · `1 650` · `.5` · `1,65` · `1234,567` | 안 푼다 | 맞다 |
| `１,６５０`(전각) · `١,٦٥٠`(아라비아-인도) | 안 푼다 | 맞다 — `u` 플래그 없이 `\d`는 ASCII만 |
| ` 1,650 ` · `　1,650` · `1,650\n` · `1,650\r\n` · `1,650 ` | `1650` | `trim()`이 유니코드 공백·줄바꿈을 다 벗긴다 |
| `1,650원` · `₩1,650` · `1,650%` · `(1,650)` | 안 푼다 | 맞다 |
| **`0,123`** → `0123` · **`00,123`** → `00123` · **`-0,000`** → `-0000` | **푼다** | **어긋난다** |

`0,123`은 천 단위 묶음으로는 안 쓰는 모양이다(123을 `0,123`이라 적지 않는다). 반대로
유럽식 소수라면 `0,123`은 흔하다. 결정문은 *"묶음이 셋이 아니면 유럽식 소수점일 수 있고
애매하면 안 건드린다"*를 규칙으로 세웠는데 **첫 묶음이 `0`인 경우는 그 규칙보다 더 애매한데
푼다.** 처방: 첫 묶음을 `(?:0|[1-9]\d{0,2})`로 좁힌다 — **실측 안 했다**(정규식 한 자리라
스펙 갱신과 함께 소유자가 하는 것이 맞다).

**유럽 CSV가 닿는 길은 있다.** 요청서 §2.2 마지막 물음의 답이다. `parseCsvText`가 구분자를
**추정**하므로(`csv.ts:4`), 세미콜론 CSV는 그대로 열린다:

```
입력  "점수;등급\n1,650;가\n2,500;나\n0,125;가\n"
격자  [["점수","등급"],["1650","가"],["2500","나"],["0125","가"]]
판정  detectKind = numeric        ← 0,125(=0.125)가 125가 됐다. 실패도 경고도 없다
```

**결정문이 받아들인 대가다**(*"이 도구의 대상은 한국 학교다"*). 뒤집자는 것이 아니다.
다만 **"한국어 로케일이라 모호하지 않다"는 어느 코드도 강제하지 않는다**는 것이 답이고,
0.22.0에서는 같은 파일이 **범주로 보여서 눈에 띄었다면** 지금은 **수치로 보여서 안 띈다.**
§4에 "안 쟀다"로 함께 적었다.

---

### C-2. `MAX_ERROR_VALUE_LENGTH` 자르기가 **서로게이트 쌍을 가른다**

**자리** `frontend/src/ml/preprocess.ts:255` (`cell.slice(0, MAX_ERROR_VALUE_LENGTH)`).

`'a' + '😀'.repeat(30)` → 길이 40 · `isWellFormed() === false` · 마지막 코드 `d83d`(홀로
남은 상위 서로게이트). 화면에는 `�`로 뜬다. 짝수 위치에서만 안 갈리므로 `'😀'.repeat(30)`은
멀쩡하다(40이 짝수라). **닿으려면 40번째 UTF-16 자리에 이모지가 걸쳐야 한다** — 드물다.

**이웃 셋** — 같은 `slice(0, MAX_…)`가 `errors.ts:524` · `experiment.ts:732`에도 있고,
`format.ts:1098`은 **`[...joined].slice`로 코드 포인트 단위**라 이 병이 없다. 처방은 그
모양을 따르는 것이다: `[...cell].slice(0, N).join('')`. 실측 안 함.

---

### C-3. `canonicalCell`이 **통과하는 칸만 `trim()`한다** — 같은 열의 두 칸이 다른 대접을 받는다

`'  150  '` → `'  150  '` · `'  1,650  '` → `'1650'`. 요청서가 물은 그대로다.

**해가 되는 자리는 못 찾았다.** `toNumber`·`detectKind`·`targetValues`가 전부 `trim()`을
하므로 학습·판정에는 안 닿고, 범주 목록(`fitPreprocessor`의 `present`)은 **트림을 안 하지만**
푼 칸은 정의상 수치라 범주에 안 들어간다. CSV 경로는 papaparse가 공백을 보존하고, xlsx
경로는 `cellToString`이 그대로 넘기므로 **공백 든 칸은 실재한다.** 정본 바이트에 공백이
남는 것은 0.22.0과 같다. **의도인지는 주석이 안 말한다** — 함수 머리에 한 줄이면 된다.
돌연변이 M2(`+`→`*`)가 조용한 것이 이 자리다: 그 돌연변이가 바꾸는 것은 정확히 "묶음 없는
수도 트림한다"이고, 그것을 보는 스펙이 없다.

---

### C-4. `table-thousands.spec.ts`의 "안 푸는 것" 열하나는 **첫 묶음이 길어지는 방향을 못 본다**

**돌연변이 M1** `\d{1,3}` → `\d{1,4}`: **조용** (23/23). `1234,567`이 `1234567`이 되는데
아무 항목도 그 모양이 아니다. `안푼다` 목록에 `'1234,567'` 하나를 더하면 **M1 상태에서
운다**(실측함). 나머지 방향(`{3}`→`{2,3}` · 부호 제거 · 소수부 · 머리글 · 입구 우회)은
전부 운다(§3).

---

## 2. 요청서 §2 항목별 답 — 본체 셋

### 2.1 거절의 폭 (`FEATURE_NOT_NUMBER`)

| 물음 | 답 | 근거 |
|---|---|---|
| 군집 | **안 걸린다.** `split.testIndices`가 `[]`라 루프가 0회 | `plan.ts:291` 소스 + M20 돌연변이가 `rows.slice(0,1)`로도 우는 것에서 루프 형태 확인 |
| `recordedSplit`(재실행) | **걸린다. 통째로 죽는다** — 결정문대로다. 그런데 교사가 보는 문장은 **`(: )`로 끝난다** | **B-2** |
| 뽑기(`nSamples`) | 시험 몫은 **뽑힌 행을 나눈 것**이다(`sampleRows` → `splitRows`). `provided`면 뽑기는 훈련 표에만 닿고 시험 몫은 `providedTestRows` 전체. 문은 그 결과 인덱스를 그대로 받는다 | `plan.ts:275-296` 소스. **실측 안 함** |
| `provided`인데 `testDataset === null` | `testFromProvided`가 거짓 → `providedTestRows` `undefined` → `providedSplit`이 **`TEST_DATASET_NO_USABLE_ROWS`로 먼저 던진다**(`split.ts:255`). 문까지 안 온다. `recordedSplit`이 있으면 `plan.ts:262`가 같은 코드로 먼저 던진다 | 소스 |
| **비용** | **20,000행 × 수치 5열 · 시험 5,000행: 문 2.8~3.6ms / `planRun` 전체 30.6~35.6ms / `fitPreprocessor` 17.5~22.7ms** (5회). **500행 × 1,280열(임베딩 모양): 문 19~26ms / `planRun` 128~189ms** (3회). 부하 중 기기 | 임시 스펙, `performance.now()` |

**비용은 문제가 아니다.** 요청서의 추론(*"`fitPreprocessor`가 이미 훈련 행을 훑으므로 비율로
작다"*)이 맞다 — 문은 `planRun`의 **약 10%**, 넓은 표에서 **약 15%**다.

### 2.2 정본 고쳐 쓰기 (`canonicalCell`)

- 정규식 전수 · 멱등 · 트림 비대칭 · 유럽 CSV — **C-1 · C-3**.
- **왕복 무손실은 안 깨진다.** 푼 칸에는 쉼표가 없고, 안 푼 칸은 원본 그대로 `quoteField`를
  지난다. 멱등이 31/31이라 `canonicalGrid`를 두 번 지나도 같다.
- **입구는 셋뿐인가 — 셋뿐이다.** `importTable(`을 부르는 자리는 `TabularPanel.vue:200` ·
  `TabularPrepPanel.vue:512` · `BatchPredict.vue:150` 셋이고, `dataset.ts:225`·`:312`가
  받는 `imported.grid`는 **`importTable`이 `canonicalGrid`를 지난 뒤의 격자**다
  (`table.ts:188-190`, `grid`가 `bytes`와 `ImportedTable` 둘 다의 출처). `readDataset` 셋은
  저장 바이트를 `parseCsvText`로만 읽는다 — 결정문의 *"옛 파일은 손도 안 탄다"*가 맞다.
- **손으로 치는 예측 칸은 이 규칙을 안 지난다.** `predict.ts:142`가 `readsAsNumber`로
  `1,650`을 거절한다. `type="number"` 입력이라 브라우저가 먼저 막는다고 주석이 말한다
  (`predict.ts:133`) — **안 열어 봤다**(§4). 갈림이 실재해도 방향이 "파일은 받고 손은
  거절"이라 조용히 틀리지는 않는다.

### 2.3 배포 관문 (`gate.yml`) — 정적으로만 읽었다

**틀릴 수 있는 자리를 못 찾았다.** 본 것:

- **권한.** `deploy.yml`이 `contents: read · pages: write · id-token: write`를 워크플로
  수준에 선언하고, `gate.yml`은 선언이 없다. 재사용 워크플로는 부르는 잡의 권한을
  물려받고 올릴 수 없다 — 0.22.0의 `deploy.yml`도 **같은 셋으로 같은 두 액션**
  (`upload-pages-artifact@v5` · `deploy-pages@v5`)을 한 워크플로 안에서 돌렸고 그것이 실제로
  나갔다. 달라진 것은 **잡이 재사용 워크플로 안으로 들어간 것**뿐이다.
- **아티팩트 이름.** 올리는 쪽·받는 쪽 둘 다 기본값(`github-pages`)이고, 같은 run 안이라
  보인다.
- **`if: inputs.pages`.** 불리언 입력, `ci.yml`은 `with` 없이 불러 기본 `false`.
  `defaults.run.working-directory`는 `uses` 단계에 안 걸리므로 `path: frontend/dist`가 맞다.
- **`needs: gate`.** 재사용 워크플로의 잡 셋이 전부 끝나야 `deploy`가 뜬다. 옛
  `build` 잡의 `concurrency: pages-build-…`는 사라졌다 — 두 번 디스패치하면 관문이 두 번
  돌고 `deploy`만 직렬이다. 해는 없다.
- **결정문 #10 넷째 항목**은 취소선으로 옛 문장을 남기고 `gate.yml` 합침을 적었다
  (`open-decisions.md:97-112`). 워크플로와 맞는다.

**돌려 보지 않았고, 돌려 볼 수 없다.** 첫 배포가 곧 검증이다. 실패하면 `deploy` 잡이
아티팩트를 못 찾는 모양일 것이고, 그때 볼 자리는 `gate.yml:105`의 조건이다.

---

## 3. 돌연변이 표 전체 — **운 것까지**

방법: 한 곳을 뭉개고 → 지정 스펙만 `npx vitest run` → 원본 바이트로 되돌리고 `git diff
--quiet` 확인. 돌연변이당 한 번. `vue-tsc`는 안 돌렸다(전부 타입이 같은 치환이다).

| # | 파일 | 무엇을 | 스펙 | 결과 | 기대 | 뜻 |
|---|---|---|---|---|---|---|
| M1 | `serialize.ts` | `\d{1,3}` → `\d{1,4}` | table-thousands | **조용** 23/23 | 조용 | **C-4**. 처방(`'1234,567'` 추가) → **욺** |
| M2 | `serialize.ts` | `(?:,\d{3})+` → `*` | table-thousands | **조용** 23/23 | 조용 | 바꾸는 것이 "묶음 없는 수도 트림"뿐 — **C-3**. 처방(`'  150  '` 보존) → **욺** |
| M3 | `serialize.ts` | `\d{3}` → `\d{2,3}` | table-thousands | 욺 2 failed | 욺 | `1,65`·`12,34`가 문다 |
| M4 | `serialize.ts` | `[+-]?` 제거 | table-thousands | 욺 2 failed | 욺 | |
| M5 | `serialize.ts` | 결과를 `cell`로(트림 안 함) | table-thousands | 욺 1 failed | 욺 | `'  1,650  '` 하나가 문다 |
| M15 | `serialize.ts` | `canonicalGrid`가 0행을 건너뜀 | table-thousands | 욺 2 failed | 욺 | 머리글 검사 둘 |
| M6 | `table.ts` | `canonicalGrid(raw)` → 복사만 | table-thousands | 욺 3 failed | 욺 | 진짜 입구 셋 |
| M7 | `plan.ts` | 문이 항상 `dataset`을 봄 | plan-not-number | 욺 5 failed | 욺 | |
| M8 | `plan.ts` | 문이 `trainIndices`를 봄 | plan-not-number | 욺 1 failed | 욺 | **홀드아웃 검사 하나만** 문다 — `provided` 넷은 훈련 번호 0..11이 4행짜리 테스트 표에 그대로 닿아 통과 |
| M11 | `plan.ts` | V-1 문이 `[]`를 봄 | plan-not-number | 욺 1 failed | 욺 | |
| M18 | `plan.ts` | V-1 문이 정본 타깃을 봄 | plan-not-number | 욺 1 failed | 욺 | |
| M22 | `plan.ts` | `feature`↔`value` 바꿈 | plan-not-number | 욺 4 failed | 욺 | `toEqual(params)` 셋 + 길이 하나 |
| M9 | `preprocess.ts` | `kind !== 'numeric'` 가드 제거 | plan-not-number | **조용** 12/12 | 욺 | **B-3 ①**. 처방 → **욺** |
| M10 | `preprocess.ts` | `isMissing` 건너뛰기 제거 | plan-not-number | 욺 1 failed | 욺 | |
| M13 | `preprocess.ts` | 문이 쉼표를 지우고 읽음 | plan-not-number | 욺 2 failed | 욺 | `1,650` 둘 |
| M14 | `preprocess.ts` | `[index]` → `[0]` | plan-not-number | **조용** 12/12 | 조용 | **B-3 ②**. 첫 처방 **조용** → 고친 처방 **욺** 2 failed |
| M20 | `preprocess.ts` | 첫 시험 행만 봄 | plan-not-number | 욺 5 failed | 욺 | |
| M23 | `limits.ts` | `40` → `41` | plan-not-number | **조용** 12/12 | 조용 | 검사가 상수를 읽는다 — 저장소 관행 |
| RXD | `plan.ts` | **B-1 처방** 적용 | plan-not-number + 재현 스펙 | 13/13 통과 | 고침 확인 | |

**욺 13 · 조용 6**(M1 · M2 · M9 · M14 · M23 · RXD). 코드 소유자가 이미 심은 넷(문 끄기 ·
V-1 가드 · V-2 가드 · `?? 0` → `?? 999`)은 안 되풀이했다.

**M8이 하나만 무는 것은 그 자체로 정보다.** `provided` 픽스처가 4행이라 훈련 번호가 시험
표 안에 들어간다. 시험 표를 훈련보다 **작게** 두는 한 `trainIndices`/`testIndices`를 바꿔
끼우는 실수는 홀드아웃 검사 하나에 매달린다.

---

## 4. 못 한 것 · 안 쟀다 · 안 읽었다

- **배포 경로를 돌리지 않았다** (§2.3). 정적 읽기뿐이다.
- **점검 화면을 눈으로 안 봤다.** B-2는 `i18n` 인스턴스에 같은 키를 넣어 렌더한 문자열이지
  화면 스크린샷이 아니다. `ReproducePanel.vue:409`의 `reproduction.failure`에 `params`가
  실리는지(`Reproduction` 타입) **안 읽었다.**
- **손 입력 예측 칸이 `1,650`을 브라우저 단계에서 막는지** 안 열어 봤다(`predict.ts:133`
  주석만 읽었다).
- **뽑기(`nSamples`)를 켠 상태의 시험 몫**은 소스로만 봤다. 실측 없음.
- **C-1의 처방(`(?:0|[1-9]\d{0,2})`)과 C-2의 처방(`[...cell].slice`)**은 실측 안 했다.
- **유럽 CSV가 0.22.0에서 어떻게 보였는지**(범주로 판정되어 눈에 띄었을 것이라는 문장)는
  추론이다. 그때의 화면을 안 봤다.
- **`canonicalGrid`의 메모리** — `raw`와 `grid` 두 벌이 잠깐 산다. 20,000행에서 안 쟀다.
- **`tests/serialize.spec.ts`의 왕복 검사가 `canonicalGrid`를 지난 격자로 도는지** 안
  열어 봤다. 멱등이 31/31이라 결론은 같지만 그 스펙이 무엇을 재는지는 안 확인했다.
- **vitest가 `console.log`를 삼킨다.** 임시 스펙의 출력이 안 나와 파일로 썼다. 설정에서
  이유를 안 찾았다 — 감사 대상이 아니다.
- R36 B-1(최빈값 동점)은 이 델타가 **안 건드렸다** — `FILL_BY_STRATEGY`에 diff가 없다.

---

## 5. `0.23.0` 태그에 대한 한 줄

**요청서가 틀리게 알고 있다 — 태그가 없다.** `git tag -l "0.2*"`는 `0.22.0`까지이고,
`git ls-remote --tags origin`에도 `0.22.0`(`d94ae79`)뿐이다. 빨간 커밋(`65570e7`)을
가리키는 태그는 **로컬에도 원격에도 남아 있지 않다.** 요청서 §0·§6·§7의 "빨간 커밋을
가리키는 태그"는 이미 지워진 뒤의 문장이거나, 감사자가 볼 수 없는 자리에 있다.

---

## 6. 배포해도 되는가

**된다. B-1 한 줄을 먼저 넣는 것이 맞고(처방 실측 13/13), 안 넣고 나가면 0.22.0보다 나빠지는
자리는 그 하나뿐이다.**
