/**
 * 결과 화면이 실험에서 읽어내는 것들.
 *
 * **눈으로는 못 잡는 판단들이다.** 최고값을 거꾸로 고르면 화면은 멀쩡해 보이고
 * 숫자만 틀린다. 회귀에서 오차가 낮은 쪽이 이겨야 하는 것이 대표적이다.
 */

import { describe, expect, it } from 'vitest'

import {
  bestByMetric,
  doneRuns,
  failedRuns,
  headlineOf,
  hyperparametersOf,
  isWeakestPerClass,
  weakestPerClass,
  whereTrainedKeyOf,
} from '../src/ml/results'
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
      [run('run-1', { r2: 0.9, rmse: 3 }), run('run-2', { r2: 0.4, rmse: 1, mae: 1 })],
      displays,
    )
    expect(best.get('r2')).toBe(0.9)
    expect(best.get('rmse')).toBe(1)
    // mae는 run-2에만 있다 - 견줄 것이 하나뿐이라 굵게 하지 않는다.
    expect(best.get('mae')).toBeUndefined()
  })

  it('전부 같은 점수면 아무것도 안 굵어진다 - 없는 차이를 지어내지 않는다', () => {
    const best = bestByMetric(
      [run('run-1', { r2: 0.9, rmse: 1, mae: 1 }), run('run-2', { r2: 0.9, rmse: 1, mae: 1 })],
      displays,
    )
    expect(best.size).toBe(0)
  })
})

describe('학습한 곳 문구', () => {
  // execution.*(브라우저/서버)만으로는 순수 JS와 scikit-learn(Pyodide)이 둘 다
  // "내 컴퓨터에서 학습"으로 뭉친다. engine.kind로 되짚어야 갈린다.
  it('순수 JS(mljs)는 그 엔진 전용 문구로 간다', () => {
    const r = run('run-1', { accuracy: 0.9 })
    expect(whereTrainedKeyOf({ ...r, engine: { kind: 'mljs', version: '2' } })).toBe(
      'runtimes.mljs',
    )
  })

  it('scikit-learn(Pyodide)도 순수 JS와 다른 문구로 간다', () => {
    const r = run('run-1', { accuracy: 0.9 })
    expect(whereTrainedKeyOf({ ...r, engine: { kind: 'pyodide-sklearn', version: '1' } })).toBe(
      'runtimes.pyodide-sklearn',
    )
  })

  // 등록부의 engineKind('sklearn')와 id('server-sklearn')가 다른 유일한 자리다.
  it('서버 sklearn은 engineKind가 아니라 등록부의 id로 옮겨진다', () => {
    const r = run('run-1', { accuracy: 0.9 })
    expect(
      whereTrainedKeyOf({ ...r, computedBy: 'server', engine: { kind: 'sklearn', version: '1' } }),
    ).toBe('runtimes.server-sklearn')
  })

  it('engine이 없으면(옛 포맷) 위치만 보여준다', () => {
    const r = run('run-1', { accuracy: 0.9 })
    expect(whereTrainedKeyOf(r)).toBe('execution.browser')
  })

  it('모르는 엔진이면 위치만 보여준다 - 아는 척하지 않는다', () => {
    const r = run('run-1', { accuracy: 0.9 })
    expect(whereTrainedKeyOf({ ...r, engine: { kind: 'unknown-engine', version: '1' } })).toBe(
      'execution.browser',
    )
  })
})

describe('run에 먹인 하이퍼파라미터', () => {
  /** mljs 결정트리로 돈 run. 등록부가 아는 손잡이가 둘이다(maxDepth, minNumSamples). */
  function tree(hyperparameters: Record<string, unknown>): Run {
    return {
      ...run('run-1', { accuracy: 0.9 }),
      hyperparameters,
      engine: { kind: 'mljs', version: '2' },
    }
  }

  it('등록부 순서로 이름과 값을 낸다 - 파일에 담긴 순서가 아니다', () => {
    // 값은 학습 직전에 확정된 것이라 학생이 안 건드린 것도 들어 있다.
    const shown = hyperparametersOf(tree({ minNumSamples: 3, maxDepth: 100 }))

    expect(shown).toEqual([
      { name: 'maxDepth', labelKey: 'hyperparams.maxDepth', text: '100' },
      { name: 'minNumSamples', labelKey: 'hyperparams.minNumSamples', text: '3' },
    ])
  })

  it('등록부가 모르는 키도 버리지 않는다 - 이름은 엔진이 받는 키 그대로다', () => {
    // 서버 엔진이나 남의 파일에서 올 수 있다. 감추면 화면이 파일보다 적게 말한다.
    const shown = hyperparametersOf(tree({ maxDepth: 5, criterion: 'entropy' }))

    expect(shown).toEqual([
      { name: 'maxDepth', labelKey: 'hyperparams.maxDepth', text: '5' },
      { name: 'criterion', labelKey: null, text: 'entropy' },
    ])
  })

  it('등록부에 있어도 값이 없으면 줄을 만들지 않는다 - 빈 값을 지어내지 않는다', () => {
    expect(hyperparametersOf(tree({ maxDepth: 5 })).map((one) => one.name)).toEqual(['maxDepth'])
  })

  it('손잡이가 없는 모델은 빈 목록이다 - 화면이 그 사실을 적는다', () => {
    const bayes = { ...tree({}), algorithm: 'naive_bayes' }
    expect(hyperparametersOf(bayes)).toEqual([])
  })

  it('engine이 없으면(옛 포맷) 이름은 못 붙여도 값은 그대로 보인다', () => {
    // 실행 방법을 모르면 어느 어휘인지 모른다(ml.js maxDepth / sklearn max_depth).
    const noEngine = { ...run('run-1', { accuracy: 0.9 }), hyperparameters: { maxDepth: 7 } }

    expect(hyperparametersOf(noEngine)).toEqual([{ name: 'maxDepth', labelKey: null, text: '7' }])
  })
})

describe('값 종류별 점수의 가장 약한 칸', () => {
  it('지표마다 가장 낮은 클래스를 짚는다', () => {
    const weakest = weakestPerClass([
      { label: '고양이', precision: 0.9, recall: 0.5, f1: 0.6, support: 10 },
      { label: '강아지', precision: 0.4, recall: 0.9, f1: 0.9, support: 10 },
    ])

    expect(isWeakestPerClass(weakest, '강아지', 'precision')).toBe(true)
    expect(isWeakestPerClass(weakest, '고양이', 'precision')).toBe(false)
    expect(isWeakestPerClass(weakest, '고양이', 'recall')).toBe(true)
    expect(isWeakestPerClass(weakest, '강아지', 'f1')).toBe(false)
    expect(isWeakestPerClass(weakest, '고양이', 'f1')).toBe(true)
  })

  it('특이도도 짚는다 - 모델이 자꾸 그 범주라고 잘못 부른다는 뜻이다', () => {
    const weakest = weakestPerClass([
      { label: '고양이', precision: 0.9, recall: 0.5, specificity: 0.6, f1: 0.6, support: 10 },
      { label: '강아지', precision: 0.4, recall: 0.9, specificity: 0.95, f1: 0.9, support: 10 },
    ])

    expect(isWeakestPerClass(weakest, '고양이', 'specificity')).toBe(true)
    expect(isWeakestPerClass(weakest, '강아지', 'specificity')).toBe(false)
  })

  it('특이도가 없는 옛 파일에서는 그 열을 아무도 안 짚는다', () => {
    // 없는 것을 0으로 보면 첫 범주가 늘 최저가 되어 뜻 없는 칸이 노래진다.
    const weakest = weakestPerClass([
      { label: '고양이', precision: 0.9, recall: 0.5, f1: 0.6, support: 10 },
      { label: '강아지', precision: 0.4, recall: 0.9, f1: 0.9, support: 10 },
    ])

    expect(isWeakestPerClass(weakest, '고양이', 'specificity')).toBe(false)
    expect(isWeakestPerClass(weakest, '강아지', 'specificity')).toBe(false)
    // 나머지 지표는 그대로 짚는다.
    expect(isWeakestPerClass(weakest, '강아지', 'precision')).toBe(true)
  })

  it('전부 같은 점수면 아무것도 안 짚는다 - 붓꽃처럼 다 100%인 실험이 그렇다', () => {
    const weakest = weakestPerClass([
      { label: 'setosa', precision: 1, recall: 1, specificity: 1, f1: 1, support: 10 },
      { label: 'versicolor', precision: 1, recall: 1, specificity: 1, f1: 1, support: 10 },
      { label: 'virginica', precision: 1, recall: 1, specificity: 1, f1: 1, support: 10 },
    ])
    expect(weakest.size).toBe(0)
  })

  it('가장 낮은 값이 여럿이면 전부 짚는다 - 하나만 고를 근거가 없다', () => {
    const weakest = weakestPerClass([
      { label: '고양이', precision: 0.5, recall: 0.9, f1: 0.9, support: 10 },
      { label: '강아지', precision: 0.5, recall: 0.9, f1: 0.9, support: 10 },
      { label: '토끼', precision: 0.9, recall: 0.5, f1: 0.5, support: 10 },
    ])

    expect(isWeakestPerClass(weakest, '고양이', 'precision')).toBe(true)
    expect(isWeakestPerClass(weakest, '강아지', 'precision')).toBe(true)
    expect(isWeakestPerClass(weakest, '토끼', 'precision')).toBe(false)
  })

  it('클래스가 하나뿐이면 아무것도 안 짚는다 - 견줄 것이 없다', () => {
    const weakest = weakestPerClass([
      { label: '고양이', precision: 0.9, recall: 0.5, f1: 0.6, support: 10 },
    ])
    expect(isWeakestPerClass(weakest, '고양이', 'precision')).toBe(false)
  })

  it('클래스가 없으면 아무것도 안 짚는다', () => {
    expect(weakestPerClass([]).size).toBe(0)
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
