/**
 * 결정 경계 (`ml/decision-boundary.ts`, `open-decisions.md` "69. 훈련 데이터가 2·3차원일 때 결과를
 * 그림으로 보일 것인가").
 *
 * **입력 열이 수치 정확히 둘일 때만 선다**는 것과, **격자가 학생의 모델 그 자체의 답**이라는 것을 문다
 * — 격자 칸 가운데 테스트 점과 같은 자리를 다시 예측하면 그 점에서 모델이 낸 답과 같아야 한다.
 */

import { describe, expect, it } from 'vitest'

import type { ConfusionRowsInput } from '../src/ml/confusion-rows'
import { decisionBoundaryAvailable, decisionBoundaryFor } from '../src/ml/decision-boundary'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import type { Dataset } from '../src/ml/preprocess'
import { DECISION_BOUNDARY_GRID, DECISION_BOUNDARY_MARGIN } from '../src/limits'
import { dataSnapshot, type Settings, type TabularSettings } from '../src/project/schema'
import { IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

async function trained(
  algorithm: string,
  features: string[],
  testDataset: Dataset | null = null,
): Promise<ConfusionRowsInput> {
  const dataset = irisDataset()
  const data: TabularSettings = {
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'iris.csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features,
    target: IRIS_TARGET_COLUMN,
    preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
  }
  const settings: Settings = {
    split: {
      method: testDataset ? 'provided' : 'holdout',
      testSize: 0.3,
      stratify: true,
      randomState: 42,
    },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm }],
    hyperparameters: {},
    data,
  }
  const input: ExperimentInput = {
    dataset,
    testDataset,
    taskType: 'classification',
    dataType: 'tabular',
    settings,
    snapshot: dataSnapshot('tabular', settings),
    context: {
      serverStatus: 'unavailable',
      limitsOff: false,
      rowCount: dataset.rows.length,
      dataType: 'tabular',
    },
  }
  const result = await runExperiment(input)
  const run = result.experiment.runs[0]!
  return {
    run,
    experiment: result.experiment,
    dataset,
    testDataset,
    preprocessor: result.preprocessor,
    modelBytes: new TextEncoder().encode(JSON.stringify(result.models.get(run.id))),
  }
}

const TWO = ['petal_length', 'petal_width']

describe('결정 경계', () => {
  it.each(['logistic_regression', 'decision_tree', 'knn'])(
    '%s — sklearn의 격자(100×100, 바깥 여백 1)에 범주를 깔고 테스트 점을 실제 범주로 찍는다',
    async (algorithm) => {
      const input = await trained(algorithm, TWO)
      const result = await decisionBoundaryFor(input)
      expect(result?.kind).toBe('boundary')
      if (result?.kind !== 'boundary') return
      const { boundary } = result
      expect(boundary.features).toEqual(TWO)
      expect(boundary.xs).toHaveLength(DECISION_BOUNDARY_GRID)
      expect(boundary.ys).toHaveLength(DECISION_BOUNDARY_GRID)
      expect(boundary.classes).toHaveLength(DECISION_BOUNDARY_GRID ** 2)
      // 붓꽃의 꽃잎 길이는 1.0~6.9cm다 — 바깥으로 1씩 넓힌다.
      const lengths = input.dataset!.rows.map((row) => Number(row[2]))
      expect(boundary.xs[0]).toBeCloseTo(Math.min(...lengths) - DECISION_BOUNDARY_MARGIN, 9)
      expect(boundary.xs.at(-1)).toBeCloseTo(Math.max(...lengths) + DECISION_BOUNDARY_MARGIN, 9)
      // 범주는 셋이고 칸마다 그중 하나다.
      expect(new Set(boundary.classes)).toEqual(new Set([0, 1, 2]))
      expect(boundary.points).toHaveLength(input.experiment.settings.testIndices.length)
    },
  )

  /** **격자는 그 모델의 답이다** — 대조가 깨진 파일에서는 안 그린다. */
  it('저장된 혼동 행렬과 다르면 그리지 않고 다르다고 말한다', async () => {
    const input = await trained('decision_tree', TWO)
    const stored = input.run.confusionMatrix!
    const matrix = stored.matrix.map((row, i) =>
      row.map((count, j) => (i === 1 && j === 1 ? count + 1 : count)),
    )
    const tampered = { ...input, run: { ...input.run, confusionMatrix: { ...stored, matrix } } }
    expect(await decisionBoundaryFor(tampered)).toEqual({ kind: 'mismatch' })
  })

  /** **셋 이상은 안 그린다** — 나머지 열을 고정한 단면은 실제 점과 같은 평면에 있지 않다. */
  it.each([[['petal_length']], [['sepal_length', 'petal_length', 'petal_width']]])(
    '입력 열이 둘이 아니면(%j) 자리가 없다',
    async (features) => {
      const input = await trained('decision_tree', features)
      expect(decisionBoundaryAvailable(input)).toBe(false)
      expect(await decisionBoundaryFor(input)).toBeNull()
    },
  )

  /**
   * **바탕은 빈 칸 없이 칠한다** (69의 감사 뒤). 혼동 행렬의 범주는 테스트 데이터의 실제·예측뿐이라,
   * 테스트 표에 없는 범주를 모델이 고른 자리는 칠할 색을 못 찾았다. 붓꽃 셋으로 학습하고 테스트 표에는
   * 두 범주만 넣는다 — 셋째 범주의 자리가 격자에 있다.
   */
  it('테스트에 없는 범주를 모델이 고른 자리도 칠하고 범주에 더한다', async () => {
    const iris = irisDataset()
    const target = iris.columns.indexOf(IRIS_TARGET_COLUMN)
    const kinds = [...new Set(iris.rows.map((row) => row[target]))]
    const left = kinds.at(-1)
    const testDataset = { ...iris, rows: iris.rows.filter((row) => row[target] !== left) }
    const input = await trained('decision_tree', TWO, testDataset)
    expect(input.run.confusionMatrix?.labels).not.toContain(left)

    const result = await decisionBoundaryFor(input)
    if (result?.kind !== 'boundary') throw new Error('expected boundary')
    expect(result.boundary.labels).toContain(left)
    expect(result.boundary.classes.every((at) => at >= 0)).toBe(true)
    expect(new Set(result.boundary.classes).size).toBe(3)
  })
})
