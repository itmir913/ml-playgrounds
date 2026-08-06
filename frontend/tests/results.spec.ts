/**
 * 결과 화면이 실험에서 읽어내는 것들.
 *
 * **눈으로는 못 잡는 판단들이다.** 최고값을 거꾸로 고르면 화면은 멀쩡해 보이고
 * 숫자만 틀린다. 회귀에서 오차가 낮은 쪽이 이겨야 하는 것이 대표적이다.
 */

import { describe, expect, it } from 'vitest'

import { bestByMetric, doneRuns, failedRuns, headlineOf } from '../src/ml/results'
import { metricsOf } from '../src/ml/metrics'
import type { Experiment, Run, TaskType } from '../src/project/schema'

function run(id: string, metrics: Record<string, number> | null): Run {
  const base = {
    id,
    algorithm: 'decision_tree',
    hyperparameters: {},
    computedBy: 'browser' as const,
    trainedAt: '2026-08-06T00:00:00.000Z',
  }
  return metrics === null
    ? { ...base, status: 'failed', failure: { code: 'JOB_FAILED' } }
    : { ...base, status: 'done', metrics }
}

function experiment(taskType: TaskType, runs: Run[]): Experiment {
  return {
    id: 'experiment-1',
    startedAt: '2026-08-06T00:00:00.000Z',
    settings: {
      taskType,
      runtime: 'mljs',
      selectedAlgorithms: [],
      features: [],
      preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
      split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
      trainIndices: [],
      testIndices: [],
    },
    runs,
  }
}

describe('대표 점수', () => {
  it('분류는 정확도의 최고값이다', () => {
    const headline = headlineOf(
      experiment('classification', [
        run('run-1', { accuracy: 0.7, f1Macro: 0.9 }),
        run('run-2', { accuracy: 0.8, f1Macro: 0.1 }),
      ]),
    )

    expect(headline?.display.name).toBe('accuracy')
    expect(headline?.value).toBe(0.8)
  })

  it('회귀는 결정계수다 - 오차가 아니다', () => {
    const headline = headlineOf(
      experiment('regression', [run('run-1', { r2: 0.5, rmse: 2, mae: 1 })]),
    )
    expect(headline?.display.name).toBe('r2')
    expect(headline?.value).toBe(0.5)
  })

  it('점수가 하나도 없으면 null이다 - 0을 보이면 0점으로 학습된 것처럼 읽힌다', () => {
    expect(headlineOf(experiment('classification', [run('run-1', null)]))).toBeNull()
    expect(headlineOf(experiment('classification', []))).toBeNull()
  })

  it('실험의 과제 유형을 본다 - 지금 프로젝트의 유형이 아니다', () => {
    // 회귀로 돌린 옛 실험. 학생이 지금 분류를 고르고 있어도 여기서는 r2가 나와야 한다.
    const headline = headlineOf(
      experiment('regression', [run('run-1', { r2: 0.3, rmse: 1, mae: 1 })]),
    )
    expect(headline?.display.name).toBe('r2')
  })
})

describe('지표별 최고값', () => {
  const displays = metricsOf('regression')

  it('낮을수록 좋은 지표는 최솟값이 이긴다', () => {
    const best = bestByMetric(
      [run('run-1', { r2: 0.9, rmse: 3, mae: 2 }), run('run-2', { r2: 0.4, rmse: 1, mae: 5 })],
      displays,
    )

    expect(best.get('r2')).toBe(0.9)
    expect(best.get('rmse')).toBe(1)
    expect(best.get('mae')).toBe(2)
  })

  it('모델이 하나뿐이면 아무것도 안 굵어진다 - 견줄 것이 없다', () => {
    expect(bestByMetric([run('run-1', { r2: 0.9, rmse: 1, mae: 1 })], displays).size).toBe(0)
  })

  it('그 지표를 안 가진 run이 섞여도 나머지로 고른다', () => {
    const best = bestByMetric(
      [run('run-1', { r2: 0.9 }), run('run-2', { r2: 0.4, rmse: 1, mae: 1 })],
      displays,
    )
    expect(best.get('r2')).toBe(0.9)
    expect(best.get('rmse')).toBe(1)
  })
})

describe('성공과 실패를 가른다', () => {
  const mixed = experiment('classification', [
    run('run-1', { accuracy: 0.5, f1Macro: 0.5 }),
    run('run-2', null),
  ])

  it('점수가 나온 것과 실패한 것이 갈린다', () => {
    expect(doneRuns(mixed).map((one) => one.id)).toEqual(['run-1'])
    expect(failedRuns(mixed).map((one) => one.id)).toEqual(['run-2'])
  })
})
