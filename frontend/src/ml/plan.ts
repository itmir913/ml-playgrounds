/**
 * 학습 직전까지 — **행을 고르고, 뽑고, 분할하고, 전처리기를 학습한다.**
 *
 * ```
 * usableRows -> sampleRows -> splitRows -> fitPreprocessor   ← 여기까지가 planRun
 *                                       -> transform -> fit  ← 그 뒤는 runExperiment
 * ```
 *
 * **이 함수가 있는 이유는 화면이 같은 숫자를 말해야 하기 때문이다** (architecture.md
 * §9.1.3). 전처리 요약 카드가 "훈련 340행 / 테스트 85행"이라고 말하려면 그 숫자가
 * 실제로 학습할 때의 것과 같아야 하는데, **화면이 따로 계산하면 반드시 어긋난다.**
 * 어긋날 자리가 이미 셋이다.
 *
 * - 테스트 행 수의 올림 — `ceil` 뒤에 `total - 1`로 자른다 (`ml/split.ts`).
 *   **`round`가 아니다** (2026-08-19에 옮겼다). 아래쪽 `Math.max(…, 1)` 클램프도 없다 —
 *   도달 불가라 R7 감사 B-1이 걷어냈다.
 * - **뽑기가 분할보다 먼저다** — 비율의 분모가 전체가 아니라 뽑힌 행이다.
 * - **채움값과 스케일 기준은 훈련 데이터에서만 구한다** (`fitPreprocessor`). 전체로
 *   계산해 보여 주면 화면이 데이터 누수를 가르치는 꼴이 된다.
 *
 * **던지지 않는다.** 아직 타깃을 안 골랐거나 빈 칸이 남은 상태에서도 카드는 그려져야
 * 하는데, 예외로 흐름을 만들면 **어떤 예외를 삼킬지 카드가 결정하게 된다** — 그 순간
 * "무엇이 막는가"의 판정이 둘이 된다. 그래서 사유를 값으로 돌려주고, 던지는 일은
 * `runExperiment`가 한다.
 */

import type { ColumnSummary } from '../data/columns'
import { ClientError, isClientError, type ClientErrorCode, type ClientErrorParams } from '../errors'
import { MIN_SPLIT_ROWS } from '../limits'
import { dataSettings } from '../project/schema'
import type { Settings, TaskType } from '../project/schema'
import {
  detectKind,
  fitPreprocessor,
  missingColumns,
  targetValues,
  unreadableNumericCell,
  usableRows,
  type ColumnKind,
  type Dataset,
  type Preprocessor,
} from './preprocess'
import { sampleRows } from './sample'
// 전처리 화면이 [학습하기] 전에 같은 판정을 한다. 표가 두 벌이면 화면과 학습이 갈린다.
import {
  featuresInUse,
  requiredTargetKind,
  sampleStratifyBlockFor,
  stratifyApplies,
  stratifyBlockFor,
} from './selection'
import { splitRows } from './split'

export interface PlanInput {
  /** 정본 CSV를 읽은 표. 행 번호가 곧 분할 인덱스다. */
  dataset: Dataset
  /** 테스트 데이터. `split.method`가 `provided`일 때만 본다. 없으면 `null`이다. */
  testDataset: Dataset | null
  settings: Settings
  /**
   * **아직 안 골랐으면 `undefined`다.** 유형은 학습 화면에서 고르므로 전처리 화면에서는
   * 비어 있는 것이 정상이고, 그때는 분할이 어떻게 될지 말할 수 없다 — 군집은 분할하지
   * 않기 때문이다 (architecture.md §3.6).
   */
  taskType?: TaskType | undefined
  /**
   * **파일에 적힌 분할.** 주면 뽑기와 나누기를 그것으로 대신한다 (mlpx-spec.md §5.1).
   *
   * **재실행 대조가 학습과 갈라지는 자리는 여기 하나다** (open-decisions.md "재실행은
   * 학습 경로를 그대로 탄다"). 다시 나누면 라이브러리 차이 하나로 테스트셋이 갈리고,
   * 그러면 대조가 아니라 새 학습이 된다. **그 하나를 `if`가 아니라 입력으로 둔다** —
   * 학습 경로가 인자를 하나 더 받을 뿐, 재실행 쪽에 이 함수의 사본이 생기지 않는다.
   *
   * **주입 자리가 여기여야 한다.** 아래에서 `fitPreprocessor`가 `split.trainIndices`로
   * 맞춰지므로, 밖에서 분할만 갈아 끼우면 **채움값과 스케일 기준이 다시 계산한 분할의
   * 훈련 행에서 나온다** — 정직한 파일이 재현되지 않는다.
   *
   * **대신하는 것은 뽑기와 나누기뿐이다.** 그 앞의 검사들(타깃 선택·타깃 자료형·빈 칸)은
   * 그대로 돈다 — 건너뛰면 빈 칸이 `transform`에서 조용히 0이 된다.
   *
   * **점검 밖에서 넘기지 마라.** 브랜드가 실수로 만드는 것을 막고(평범한
   * `{ trainIndices, testIndices }`는 이 타입이 아니다), **누가 부를 수 있는지는
   * `asRecordedSplit`을 부르는 자리를 임포트 그래프 검사가 지킨다** — 그 검사는 조립과
   * 함께 온다(계획 1-b).
   */
  recordedSplit?: RecordedSplit | undefined
}

declare const recordedSplitBrand: unique symbol

/**
 * 파일에서 읽은 분할. **학습 화면이 실수로 만들 수 없게 브랜드를 달았다** —
 * 평범한 `{ trainIndices, testIndices }`는 이 타입이 아니다.
 */
export interface RecordedSplit {
  readonly trainIndices: readonly number[]
  readonly testIndices: readonly number[]
  readonly [recordedSplitBrand]: true
}

/**
 * 인덱스 둘을 `RecordedSplit`으로 만든다. **부르는 곳은 조립 하나여야 한다.**
 *
 * 브랜드는 타입 안에서만 사는 표시라 런타임 값이 늘지 않는다 - 그래서 여기서 단언한다.
 */
export function asRecordedSplit(split: {
  readonly trainIndices: readonly number[]
  readonly testIndices: readonly number[]
}): RecordedSplit {
  return split as RecordedSplit
}

/**
 * 계획을 세울 수 없는 이유.
 *
 * - `error` — 학습이 거부한다. 그대로 `ClientError`가 된다.
 * - `pending` — 학생이 아직 안 고른 것이 있다. **실패가 아니다.** 화면은 "고르면
 *   정해집니다"라고 말하고, 학습 경로에서는 나올 수 없다(그쪽은 유형을 받고 온다).
 */
export type PlanBlock =
  | { kind: 'error'; code: ClientErrorCode; params: ClientErrorParams }
  | { kind: 'pending'; missing: 'taskType' }

export interface PlanFacts {
  /** 정본의 전체 행 수. 무엇이 얼마나 빠졌는지의 분모다. */
  totalRows: number
  /** 학습에 쓸 수 있는 행의 **원본 번호**. 타깃이 비었거나 `drop`으로 걸린 행이 빠졌다. */
  usable: readonly number[]
  /** 뽑힌 행. 뽑기를 안 켰으면 `usable`과 같다. 분할되는 것은 이쪽이다. */
  sampled: readonly number[]
  split: { readonly trainIndices: readonly number[]; readonly testIndices: readonly number[] }
  /**
   * `testIndices`가 **`testDataset`의 행 번호인가.** `provided`일 때만 참이고, 그때는
   * `trainIndices`와 서로 다른 정본을 가리킨다 (mlpx-spec.md §1.1).
   */
  testFromProvided: boolean
  /** 훈련 데이터에서 구한 전처리기. 채움값·스케일 기준·범주 목록이 여기 있다. */
  preprocessor: Preprocessor
  /** 뽑힌 행의 타깃 값. 군집이면 빈 배열이다. */
  labels: readonly string[]
  /** 분할하지 않는가 (architecture.md §3.6). */
  isClustering: boolean
  /** 학습이 타깃을 무엇으로 봤는가 (`TargetJudgment`). 군집이면 없다. */
  targetKind?: ColumnKind
}

/**
 * **학습이 타깃을 무엇으로 봤는가.** 쓸 수 있는 행(`usable`)의 라벨로 센다 — 파일 전체가
 * 아니다. 계획이 그 뒤에서 거부해도 판정은 이미 났으므로 **거부에도 실린다.** 타깃 판정
 * 앞에서 섰으면(타깃 미선택 · 유형 미정) 없다.
 *
 * **화면은 타깃 열의 종류를 이것으로 말한다** (2026-09-23 R38-V V-A1). 화면이 파일 전체로
 * 세면 `drop`으로 빠지는 행에만 글자가 있을 때 학습은 받는데 화면은 *"거부한다"*고 했다 —
 * 특성 열의 R38 A-2와 같은 병이다. 화면이 같은 행을 따로 세는 대신 여기서 읽는다.
 * `tabular-prep-kind.spec.ts`의 *"타깃 줄이 학습의 판정을 말한다"*가 문다.
 */
export interface TargetJudgment {
  targetKind?: ColumnKind
}

export type RunPlan =
  ({ ok: true } & PlanFacts) | ({ ok: false; reason: PlanBlock } & TargetJudgment)

/**
 * 정본의 타깃 사유를 **따로 올린 테스트 표**의 것으로 옮긴다 (R38-V2 C-1). 유형이 요구하는
 * 종류가 늘면 여기 한 줄이 는다 — 타입이 빠진 짝을 잡는다.
 */
const TEST_TARGET_CODE = {
  TARGET_NOT_NUMERIC: 'TEST_DATASET_TARGET_NOT_NUMERIC',
} as const satisfies Record<
  NonNullable<ReturnType<typeof requiredTargetKind>>['code'],
  ClientErrorCode
>

const blocked = (code: ClientErrorCode, params: ClientErrorParams = {}): RunPlan => ({
  ok: false,
  reason: { kind: 'error', code, params },
})

/**
 * 지금 설정으로 학습하면 무엇이 되는가.
 *
 * **`runExperiment`가 부르는 그 함수다.** 여기서 나온 값이 그대로 학습에 들어간다 —
 * 화면이 보는 것과 모델이 보는 것이 같은 객체다.
 */
export function planRun(input: PlanInput): RunPlan {
  const { dataset, testDataset, settings, taskType } = input
  /**
   * **여기서 읽는 설정은 언제나 표의 모양이다.** 이미지도 임베딩을 열 이름 붙인 표로
   * 바꿔서 들어온다 (open-decisions.md "이미지 학습은 표 문제로 바꿔서 푼다").
   */
  const data = dataSettings('tabular', settings)
  const { target } = data

  // 유형을 모르면 분할을 말할 수 없다. **거부가 아니라 아직 정해지지 않은 것이다.**
  if (taskType === undefined) return { ok: false, reason: { kind: 'pending', missing: 'taskType' } }

  const isClustering = taskType === 'clustering'

  // 군집화에는 타깃이 없다 (architecture.md §3.6). 분류·회귀는 정답 열이 있어야
  // 학습도 채점도 된다.
  if (!isClustering && (target === undefined || target === '')) {
    return blocked('TARGET_NOT_SELECTED')
  }
  /**
   * **타깃 이름이 표에 없으면 사유로 돌려준다.** 손으로 고친 `.mlpx`가 그렇게 열린다. 아래
   * `targetValues`는 `try` 밖이라 던지면 화면의 계산(`tabularPlanOf`를 읽는 computed)이 죽는다.
   * `plan.spec.ts`의 *"타깃 이름이 표에 없으면 던지지 않고 사유로 선다"*가 문다.
   */
  if (!isClustering && !dataset.columns.includes(target!)) {
    return blocked('COLUMN_NOT_FOUND', { column: target! })
  }

  /**
   * **학습에 넣는 특성. 타깃과 같은 이름은 여기서 뺀다** (`open-decisions.md` 55).
   *
   * 설정의 특성 목록은 학생이 켠 것을 그대로 든다 — 특성으로 골라 둔 열을 나중에 타깃으로
   * 고르면 그 이름이 목록에 남는다(`project/settings.ts`의 `withTarget`). **정답이 문제에
   * 들어가 정확도가 1.0으로 나오는 것을 막는 자리가 이제 여기 하나다.** 아래에서 특성을
   * 쓰는 자리는 전부 이 값을 쓴다 — 설정의 목록을 직접 읽으면 그 자리로 샌다.
   * `option-cascade.spec.ts`의 *"학습 계획은 타깃과 같은 이름을 특성에서 뺀다"*가 문다.
   */
  const features = featuresInUse(data.features, isClustering ? undefined : target)

  // provided일 때만 쓰는 테스트 데이터셋의 usableRows. holdout이면 undefined다 -
  // splitRows가 그때는 아예 보지 않는다 (ml/split.ts).
  // 군집화에는 테스트 데이터셋이 없다 — 전체 데이터로 학습한다.
  const testFromProvided = !isClustering && settings.split.method === 'provided' && !!testDataset
  /**
   * **따로 올린 테스트 표에 타깃 열이 없으면 사유로 돌려준다.** 화면의 입구는 열을 맞춰 받지만
   * 손으로 고친 `.mlpx`는 그 표를 그대로 연다. 아래 `targetValues(testDataset, …)`는 `try`
   * 밖이라 던지면 화면의 계산이 죽는다. `plan.spec.ts`의 *"테스트 표에 타깃 열이 없으면 …"*이 문다.
   */
  if (testFromProvided && !testDataset!.columns.includes(target!)) {
    return blocked('TEST_DATASET_COLUMN_MISSING', { columns: target! })
  }
  const providedTestRows = testFromProvided
    ? usableRows(testDataset!, features, target!, data.preprocessing.missing)
    : undefined

  // 군집화에는 타깃이 없으므로 usableRows에 undefined를 넘긴다. usableRows는
  // target이 없으면 타깃 결측 검사를 건너뛴다.
  const usable = usableRows(
    dataset,
    features,
    isClustering ? undefined : target,
    data.preprocessing.missing,
  )
  /**
   * **쓸 수 있는 행이 하나도 없으면 타깃의 종류를 판정하지 않는다** (`open-decisions.md` 53,
   * R38-V2 B-1). 행이 없으면 종류도 없는데 `detectKind([])`는 `categorical`이라, 숫자뿐인
   * 회귀 타깃에 *"숫자가 아닌 값이 있습니다"*라고 답했고 전처리 화면의 타깃 줄이 그 말을
   * 빨갛게 옮겼다. **분할이 같은 입력에서 던지던 코드를 그대로 쓴다** — 새 어휘가 안 생긴다.
   * `targetKind`를 안 실으므로 화면은 파일 전체의 종류로 돌아간다. 군집은 타깃이 없어
   * 해당 없다. `tabular-prep-kind.spec.ts`의 *"쓸 수 있는 행이 0개면 … 계획은 행 수로 선다"*가 문다.
   */
  if (!isClustering && usable.length === 0) {
    return blocked('SPLIT_TOO_FEW_ROWS', {
      minRows: settings.split.method === 'provided' ? 1 : MIN_SPLIT_ROWS,
      actualRows: 0,
    })
  }
  const usableLabels = isClustering ? [] : targetValues(dataset, usable, target!)
  // **아래 판정과 화면이 읽는 값이 같은 식이다** — 따로 두면 둘이 갈린다.
  const judged: TargetJudgment = isClustering ? {} : { targetKind: detectKind(usableLabels) }
  const refuse = (code: ClientErrorCode, params: ClientErrorParams = {}): RunPlan => ({
    ...blocked(code, params),
    ...judged,
  })

  // **성립하지 않는 조합은 분할보다 먼저 거부한다.** 여기서 넘기면 지표가 NaN인 채로
  // run이 done으로 끝나고, 그 파일은 저장은 되는데 다시 열리지 않는다.
  // 군집화에는 타깃 자료형 요구가 없다.
  if (!isClustering) {
    const required = requiredTargetKind(taskType)
    // **표본이 아니라 쓸 수 있는 행 전부를 본다.** 타깃이 숫자인지 범주인지는 열의
    // 성질이지 뽑기의 결과가 아니고, 표본으로 판정하면 nSamples를 움직일 때마다
    // 같은 데이터의 판정이 흔들릴 수 있다.
    if (required && judged.targetKind !== required.kind) {
      return refuse(required.code, { target: target! })
    }

    /**
     * **따로 올린 테스트 표의 타깃도 같은 잣대로 본다** (2026-09-21 R36-V V-1).
     *
     * 위 줄이 보는 `usableLabels`는 **정본**의 라벨이다. `provided`면 채점에 쓰는 정답이
     * **다른 표**에서 오는데(`experiment.ts`의 `targetValues(testSource, …)`) 그쪽은
     * 아무도 안 봤다 — 회귀에서 거기 글자가 있으면 `evaluateRegression`의 `Number()`가
     * `NaN`을 만들고 지표 가드가 `JOB_FAILED`로 던진다. **시끄럽게 죽긴 하는데 열
     * 이름도 값도 없다.** 같은 데이터가 특성 열에 있었으면 `FEATURE_NOT_NUMBER`가
     * 짚어 주므로, 같은 병에 얼굴이 둘이었다.
     *
     * **어휘는 테스트 표의 것이다** (2026-09-23, R38-V2 C-1). 처음에는 *"새 어휘를 안
     * 만든다"*며 `TARGET_NOT_NUMERIC`을 썼는데, 그 문장을 읽은 학생은 **정본**의 타깃 열을
     * 뒤진다 — 정본의 타깃 줄은 조용한데. 할 일(테스트 파일을 고친다)이 달라 가른다.
     * `plan-not-number.spec.ts`의 *"테스트 표의 타깃이 글자면 테스트 표의 이름으로 말한다"*가 문다.
     */
    if (required && testFromProvided) {
      const testLabels = targetValues(testDataset!, providedTestRows ?? [], target!)
      if (testLabels.length > 0 && detectKind(testLabels) !== required.kind) {
        return refuse(TEST_TARGET_CODE[required.code], { target: target! })
      }
    }
  }

  // **"아무것도 안 함"은 빈 칸이 있으면 거부한다.** 조용히 두는 길이 없어서다 - 수치
  // 열의 빈 칸은 결국 0이 되고, 그러면 그 이름으로 0 채우기를 하는 셈이 된다
  // (open-decisions.md "전처리도 분할도 끌 수 있다"). **전체**를 본다 - provided면
  // 테스트 데이터셋도 같은 전처리를 받으므로(mlpx-spec.md §1.1) 거기도 봐야 한다.
  // 군집화에는 타깃이 없으므로 특성만 본다.
  if (data.preprocessing.missing === 'none') {
    const checked = isClustering ? [...features] : [...features, target!]
    const blank =
      missingColumns(dataset, checked)[0] ??
      (testFromProvided ? missingColumns(testDataset!, checked)[0] : undefined)
    if (blank) return refuse('FEATURE_HAS_MISSING', { feature: blank.name, count: blank.count })
  }

  /**
   * **여기부터는 던지는 코드다.** 뽑기·분할·전처리기는 성립하지 않는 조합에서
   * `ClientError`를 던진다 — 층화할 수 없는 타깃, 너무 적은 행, 통째로 빈 특성,
   * 하나도 안 남은 특성. **전부 학생이 화면에서 만들 수 있는 상태이므로** 카드가
   * 사유로 말할 수 있어야 한다.
   *
   * 삼키는 자리를 여기 하나로 모은다. 부르는 쪽마다 `try`를 두면 무엇을 삼킬지가
   * 자리마다 갈리고, 그러면 화면과 학습이 다른 목록을 본다.
   */
  /**
   * **층화가 막히면 무시한다. 파일의 값은 안 건드린다** (`open-decisions.md` 55
   * *"끄지 않고 잠근다"*). 유형 · 표본 수 · 시험 비율 · 데이터(값이 1개뿐 · 연속 타깃),
   * 이유가 무엇이든 분할은 같다 — 전처리 화면은 같은 판정(`stratifyBlockFor`)으로 체크박스를 잠근다.
   * **뽑기는 아래 `sampleSettings`가 따로 본다** — 분할 쪽 사유만 있으면 뽑기는 층화하고 화면은
   * 잠그지 않는다(`StratifyBlock.stillSamples`, `open-decisions.md` 64 ①).
   *
   * **무시하는 자리가 여기 하나다.** 화면마다 무시하면 화면과 학습이 다른 것을 돌린다.
   * `ml/split.ts`·`ml/sample.ts`의 거부는 그대로 남는다 — 이 판정과 같은 조건이라 여기서
   * 넘어가면 닿지 않는다. **오늘은 어떤 입력에서도 안 닿는다** — 그 둘을 부르는 곳이 아래
   * 둘뿐이고, 재실행 대조는 기록된 분할로 건너뛴다(R38-D55 I5). 계획을 거치지 않는 호출이
   * 새로 생기면 그때 방어선이 된다.
   */
  const splitSettings = {
    ...settings.split,
    stratify: stratifyApplies(
      settings.split.stratify,
      stratifyBlockFor(taskType, usableLabels, settings.nSamples, settings.split),
    ),
  }
  /**
   * **뽑기는 뽑기의 사유만 본다** (`open-decisions.md` 64 ①). 나눌 때만 막히는 데이터(한 값뿐인
   * 라벨 등)에서 분할 층화를 따라 뽑기 층화까지 끄면 드문 범주가 표본에서 조용히 빠진다.
   */
  const sampleSettings = {
    ...settings.split,
    stratify: stratifyApplies(
      settings.split.stratify,
      sampleStratifyBlockFor(taskType, usableLabels, settings.nSamples),
    ),
  }

  try {
    /**
     * **파일에 적힌 분할이 있으면 뽑기와 나누기를 건너뛴다.**
     *
     * 뽑힌 행은 훈련과 시험의 합집합이다 — **`provided`는 예외로, 시험 행이 다른 표의
     * 번호라 여기 더할 수 없다** (mlpx-spec.md §1.1).
     */
    const recorded = input.recordedSplit
    if (recorded && !isClustering && settings.split.method === 'provided' && !testDataset) {
      // **여기서 던지던 것은 `splitRows`였고 기록된 분할이 그 자리를 건너뛴다.**
      // 안 막으면 시험 표의 행 번호로 훈련 표를 잘라 **엉뚱한 행으로 채점한 숫자**가
      // 나온다 - 범위 안이면 아무 예외도 없이 조용히 틀린다.
      throw new ClientError('TEST_DATASET_NO_USABLE_ROWS')
    }
    const sampled = recorded
      ? [...recorded.trainIndices, ...(testFromProvided ? [] : recorded.testIndices)].sort(
          (a, b) => a - b,
        )
      : // **뽑고 나서 나눈다** (open-decisions.md #22). 뽑힌 행만 분할되므로 trainIndices와
        // testIndices의 뜻은 그대로이고, **뽑히지 않은 행은 그 둘의 여집합**이라 따로 적지
        // 않는다. nSamples가 없으면 usable을 그대로 돌려주므로 지금까지의 동작과 같다.
        sampleRows(
          { rows: usable, ...(isClustering ? {} : { labels: usableLabels }) },
          sampleSettings,
          settings.nSamples,
        )
    // 뽑힌 행의 정답이다. usableLabels를 잘라 쓰지 않는 이유는 sampleRows가 원본 행
    // 번호를 오름차순으로 돌려주지 usable의 위치를 돌려주지 않기 때문이다 - 위치로
    // 착각해 자르면 라벨이 조용히 다른 행의 것이 된다.
    const labels = isClustering ? [] : targetValues(dataset, sampled, target!)

    // **군집화는 나누지 않는다** (architecture.md §3.6). 전체 데이터로 학습하고,
    // trainIndices는 전체, testIndices는 빈 배열이다. 교실에서 "왜 나누지 않나요?"는
    // 비지도학습을 이해하는 좋은 질문이고, 그것을 설명할 자리가 생기는 것이 교육적 가치다.
    const split = recorded
      ? { trainIndices: [...recorded.trainIndices], testIndices: [...recorded.testIndices] }
      : isClustering
        ? { trainIndices: sampled, testIndices: [] as number[] }
        : splitRows(
            { rows: sampled, labels },
            splitSettings,
            providedTestRows ? { rows: providedTestRows } : undefined,
          )

    /**
     * **열 종류는 이 실행이 쓰는 행 전체로 정한다** (open-decisions.md 53, 2026-09-23).
     * 훈련 몫만 보면 **무작위 분할이 해석을 정했다** — 같은 `모름` 한 칸이 훈련 몫이면
     * 범주, 시험 몫이면 아래에서 거절이었다. 파라미터(채움값·스케일·범주 목록)는 여전히
     * 훈련 몫만 본다.
     *
     * **따로 올린 테스트 파일은 넣지 않는다.** 행 번호가 다른 파일을 가리키고, 그 파일의
     * 글자 칸은 아래에서 거절한다.
     */
    const kindIndices = testFromProvided
      ? split.trainIndices
      : [...split.trainIndices, ...split.testIndices]
    const preprocessor = fitPreprocessor(
      dataset,
      split.trainIndices,
      features,
      data.preprocessing,
      kindIndices,
    )

    /**
     * **수치 열의 시험 몫에 수로 못 읽는 값이 있으면 학습 전에 거절한다**
     * (2026-09-21 R36 A-1).
     *
     * **지금 이 거절에 닿는 것은 따로 올린 테스트 파일뿐이다** (2026-09-23). 같은 파일의
     * 시험 몫은 위에서 종류 판정에 들어가므로, 거기 `없음`이 있으면 열이 범주가 되지
     * 수치 열 안의 못 읽는 칸으로 남지 않는다.
     *
     * 처음 선 사연: 열 판정이 훈련 몫만 보고 `transform`은 시험 몫도 돌려서, 시험 몫에만
     * 있는 `없음`·`N/A`가 **조용히 `0`이 되어 정확도와 R²에 섞였다** — 실패도 경고도
     * 없이 그 숫자가 포트폴리오에 적혔다.
     *
     * **여기서 막는 이유.** `transform`을 부르는 자리(`experiment.ts`)는 어떤 `try`
     * 안에도 없어서 던지면 **run 하나가 아니라 학습 전체가 죽는다.** 계획 단계면
     * 전처리 화면의 요약 카드가 같은 함수를 쓰므로(architecture.md §9.1.3) **학생이
     * 고칠 수 있는 화면에서 열 이름과 함께 본다.**
     *
     * **훈련 몫은 안 본다** — `detectKind`가 이미 보장한다(`unreadableNumericCell`).
     */
    const unreadable = unreadableNumericCell(
      preprocessor,
      testFromProvided ? testDataset! : dataset,
      split.testIndices,
    )
    if (unreadable) {
      throw new ClientError('FEATURE_NOT_NUMBER', {
        feature: unreadable.name,
        value: unreadable.value,
      })
    }

    return {
      ok: true,
      totalRows: dataset.rows.length,
      usable,
      sampled,
      split,
      testFromProvided,
      preprocessor,
      labels,
      isClustering,
      ...judged,
    }
  } catch (error) {
    if (isClientError(error)) return refuse(error.code, error.params)
    throw error
  }
}

/**
 * 열 요약의 종류를 **계획이 본 종류로 덮는다.** `summarizeColumns`는 파일 전체의 행으로
 * 종류를 세고 계획은 그 실행이 쓰는 행으로 센다(결정문 53) — 화면이 학습과 같은 말을 하려면
 * 이것을 지나야 한다.
 *
 * - **특성 열**은 계획이 선 열만 덮는다(`preprocessor.columns`). 계획에서 빠진 열은 파일
 *   전체의 종류로 남는다.
 * - **타깃 열**은 `targetKind`로 덮는다. 계획이 거부해도 실린다 — 타깃 판정 자체가 거부의
 *   이유일 때 그 빨강은 옳다.
 * - **계획이 없거나 못 섰으면** 파일 전체의 종류다.
 *
 * 화면마다 이 덮기를 다시 쓰지 않는다. 점검의 대조 판은 계획을 다시 세우지 않고
 * (`inspect-rules.spec.ts`) 기록된 전처리기로 같은 몸통(`fittedKinds`)을 지난다.
 * `train-prep-kind.spec.ts`가 전처리 판과 학습 화면을 나란히, `tabular-prep-kind.spec.ts`가
 * 전처리 판을, `inspect-reproduce-width.spec.ts`가 대조 판을 문다.
 */
export function plannedColumns(
  columns: readonly ColumnSummary[],
  plan: RunPlan | null,
  target: string | undefined,
): ColumnSummary[] {
  return fittedKinds(columns, plan?.ok ? plan.preprocessor : null, target, plan?.targetKind)
}

/**
 * `plannedColumns`의 몸통. **전처리기가 본 종류로 덮는다** — 계획이 방금 지은 것이든 파일에
 * 기록된 것(`experimentPreprocessor`)이든 같은 물건이다.
 */
export function fittedKinds(
  columns: readonly ColumnSummary[],
  preprocessor: Pick<Preprocessor, 'columns'> | null,
  target: string | undefined,
  targetKind: ColumnKind | undefined,
): ColumnSummary[] {
  const fitted = preprocessor
    ? new Map(preprocessor.columns.map((column) => [column.name, column.kind]))
    : undefined
  return columns.map((summary) => {
    const kind =
      summary.name === target && targetKind !== undefined ? targetKind : fitted?.get(summary.name)
    return kind !== undefined && kind !== summary.kind ? { ...summary, kind } : summary
  })
}

/**
 * 계획을 세우거나 그 사유로 던진다. **학습 경로가 쓴다.**
 *
 * `pending`은 여기서 나올 수 없다 — 이 경로는 유형을 받고 온다. 그래도 조용히
 * 넘어가지 않고 시끄럽게 죽는다.
 */
export function planRunOrThrow(input: PlanInput & { taskType: TaskType }): PlanFacts {
  const plan = planRun(input)
  if (plan.ok) return plan
  if (plan.reason.kind === 'error') throw new ClientError(plan.reason.code, plan.reason.params)
  throw new Error(`planRun returned pending for a known task type: ${plan.reason.missing}`)
}
