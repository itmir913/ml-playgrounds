/**
 * 학습한 회귀 모델을 그릴 재료 (`open-decisions.md` "97. 학습한 회귀 모델을 그림으로 보일 것인가").
 *
 * **저장된 모델로 테스트 데이터를 다시 예측한다 — 재학습이 아니다.** 행마다의 예측은 파일에 안
 * 담기므로(데이터가 클수록 커진다, #28-4) 군집 패널이 배정을 되계산하는 것과 같은 길을 간다
 * (`ml/clusters.ts`의 `clusterMaterialFor`). 테스트 행과 그 정본은 실험이 갖는다 — 학습할 때
 * `ml/experiment.ts`가 만든 시험 행렬과 같은 식으로 다시 만든다.
 *
 * **다시 잰 결정계수가 파일의 값과 다르면 그리지 않는다.** 같은 모델에서 같은 예측이 나와야 하고,
 * 아니면 그림이 지표와 다른 이야기를 한다. 무는 검사: `tests/regression-fit.spec.ts`.
 *
 * **Vue도 chart.js도 모른다.**
 */

import type { DataPoint } from '@/data/stats'
import { ClientError } from '@/errors'
import { REGRESSION_LINE_STEPS } from '@/limits'
import type { Experiment, Run } from '@/project/schema'
import { dataSnapshot } from '@/project/schema'

import { evaluate } from './metrics'
import { loadModel } from './models'
import { transform, targetValues, type Dataset, type Preprocessor } from './preprocess'

/** 입력 열이 수치 하나일 때의 선. 가로는 그 열의 원래 단위다. */
export interface RegressionLine {
  readonly feature: string
  /** 테스트 데이터에서 그 열의 값. 점마다 하나이고 `actual`과 같은 차례다. */
  readonly xs: readonly number[]
  /** 테스트 범위를 고르게 나눈 점에서 모델이 낸 값. 가로로 정렬돼 있다. */
  readonly curve: readonly { readonly x: number; readonly y: number }[]
}

export interface RegressionFit {
  /** 테스트 행의 번호(그 정본 안의). */
  readonly rows: readonly number[]
  readonly actual: readonly number[]
  readonly predicted: readonly number[]
  readonly line: RegressionLine | null
}

export type RegressionFitResult =
  | { readonly kind: 'fit'; readonly fit: RegressionFit }
  /** 다시 잰 결정계수가 파일의 값과 다르다. 그리지 않고 그 사실만 말한다. */
  | { readonly kind: 'mismatch' }

/**
 * 결정계수를 견주는 허용오차. **같은 해석기의 같은 연산이므로 정확히 같아야 한다** — 여유는
 * 부동소수의 마지막 자리 몫뿐이다.
 */
const R2_TOLERANCE = 1e-9

export interface RegressionFitInput {
  readonly run: Run
  readonly experiment: Experiment
  readonly dataset: Dataset | null
  /** `provided` 분할의 테스트 표. 그 밖에는 안 쓴다. */
  readonly testDataset: Dataset | null
  readonly preprocessor: Preprocessor | null
  readonly modelBytes: Uint8Array | undefined
}

/**
 * 그릴 재료. **재료가 하나라도 없으면 `null`** — 모델이 안 담긴 파일, 데이터를 뺀 파일, 전처리기를
 * 못 읽은 파일이다. 그때 패널은 아무것도 안 그린다(사유는 다른 자리가 말한다).
 */
export function regressionFitFor(input: RegressionFitInput): RegressionFitResult | null {
  const { run, experiment, dataset, testDataset, preprocessor, modelBytes } = input
  if (!modelBytes || !dataset || !preprocessor) return null
  const stored = run.metrics?.['r2']
  if (stored === undefined) return null

  const { settings } = experiment
  let snapshot: ReturnType<typeof dataSnapshot<'tabular'>>
  try {
    snapshot = dataSnapshot('tabular', settings)
  } catch {
    return null
  }
  const target = snapshot.target
  if (target === undefined || target === '') return null
  const source = settings.split.method === 'provided' ? testDataset : dataset
  if (!source) return null
  const rows = settings.testIndices
  if (rows.length === 0) return null

  const encoding = snapshot.preprocessing.categoricalEncoding
  let predict: ReturnType<typeof loadModel>
  let truth: string[]
  let guesses: ReturnType<ReturnType<typeof loadModel>>
  let line: RegressionLine | null
  try {
    // **표가 어긋난 파일에서 던지지 않는다** — 테스트 표의 열이 모자라면 `transform`이 던진다.
    // 혼동 행렬 칸의 행(`confusion-rows.ts`)과 같이 그림의 자리를 비운다.
    predict = loadModel(JSON.parse(new TextDecoder().decode(modelBytes)))
    truth = targetValues(source, rows, target)
    guesses = predict(transform(preprocessor, source, rows, encoding))
    line = lineFor(preprocessor, source, rows, encoding, predict)
  } catch {
    return null
  }

  let r2: number
  try {
    r2 = evaluate('regression', truth, guesses).metrics['r2'] ?? Number.NaN
  } catch (error) {
    // 길이가 어긋나거나 수가 아닌 값 — 저장된 지표를 낸 예측과 다른 것이 나왔다.
    if (error instanceof ClientError) return { kind: 'mismatch' }
    throw error
  }
  if (!(Math.abs(r2 - stored) <= R2_TOLERANCE)) return { kind: 'mismatch' }

  return {
    kind: 'fit',
    fit: {
      rows,
      actual: truth.map(Number),
      predicted: guesses.map(Number),
      line,
    },
  }
}

/**
 * **입력 열이 수치 하나일 때만 선을 긋는다.** 열이 둘 이상이면 하나만 가로축에 둔 그림은 나머지
 * 열이 고정되지 않아 선과 점이 같은 평면에 있지 않다. 범주 열 하나도 안 된다 — 원-핫으로 열이 는다.
 */
function lineFor(
  preprocessor: Preprocessor,
  source: Dataset,
  rows: readonly number[],
  encoding: Parameters<typeof transform>[3],
  predict: ReturnType<typeof loadModel>,
): RegressionLine | null {
  const only = preprocessor.columns.length === 1 ? preprocessor.columns[0] : undefined
  if (!only || only.kind !== 'numeric') return null
  const column = source.columns.indexOf(only.name)
  if (column < 0) return null

  const xs = rows.map((row) => Number(source.rows[row]?.[column] ?? Number.NaN))
  const finite = xs.filter(Number.isFinite)
  if (finite.length === 0) return null
  const { low, high } = rangeOf(finite)

  const steps = high > low ? REGRESSION_LINE_STEPS : 1
  const grid = Array.from({ length: steps + 1 }, (_value, index) =>
    steps === 1 ? low : low + ((high - low) * index) / steps,
  )
  // 원래 단위의 값을 표처럼 만들어 같은 전처리기를 거친다 — 스케일링·결측 대체가 학습 때와 같다.
  const table: Dataset = { columns: [only.name], rows: grid.map((x) => [String(x)]) }
  const encoded = transform(
    preprocessor,
    table,
    grid.map((_x, index) => index),
    encoding,
  )
  const ys = predict(encoded).map(Number)
  return {
    feature: only.name,
    xs,
    curve: grid.map((x, index) => ({ x, y: ys[index] ?? Number.NaN })),
  }
}

/**
 * 그림의 종류. **앞의 둘은 sklearn `PredictionErrorDisplay`의 `kind` 이름 그대로다.** 셋째는 입력 열이
 * 수치 하나일 때만 선다(`RegressionFit.line`).
 */
export const REGRESSION_VIEWS = ['actual_vs_predicted', 'residual_vs_predicted', 'line'] as const
export type RegressionView = (typeof REGRESSION_VIEWS)[number]

/** 한 그림의 점과 기준선. 점은 `data/scatter-thin.ts`가 거른다(결정 94). */
export interface RegressionPlot {
  readonly points: readonly DataPoint[]
  /** 대각선(예측 = 실제)·0선(잔차 = 0)·모델의 선. 가로로 정렬돼 있다. */
  readonly reference: readonly { readonly x: number; readonly y: number }[]
}

/**
 * 그 종류의 점과 기준선. **축은 sklearn과 같다** — 가로는 예측, 세로는 실제 또는 잔차(실제 − 예측).
 * 셋째는 가로가 그 열, 세로가 실제다. 수가 아닌 점은 뺀다. 선이 없는 그림에서 `line`을 물으면 `null`이다.
 */
export function regressionPlot(fit: RegressionFit, view: RegressionView): RegressionPlot | null {
  const finite = (point: DataPoint) => Number.isFinite(point.x) && Number.isFinite(point.y)
  if (view === 'line') {
    const line = fit.line
    if (!line) return null
    return {
      points: fit.rows
        .map((row, index) => ({
          row,
          x: line.xs[index] ?? Number.NaN,
          y: fit.actual[index] ?? Number.NaN,
        }))
        .filter(finite),
      reference: line.curve.filter((point) => Number.isFinite(point.y)),
    }
  }
  const points = fit.rows
    .map((row, index) => {
      const actual = fit.actual[index] ?? Number.NaN
      const predicted = fit.predicted[index] ?? Number.NaN
      return { row, x: predicted, y: view === 'actual_vs_predicted' ? actual : actual - predicted }
    })
    .filter(finite)
  if (points.length === 0) return { points, reference: [] }
  const xs = points.map((point) => point.x)
  if (view === 'residual_vs_predicted') {
    return {
      points,
      reference: [
        { x: rangeOf(xs).low, y: 0 },
        { x: rangeOf(xs).high, y: 0 },
      ],
    }
  }
  // 대각선은 두 축을 다 덮어야 한다 — 실제와 예측의 범위를 합친다.
  const across = rangeOf(xs)
  const down = rangeOf(points.map((point) => point.y))
  const low = Math.min(across.low, down.low)
  const high = Math.max(across.high, down.high)
  return {
    points,
    reference: [
      { x: low, y: low },
      { x: high, y: high },
    ],
  }
}

/**
 * 가장 작은 값과 큰 값. **펼치지 않는다** — `Math.min(...값)`은 테스트 행 수만큼 인자를 쌓아 큰
 * 표에서 스택을 넘긴다(`tests/spread-rules.spec.ts`).
 */
function rangeOf(values: readonly number[]): { low: number; high: number } {
  let low = Infinity
  let high = -Infinity
  for (const value of values) {
    if (value < low) low = value
    if (value > high) high = value
  }
  return { low, high }
}
