/**
 * 재실행 대조.
 *
 * **여기서 확인하는 것은 판정이 아니라 사실이다.** 허용 오차는 아직 미결이고
 * (open-decisions.md #12) 이 층은 "차이가 얼마인가"까지만 답한다.
 *
 * 가장 중요한 것은 **못 하는 것을 안 맞는다고 하지 않는가**다. 엔진이 다른 파일을
 * NOT_REPRODUCED로 내면 도구가 무고한 학생을 지목한다.
 */

import { describe, expect, it } from 'vitest'

import { runExperiment } from '../src/ml/experiment'
import { reproduceExperiment } from '../src/ml/reproduce'
import type { Experiment, Run, Settings } from '../src/project/schema'
import { irisDataset, IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN } from './fixtures/iris'

const dataset = irisDataset()

function settingsFor(algorithms: string[]): Settings {
  return {
    features: [...IRIS_FEATURE_COLUMNS],
    target: IRIS_TARGET_COLUMN,
    preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: algorithms.map((algorithm) => ({ algorithm })),
    hyperparameters: {},
  }
}

function trained(algorithms: string[]): Experiment {
  return runExperiment(
    {
      dataset,
      taskType: 'classification',
      dataType: 'tabular',
      settings: settingsFor(algorithms),
      context: { serverStatus: 'unavailable', rowCount: 30 },
    },
    { now: () => '2026-08-06T00:00:00.000Z' },
  ).experiment
}

/** run 하나를 손본 실험. 파일을 풀어 고친 상태를 흉내 낸다. */
function withRun(experiment: Experiment, index: number, overrides: Partial<Run>): Experiment {
  const runs = experiment.runs.map((run, at) => (at === index ? { ...run, ...overrides } : run))
  return { ...experiment, runs }
}

describe('재실행 대조', () => {
  it('방금 학습한 실험은 그대로 재현된다', () => {
    const experiment = trained(['decision_tree', 'knn', 'naive_bayes', 'svm'])
    const found = reproduceExperiment({ experiment, dataset })

    expect(found).toHaveLength(4)
    for (const one of found) {
      expect(one.status, one.algorithm).toBe('REPRODUCED')
      // 차이가 0이라는 것을 값으로도 남긴다. 화면이 허용 오차를 정할 때 볼 값이다.
      expect(
        Object.values(one.deltas ?? {}).every((delta) => delta === 0),
        one.algorithm,
      ).toBe(true)
    }
  })

  it('지표를 고친 파일은 어긋나고, 얼마나 어긋났는지까지 준다', () => {
    const experiment = trained(['decision_tree'])
    const stored = experiment.runs[0]?.metrics?.['accuracy'] ?? 0
    const tampered = withRun(experiment, 0, {
      metrics: { ...experiment.runs[0]?.metrics, accuracy: 1 },
    })

    const [found] = reproduceExperiment({ experiment: tampered, dataset })
    expect(found?.status).toBe('NOT_REPRODUCED')
    expect(found?.again?.['accuracy']).toBe(stored)
    // 판정하지 않고 차이를 준다. 얼마까지 봐 줄지는 이 층이 정하지 않는다.
    expect(found?.deltas?.['accuracy']).toBeCloseTo(stored - 1, 10)
  })

  it('엔진이 다르면 대조하지 않는다 - 무고한 학생을 지목하지 않는다', () => {
    const experiment = trained(['decision_tree'])
    const other = withRun(experiment, 0, { engine: { kind: 'mljs', version: '999' } })

    const [found] = reproduceExperiment({ experiment: other, dataset })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
    // 무엇으로 만든 것인지 함께 준다. 화면이 "이 파일은 다른 엔진에서 왔다"를 말해야 한다.
    expect(found?.engine?.version).toBe('999')
    expect(found?.again).toBeUndefined()
  })

  it('무엇으로 만들었는지 모르는 run도 대조하지 않는다', () => {
    const experiment = trained(['decision_tree'])
    const [found] = reproduceExperiment({
      experiment: withRun(experiment, 0, { engine: undefined }),
      dataset,
    })
    expect(found?.status).toBe('ENGINE_UNAVAILABLE')
  })

  it('실패한 run은 대조 대상이 아니다 - 견줄 지표가 없다', () => {
    const experiment = trained(['decision_tree'])
    const failed = withRun(experiment, 0, {
      status: 'failed',
      metrics: undefined,
      failure: { code: 'JOB_FAILED' },
    })
    expect(reproduceExperiment({ experiment: failed, dataset })).toEqual([])
  })

  it('학생이 바꾼 하이퍼파라미터를 그대로 먹인다', () => {
    // 기본값으로 다시 채우면 다른 설정으로 학습해 놓고 "안 맞는다"고 말하게 된다.
    const experiment = trained(['decision_tree'])
    const shallow = withRun(experiment, 0, { hyperparameters: { maxDepth: 1, minNumSamples: 3 } })

    const [found] = reproduceExperiment({ experiment: shallow, dataset })
    // 깊이 1로 다시 돌리면 붓꽃 세 품종을 못 가르므로 파일의 지표와 어긋난다.
    expect(found?.status).toBe('NOT_REPRODUCED')
    expect(found?.again?.['accuracy']).toBeLessThan(experiment.runs[0]?.metrics?.['accuracy'] ?? 1)
  })
})
