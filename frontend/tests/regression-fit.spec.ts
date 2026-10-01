/**
 * 학습한 회귀 모델을 그릴 재료 (`ml/regression-fit.ts`, `open-decisions.md` "97. 학습한 회귀 모델을
 * 그림으로 보일 것인가").
 *
 * **그림이 지표와 같은 이야기를 하는가가 이 검사의 중심이다.** 진짜로 학습한 모델을 저장된
 * 바이트로 다시 읽어 테스트 데이터를 예측하고, 그 예측으로 잰 결정계수가 파일의 값과 같은지,
 * 다르면 그리지 않는지를 문다.
 */

import { describe, expect, it } from 'vitest'

import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import {
  regressionFitFor,
  regressionPlot,
  type RegressionFit,
  type RegressionFitInput,
} from '../src/ml/regression-fit'
import type { Dataset } from '../src/ml/preprocess'
import { dataSnapshot, type Settings, type TabularSettings } from '../src/project/schema'

/** y = 2·키 − 0.5·몸무게 + 3에 작은 흔들림. 씨앗이 있어 매번 같다. */
function people(count: number): Dataset {
  let state = 7
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  return {
    columns: ['키', '몸무게', '점수'],
    rows: Array.from({ length: count }, () => {
      const height = 150 + next() * 40
      const weight = 40 + next() * 40
      const score = 2 * height - 0.5 * weight + 3 + (next() - 0.5) * 4
      return [height.toFixed(2), weight.toFixed(2), score.toFixed(3)]
    }),
  }
}

function settingsWith(features: string[]): Settings {
  const data: TabularSettings = {
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'p.csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features,
    target: '점수',
    preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
  }
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'linear_regression' }],
    hyperparameters: {},
    data,
  }
}

async function trained(features: string[]): Promise<RegressionFitInput> {
  const dataset = people(60)
  const settings = settingsWith(features)
  const input: ExperimentInput = {
    dataset,
    testDataset: null,
    taskType: 'regression',
    dataType: 'tabular',
    settings,
    snapshot: dataSnapshot('tabular', settings),
    context: { serverStatus: 'unavailable', limitsOff: false, rowCount: 60, dataType: 'tabular' },
  }
  const result = await runExperiment(input)
  const run = result.experiment.runs[0]!
  const model = result.models.get(run.id)
  expect(model, 'the run kept its model').toBeDefined()
  return {
    run,
    experiment: result.experiment,
    dataset,
    testDataset: null,
    preprocessor: result.preprocessor,
    modelBytes: new TextEncoder().encode(JSON.stringify(model)),
  }
}

describe('저장된 모델로 다시 예측한다', () => {
  it('다시 잰 결정계수가 파일과 같고, 테스트 행마다 실제와 예측이 하나씩이다', async () => {
    const input = await trained(['키', '몸무게'])
    const result = regressionFitFor(input)
    expect(result?.kind).toBe('fit')
    if (result?.kind !== 'fit') return
    const { fit } = result
    expect(fit.rows).toEqual(input.experiment.settings.testIndices)
    expect(fit.actual).toHaveLength(fit.rows.length)
    expect(fit.predicted).toHaveLength(fit.rows.length)
    // 흔들림이 작아 거의 맞힌다 — 예측이 실제를 따라간다.
    fit.actual.forEach((value, index) => {
      expect(Math.abs(value - (fit.predicted[index] ?? Number.NaN))).toBeLessThan(5)
    })
  })

  /** **그림이 지표와 다른 이야기를 하면 그리지 않는다.** 파일의 값을 살짝 바꿔 재현한다. */
  it('파일의 결정계수와 다르면 그리지 않고 다르다고 말한다', async () => {
    const input = await trained(['키', '몸무게'])
    const r2 = input.run.metrics?.['r2'] ?? 0
    const tampered = {
      ...input,
      run: { ...input.run, metrics: { ...input.run.metrics, r2: r2 - 1e-6 } },
    }
    expect(regressionFitFor(tampered)).toEqual({ kind: 'mismatch' })
  })

  it('재료가 하나라도 없으면 그리지 않는다', async () => {
    const input = await trained(['키'])
    expect(regressionFitFor({ ...input, modelBytes: undefined })).toBeNull()
    expect(regressionFitFor({ ...input, dataset: null })).toBeNull()
    expect(regressionFitFor({ ...input, preprocessor: null })).toBeNull()
    expect(regressionFitFor({ ...input, modelBytes: new TextEncoder().encode('{') })).toBeNull()
  })

  /** **열이 어긋난 표에서 던지지 않는다** — 던지면 결과 화면의 패널이 통째로 깨진다(감사 D-11). */
  it('표에 입력 열이 없으면 던지지 않고 그리지 않는다', async () => {
    const input = await trained(['키'])
    const dataset = input.dataset
    if (!dataset) throw new Error('expected dataset')
    const broken = { ...dataset, columns: dataset.columns.map((name) => `${name}_`) }
    expect(regressionFitFor({ ...input, dataset: broken })).toBeNull()
  })
})

describe('회귀선', () => {
  /** 선형 회귀는 직선이다 — 고르게 나눈 점의 기울기가 어디서나 같다. */
  it('입력 열이 수치 하나면 테스트 범위에 선을 긋는다', async () => {
    const result = regressionFitFor(await trained(['키']))
    if (result?.kind !== 'fit') throw new Error('expected a fit')
    const line = result.fit.line
    expect(line?.feature).toBe('키')
    expect(line?.xs).toHaveLength(result.fit.rows.length)
    const curve = line?.curve ?? []
    expect(curve.length).toBeGreaterThan(2)
    expect(curve[0]?.x).toBe(Math.min(...(line?.xs ?? [])))
    expect(curve.at(-1)?.x).toBe(Math.max(...(line?.xs ?? [])))
    const slope = (a: number, b: number) =>
      ((curve[b]?.y ?? 0) - (curve[a]?.y ?? 0)) / ((curve[b]?.x ?? 0) - (curve[a]?.x ?? 1))
    expect(slope(0, 1)).toBeCloseTo(slope(curve.length - 2, curve.length - 1), 6)
  })

  /** **열이 둘이면 안 긋는다** — 하나만 가로축에 두면 나머지 열이 고정되지 않은 그림이다. */
  it('입력 열이 둘 이상이면 선이 없다', async () => {
    const result = regressionFitFor(await trained(['키', '몸무게']))
    if (result?.kind !== 'fit') throw new Error('expected a fit')
    expect(result.fit.line).toBeNull()
  })
})

/**
 * 세 그림의 점과 기준선. **축은 sklearn `PredictionErrorDisplay`와 같다** — 가로는 예측이고 세로는
 * 실제 또는 잔차(실제 − 예측)다.
 */
describe('그림의 축과 기준선', () => {
  const fit: RegressionFit = {
    rows: [4, 7, 9],
    actual: [10, 20, 30],
    predicted: [12, 18, 33],
    line: {
      feature: '키',
      xs: [1, 2, 3],
      curve: [
        { x: 1, y: 11 },
        { x: 3, y: 31 },
      ],
    },
  }

  it('실제 vs 예측은 가로가 예측, 세로가 실제이고 대각선이 두 범위를 덮는다', () => {
    const plot = regressionPlot(fit, 'actual_vs_predicted')
    expect(plot?.points).toEqual([
      { row: 4, x: 12, y: 10 },
      { row: 7, x: 18, y: 20 },
      { row: 9, x: 33, y: 30 },
    ])
    expect(plot?.reference).toEqual([
      { x: 10, y: 10 },
      { x: 33, y: 33 },
    ])
  })

  it('잔차 vs 예측은 세로가 실제 − 예측이고 0선이 예측 범위를 덮는다', () => {
    const plot = regressionPlot(fit, 'residual_vs_predicted')
    expect(plot?.points.map((point) => point.y)).toEqual([-2, 2, -3])
    expect(plot?.reference).toEqual([
      { x: 12, y: 0 },
      { x: 33, y: 0 },
    ])
  })

  it('회귀선 그림은 가로가 그 열이고, 선이 없는 실험에서는 없다', () => {
    expect(regressionPlot(fit, 'line')?.points.map((point) => point.x)).toEqual([1, 2, 3])
    expect(regressionPlot({ ...fit, line: null }, 'line')).toBeNull()
  })

  it('수가 아닌 점은 뺀다', () => {
    const holes = { ...fit, predicted: [12, Number.NaN, 33] }
    expect(regressionPlot(holes, 'actual_vs_predicted')?.points.map((point) => point.row)).toEqual([
      4, 9,
    ])
  })
})
