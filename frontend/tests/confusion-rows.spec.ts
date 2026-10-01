/**
 * 혼동 행렬 칸마다의 테스트 행 (`ml/confusion-rows.ts`, `open-decisions.md` "98. 혼동 행렬의 칸을
 * 누르면 그 칸의 행을 보일 것인가").
 *
 * **칸의 행 수가 칸의 숫자와 같은가**가 중심이다 — 다르면 다른 행을 그 칸의 행이라고 말하게 된다.
 * 진짜로 학습한 모델의 저장된 바이트로 다시 예측한다. KNN은 훈련 행이 있어야 예측하는 참조형이라
 * 따로 본다.
 */

import { describe, expect, it } from 'vitest'

import { confusionRowsFor, type ConfusionRowsInput } from '../src/ml/confusion-rows'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import { dataSnapshot, type Settings, type TabularSettings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

async function trained(algorithm: string): Promise<ConfusionRowsInput> {
  const dataset = irisDataset()
  const data: TabularSettings = {
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'iris.csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features: [...IRIS_FEATURE_COLUMNS],
    target: IRIS_TARGET_COLUMN,
    preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
  }
  const settings: Settings = {
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm }],
    hyperparameters: {},
    data,
  }
  const input: ExperimentInput = {
    dataset,
    testDataset: null,
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

describe('칸마다의 행', () => {
  it.each(['decision_tree', 'knn'])(
    '%s — 칸의 행 수가 파일의 숫자와 같고 테스트 행이 한 번씩 든다',
    async (algorithm) => {
      const input = await trained(algorithm)
      const result = confusionRowsFor(input)
      expect(result?.kind).toBe('rows')
      if (result?.kind !== 'rows') return
      const matrix = input.run.confusionMatrix!.matrix
      result.rows.cells.forEach((row, i) =>
        row.forEach((cell, j) => expect(cell.length, `cell ${i},${j}`).toBe(matrix[i]?.[j])),
      )
      const all = result.rows.cells.flat(2).sort((a, b) => a - b)
      expect(all).toEqual([...input.experiment.settings.testIndices].sort((a, b) => a - b))
    },
  )

  /** **다른 행을 그 칸의 행이라고 말하지 않는다.** 파일의 숫자 하나를 바꿔 재현한다. */
  it('다시 센 행렬이 파일과 다르면 행을 안 내고 다르다고 말한다', async () => {
    const input = await trained('decision_tree')
    const stored = input.run.confusionMatrix!
    const matrix = stored.matrix.map((row, i) =>
      row.map((count, j) => (i === 0 && j === 0 ? count + 1 : count)),
    )
    const tampered = { ...input, run: { ...input.run, confusionMatrix: { ...stored, matrix } } }
    expect(confusionRowsFor(tampered)).toEqual({ kind: 'mismatch' })
  })

  it('재료가 하나라도 없으면 행을 안 낸다', async () => {
    const input = await trained('decision_tree')
    expect(confusionRowsFor({ ...input, modelBytes: undefined })).toBeNull()
    expect(confusionRowsFor({ ...input, dataset: null })).toBeNull()
    expect(confusionRowsFor({ ...input, preprocessor: null })).toBeNull()
    expect(confusionRowsFor({ ...input, modelBytes: new TextEncoder().encode('{') })).toBeNull()
  })
})
