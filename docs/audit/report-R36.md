# R36 감사 보고서 — `ml/` 최상위와 워커를 표기가 아니라 실물로 셌다

> 요청서 `docs/audit/request-R36.md` · 앞 라운드 `report-R35.md` · 지도 `map-2026-09-21.md`
>
> **HEAD `c2847a1`**(`0.22.0`). 작업 트리는 시작할 때 깨끗했고 끝날 때도 깨끗하다.
> 기준선 `npx vitest run --testTimeout=60000` — **174파일 · 3,575 통과 · 3 건너뜀 · 148.1초**
> (빨간 것 없음, 재시도 없음).
> 심은 것은 전부 즉시 되돌렸다(원본 바이트 대조, `tools/mutate.mjs`와 같은 방식).
> **소스에 남은 것은 없다.** 임시 스펙 하나를 심었다가 지웠다(§1 A-1의 재현).

---

## 0. 요약 — 뿌리 하나

세 표를 채우고 나니 같은 모양이 세 번 나왔다.

> **그물은 "값이 들어가는 자리"에만 있고, "축이 넓어지는 것"과 "그 문을 안 지나는 다른 길"에는 없다.**

- 예측의 문(`PREDICTION_INPUT_NOT_NUMBER`, 커밋 `79183f1`)은 **경계가 정확하다.** 그런데
  그 문이 막으려던 `?? 0`에는 **문을 안 지나는 길이 둘** 더 있고, 그쪽은 학생이 보는
  **점수**를 조용히 바꾼다 — A-1.
- 등록부는 **항목이 사라지는 것**과 **실행 방법 축**은 문다. **과제 유형 축을 넓히는 것**은
  아홉 중 여섯이 조용하다 — B-2.
- 지표 판 등록부 여섯 중 **셋은 항목을 통째로 지워도** 조용하다 — B-3.
- 워커도 같다. **성공 경로의 여섯 종류는 이어져 있고**, 죽는 길 여섯과 교정 경로 넷은
  **전부 조용하다** — B-4 · C-5.

**돌연변이 110개 — 욺 66 · 조용 44.** 좁힌 스펙 목록에서 조용했던 45개를 **묶어 스위트
전체로 다시 쟀고**(묶음 열다섯), **하나가 뒤집혔다**(§3.5).

**관문을 끝에 통째로 돌렸다** — `npm run ci` **초록**(174파일 · 3,575 통과 · 3 건너뜀 ·
`build`까지). 작업 트리에 남은 것은 이 보고서 파일 하나다.

**등급** — **A 1 · B 5 · C 8.**

**부채 목록 하나는 적힌 것보다 가볍다** — 요청서 §4의 `metrics.ts:158`(`r2`가 `Infinity`)은
`evaluate`가 나가는 길에서 이미 던진다. 재 봤다(§5의 ④⑤).

---

## 1. 지적

### A-1. 예측의 문을 우회해 `?? 0`에 닿는 길이 둘 있다 — **채점하는 행렬이 조용히 0이 된다**

**자리** `frontend/src/ml/preprocess.ts:475–477` (주석과 코드) · `frontend/src/ml/experiment.ts:798`

**주장.** 2026-09-19의 `79183f1`은 *"숫자로 못 읽는 예측 입력을 조용히 0으로 떨어뜨리지
않는다"*를 **`inputVector` 안에만** 세웠다. 그런데 `transform`을 부르는 자리는 그것 말고도
있고, **학습 경로가 그 문을 안 지난다.**

```ts
// preprocess.ts:475–477
// 대체값이 없는데(drop 전략) 결측이면 0으로 둔다. usableRows가 이미
// 그런 행을 버렸으므로 여기 오는 것은 예측 입력뿐이다.
const raw = typeof filled === 'number' ? filled : (toNumber(String(filled)) ?? 0)
```

**이 주석의 단정이 둘 다 틀렸다.**

1. `usableRows`(:230–247)가 버리는 것은 **빈 칸**(`isMissing`)뿐이다. `1,650`·`없음`·`N/A`
   처럼 **값은 있는데 수로 못 읽는 칸**은 한 줄도 안 본다.
2. *"여기 오는 것은 예측 입력뿐"*이 아니다. `experiment.ts:798`이 **시험 몫**을 같은 함수에
   태운다:

```ts
testFeatures: transform(preprocessor, testSource, split.testIndices, categoricalEncoding),
```

**닿는 길 둘.**

- **따로 올린 테스트 표**(`split.method === 'provided'`). 받는 문은 `alignTestDataset`
  (`data/columns.ts:147–166`)인데 **열 이름만 대조한다** — 값이 수로 읽히는지는 아무도 안 본다.
- **한 파일 홀드아웃.** `detectKind`는 `fitPreprocessor`가 **훈련 행만** 뽑아 부른다
  (`preprocess.ts:269`, `cells = trainIndices.map(...)`). 그래서 훈련 몫에 없고 **시험 몫에만**
  있는 글자는 열 판정에 안 들어가고, 그 열은 계속 `numeric`이며 그 칸만 `0`이 된다.

**재현.** 임시 스펙(`tests/zz-r36-probe.spec.ts`, 심고 지웠다) — 실측값은 §5.

**잃는 것.** 학생이 보는 정확도·R²·혼동 행렬이 **오염된 시험 행렬**에서 나온다. 실패도
경고도 없고, **그 숫자가 포트폴리오에 적혀 제출된다.** 예측 칸 하나가 틀리는 것과 달리
여기서 틀리는 것은 *"이 모델이 제일 좋다"*는 판단 자체다.

**처방(실측 전).** 판정 규칙을 한 벌로 둔 것(`readsAsNumber`)은 이미 있으니 문을 하나 더
세우는 것이 아니라 **`transform`이 수치 열에서 못 읽는 값을 만나면 서게** 하는 쪽이 맞다 —
`?? 0`을 지우고 `ClientError`를 던지면 `inputVector` 경로는 오늘처럼 그 행만 실패하고
(`predictPage`가 이미 행 단위로 잡는다), 학습 경로는 `planRun`이 삼켜 카드가 사유로 말한다.
**다만 학습 경로에서 무엇을 말할지는 결정이 걸린다** — 그 행을 버릴지(`drop`처럼), 통째로
거절할지(`FEATURE_HAS_MISSING`처럼). 그래서 **고침은 코드 소유자의 결정 뒤**다.

**무는 검사** — 없다. `?? 0`을 `?? 999`로 바꿔도(§3.3의 `G-FILL-ZERO`) **스위트 174파일이
전부 초록이다**(§3.5의 `preprocess.ts-1`, 147.1초). **세울 수 있는가** — 있다. §5의 프로브
①~③이 그대로 스펙이다.

---

### B-1. 최빈값 동점 규칙이 sklearn과 갈리고, **저장소 안에서도 두 벌이다**

**자리** `frontend/src/ml/preprocess.ts:122` (`mostFrequent` 헬퍼) 대
`frontend/src/ml/models/reference.ts:160` (KNN 득표) · `frontend/src/ml/engines/mljs.ts:394`

```ts
// preprocess.ts:122 — 결측 대체값
// 동점이면 먼저 나온 값이 이긴다. Map이 삽입 순서를 지키므로 결정적이다.
if (count > bestCount) { best = value; bestCount = count }
```

```ts
// reference.ts:160 — KNN 득표
// 득표 동점은 정렬 순서가 앞선 클래스 - sklearn과 같은 답이다 (mlpx-spec.md 5.6).
if (count > bestCount || (count === bestCount && best !== undefined && label < best)) { … }
```

**같은 계산("가장 자주 나온 값을 고르고 동점을 가른다")이 두 규칙을 쓴다.** 그리고 한쪽은
*"sklearn과 같은 답"*이라고 적혀 있다.

**sklearn을 돌렸다** (`uv run --project backend python`, scikit-learn **1.9.1**):

```
from sklearn.impute import SimpleImputer
X  = [[70],[40],[70],[40],[nan]]          -> statistics_ = [40.]
Xs = [['b'],['a'],['b'],['a'],[None]]     -> statistics_ = ['a']
```

**저쪽은 동점에서 작은 값이 이긴다.** 우리 대체값은 `70`·`'b'`를 고른다 — `preprocess.spec.ts`
의 *"최빈값이 동점이면 먼저 나온 값이 이긴다"*가 `서울`(먼저 나온 값)을 못 박고 있고, 그
검사의 근거는 *"어느 쪽이든 정해져 있어야 같은 파일이 같은 답을 낸다"*뿐이다 — **sklearn을
본 흔적이 없다.**

**잃는 것.** 결측이 있는 범주 열에서 우리와 sklearn의 채움값이 갈리고, 그 아래의 모든
지표가 함께 갈린다. `CLAUDE.md` §2가 *"이 도구는 scikit-learn으로 가는 발판"*이라고 적은
그 자리다. R30이 KNN에서 같은 병을 이미 한 번 맞췄는데 **바로 옆의 임퓨터는 안 봤다.**

**등급이 B인 이유** — 바꾸면 **이미 나간 `.mlpx`의 채움값이 달라진다.** 값을 뒤집을지
(그리고 `preprocess.spec.ts`의 그 검사와 소스 주석을 함께 고칠지)는 코드 소유자의 결정이다.

**무는 검사** — 있다(`preprocess.spec.ts`의 그 한 줄). 다만 **무는 것이 "sklearn과 같은가"가
아니라 "우리가 정한 규칙 그대로인가"다.** **세울 수 있는가** — 있다. `generate_sklearn_fixtures.py`
가 이미 sklearn을 돌리므로 `SimpleImputer`의 `statistics_`를 픽스처로 뽑아 대조하면 된다.

---

### B-2. 알고리즘 등록부의 **과제 유형 축은 넓혀도 아무도 안 운다** (아홉 중 여섯)

**자리** `frontend/src/ml/algorithms.ts:132`의 `ALGORITHMS` — 각 항목의 `taskTypes`

**재현.** 항목마다 꺼진 칸 하나를 켜고(예: `knn`에 `regression: true`) 좁힌 스펙 열여섯을
돌린 뒤, 조용했던 여섯을 **한꺼번에 심어 스위트 전체**로 다시 쟀다 — **96.7초, 조용**(§3.5).

**우는 셋도 축을 세서 우는 것이 아니다.** `ALG-T-decision_tree`를 따로 심어 보니 무는 것은
`algorithms.spec.ts:190`의 *"회귀를 고르면 회귀 모델이 열리고 분류 모델이 잠긴다"*와
`experiment.spec.ts`의 *"분류 전용 모델을 회귀에 고르면 학습하지 않는다"* 셋인데, **넷 다
`decision_tree`라는 이름을 박아 둔 검사다.** 대표 하나를 골라 둔 자리이지 축을 세는 자리가
아니다 — 그래서 나머지 여덟은 같은 일을 해도 조용하다.

**잃는 것.** 이 축은 **화면이 무엇을 열어 줄지**를 정한다(`algorithmOptions`). 넓히면
`enabledAlgorithms`가 그 조합을 열고, **엔진은 거절하지 않는다** — `mljs.ts:718`의 `knn`은
`taskType`을 아예 안 본다. 회귀로 켠 KNN은 이웃 라벨을 다수결로 골라 문자열을 내고,
`evaluateRegression`이 그것을 `Number()`로 읽어 **그럴듯한 R²를 낸다.** 실패도 경고도 없다.
`k_means`를 회귀로 켜면 군집 번호가 예측값이 되어 같은 일이 난다.

`runtimes` 축은 아홉 중 아홉이 운다 — **같은 등록부의 두 축이 그물의 유무로 갈린다.**

**무는 검사** — `algorithms.spec.ts`의 등록부 검사 넷은 *"칸이 다 false인 줄이 없다"*만 보므로
**켜는 방향을 구조적으로 못 본다**(`some(...)`은 켤수록 참이다). **세울 수 있는가** — 있다.
*"(데이터 종류 × 과제 유형 × 알고리즘)의 열린 칸 목록이 이 표와 같다"*를 골든 표 하나로
못 박으면 양방향을 다 문다. `metric-panels.spec.ts`가 판에 대해 이미 그 모양으로 문다
(`toEqual(['confusion-matrix', 'per-class'])`).

---

### B-3. 지표 판 등록부 **여섯 중 셋은 항목을 지워도 조용하다**

**자리** `frontend/src/ml/metric-panels.ts:191`의 `METRIC_PANELS` — `parameters` · `loss-curve` ·
(부분적으로) `cluster-result`·`image-cluster-result`의 `taskTypes`

**재현.** 항목마다 셋을 심었다 — 데이터 종류 축 뒤집기 · 과제 유형 축 넓히기 · 항목 삭제
(§3.2). 조용했던 아홉은 **스위트 전체로 다시 재도 조용하다**(§3.5의 `metric-panels.ts-1·2·3`).

**왜 조용한가.** `metric-panels.spec.ts`의 픽스처는 둘뿐이다 — `classified`(혼동 행렬·범주별
점수만 담김)와 `clustered`(`model`만 담김). 그래서 `hasData`가 거짓인 판은 **축을 어떻게
흔들어도 목록에 안 뜬다.** `parameters`와 `loss-curve`는 `run.model?.format`을 보는데
`classified`에는 `model`이 없다 — **두 판은 어느 검사에서도 한 번도 서 본 적이 없다.**

**잃는 것.** `parameters`는 *"모델이 무엇을 배웠는지 화면이 보여준다"*가 낳은 판이고
`loss-curve`는 신경망이 낳은 판이다. 등록부 줄을 지우면 **둘 다 결과 화면에서 사라지는데
관문이 초록이다.** 지도 §1.2가 *"마운트 0"*으로 적은 것과 같은 자리이고, 이 라운드는
**마운트가 아니라 등록 항목 자체가 무검사**임을 보탠다.

**무는 검사** — 없다. **세울 수 있는가** — 있다. 픽스처에 `model.format`을 채운 run을
하나 더 두고 `metricPanelsFor('tabular','classification', …)`의 **전체 목록**을 `toEqual`로
못 박으면 항목 삭제·축 넓힘이 한꺼번에 걸린다. **화면 마운트는 R39의 몫이고 여기서는
등록부까지만이다.**

---

### B-4. **컴퓨트 워커가 죽는 길 여섯이 전부 무검사다** — R26이 세운 셋을 다시 떼도 초록이다

**자리** `frontend/src/ml/worker/pool.ts:63–80` (`askWorker`의 `onError`·`onMessageError`·`cleanup`)

**재현.** 여섯을 심었고 **여섯 다 조용하다**(§3.4의 `WP-*`, 그리고 스위트 전체로 다시
재도 조용하다 — §3.5의 `pool.ts-1·2·3`). 같은 스펙 목록에 심은
`WP-SPANS`(병렬을 통째로 끄기)는 **운다** — 그러니 목록이 안 도는 것이 아니라 **이 자리를
아무도 안 보는 것이다.**

특히 무거운 둘:

- `WP-ERR-GONE`·`WP-MSGERR-GONE` — 리스너를 통째로 뗀다. 그러면 워커가 죽거나 답이 복제에
  실패했을 때 **`askWorker`의 Promise가 영영 안 풀리고 학습이 멈춘 채로 남는다.**
  `messageerror`는 **2026-09-04 R26 B-6이 일부러 더한 셋째 길이다** — 그 고침을 되돌려도
  관문이 초록이다.
- `WP-ERR-RESOLVE` — 거절을 성공으로 바꾼다. 그러면 `undefined`가 재조립에 섞여
  `answer.results`에서 터지거나, 운이 나쁘면 **빈 답이 결과에 들어간다.**

**주석이 단정한다** — *"끝나는 길을 전부 듣는다 — 안 들리는 길이 하나라도 있으면 부르는
쪽이 영원히 기다린다."* 그 단정을 지키는 검사가 **0개다.**

**무는 검사** — 없다. **세울 수 있는가** — 있다. `tests/fixtures/compute-workers.ts`의
가짜 워커는 이미 손이 던지면 `error` 이벤트를 쏘고(진짜 경계다), `messageerror`만 못 쏜다 —
**쏘는 손잡이를 하나 더 달면 여섯 중 여섯이 닫힌다.** 가짜가 진짜보다 관대한 자리를
셋이나 조인 파일이라 **비용이 거의 없다.**

---

### B-5. **`done`이 모델을 하나도 안 실어 보내도 조용하다**

**자리** `frontend/src/ml/worker/handler.ts:58`

`emit({ type: 'done', experiment, preprocessor, models })`의 `models`를 `new Map()`으로
바꿔도 **아무도 안 운다**(§3.4의 `WH-DONE`, 스위트 전체로 다시 재도 조용하다 — §3.5의
`handler.ts-1`). 바로 윗줄의 `progress`에서 모델을 빼면
(`WH-PROGRESS`) **운다** — R26이 취소 경로 때문에 세운 그물이 거기 있기 때문이다.
**성공 경로에는 그 그물이 없다.**

**잃는 것.** 학습은 끝나고 지표도 나오는데 **모델 파일이 하나도 안 담긴다.** 그러면 예측
화면이 통째로 비고, `.mlpx`를 교사가 열어도 재학습 없이는 아무것도 못 한다 —
`CLAUDE.md` §1.3이 *"교사는 이 파일 하나만 열면 재학습 없이 모든 것을 볼 수 있어야 한다"*고
적은 바로 그 자리다.

**무는 검사** — 없다. **세울 수 있는가** — 있다. `worker.spec.ts`의
*"끝 보고가 방금 추가한 모델을 싣는다"*와 짝이 되는 한 줄 — *"`done`이 담긴 모델 전부를
싣는다"* — 이면 된다.

---

### C-1. `FILL_BY_STRATEGY.drop`은 **닿지 않는 항목**이고, 주석이 다른 이유를 댄다

**자리** `frontend/src/ml/preprocess.ts:142–144` 대 `:286`

```ts
// 여기까지 왔으면 빈 칸이 없다는 뜻이다 - missingColumns가 앞에서 거부했다.
none: () => '',
drop: () => '',
```

```ts
// :286 — 유일한 호출 자리
if (preprocessing.missing !== 'drop') {
  fitted.fill = FILL_BY_STRATEGY[preprocessing.missing](numbers, present, kind)
}
```

**`drop` 항목은 절대 안 불린다.** 그 이유는 *"빈 칸이 없어서"*가 아니라 **호출 자리가
`drop`을 명시적으로 건너뛰기 때문이다.** 주석은 위의 `none`에 대해서는 참이고
(`plan.ts:204`가 `missing === 'none'`일 때 `missingColumns`로 거부하며, `fitPreprocessor`의
호출자는 `plan.ts:278` 하나뿐이다 — 확인했다), **`drop`에 대해서는 이유가 틀렸다.**

**왜 남겨 두면 위험한가.** `Record<Preprocessing['missing'], …>`이 칸을 요구하므로 지울 수는
없는데, 누가 `:286`의 가드를 옮기는 날 이 줄이 **수치 열의 `fill`을 `''`로 채운다.** 그러면
`transform`이 `toNumber('') ?? 0`으로 **0을 채운다** — A-1과 같은 침묵이다.

**무는 검사** — 없다(무실행). **세울 수 있는가** — 있다. `drop` 칸을 `() => { throw … }`로
바꾸고 *"`drop`에서는 채움값을 구하지 않는다"*를 검사로 두면 가드가 사라지는 날 선다.

---

### C-2. `PARALLEL_WORKER_CAP`의 소비자는 **둘이 아니라 하나다** — 요청서와 지도가 표기를 셌다

**자리** `docs/audit/request-R36.md:139` · `docs/audit/map-2026-09-21.md:168` 대
`frontend/src/ml/worker/pool.ts:10·48`

요청서 §2.3은 *"`PARALLEL_WORKER_CAP`은 소비자가 둘이다 (`ml/worker/neural-pool.ts` ·
`ml/worker/pool.ts`)"*라고 적고 **R31 C-1 → R32 B-1의 모양(한 값을 두 소비자가 각자 기본값으로
덮는다)이 생길 자리**로 지목했다. **재 보니 소비자는 하나다.**

```
$ grep -rn PARALLEL_WORKER_CAP frontend/src
src/limits.ts:1610:  ... 실측한 무릎(워커 4, 아래 `PARALLEL_WORKER_CAP`)과   ← 주석
src/limits.ts:1632:export const PARALLEL_WORKER_CAP = 4
src/ml/worker/neural-pool.ts:45:  (`limits.ts`의 `PARALLEL_WORKER_CAP`), 하나는 …   ← 주석
src/ml/worker/pool.ts:10:import { PARALLEL_WORKER_CAP } from '../../limits'
src/ml/worker/pool.ts:48:  const count = Math.min(PARALLEL_WORKER_CAP, …)        ← 유일한 소비
```

`neural-pool.ts:45`는 **주석이다.** `poolWorkerCount`를 부를 뿐 상수를 임포트하지 않는다.
**이 라운드가 "표기가 아니라 실물로 세라"고 말하면서, 요청서 자신의 표가 표기를 셌다.**
나머지 여섯 상수는 재 보니 전부 소비자 하나씩이고 실물이다(§2.3).

**그리고 그 주석이 값을 복제한다** — `neural-pool.ts:45`가 *"상한(4)"*이라고 **숫자를 손으로
적는다.** `limits.ts`가 유일한 출처라는 규약(`CLAUDE.md` §1.5)의 정신과 부딪히고, 상수를
움직이면 그 줄이 조용히 거짓이 된다.

**무는 검사** — 없다. **세울 수 있는가** — 있다(주석 안의 숫자는 `limits-rules.spec.ts`가
이미 소스를 훑는 방식으로 잡을 수 있다). **다만 소급 적용은 하지 마라** — 같은 모양이
`27.3MB`에도 있다(C-3).

---

### C-3. `27.3MB`가 주석 **스물다섯 줄 · 열다섯 파일**에 손으로 적혀 있다

**자리** `grep -rn '27\.3' frontend/src | grep -v limits.ts` — **25줄 · 15파일**
(`ml/backend.ts` `ml/browser.ts` `ml/engines/{index,mljs,pyodide-runtime,pyodide-serialize,pyodide-sklearn}.ts`
`ml/{estimate,experiment,reproduce,training-status}.ts` `ml/worker/handler.ts`
`views/inspect/ReproducePanel.vue` `views/train/{ChosenModels,ModelAxes}.vue`).
출처는 `limits.ts:683`의 `PYODIDE_DOWNLOAD_BYTES = 27.3 * MB` 하나다.

**전부 주석이고 화면 문구는 상수를 쓴다** — 그래서 학생이 보는 숫자는 안 틀린다.
그래도 값이 바뀌면 **스물다섯 줄이 한꺼번에 거짓이 된다.** `CLAUDE.md`가 *"단정형 주석은 무는 검사를
이름으로 가리킨다 · 소급 적용하지 마라"*를 이미 갖고 있으므로 **지금 고칠 것이 아니라
다음에 그 파일을 만질 때 줄이는 자리다.** C로 둔다.

---

### C-4. `unavailableReason`의 **세 갈래가 전부 무검사다** — 학생이 읽는 사유를 고르는 자리

**자리** `frontend/src/ml/experiment.ts:309–328`

요청서 §3.3이 짚은 `:325`의 폴백만이 아니다. **셋 다 조용하다**(§3.3의 `EX-REASON-*`):

- `find` → `findLast` (폴백이 **첫째가 아니라 마지막**을 고른다) — 조용
- 폴백을 통째로 `'ALGORITHM_NOT_AVAILABLE_HERE'`로 — 조용
- `requested.reason !== 'ALGORITHM_NOT_AVAILABLE_HERE'` 조건 제거 — 조용

**잃는 것.** *"이 알고리즘을 여기서 왜 못 쓰는지"*가 여기서 정해진다. 주석이 적은 규약은
*"막다른 답(`여기선 실행할 수 없습니다`)은 건너뛰고 학생이 할 수 있는 일이 있는 사유를
준다"*인데, **그 규약을 지키는 검사가 없다.** 셋 중 어느 것이 깨져도 학생은 실패한 run
카드에서 *"여기선 실행할 수 없습니다"*만 보고 무엇을 하면 되는지 못 듣는다.

그리고 요청서가 물은 *"`find`가 첫째를 고르는데 그 순서가 `RUNTIMES`의 배열 순서다 —
그것이 의도인가"*의 답: **의도다.** `RUNTIMES`의 주석이 *"순서가 곧 기본값 우선순위다"*라고
적고 `chooseRuntime`도 같은 순서를 쓴다. **다만 그 의도를 지키는 검사가 없어서**,
등록부 순서를 바꾸면 학생이 다른 이유를 듣는데 아무도 모른다.

**무는 검사** — 없다(무실행). **세울 수 있는가** — 있다. `experiment.spec.ts`에 *"학생이
고른 실행 방법이 막다른 사유일 때 다른 실행 방법의 사유를 준다"* 한 줄이면 폴백을 지나간다.

---

### C-5. `calibrate`/`calibrated`는 **보내는 쪽이 어느 스펙도 안 지난다**

**자리** `frontend/src/ml/worker/handler.ts:76–85` (`handleRequest`의 `calibrate` 갈래)

프로토콜 아홉 종류 중 **`calibrate` 요청과 `calibrated` 답만 이음매가 비어 있다.**

- 받는 쪽은 물린다 — `worker.spec.ts`의 `CalibrateWorker`가 `{type:'calibrated'}`를 **손으로
  쏘고** `calibrateDevice`가 받는다.
- 보내는 쪽은 **아무 스펙도 `handleRequest`에 `{type:'calibrate'}`를 안 보낸다.**
  `handleRequest`를 부르는 스펙은 `inspect-walk.spec.ts:166`과 `train-walk.spec.ts:54` 둘인데
  **둘 다 `train`만** 보낸다. `calibration.spec.ts`는 `runCalibration()`을 직접 부른다.

**심어서 확인했다 — 넷이 조용하다**(§3.4):

| 심은 것 | 결과 |
|---|---|
| `WH-ROUTE` — 교정 요청을 학습 갈래로 보낸다 | 조용 |
| `WH-CALIBRATED` — 재지 않고 `elapsedMs: 0`을 보낸다 | 조용 |
| `WH-CAL-FAILED` — 교정이 던져도 아무 말 안 한다 | 조용 |
| `WC-CAL-ERR` — 교정 워커의 `onerror`·`onmessageerror`를 무동작으로 | 조용 |

**잃는 것.** 셋 중 어느 것이 깨져도 **예상 시간이 전부 틀리거나 사라지는데 화면은 정상으로
보인다** — R20 B-6이 `calibrateDevice`에서 이미 한 번 맞은 병의 반대편이다. `WC-CAL-ERR`은
거기에 더해 **Promise가 영영 안 풀리는 길**을 연다.

**무는 검사** — 없다. **세울 수 있는가** — 있다. `handleRequest({type:'calibrate'}, emit)`
한 줄로 셋이 닫히고, `CalibrateWorker`에 `crash()`를 한 번 태우면 넷째가 닫힌다.

---

### C-6. `preparing`은 **양쪽이 따로** 재어지고 잇는 스펙이 없다

**자리** `frontend/src/ml/worker/handler.ts:55–56` ↔ `frontend/src/ml/worker/client.ts:131–136`

보내는 쪽은 `worker.spec.ts`의 *"준비 국면이 워커 밖으로 나간다"*가 **가짜 엔진**으로 물고,
받는 쪽은 *"준비 국면이 화면까지 간다"*가 **`FakeWorker`가 손으로 쏜 메시지**로 문다. 그
스펙 자신이 주석에 *"메시지를 만드는 쪽은 `tests/experiment.spec.ts`가 본다"*고 적어 놓았다.
**진짜 왕복을 하는 `HandlerWorker`는 엔진을 안 받으므로 이 종류를 한 번도 안 나른다.**

프로토콜 아홉 중 여섯(`train`·`prelude`·`started`·`progress`·`done`·`failed`)은
`HandlerWorker`가 실제로 잇는다. **안 잇는 셋이 `preparing`·`calibrate`·`calibrated`다.**

**무는 검사** — 반쪽씩 있다. **세울 수 있는가** — 있다. `HandlerWorker`가 `engines`를 받게
하면 여섯과 같은 길이 된다.

---

### C-7. `answerEvidenceFor`의 **주입 자리와 고르는 순서**가 무검사다

**자리** `frontend/src/ml/answer-evidence.ts:69–86`

등록부에 항목이 하나뿐이라, 요청서가 짚은 대로 *"고르는 코드가 정말 고르는지"*를 재기
어렵다. 실제로 심어 보니 **`find`를 뒤집어도**(`[...evidence].reverse().find`) **넘긴 등록부를
무시하게 만들어도** 조용하다(§3의 `AE-ORDER`·`AE-INJECT`).

축 셋(`dataTypes`·`taskTypes`·`hasData`)은 `answer-evidence.spec.ts`가 전부 문다 —
**이 등록부에서 안 물리는 것은 "여럿일 때의 행동"뿐이다.** 음성이 오는 날 두 번째 줄이
생기는데, 그때 순서 규칙이 무검사인 채로 열린다.

**무는 검사** — 축은 있다, 순서와 주입은 없다. **세울 수 있는가** — 있다.
`metric-panels.spec.ts`가 하듯 **가짜 등록부를 넘겨** 두 항목의 순서를 못 박으면 된다
(그 인자는 이미 있고 아무도 안 쓴다).

---

### C-8. 결측 전략 여섯 중 **`mostFrequent`는 어느 스펙도 안 고른다**

**자리** `frontend/src/ml/preprocess.ts:155–158`

`MISSING_STRATEGIES`는 여섯이고 `TabularPrepPanel.vue:927`이 **여섯을 다 화면에 내놓는다.**
`tests/` 어디에도 `missing: 'mostFrequent'`가 없다 — 있는 것은 스키마 어휘 목록
(`schema-version.spec.ts:85`)과 픽스처 JSON의 열거뿐이다.

수치 갈래는 `String → 최빈 → Number` 왕복이다. **왕복 자체는 안전하다** — 재 보니 유한한
배정밀도 수는 `Number(String(x)) === x`가 언제나 참이라 표현이 갈려 같은 값이 둘로 세어지는
일은 없다(`-0`만 `0`으로 합쳐지고 되돌린 값도 `0`이다). **틀리는 것은 동점 규칙이고 그것이
B-1이다.**

**무는 검사** — 없다. **세울 수 있는가** — 있다(`preprocess.spec.ts`의 전략 표에 줄 둘).

---

## 2. 세기 — 이 라운드의 본체

**세는 잣대는 "지나가는 스펙이 있는가"가 아니라 "그 자리를 뭉개면 우는가"다**(요청서 §0.2).
그래서 아래 칸의 분모는 항목 수이고, 분자는 **심어서 울린 수**다.

### 2.1 등록부 — 배열을 읽어 셌다

| 등록부 | 항목 | 항목을 지우면 | 데이터 종류 축을 뒤집으면 | 과제 유형 축을 넓히면 | 실행 방법 축을 뒤집으면 |
|---|---|---|---|---|---|
| `ALGORITHMS` (`ml/algorithms.ts:132`) | 9 | **9 / 9** | 안 쟀다(§4) | **3 / 9** | **9 / 9** |
| `RUNTIMES` (`ml/backend.ts:212`) | 3 | **3 / 3** | — | — | `location` 뒤집기 **3 / 3** |
| `METRIC_PANELS` (`ml/metric-panels.ts:191`) | 6 | **4 / 6** | **2 / 6** | **2 / 6** | — |
| `ANSWER_EVIDENCE` (`ml/answer-evidence.ts:54`) | 1 | — | 축 셋 전부 물린다(스펙 넷) · **고르는 순서 0 / 1 · 주입 자리 0 / 1** | | |
| `FILL_BY_STRATEGY` (`ml/preprocess.ts:141`) | 6 | — | 전략마다 값 바꾸기 **3 / 6** (`zero`·`mean`·`median`) · 동점 규칙 **1 / 1** | | |

**읽는 법.**

- **`ALGORITHMS`의 두 축이 그물의 유무로 갈린다** — `runtimes`는 아홉이 다 울고 `taskTypes`는
  셋만 운다. 운 셋은 `decision_tree`(회귀 켜기) · `neural_network`·`linear_regression`(군집
  켜기)이고, **회귀를 켜는 일곱 중 여섯이 조용하다.** 그리고 `decision_tree`가 우는 이유는
  축을 세는 검사가 있어서가 아니라 **`algorithms.spec.ts:190`이 그 한 이름을 박아 두었기
  때문이다**(*"회귀를 고르면 회귀 모델이 열리고 분류 모델이 잠긴다"*가 `decision_tree`를
  대표로 쓴다). **표본이 하나다.** → B-2
- **`METRIC_PANELS`은 `hasData`가 참인 판만 물린다.** `parameters`·`loss-curve`는 픽스처에
  `run.model`이 없어 **셋 다(삭제 포함) 조용하다.** → B-3
- **`FILL_BY_STRATEGY`에서 조용한 셋**은 `none`(값이 쓰이지 않는다) · `drop`(**호출 자리가
  없다**, C-1) · `mostFrequent`(**어느 스펙도 이 전략을 안 고른다**, C-7)다.
- **`architecture.md` §9의 규약**(*"X는 Y에서만 쓸 수 있다는 X의 등록부 항목에 적는다"*)은
  **좁히는 방향으로만 지켜진다.** 좁히면(칸을 끄면) 기존 검사가 울고, **넓히면 안 운다** —
  `some(...)`으로 *"아무 데서도 안 서는 줄이 없다"*를 보는 검사는 켤수록 참이 되기 때문이다.

### 2.2 문(門) — 불러 보고 셌다

#### (가) `ml/experiment.ts` — run 문서에 값을 넣는 자리 **35**

`runExperiment` · `trainOne` · `assembleExperiment`가 문서에 값을 넣는 자리를 전부 세면
다섯 덩어리 **35칸**이다. **`tests/settings.spec.ts`가 `project/settings.ts`에 세운 잣대
(문마다 적대적 값 → 스키마 파스)는 여기 없다.** 대신 `experiment.spec.ts`가
`experimentSchema.parse(experiment)`를 **다섯 자리**에서 부른다(`:183` `:472` `:501` `:977`
`:1553`) — 성공 경로 하나, 손잡이 범위 밖 하나, 모르는 알고리즘 하나, 그리고 둘.

| 덩어리 | 자리 | 칸 | 스키마 잣대 | 통과 못 할 수 있나 |
|---|---|---|---|---|
| `prelude` | `:859–866` | 4 (`id` `startedAt` `settings` `preprocessor`) | `startedAt`만 `timestamp` 정규식 | `options.now`가 비ISO를 내면 못 통과한다. **제품 호출자는 `now`를 안 넘긴다**(§4) |
| `experimentSettings` | `:838–856` | 8 | `taskType`만 `enum`, 나머지는 `z.string()`·`looseObject`·배열 | 사실상 못 막는다 — 모르는 실행 방법 이름이 그대로 파일에 남는 것이 **설계다** |
| `RunBase` | `:895–900` | 4 (`id` `algorithm` `hyperparameters` `trainedAt`) | `algorithm`은 `userString`(무엇이든), `hyperparameters`는 `opaqueRecord`, `trainedAt`은 정규식 | 위와 같다 |
| 실패 run 둘 | `:906–911` `:913–921` | 3+3 | `status`·`computedBy`는 `enum`, `failure`는 `refine`이 요구 | 코드가 언제나 채우므로 안 걸린다 |
| `trainOne` | `:611` `:700–736` `:739–748` | 13 | `metrics`는 `z.record(string, number)` — **`NaN`을 거절한다** | **여기 하나가 진짜다.** `evaluateRegression`의 `r2`가 `NaN`이 되면 문서가 스키마를 못 통과한다. 크기 문턱은 §5의 ④ |
| `assembleExperiment` | `:506–513` | 5 (`id` `startedAt` `changed` `settings` `runs`) | `changed`는 문자열 배열 | 안 걸린다 |

**쓰는 길에는 검증이 없다.** `parseProjectDocument`(`project/schema.ts:998`)를 부르는 자리는
`project/migrate.ts:185` 하나이고 **읽는 길이다** — R32 A-1이 `modelOmittedDetail`에서
맞은 그 모양이 이 문 전체에 그대로 있다. 즉 *"스키마를 통과하는 문서를 내거나 `ClientError`로
선다"*를 **런타임에서 강제하는 것은 아무것도 없고**, 서 있는 것은 위 다섯 줄의 스펙 단언뿐이다.

#### (나) `ml/predict.ts` — `79183f1`의 새 문

**① 경계는 맞다 — 그리고 두 벌이 아니다.** 문이 부르는 `readsAsNumber`는
`detectKind`와 **같은 `toNumber`** 하나를 지난다(`preprocess.ts:69–85`). 경계를 양쪽으로 쟀다:

| 통과 | `150` `  150  `(공백 다듬음) `-5` `+5` `1e3` `1E3` `1.5e-3` `.5` `5.` `0x1F`(31) `0b101`(5) ` -0`(0) |
|---|---|
| **거절** | **`1,650`** `1 650` `1,650.5` `없음` `-` `1_000` `Infinity` `-Infinity` `NaN` `5%` `$5` `１５０`(전각) `１e3` `''` `'   '` `' '` |

요청서가 물은 넷(쉼표·공백·지수 표기·`-`)이 전부 의도대로다. **한 가지 덤**: `0x1F`·`0b101`을
수로 읽는데, `detectKind`도 같은 규칙이라 **학습과 예측이 갈리지는 않는다**(pandas는
저것을 수로 안 읽지만, 그 열은 우리에게도 저쪽에게도 학습 전에 이미 갈린 물건이다).

**② 새 실패 사유는 화면까지 코드로 간다.** `errors.ts:145`의 `PREDICTION_INPUT_NOT_NUMBER`,
`locales/{en,ko}.json`의 `client.*` 한 줄씩. 백엔드 문자열 없음(§1.4 지킴).

**③ `+39`줄 검사는 그 문을 문다** — 심어서 확인했다(§3의 `G-*`).

**④ 그러나 그 문을 우회하는 길이 둘 있다 — A-1.**

### 2.3 상한 — 값을 넘겨 셌다

요청서 §2.3의 일곱이다. **`tests`에 이름이 0번 나온다는 것은 표기였고, 값으로는 셋이 물린다.**

| 상수 | 실물 소비자 | 값을 뭉갰을 때 | 문 스펙 |
|---|---|---|---|
| `HASH_PREVIEW_LENGTH` (8→6) | `ml/changes.ts:159` (**1**) | **욺** | `changes.spec.ts:347` — 여덟 글자를 통째로 못 박는다 |
| `TRAINING_ESTIMATE_COARSE_FROM_SECONDS` (10→20) | `ml/estimate.ts:405` (**1**) | **욺** | `estimate.spec.ts:175–177` |
| `TRAINING_ESTIMATE_COARSE_STEP_SECONDS` (5→7) | `ml/estimate.ts:409` (**1**) | **욺** | 〃 |
| `PARALLEL_WORKER_CAP` (4→2) | `ml/worker/pool.ts:48` (**1**, 둘이 아니다 — C-2) | **욺** | `compute-pools.spec.ts` 넷 — 코어를 5로 고정해 `spawned === 4`를 본다 |
| `MLJS_NEURAL_PARALLEL_MIN_WEIGHT_ROWS` (3e6→30) | `ml/worker/neural-pool.ts:37` (**1**) | **욺** | |
| `SILHOUETTE_MS_PER_PAIR_FEATURE` (3.2e-6→3.2e-5) | `ml/metrics.ts:247` (**1**) | **욺** | `bench-rules.spec.ts` *"전수 사다리는 어느 점에서도 안 자른다"* |
| `PYODIDE_DOWNLOAD_BYTES` (27.3MB→13.3MB) | `ml/backend.ts:220` (**1**) | **조용** | — |

**일곱 중 여섯이 값으로 물린다.** *"`tests`에 이름이 한 번도 안 나온다"*는 **표기였고**,
여섯은 값을 경유해 이미 그물에 걸려 있다.

**소비자 수도 전부 하나씩이다** — 지도 §2.3이 *"비화면 소비, 무언급"*으로 묶은 열넷 중 이
일곱을 실물로 세니 `PARALLEL_WORKER_CAP`만 둘로 적혀 있었고 **그것도 하나였다**(C-2).

**`SILHOUETTE_MS_PER_PAIR_FEATURE`는 내 좁힌 목록이 놓쳤다** — 여섯 스펙을 골랐는데 무는 것은
`bench-rules.spec.ts`였고 거기 없었다. **스위트 전체로 다시 재고서야 뒤집혔다**(§3.5). 45개
중 유일하게 뒤집힌 항목이고, **좁힌 목록이 만드는 거짓 "조용"의 실례**다.

**남은 하나.** `PYODIDE_DOWNLOAD_BYTES`의 유일한 소비자는 `RUNTIMES`의
`preparation.bytes`에 상수를 그대로 넣는 자리다 — **검사를 세울 수는 있지만 세우면 상수를
다시 적는 꼴이라 아무것도 증명하지 않는다.** 그래서 **"세울 수 있는데 안 세운 것"은 0**이고,
이 하나는 `workflow.md` §3의 *"측정값은 검사가 구조적으로 못 지킨다"* 부류다.

### 2.4 워커 프로토콜 — 메시지 종류 **아홉 중 여섯**이 이어진다

`ml/worker/protocol.ts`의 `type` 리터럴 아홉을 **보내는 쪽과 받는 쪽을 실제로 지나가는
스펙이 있는가**로 셌다. 잣대는 *"한 스펙이 보내는 쪽의 코드를 돌려 나온 메시지를 받는 쪽의
코드에 먹이는가"*이지 *"양쪽에 각각 스펙이 있는가"*가 아니다.

| 종류 | 보내는 쪽 | 받는 쪽 | 이어지는가 |
|---|---|---|---|
| `train` | `composables/useTraining.ts:58` → `postMessage` | `handler.ts:86` `handleRequest` | **예** — `train-walk.spec.ts:54`가 목의 `postMessage`에서 곧바로 `handleRequest`를 부른다 |
| `prelude` | `handler.ts:52` | `client.ts:117` | **예** — `worker.spec.ts:123` `HandlerWorker` |
| `started` | `handler.ts:47` | `client.ts:123` | **예** — 〃 |
| `progress` | `handler.ts:51` | `client.ts:138` | **예** — 〃 |
| `done` | `handler.ts:58` | `client.ts:151` | **예** — 〃 |
| `failed` | `handler.ts:62–63` `:83` | `client.ts:168` | **예** — 〃 (`worker.spec.ts`의 *"던지지 않는다 - 실패도 메시지다"*와 `train-walk`) |
| `preparing` | `handler.ts:56` | `client.ts:131` | **아니다** — C-5. 보내는 쪽은 가짜 엔진으로, 받는 쪽은 `FakeWorker`가 손으로 쏜 메시지로 따로 잰다 |
| `calibrate` | `client.ts:267` | `handler.ts:76` | **아니다** — C-4. 받는 쪽에 이 요청을 넣는 스펙이 0 |
| `calibrated` | `handler.ts:80` | `client.ts:249`(학습 경로 거절) · `:262`(교정) | **아니다** — C-4. 보내는 쪽이 무실행 |

**`failed`는 요청서의 걱정과 달리 이어진다.** 지도 §1.3 B가 *"워커가 죽는 갈래 전부 무실행"*
이라고 적은 것은 **`failed` 메시지가 아니라 `onerror`/`onmessageerror` 이벤트**다 — 그 둘은
프로토콜 밖(브라우저 이벤트)이고, `worker.spec.ts`의 `FakeWorker.crash()`·`garble()`이
**받는 쪽만** 지나간다. 컴퓨트 풀 쪽(`pool.ts:66·70`)은 §3의 `WP-*`가 답한다.

---

## 3. 돌연변이 표 전체 — **운 것까지**

**110개 · 최종 욺 66 · 조용 44.** 아래 §3.1~§3.4는 **좁힌 스펙 목록으로 잰 1차**이고
(합계 욺 65 · 조용 45), §3.5가 조용했던 45개를 **스위트 전체**로 다시 재서 하나를 뒤집는다.

**심은 방식.** `tools/mutate.mjs`를 그대로 본뜬 러너(스크래치패드)로 하나씩 심고, **좁힌
스펙 목록**을 돌리고, 원본 바이트로 즉시 되돌리고 바이트가 같은지 확인했다. 카탈로그 넷과
로그 넷은 `%TEMP%\claude\…\scratchpad`에 있다(`alg|reg|gate|worker.json`, `out-*.log`).

### 3.1 `ALGORITHMS` 등록부 — 27개 (욺 21 · 조용 6)

| # | 심은 것 | 결과 |
|---|---|---|
| ALG-T-decision_tree | `regression: false → true` | **욺** |
| ALG-T-knn | 〃 | 조용 |
| ALG-T-logistic_regression | 〃 | 조용 |
| ALG-T-random_forest | 〃 | 조용 |
| ALG-T-naive_bayes | 〃 | 조용 |
| ALG-T-svm | 〃 | 조용 |
| ALG-T-k_means | 〃 | 조용 |
| ALG-T-neural_network | `clustering: false → true` | **욺** |
| ALG-T-linear_regression | 〃 | **욺** |
| ALG-R-{아홉 전부} | `'pyodide-sklearn'` 칸 뒤집기 | **욺 9 / 9** |
| ALG-D-{아홉 전부} | 항목 통째 삭제 | **욺 9 / 9** |

### 3.2 등록부 셋과 결측 전략 — 34개 (욺 19 · 조용 15)

| # | 심은 것 | 결과 | 문 스펙 |
|---|---|---|---|
| MP-D-confusion-matrix | `image: true → false` | 조용 | |
| MP-T-confusion-matrix | `regression: false → true` | **욺** | `metric-panels` *"회귀에는 아무것도 안 선다"* |
| MP-X-confusion-matrix | 항목 삭제 | **욺** | `metric-panels` *"분류에는 혼동 행렬과…"* |
| MP-D-per-class | `image: true → false` | 조용 | |
| MP-T-per-class | `regression: false → true` | **욺** | 위와 같다 |
| MP-X-per-class | 항목 삭제 | **욺** | 위와 같다 |
| MP-D-parameters | `image: false → true` | 조용 | |
| MP-T-parameters | `clustering: false → true` | 조용 | |
| MP-X-parameters | **항목 삭제** | **조용** | |
| MP-D-loss-curve | `image: true → false` | 조용 | |
| MP-T-loss-curve | `clustering: false → true` | 조용 | |
| MP-X-loss-curve | **항목 삭제** | **조용** | |
| MP-D-cluster-result | `image: false → true` | **욺** | *"이미지 군집에는 사진 판이 선다"* |
| MP-T-cluster-result | `classification: false → true` | 조용 | |
| MP-X-cluster-result | 항목 삭제 | **욺** | *"표 군집에는 산점도 판이 선다"* |
| MP-D-image-cluster-result | `tabular: false → true` | **욺** | *"표 군집에는 산점도 판이 선다"* |
| MP-T-image-cluster-result | `classification: false → true` | 조용 | |
| MP-X-image-cluster-result | 항목 삭제 | **욺** | |
| RT-L-mljs · RT-X-mljs | `location` 뒤집기 · 삭제 | **욺·욺** | `algorithms` · `create` |
| RT-L-server-sklearn · RT-X | 〃 | **욺·욺** | `algorithms` · `experiment` |
| RT-L-pyodide-sklearn · RT-X | 〃 | **욺·욺** | `algorithms` · `experiment` |
| AE-ORDER | `find` → `reverse().find` | **조용** | |
| AE-INJECT | 넘긴 등록부를 무시 | **조용** | |
| AE-HASDATA | `hasData`를 언제나 참으로 | **욺** | `answer-evidence` |
| FILL-none | `none: () => 'X'` | **조용** | |
| FILL-drop | `drop: () => 'X'` | **조용** | |
| FILL-zero | `0 → 1` | **욺** | `preprocess` *"zero - …0.00"* |
| FILL-mean | `mean(numbers) + 1` | **욺** | `preprocess` 넷 · `clusters` 하나 |
| FILL-median | 분위 `0.5 → 0.25` | **욺** | `preprocess` 둘 |
| FILL-mostFrequent | `Number(최빈(문자열)) → numbers[0]` | **조용** | |
| FILL-tiebreak | `count > bestCount` → `>=` | **욺** | `preprocess` *"동점이면 먼저 나온 값이 이긴다"* |

### 3.3 문과 상한 — 23개 (좁힌 목록에서 욺 12 · 조용 11 → 스위트 전체로 **욺 13 · 조용 10**)

| # | 심은 것 | 결과 | 문 스펙 |
|---|---|---|---|
| G-GATE-OFF | 새 문 통째 제거 | **욺** | `predict` 둘 |
| G-GATE-KIND | `kind === 'numeric'` → `!== 'categorical'` | 조용 | **동치 돌연변이(대조군)** |
| G-GATE-COUNT | `count: notNumbers.length → 1` | **조용** | |
| G-GATE-FEATURE | `feature: bad → ''` | **욺** | `predict` |
| G-READS-COMMA | 천 단위 쉼표를 받아 준다 | **욺** | `predict` |
| G-READS-BLANK | 빈 칸도 수로 본다 | **조용** | (빈 칸 문이 앞에 있어 가려진다) |
| G-BLANK-CODE | 빈 칸 사유를 `NOT_NUMBER`로 | **욺** | `predict` |
| **G-FILL-ZERO** | **`?? 0` → `?? 999`** | **조용** | **→ A-1** |
| EX-REASON-FIND | `find` → `findLast` | **조용** | |
| EX-REASON-FALLBACK | 언제나 `ALGORITHM_NOT_AVAILABLE_HERE` | **조용** | |
| EX-REASON-REQUESTED | 막다른 사유도 그대로 준다 | **조용** | |
| EX-HYPER-RESOLVE | 손잡이를 확정 안 한다 | **욺** | `experiment` |
| EX-TRAINED-AT | `now()` → `startedAt` | 조용 | 픽스처가 시계를 얼려 두 값이 같다(동치) |
| EX-SEQ | `sequence += 0` | **욺** | `experiment` |
| EX-INDICES-COPY | 사본 대신 원본 배열 | **조용** | |
| EX-NSAMPLES | `nSamples: undefined`를 남긴다 | **욺** | `experiment` |
| LIM-HASH | `8 → 6` | **욺** | `changes` |
| LIM-NEURAL-MIN | `3_000_000 → 30` | **욺** | |
| LIM-CAP | `4 → 2` | **욺** | `compute-pools` 넷 |
| LIM-PYBYTES | `27.3MB → 13.3MB` | **조용** | |
| LIM-SIL-PAIR | `3.2e-6 → 3.2e-5` | 조용 → **욺** | **좁힌 목록에서만 조용했다.** 스위트 전체에서는 `bench-rules.spec.ts` *"전수 사다리는 어느 점에서도 안 자른다"*가 문다(§3.5) |
| LIM-COARSE-FROM | `10 → 20` | **욺** | `estimate` |
| LIM-COARSE-STEP | `5 → 7` | **욺** | `estimate` |

### 3.4 워커 — 26개 (욺 13 · 조용 13)

| # | 심은 것 | 결과 |
|---|---|---|
| WP-ERR-CLEANUP | `onError`에서 `cleanup()` 제거 (리스너가 샌다) | **조용** |
| WP-ERR-RESOLVE | 워커가 죽어도 `resolve` | **조용** |
| WP-ERR-MESSAGE | 오류 원문을 버린다 | **조용** |
| WP-MSGERR-CLEANUP | `onMessageError`에서 `cleanup()` 제거 | **조용** |
| WP-MSGERR-GONE | `messageerror` 리스너 자체를 뗀다 (R26 B-6을 되돌린다) | **조용** |
| WP-ERR-GONE | `error` 리스너 자체를 뗀다 | **조용** |
| WP-SPANS | 언제나 한 덩어리 (병렬을 통째로 끈다) | **욺** — **대조군.** 이 스펙 목록이 실제로 돌고 실패할 수 있음을 보인다 |
| WC-ERR-DETAIL | 어디서 터졌는지를 버린다 | **욺** |
| WC-MSGERR | 복원 못 한 메시지에 아무것도 안 한다 | **욺** (64.9초 — 시간 초과로 운다) |
| WC-CALIBRATED-IN-TRAIN | 학습 경로의 `calibrated`를 무시 | **조용** |
| WC-PRELUDE | `prelude`를 안 모은다 | **욺** |
| WC-PROGRESS-PUSH | 진행에 실려 온 모델을 안 모은다 | **욺** |
| WC-CANCEL-GUARD | run 0개여도 빈 실험을 만든다 | **욺** |
| WC-CAL-ERR | 교정 워커의 `onerror`·`onmessageerror`를 무동작으로 | **조용** |
| WC-CAL-SPAWN | 워커를 못 띄우면 던진다 | **욺** |
| WH-STARTED | `index`를 틀리게 보낸다 | **욺** |
| WH-PROGRESS | 진행에 모델을 안 싣는다 | **욺** |
| WH-PRELUDE | `prelude`를 안 보낸다 | **욺** |
| WH-PREPARING | 준비 국면을 언제나 `ready`로 | **욺** |
| **WH-DONE** | **`done`에 모델을 안 싣는다 (`models: new Map()`)** | **조용** |
| WH-FAILED-CODE | 사유 코드를 `JOB_FAILED`로 뭉갠다 | **욺** |
| WH-FAILED-DETAIL | 기술 원문을 버린다 | **조용** |
| WH-CALIBRATED | 교정을 안 재고 0을 보낸다 | **조용** |
| WH-CAL-FAILED | 교정이 던져도 아무 말 안 한다 | **조용** |
| WH-ROUTE | 교정 요청을 학습으로 보낸다 | **조용** |
| WH-POOLS | KNN 병렬화를 뗀다 (R26 A-4의 그물) | **욺** — 아직 문다 |

### 3.5 조용했던 45개를 **스위트 전체**로 다시 쟀다

좁힌 목록에서 조용한 것은 *"그 목록이 안 본다"*이지 *"저장소가 안 본다"*가 아니다. 그래서
조용했던 45개를 **파일별로 묶어**(앵커가 겹치는 것은 다른 묶음으로) 스펙 필터 없이 스위트
전체(174파일)를 돌렸다. **묶음 열다섯 · 각 97~149초.**

| 묶음 | 담긴 것 | 결과 |
|---|---|---|
| `algorithms.ts-1` | `ALG-T` 여섯 (knn · logistic_regression · random_forest · naive_bayes · svm · k_means) | 조용 96.7s |
| `metric-panels.ts-1` | `MP-D` 넷 + `MP-T-cluster-result` + `MP-T-image-cluster-result` | 조용 103.8s |
| `metric-panels.ts-2` | `MP-T-parameters` · `MP-T-loss-curve` | 조용 134.1s |
| `metric-panels.ts-3` | **`MP-X-parameters` · `MP-X-loss-curve`** (항목 삭제) | 조용 134.7s |
| `answer-evidence.ts-1` | `AE-ORDER` · `AE-INJECT` | 조용 139.9s |
| `preprocess.ts-1` | `FILL-none` · `FILL-drop` · `FILL-mostFrequent` · `G-READS-BLANK` · **`G-FILL-ZERO`** | 조용 147.1s |
| `predict.ts-1` | `G-GATE-KIND` · `G-GATE-COUNT` | 조용 149.3s |
| `experiment.ts-1` | `EX-REASON-FIND` · `EX-REASON-REQUESTED` · `EX-TRAINED-AT` · `EX-INDICES-COPY` | 조용 127.9s |
| `experiment.ts-2` | `EX-REASON-FALLBACK` | 조용 105.9s |
| **`limits.ts-1`** | `LIM-PYBYTES` · `LIM-SIL-PAIR` | **욺 125.5s** — `bench-rules.spec.ts` |
| `pool.ts-1` | `WP-ERR-CLEANUP` · `WP-MSGERR-CLEANUP` · `WP-MSGERR-GONE` · `WP-ERR-GONE` | 조용 118.1s |
| `pool.ts-2` | `WP-ERR-RESOLVE` | 조용 122.2s |
| `pool.ts-3` | `WP-ERR-MESSAGE` | 조용 106.8s |
| `client.ts-1` | `WC-CALIBRATED-IN-TRAIN` · `WC-CAL-ERR` | 조용 113.9s |
| `handler.ts-1` | **`WH-DONE`** · `WH-FAILED-DETAIL` · `WH-CALIBRATED` · `WH-CAL-FAILED` · `WH-ROUTE` | 조용 120.9s |

**뒤집힌 묶음 하나를 갈랐다** — 둘을 따로 `bench-rules.spec.ts`에 심으니
`LIM-PYBYTES`는 조용하고 **`LIM-SIL-PAIR`가 운다.**

**그래서 최종은 욺 66 · 조용 44다**(110 중). **좁힌 목록이 만든 거짓 "조용"은 45개 중 하나**
였고, 그 하나는 내가 고른 여섯 스펙에 무는 파일이 안 들어 있어서였다.

---

## 4. 못 한 것 · 안 쟀다 · 안 읽었다

**감사자가 멈춘 자리가 곧 고치는 쪽이 재야 할 자리다.**

### 4.1 방법의 한계 — 이 라운드가 세는 방식에서 오는 것

- **1차는 좁힌 스펙 목록으로 쟀다.** "욺"은 *"그 목록 안에서 울었다"*이지 *"저장소 전체에서
  운다"*가 아니다. **조용했던 것만 스위트 전체로 다시 쟀고**(§3.5), 운 것은 다시 안 쟀다 —
  **운 것 중에 "겨냥한 것과 다른 이유로 우는 항목"이 있을 수 있고 항목마다 확인하지 않았다.**
  실패한 스펙 이름은 §3의 표에 붙였으니 거기까지가 근거다.
- **그 방식이 실제로 거짓 "조용"을 하나 만들었다** — `LIM-SIL-PAIR`가 좁힌 목록에서는
  조용했는데 스위트 전체에서는 운다. 45개 중 하나이고, **뒤집힌 쪽을 못 잡았으면 §2.3의
  결론이 반대로 적혔을 것이다.** 다음 라운드가 좁힌 목록을 쓸 때 이 비율(1/45)을 알고 써라.
- **동치 돌연변이를 하나 심었다** — `G-GATE-KIND`(`kind === 'numeric'` → `kind !== 'categorical'`)는
  오늘 `ColumnKind`가 둘뿐이라 **뜻이 같다.** 조용한 것이 정상이고, 대조군으로 남긴다.
- **`ALGORITHMS`의 `dataTypes` 축은 안 쟀다.** `taskTypes`·`runtimes`·항목 삭제 셋만 쟀다.
- **0% 워커 진입점 넷**(`train.worker` `forest.worker` `knn.worker` `neural-compute.worker`)
  에는 심지 않았다 — 요청서 §1의 지시다.
- **`ml/engines/` `ml/models/` `ml/embed/`는 안 봤다**(R35) · **`project/` `data/`도 안 봤다**(R37) ·
  **화면까지의 이음매는 안 봤다**(R38·R39).

### 4.2 확인 못 한 의심 — 지적으로 안 올린 것

- **`options.now`가 비ISO를 내면 run 문서가 스키마를 못 통과한다.** 그런데 **제품 호출자가
  `now`를 안 넘긴다**(`handler.ts`도 `TrainView.vue`도) — 재현 경로가 없어 지적이 아니다.
- **`experimentSettings.runtime`·`selectedAlgorithms[].runtime`이 모르는 문자열을 그대로
  받는다.** `z.string()`이라 스키마도 안 막는다. **설계로 보인다**(*"모르는 알고리즘이 든
  파일도 열린다"*) — 결정문을 못 찾아 지적으로 안 올렸다.
- **`ImagePredictPanel.vue:469`가 `transform`을 직접 부른다**(`inputVector`를 안 지난다).
  거기 들어가는 표는 임베딩 수치라 A-1과 같은 길은 아닌 것으로 보이는데 **안 쟀다** — 화면
  파일이라 R38의 몫이기도 하다.
- **`ml/metrics.ts:342`의 표본 실루엣이 맞는 값을 내는지** — R34가 남긴 부채 그대로다.
  주석은 고쳐졌고 코드는 그대로인데, **이 라운드에서 안 쟀다.**
- **`ml/metrics.ts:243`의 표본 크기를 화면이 밝히는지** — R38의 몫이라 안 봤다.

### 4.3 다음 주기로 넘기는 냄새 — 화면까지의 이음매

요청서 §0이 *"이 방법이 못 보는 것은 화면까지의 이음매다. 냄새가 나면 지적하지 말고 한 줄로
적어라"*고 했다. 셋 났다.

- **`views/predict/ImagePredictPanel.vue:469`가 `transform`을 직접 부른다** — `inputVector`를
  안 지나므로 A-1의 문도 안 지난다. 거기 들어가는 표가 임베딩 수치라 같은 길은 아닌 것으로
  보이는데 **안 쟀다.** → R38
- **`METRIC_PANELS`의 판 셋과 `ANSWER_EVIDENCE`의 판 하나가 마운트 0이다**(지도 §1.2). 이
  라운드는 **등록 항목까지만** 봤고, 등록부에서 화면까지의 길은 안 봤다. → R39
- **`silhouetteSampleSize`가 표본을 고를 때 화면이 그 사실을 말하는지** — `metrics.ts:240`의
  주석이 *"화면도 이 함수를 부른다"*고 단정하는데 그 이음매는 안 쟀다. → R38

### 4.4 안 잰 것 — 요청서가 시간 쓰지 말라고 한 것

브라우저 워커의 113MB 모델 · 교정 배수의 분산 · 사진 경로의 실물 `.mlpx` 왕복 ·
실기기(아이폰·학교 PC) · 백엔드 관문(`uv run python scripts/ci.py`).

---

## 5. 재현 — 임시 스펙의 실측값

`frontend/tests/zz-r36-probe.spec.ts`를 심고 돌린 뒤 **지웠다**(스크립트가 지운 것을 확인한다).
소스는 안 건드렸다. 전문은 스크래치패드에 있고, 여기 적는 것은 단언과 결과다.

**① 따로 올린 테스트 표 — `provided`**

훈련 표는 `점수`가 `100,110,…,210`인 12행(전부 수로 읽힌다), 테스트 표는
`['150','없음','1,650','N/A']`. `planRun`이 **막지 않고**(`ok: true`, `testFromProvided: true`),
전처리기의 `점수` 열은 `numeric`이다. 그다음:

```
transform(plan.preprocessor, test, plan.split.testIndices, 'onehot')
  === [[150], [0], [0], [0]]        ← 단언이 통과했다
```

**셋이 0이다.** `없음`도 `1,650`도 `N/A`도 같은 값이 된다 — `79183f1`의 커밋 메시지가
예측에서 잡았다고 적은 바로 그 모양이 **채점 행렬에 그대로 있다.**

**② 한 파일 홀드아웃**

같은 훈련 표에서 깨끗하게 한 번 계획을 세워 시험 몫 행 번호를 얻고, **그중 첫 행의 `점수`만**
`N/A`로 바꿔 다시 계획을 세웠다. 열은 **여전히 `numeric`**이고(훈련 몫만 보므로),

```
transform(plan.preprocessor, dirty, plan.split.testIndices, 'onehot')[0] === [0]
```

**따로 올린 테스트 표가 없어도 닿는다.**

**③ 진짜 입구 — `runExperiment`**

테스트 표를 `['1,650','1,660','1,670','1,680']`(네 행 전부 쉼표)로 두고 `runExperiment`를
그대로 돌렸다. 결과:

```
run.status  === 'done'
run.warning === undefined
run.failure === undefined
```

**실패도 경고도 없다.** 네 행의 특성이 전부 0이 된 채로 지표가 나왔고, 학생은 그 숫자를 본다.

**④⑤ R34가 남긴 `metrics.ts:158`을 재 봤다 — 이미 막혀 있다**

요청서 §4가 *"`r2`의 `total`이 극히 작을 때 `residual / total`이 `Infinity`가 된다. CSV
글자로 그 크기를 만들 수 있는지 아무도 안 쟀다"*로 남긴 자리다. **크기는 만들 수 있다** —
타깃이 `1e154` 언저리를 넘으면 `error * error`가 배정밀도를 넘어 `residual`이 `Infinity`가
되고, `total`도 함께 넘치면 `r2 = 1 - Infinity/Infinity = NaN`이다. `1e200`은 CSV에 다섯
글자다.

**그런데 거기서 끝나지 않는다.** 프로브 ④⑤는 **둘 다 `evaluate`가 던져서 실패했다**:

```
ClientError: JOB_FAILED   ❯ evaluate src/ml/metrics.ts:493
    if (!Number.isFinite(value)) throw new ClientError('JOB_FAILED', { metric })
```

`evaluate`(:492–494)와 `evaluateCluster`(:524–526)가 **나가는 지표가 수치가 아니면 던진다.**
그러므로 이 자리의 결말은 *"다시 안 열리는 `.mlpx`"*가 아니라 **그 run 하나가 사유와 함께
실패하는 것**이다 — 학생이 다치지 않는다.

**→ 부채 목록의 이 줄은 적힌 것보다 가볍다.** 남는 물음은 *"`JOB_FAILED`가 학생에게 쓸모
있는 사유인가"*이고 그건 문구의 문제라 이 라운드 밖이다.

---

## 6. `tools/mutants.json`에 더할 후보

**파일을 고치는 것은 코드 소유자다.** 아래는 이 라운드가 값을 증명한 것들이고, 앵커는 지금
소스에서 정확히 한 번 나온다(러너가 확인했다). `WH-POOLS`는 이미 카탈로그에 있다(R26 M7) —
**다시 재 보니 여전히 문다.**

**`cries` — 값이 증명된 것 다섯** (전부 `79183f1` 이후 세운 그물이거나, 상수의 유일한 그물이다)

| `file` | `find` → `replace` | `expectSpecs` | `loses` |
|---|---|---|---|
| `src/ml/preprocess.ts` | `return toNumber(cell) !== null` → `return toNumber(cell.replaceAll(',', '')) !== null` | `tests/predict.spec.ts` | 천 단위 쉼표를 예측만 수로 읽어 학습과 잣대가 갈린다 (R33 C-3의 뿌리) |
| `src/ml/predict.ts` | `      feature: bad,` → `      feature: '',` | `tests/predict.spec.ts` | 어느 열이 잘못됐는지 안 말한다 — 학생이 파일에서 고칠 자리를 못 찾는다 |
| `src/ml/predict.ts` | `'PREDICTION_INPUT_INCOMPLETE'` → `'PREDICTION_INPUT_NOT_NUMBER'` (`:124`) | `tests/predict.spec.ts` | 빈 칸과 숫자 아님이 한 사유로 뭉개진다 — 학생이 할 일이 다르다 |
| `src/limits.ts` | `export const PARALLEL_WORKER_CAP = 4` → `= 2` | `tests/compute-pools.spec.ts` | 워커 수 계산(`min(천장, 코어−1, 일감)`)의 유일한 그물 |
| `src/limits.ts` | `export const SILHOUETTE_MS_PER_PAIR_FEATURE = 3.2e-6` → `= 3.2e-5` | `tests/bench-rules.spec.ts` | 실루엣이 전수인지 표본인지가 조용히 뒤집힌다 |

**`silent` — 아직 무검사인 자리 일곱** (전부 스위트 전체로 확인했다)

| `file` | `find` → `replace` | `loses` |
|---|---|---|
| `src/ml/preprocess.ts` | `(toNumber(String(filled)) ?? 0)` → `(toNumber(String(filled)) ?? 999)` | **채점하는 시험 행렬이 조용히 0이 된다** (R36 A-1) |
| `src/ml/worker/pool.ts` | `worker.addEventListener('messageerror', onMessageError)` → `void onMessageError` | 답이 복제에 실패하면 학습이 영영 안 끝난다 (R26 B-6의 고침을 되돌린다) |
| `src/ml/worker/pool.ts` | `worker.addEventListener('error', onError)` → `void onError` | 컴퓨트 워커가 죽으면 학습이 영영 안 끝난다 |
| `src/ml/worker/handler.ts` | `emit({ type: 'done', experiment, preprocessor, models })` → `models: new Map()` | 학습은 끝났는데 모델이 하나도 안 담긴다 (R36 B-5) |
| `src/ml/metric-panels.ts` | `parameters` 항목 통째 삭제 | 계수 표가 결과 화면에서 사라진다 (R36 B-3) |
| `src/ml/experiment.ts` | `unavailableReason`의 폴백 두 줄 → `return 'ALGORITHM_NOT_AVAILABLE_HERE'` | 학생이 할 수 있는 일이 있는 사유 대신 막다른 답만 듣는다 (R36 C-4) |
| `src/ml/preprocess.ts` | `? Number(mostFrequent(numbers.map((value) => String(value))))` → `? (numbers[0] ?? 0)` | 학생이 고를 수 있는 전략 하나가 무검사다 (R36 C-8) |

---

## 7. 지도 `map-2026-09-21.md` §3에 넣을 줄

| 라운드 | # | 등급 | 자리 | 틀리면 학생에게 | 무는 검사가 있는가 / 세울 수 있는가 / 못 세우면 왜 |
|---|---|---|---|---|---|
| R36 | A-1 | A | `ml/preprocess.ts:477` · `ml/experiment.ts:798` | **채점하는 시험 행렬이 조용히 0이 된다.** 정확도·R²가 틀린 채로 포트폴리오에 적힌다 | **없다**(`?? 0`을 뭉개도 174파일 전부 초록) **· 있다** — 프로브 셋이 그대로 스펙이다(§5). 고침은 결정이 걸린다(그 행을 버릴지 통째로 거절할지) |
| R36 | B-1 | B | `ml/preprocess.ts:122` 대 `ml/models/reference.ts:160` | 결측 있는 범주 열의 채움값이 sklearn과 갈리고 그 아래 지표가 전부 갈린다 | **있는데 재는 것이 다르다**(우리 규칙 그대로인가) **· 있다** — `SimpleImputer.statistics_`를 픽스처로. **결정이 걸린다**: 뒤집으면 나간 `.mlpx`의 값이 달라진다 |
| R36 | B-2 | B | `ml/algorithms.ts:132`의 `taskTypes` | 없는 조합이 열리고 엔진이 거절하지 않아 **그럴듯한 숫자**가 나온다 | **없다 · 있다** — (종류 × 유형 × 알고리즘) 열린 칸의 골든 표 |
| R36 | B-3 | B | `ml/metric-panels.ts:191`의 `parameters`·`loss-curve` | 결과 화면에서 판이 통째로 사라져도 관문이 초록이다 | **없다 · 있다** — `model.format`이 담긴 픽스처 하나 + 목록 `toEqual` |
| R36 | B-4 | B | `ml/worker/pool.ts:63–80` | 컴퓨트 워커가 죽으면 **학습이 멈춘 채 영영 안 끝난다** | **없다 · 있다** — 가짜 워커에 `messageerror`를 쏘는 손잡이 하나 |
| R36 | B-5 | B | `ml/worker/handler.ts:58` | 학습은 끝났는데 **모델이 하나도 안 담긴다** — 교사가 파일을 열어도 재학습이 필요하다 | **없다 · 있다** — `worker.spec.ts`에 한 줄 |
| R36 | C-1 | C | `ml/preprocess.ts:144` | (오늘은 안 닿는다) 가드가 옮겨지는 날 수치 열이 조용히 0으로 채워진다 | **없다 · 있다** — `drop` 칸을 던지게 두기 |
| R36 | C-2 | C | `docs/audit/request-R36.md:139` · `map-2026-09-21.md:168` | (문서의 문제다) 소비자 수가 둘이 아니라 하나다 — **표기를 셌다** | 해당 없음 **· 있다** — 다만 주석의 숫자 복제는 소급 적용하지 마라 |
| R36 | C-3 | C | `27.3MB`가 든 주석 25줄 · 15파일 | (주석의 문제다) 상수를 옮기면 스물다섯 줄이 한꺼번에 거짓이 된다. **화면 문구는 상수를 쓰므로 학생은 안 다친다** | **없다 · 있다** — 다음에 그 파일을 만질 때. 소급 적용하지 마라 |
| R36 | C-4 | C | `ml/experiment.ts:309–328` | 학생이 *"여기선 실행할 수 없습니다"*만 듣고 할 수 있는 일을 못 듣는다 | **없다 · 있다** — 폴백을 지나가는 스펙 한 줄 |
| R36 | C-5 | C | `ml/worker/handler.ts:76–85` | 교정이 조용히 틀리거나 사라져 **예상 시간이 전부 거짓이 된다** | **없다 · 있다** — `handleRequest({type:'calibrate'})` 한 줄 |
| R36 | C-6 | C | `ml/worker/handler.ts:56` ↔ `client.ts:131` | 준비 국면이 끊기면 학생이 8.7초 동안 멈춘 줄 안다 | **반쪽씩 있다 · 있다** — `HandlerWorker`가 `engines`를 받게 |
| R36 | C-7 | C | `ml/answer-evidence.ts:69–86` | 음성이 오는 날 둘째 항목이 무검사인 채로 열린다 | **축은 있다, 순서·주입은 없다 · 있다** — 가짜 등록부를 넘겨서 |
| R36 | C-8 | C | `ml/preprocess.ts:155–158` | 학생이 고를 수 있는 전략 하나가 **한 번도 안 돌아 본 채** 나가 있다 | **없다 · 있다** — 전략 표에 줄 둘 |
