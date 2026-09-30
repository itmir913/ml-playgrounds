/**
 * **점검의 대조가 얼마나 걸릴까** (open-decisions.md 87, architecture.md §8.21).
 *
 * 대조 판(`views/inspect/ReproducePanel.vue`)이 누르기 전에 적는 예상이다. **입력은 학습 화면이 내는 것과
 * 같은 모양이다** — 데이터 종류는 실험의 것, 행 수는 그 실험이 학습한 훈련 몫, 특성 수는 표면 전처리 뒤의
 * 폭이고 표가 아니면 0이다(학습 화면도 표 설정이 없으면 0을 넘긴다 — 사진의 폭은 사진 기준표가 이미 쟀다).
 * 분류면 클래스 수도 넘긴다(open-decisions.md 88) — 학습 화면이 넘기는 것과 같은 칸이고, **학습 화면과 같은
 * 규칙으로 그 실험의 훈련 몫을 센다**(88의 개정). 기록에 남은 혼동 행렬은 시험 몫의 라벨이라 드문 클래스가
 * 빠진다 — 셀 수 없을 때만 그리로 물러선다.
 * 기준표가 빈 칸은 `browserEstimateMs`가 `null`로 돌려 `알 수 없음`이 된다 — 지어내지 않는다.
 *
 * `tests/reproduce-estimate.spec.ts`가 문다.
 */

import { RUNTIMES } from './backend'
import { browserEstimateMs, describe, type Estimate } from './estimate'
import type { Dataset } from './preprocess'
import { countsClasses, targetClassCount } from './training-source'
import { DATA_SCHEMAS, type DataType, type Experiment } from '@/project/schema'

/** `browserEstimateMs`가 받는 입력 — 실행 방법은 등록부의 id 그대로이고, 좁히기는 그쪽이 한다. */
export type ReproduceEstimateInput = Parameters<typeof browserEstimateMs>[0]

export interface ReproduceEstimateSubject {
  readonly experiment: Experiment
  readonly dataType: DataType
  /**
   * 표 실험이면 대조 판이 센 특성 폭(`ReproducePanel`의 `featureWidth` — 기록된 전처리기로 센 것).
   * **표를 못 열었으면 `null`이다** — 폭을 모르면 예상도 모른다. 표가 아닌 실험에서는 안 읽는다.
   */
  readonly featureWidth: number | null
  /**
   * 대조 판이 연 훈련 표(`ReproducePanel`의 `dataset` — 그 파일의 `data.csv`). 표 실험의 클래스 수를 그 실험의
   * `trainIndices` 행에서 센다. **못 열었으면 `null`이다.** 표가 아닌 실험에서는 안 읽는다.
   */
  readonly dataset: Dataset | null
}

/**
 * 기록으로 세는 훈련 몫의 클래스 수. **종류마다 세는 것이 다르다** — 학습 화면의 `TRAINING_CLASS_COUNTS`
 * (`ml/training-source.ts`)와 짝이다. 셀 수 없으면 `undefined`이고, 그때 부르는 쪽이 혼동 행렬로 물러선다.
 *
 * - **표**는 대조 판이 연 표의 `trainIndices` 행에서 타깃 값의 종류 수다 — 학습 화면과 **같은 함수**
 *   (`targetClassCount`)라 앞뒤 공백과 결측을 같게 다룬다.
 * - **사진**은 스냅샷의 범주별 장수(`categoryCounts`)에서 한 장이라도 있는 범주의 수다. 스냅샷의 `categories`는
 *   빈 범주까지 든 목록이라 그대로 세면 많게 센다. 장수는 학습 때 라벨 붙은 사진 전부의 것이라(미분류는
 *   `unlabeledCount`로 따로 간다) **학습 화면이 그때 센 `labeledCategoryCount`와 같은 수이고, 훈련 몫만의 수는
 *   아니다** — 시험 몫에만 있는 범주가 있으면 학습 화면처럼 많게 센다.
 *
 * **종류를 비교하지 않고 등록부로 둔다** (architecture.md §9.3) — 종류를 더하는 사람은 칸을 채워야 한다.
 */
const RECORDED_CLASS_COUNTS: Readonly<
  Record<DataType, (experiment: Experiment, dataset: Dataset | null) => number | undefined>
> = {
  tabular: (experiment, dataset) => {
    const data = DATA_SCHEMAS.tabular.snapshot.safeParse(experiment.settings.data)
    if (!data.success || dataset === null || data.data.target === undefined) return undefined
    return targetClassCount(dataset, experiment.settings.trainIndices, data.data.target)
  },
  image: (experiment) => {
    const data = DATA_SCHEMAS.image.snapshot.safeParse(experiment.settings.data)
    if (!data.success) return undefined
    // **이름으로 센다.** 옛 파일은 `categories`에 같은 이름이 두 번 들 수 있다(`renameCategory`가 겹침을 걷기 전) —
    // 칸으로 세면 한 범주가 둘이 된다. `tests/reproduce-estimate.spec.ts`의 *"같은 이름이 두 칸이면"*이 문다.
    const { categories, categoryCounts } = data.data
    return new Set(categories.filter((_, index) => (categoryCounts[index] ?? 0) > 0)).size
  },
}

/**
 * 대조가 다시 돌릴 run마다의 예상 입력. **하나라도 모르면 `null`이다** — 실험 하나가 통째로 도는 시간이라
 * 한 줄을 빼고 더하면 짧게 틀린다.
 *
 * **종류를 비교하지 않고 스키마에 묻는다** (architecture.md §9.1). 실험의 설정이 그 종류의 스냅샷으로 안
 * 읽히면 모른다. 표 스냅샷으로 읽히면 표로 센 폭이 있어야 하고, 아니면 폭은 0이다.
 *
 * **브라우저에서 돈 줄만 안다.** 파일의 엔진이 브라우저 실행 방법이 아니면(서버) 모른다 — 우리가 모르는
 * 기기다. 서버를 거르는 일은 `browserEstimateMs`가 한다.
 */
export function reproduceEstimateInputs(
  subject: ReproduceEstimateSubject,
): ReproduceEstimateInput[] | null {
  const { experiment, dataType } = subject
  const data = experiment.settings.data
  if (!DATA_SCHEMAS[dataType].snapshot.safeParse(data).success) return null

  let columns = 0
  if (DATA_SCHEMAS.tabular.snapshot.safeParse(data).success) {
    if (subject.featureWidth === null) return null
    columns = subject.featureWidth
  }
  const rows = experiment.settings.trainIndices.length
  /**
   * **클래스 수는 학습 화면과 같은 규칙으로 훈련 몫에서 센다** (open-decisions.md 88의 개정). 분류가 아니면
   * 비고, 그러면 클래스 배수가 안 붙는다. 실험 하나에 한 번 센다 — run마다 같은 훈련 몫이다.
   */
  const counts = countsClasses(experiment.settings.taskType)
  const recorded = counts ? RECORDED_CLASS_COUNTS[dataType](experiment, subject.dataset) : undefined

  const inputs: ReproduceEstimateInput[] = []
  for (const run of experiment.runs) {
    if (run.status !== 'done') continue
    const runtime = RUNTIMES.find((one) => one.engineKind === run.engine?.kind)?.id
    if (runtime === undefined) return null
    inputs.push({
      algorithm: run.algorithm,
      dataType,
      rows,
      columns,
      hyperparameters: run.hyperparameters,
      runtime,
      /**
       * **셀 수 없을 때만** 기록에 남은 혼동 행렬의 라벨 수로 물러선다 — 시험 몫의 정답과 예측이라 시험 몫에 안
       * 나온 클래스는 빠져 짧게 틀린다(감사 슬라이스 1 B-1의 재현에서 10클래스가 2가 됐다).
       */
      classes: counts ? (recorded ?? run.confusionMatrix?.labels.length) : undefined,
    })
  }
  return inputs
}

/**
 * 대조 전체의 예상. **모델은 하나씩 차례로 돌므로 합이 곧 기다림이다.** 기기 배수를 아직 못 쟀으면
 * (`factor`가 `null`) 모른다.
 */
export function reproduceEstimate(
  subject: ReproduceEstimateSubject,
  factor: number | null,
): Estimate {
  if (factor === null) return { kind: 'unknown' }
  const inputs = reproduceEstimateInputs(subject)
  if (inputs === null) return { kind: 'unknown' }
  let total = 0
  for (const input of inputs) {
    const ms = browserEstimateMs(input, factor)
    if (ms === null) return { kind: 'unknown' }
    total += ms
  }
  return describe(total)
}
