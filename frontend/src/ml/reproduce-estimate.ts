/**
 * **점검의 대조가 얼마나 걸릴까** (open-decisions.md 87, architecture.md §8.21).
 *
 * 대조 판(`views/inspect/ReproducePanel.vue`)이 누르기 전에 적는 예상이다. **입력은 학습 화면이 내는 것과
 * 같은 모양이다** — 데이터 종류는 실험의 것, 행 수는 그 실험이 학습한 훈련 몫, 특성 수는 표면 전처리 뒤의
 * 폭이고 표가 아니면 0이다(학습 화면도 표 설정이 없으면 0을 넘긴다 — 사진의 폭은 사진 기준표가 이미 쟀다).
 * 기준표가 빈 칸은 `browserEstimateMs`가 `null`로 돌려 `알 수 없음`이 된다 — 지어내지 않는다.
 *
 * `tests/reproduce-estimate.spec.ts`가 문다.
 */

import { RUNTIMES } from './backend'
import { browserEstimateMs, describe, type Estimate } from './estimate'
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
