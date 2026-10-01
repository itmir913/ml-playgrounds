/**
 * 분류 모델의 **결정 경계** (`open-decisions.md` "69. 훈련 데이터가 2·3차원일 때 결과를 그림으로 보일
 * 것인가").
 *
 * scikit-learn `DecisionBoundaryDisplay`와 같은 그림이다 — 두 특성의 평면을 격자로 나눠 칸마다 모델이
 * 고를 범주를 깔고, 그 위에 테스트 데이터를 실제 범주로 찍는다. **입력 열이 수치 정확히 둘일 때만**
 * 선다. 셋 이상의 단면은 실제 점과 같은 평면에 있지 않아 안 그린다(sklearn도 거부한다).
 *
 * **재학습하지 않는다.** 학생이 학습한 그 모델로 격자를 예측한다. 그 모델이 저장된 혼동 행렬을 다시
 * 내는지 먼저 대조하고(`ml/confusion-rows.ts`), 다르면 안 그린다. 무는 검사: `tests/decision-boundary.spec.ts`.
 *
 * **Vue도 chart.js도 모른다.**
 */

import { DECISION_BOUNDARY_GRID, DECISION_BOUNDARY_MARGIN } from '@/limits'
import { dataSnapshot } from '@/project/schema'

import { confusionRowsFor, type ConfusionRowsInput } from './confusion-rows'
import { loadModel } from './models'
import { predictInSteps, StepsCancelled, type StepControl } from './predict-in-steps'
import { trainingRowsFor } from './predict'
import { transform, targetValues, type Dataset } from './preprocess'

export interface DecisionBoundary {
  /** 가로·세로 축의 열 이름. 전처리기의 열 차례다. */
  readonly features: readonly [string, string]
  /**
   * 범주 이름. **혼동 행렬과 같은 차례이고, 격자에서만 나온 범주가 뒤에 붙는다** — 색이 그 차례를
   * 따른다.
   */
  readonly labels: readonly string[]
  /** 격자의 가로·세로 좌표(원래 단위, 오름차순). */
  readonly xs: readonly number[]
  readonly ys: readonly number[]
  /** `classes[j * xs.length + i]` = 칸 (xs[i], ys[j])에서 모델이 고른 범주의 자리(`labels`의). */
  readonly classes: Int32Array
  /** 테스트 데이터. `label`은 실제 범주의 자리다. */
  readonly points: readonly {
    readonly row: number
    readonly x: number
    readonly y: number
    readonly label: number
  }[]
}

export type DecisionBoundaryResult =
  | { readonly kind: 'boundary'; readonly boundary: DecisionBoundary }
  /** 모델이 저장된 혼동 행렬을 다시 내지 않는다. 그리지 않고 그 사실만 말한다. */
  | { readonly kind: 'mismatch' }

/**
 * 이 실행에 결정 경계의 자리가 있는가. **입력 열이 수치 정확히 둘이고 재료가 다 있을 때만이다** — 아니면
 * 패널은 자리 자체가 없다. 예측하지 않으므로 화면을 열 때 바로 부른다(계산은 단추를 눌러야 한다).
 */
export function decisionBoundaryAvailable(input: ConfusionRowsInput): boolean {
  const { run, dataset, preprocessor, modelBytes } = input
  if (!run.confusionMatrix || !modelBytes || !dataset || !preprocessor) return false
  const [first, second] = preprocessor.columns
  if (preprocessor.columns.length !== 2 || !first || !second) return false
  return first.kind === 'numeric' && second.kind === 'numeric'
}

/**
 * 결정 경계. **자리가 없거나(`decisionBoundaryAvailable`) 다시 예측하지 못하면 `null`.**
 *
 * **나눠 예측하고 그 사이마다 화면에 양보한다** (`predict-in-steps.ts`) — 격자가 1만 점이고, KNN은 한 점이
 * 훈련 행 수만큼의 거리 계산이다.
 */
export async function decisionBoundaryFor(
  input: ConfusionRowsInput,
  control: StepControl = {},
): Promise<DecisionBoundaryResult | null> {
  if (!decisionBoundaryAvailable(input)) return null
  const { run, experiment, dataset, preprocessor, modelBytes } = input
  const stored = run.confusionMatrix
  const [first, second] = preprocessor?.columns ?? []
  if (!stored || !modelBytes || !dataset || !preprocessor || !first || !second) return null

  const check = await confusionRowsFor(input, control)
  if (check === null) return null
  if (check.kind === 'mismatch') return { kind: 'mismatch' }
  const source = check.rows.source

  const { settings } = experiment
  let snapshot: ReturnType<typeof dataSnapshot<'tabular'>>
  try {
    snapshot = dataSnapshot('tabular', settings)
  } catch {
    return null
  }
  const target = snapshot.target
  if (target === undefined || target === '') return null
  const encoding = snapshot.preprocessing.categoricalEncoding

  const columnsOf = (table: Dataset) => [
    table.columns.indexOf(first.name),
    table.columns.indexOf(second.name),
  ]
  const valuesOf = (table: Dataset, rows: readonly number[]) => {
    const [a, b] = columnsOf(table)
    return rows.map((row) => [
      Number(table.rows[row]?.[a ?? -1] ?? Number.NaN),
      Number(table.rows[row]?.[b ?? -1] ?? Number.NaN),
    ])
  }
  // 범위는 학습과 시험 데이터 전부에서 잰다 — 시험 점만 보면 학습이 본 자리가 잘린다.
  const seen = [
    ...valuesOf(dataset, settings.trainIndices),
    ...valuesOf(source, settings.testIndices),
  ]
  const xRange = rangeOf(seen.map((pair) => pair[0] ?? Number.NaN))
  const yRange = rangeOf(seen.map((pair) => pair[1] ?? Number.NaN))
  if (!xRange || !yRange) return null

  const xs = gridOf(xRange.low - DECISION_BOUNDARY_MARGIN, xRange.high + DECISION_BOUNDARY_MARGIN)
  const ys = gridOf(yRange.low - DECISION_BOUNDARY_MARGIN, yRange.high + DECISION_BOUNDARY_MARGIN)
  // 원래 단위의 칸을 표처럼 만들어 같은 전처리기를 거친다 — 스케일링이 학습 때와 같다.
  const table: Dataset = {
    columns: [first.name, second.name],
    rows: ys.flatMap((y) => xs.map((x) => [String(x), String(y)])),
  }
  let guesses: Awaited<ReturnType<typeof predictInSteps>>
  try {
    const predict = loadModel(JSON.parse(new TextDecoder().decode(modelBytes)), {
      trainingRows: trainingRowsFor(experiment, preprocessor, dataset),
    })
    const encoded = transform(
      preprocessor,
      table,
      table.rows.map((_row, index) => index),
      encoding,
    )
    guesses = await predictInSteps(predict, encoded, control)
  } catch (error) {
    if (error instanceof StepsCancelled) throw error
    return null
  }
  /**
   * **격자에서 처음 나온 범주는 뒤에 더한다** (69의 감사 뒤). 혼동 행렬의 범주는 테스트 데이터의 실제·예측뿐이라,
   * 훈련에만 있던 범주를 모델이 고른 자리는 찾을 데가 없어 칠해지지 않았다. sklearn은 그 자리도 칠한다.
   */
  const labels = [...stored.labels]
  const position = new Map(labels.map((label, index) => [label, index]))
  const classes = Int32Array.from(guesses, (guess) => {
    const name = String(guess)
    let at = position.get(name)
    if (at === undefined) {
      at = labels.length
      labels.push(name)
      position.set(name, at)
    }
    return at
  })

  const truth = targetValues(source, settings.testIndices, target)
  const tested = valuesOf(source, settings.testIndices)
  const points = settings.testIndices.flatMap((row, index) => {
    const [x, y] = tested[index] ?? []
    const label = position.get(truth[index] ?? '')
    if (x === undefined || y === undefined || label === undefined) return []
    if (!Number.isFinite(x) || !Number.isFinite(y)) return []
    return [{ row, x, y, label }]
  })

  return {
    kind: 'boundary',
    boundary: {
      features: [first.name, second.name],
      labels,
      xs,
      ys,
      classes,
      points,
    },
  }
}

/** 고르게 나눈 격자 좌표. sklearn의 `np.linspace(min, max, grid_resolution)`과 같다. */
function gridOf(low: number, high: number): number[] {
  const steps = DECISION_BOUNDARY_GRID - 1
  return Array.from({ length: DECISION_BOUNDARY_GRID }, (_value, index) =>
    index === steps ? high : low + ((high - low) * index) / steps,
  )
}

/** 수인 값의 범위. **펼치지 않는다**(`tests/spread-rules.spec.ts`). 수가 하나도 없으면 `null`. */
function rangeOf(values: readonly number[]): { low: number; high: number } | null {
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < low) low = value
    if (value > high) high = value
  }
  return Number.isFinite(low) ? { low, high } : null
}
