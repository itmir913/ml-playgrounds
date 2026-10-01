/**
 * 순열 특성 중요도 (`ml/permutation-importance.ts`, `open-decisions.md` "99. 모델이 어느 특성에 기댔는지
 * 보일 것인가").
 *
 * **모델이 실제로 기댄 열이 위에 서고, 아무 상관 없는 열은 0 근처다**를 문다 — 붓꽃에 난수 열을 하나
 * 끼워 학습한다. 그리고 sklearn과 같은 모양(반복 5번의 평균·표준편차, 점수는 모델의 기본 점수)과
 * 같은 파일이면 같은 막대인지(씨앗이 `randomState`), 다시 잰 기준 점수가 다르면 안 그리는지를 본다.
 */

import { describe, expect, it } from 'vitest'

import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import {
  meanAndStd,
  permutationImportanceAvailable,
  permutationImportanceFor,
  permutationSteps,
  type PermutationImportanceInput,
} from '../src/ml/permutation-importance'
import { StepsCancelled } from '../src/ml/predict-in-steps'
import type { Dataset } from '../src/ml/preprocess'
import { dataSnapshot, type Settings, type TabularSettings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

/** 붓꽃에 아무 뜻 없는 열 하나를 끼운다. 씨앗이 있어 매번 같다. */
function irisWithNoise(): Dataset {
  const iris = irisDataset()
  let state = 11
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  return {
    columns: [...iris.columns, 'noise'],
    rows: iris.rows.map((row) => [...row, (next() * 10).toFixed(3)]),
  }
}

async function trained(
  algorithm: string,
  taskType: 'classification' | 'regression',
  dataset: Dataset,
  features: string[],
  target: string,
): Promise<PermutationImportanceInput> {
  const data: TabularSettings = {
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'd.csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features,
    target,
    preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
  }
  const settings: Settings = {
    split: {
      method: 'holdout',
      testSize: 0.3,
      stratify: taskType === 'classification',
      randomState: 42,
    },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm }],
    hyperparameters: {},
    data,
  }
  const input: ExperimentInput = {
    dataset,
    testDataset: null,
    taskType,
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
    testDataset: null,
    preprocessor: result.preprocessor,
    modelBytes: new TextEncoder().encode(JSON.stringify(result.models.get(run.id))),
  }
}

const FEATURES = [...IRIS_FEATURE_COLUMNS, 'noise']

describe('순열 특성 중요도', () => {
  it.each(['decision_tree', 'knn'])(
    '%s — sklearn과 같은 모양이고, 트리는 기댄 열이 위에 서고 난수 열은 0이다',
    async (algorithm) => {
      const input = await trained(
        algorithm,
        'classification',
        irisWithNoise(),
        FEATURES,
        IRIS_TARGET_COLUMN,
      )
      const result = await permutationImportanceFor(input)
      expect(result?.kind).toBe('importance')
      if (result?.kind !== 'importance') return
      const { importance } = result
      expect(importance.metric).toBe('accuracy')
      expect(importance.baseline).toBe(input.run.metrics?.['accuracy'])
      expect(importance.weights.map((one) => one.feature).sort()).toEqual([...FEATURES].sort())
      // 평균이 큰 것부터다.
      const means = importance.weights.map((one) => one.mean)
      expect(means).toEqual([...means].sort((a, b) => b - a))
      importance.weights.forEach((one) => expect(one.std).toBeGreaterThanOrEqual(0))
      // **순위는 트리에서만 단정한다.** 붓꽃 픽스처의 테스트 데이터는 9행이라 KNN의 값은 ±0.05 안팎의
      // 잡음이다(한 행이 바뀌면 0.11) — KNN은 거리에 모든 열이 들어가 난수 열에도 조금씩 기댄다. 트리는
      // 꽃잎 하나로 갈라서 그 열만 서고 나머지는 정확히 0이다(개발 PC에서 찍어 본 값).
      if (algorithm !== 'decision_tree') return
      expect(['petal_length', 'petal_width']).toContain(importance.weights[0]?.feature)
      const noise = importance.weights.find((one) => one.feature === 'noise')
      expect(noise?.mean).toBe(0)
    },
  )

  it('회귀는 결정계수로 잰다', async () => {
    const iris = irisDataset()
    const input = await trained(
      'linear_regression',
      'regression',
      iris,
      ['sepal_length', 'sepal_width', 'petal_width'],
      'petal_length',
    )
    const result = await permutationImportanceFor(input)
    if (result?.kind !== 'importance') throw new Error('expected importance')
    expect(result.importance.metric).toBe('r2')
    expect(result.importance.baseline).toBe(input.run.metrics?.['r2'])
  })

  /** **같은 파일이면 같은 막대다** — 씨앗이 그 실험의 `randomState`다. */
  it('같은 입력이면 같은 값이다', async () => {
    const input = await trained(
      'decision_tree',
      'classification',
      irisWithNoise(),
      FEATURES,
      IRIS_TARGET_COLUMN,
    )
    expect(await permutationImportanceFor(input)).toEqual(await permutationImportanceFor(input))
  })

  it('파일의 점수와 다르면 그리지 않고 다르다고 말한다', async () => {
    const input = await trained(
      'decision_tree',
      'classification',
      irisWithNoise(),
      FEATURES,
      IRIS_TARGET_COLUMN,
    )
    const metrics = {
      ...input.run.metrics,
      accuracy: (input.run.metrics?.['accuracy'] ?? 0) - 0.01,
    }
    expect(await permutationImportanceFor({ ...input, run: { ...input.run, metrics } })).toEqual({
      kind: 'mismatch',
    })
  })

  /**
   * **sklearn과 같은 통계다** — numpy `std`의 기본값(모표준편차, `ddof=0`). 표본 표준편차(`ddof=1`)면
   * [1, 2, 3, 4]에서 1.29다(감사 D-10: 전에는 0 이상인지만 봤다).
   */
  it('평균과 모표준편차', () => {
    const { mean, std } = meanAndStd([1, 2, 3, 4])
    expect(mean).toBe(2.5)
    expect(std).toBeCloseTo(Math.sqrt(1.25), 12)
  })

  /** 단추가 진행을 말한다 — 측정 하나마다 한 번, 전부 `permutationSteps`번이다. */
  it('측정마다 진행을 알리고, 멈추라면 멈춘다', async () => {
    const input = await trained(
      'decision_tree',
      'classification',
      irisWithNoise(),
      FEATURES,
      IRIS_TARGET_COLUMN,
    )
    const seen: number[] = []
    await permutationImportanceFor(input, { onStep: (done) => seen.push(done) })
    const total = permutationSteps(input)
    expect(total).toBe(1 + FEATURES.length * 5)
    expect(seen).toEqual(Array.from({ length: total }, (_value, index) => index + 1))

    await expect(permutationImportanceFor(input, { cancelled: () => true })).rejects.toBeInstanceOf(
      StepsCancelled,
    )
  })

  it('재료가 없으면 자리가 없다', async () => {
    const input = await trained(
      'decision_tree',
      'classification',
      irisWithNoise(),
      FEATURES,
      IRIS_TARGET_COLUMN,
    )
    expect(permutationImportanceAvailable(input)).toBe(true)
    expect(permutationImportanceAvailable({ ...input, modelBytes: undefined })).toBe(false)
    expect(await permutationImportanceFor({ ...input, modelBytes: undefined })).toBeNull()
    expect(await permutationImportanceFor({ ...input, dataset: null })).toBeNull()
    expect(await permutationImportanceFor({ ...input, preprocessor: null })).toBeNull()
  })
})
