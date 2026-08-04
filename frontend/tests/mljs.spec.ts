/**
 * 순수 JS 학습 엔진.
 *
 * **숫자를 고정하는 것이 이 파일의 목적이다.** 학생이 같은 데이터와 같은 설정으로
 * 두 번 돌리면 같은 결과가 나와야 하고(재현 가능성), 우리가 의존성을 올릴 때
 * 그 결과가 움직였는지 알아야 한다(재실행 대조가 엔진 버전에 걸려 있으므로).
 *
 * 붓꽃은 sklearn과 대조한 값이 있다 - 결정트리 0.9333, KNN 1.0.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { ALGORITHMS } from '../src/ml/algorithms'
import { MLJS_ALGORITHMS, MLJS_ENGINE, fit } from '../src/ml/engines/mljs'
import { evaluate } from '../src/ml/metrics'
import { holdoutSplit } from '../src/ml/split'
import packageJson from '../package.json'

/**
 * 붓꽃 축소판. 품종마다 10개씩, 실제 붓꽃 값에서 고르게 뽑았다.
 * 전체 150개를 테스트에 박으면 읽을 수 없는 파일이 된다.
 */
const IRIS: { features: number[][]; labels: string[] } = {
  features: [
    [5.1, 3.5, 1.4, 0.2],
    [4.9, 3.0, 1.4, 0.2],
    [4.7, 3.2, 1.3, 0.2],
    [4.6, 3.1, 1.5, 0.2],
    [5.0, 3.6, 1.4, 0.2],
    [5.4, 3.9, 1.7, 0.4],
    [4.6, 3.4, 1.4, 0.3],
    [5.0, 3.4, 1.5, 0.2],
    [4.4, 2.9, 1.4, 0.2],
    [4.9, 3.1, 1.5, 0.1],
    [7.0, 3.2, 4.7, 1.4],
    [6.4, 3.2, 4.5, 1.5],
    [6.9, 3.1, 4.9, 1.5],
    [5.5, 2.3, 4.0, 1.3],
    [6.5, 2.8, 4.6, 1.5],
    [5.7, 2.8, 4.5, 1.3],
    [6.3, 3.3, 4.7, 1.6],
    [4.9, 2.4, 3.3, 1.0],
    [6.6, 2.9, 4.6, 1.3],
    [5.2, 2.7, 3.9, 1.4],
    [6.3, 3.3, 6.0, 2.5],
    [5.8, 2.7, 5.1, 1.9],
    [7.1, 3.0, 5.9, 2.1],
    [6.3, 2.9, 5.6, 1.8],
    [6.5, 3.0, 5.8, 2.2],
    [7.6, 3.0, 6.6, 2.1],
    [4.9, 2.5, 4.5, 1.7],
    [7.3, 2.9, 6.3, 1.8],
    [6.7, 2.5, 5.8, 1.8],
    [7.2, 3.6, 6.1, 2.5],
  ],
  labels: [
    ...Array(10).fill('setosa'),
    ...Array(10).fill('versicolor'),
    ...Array(10).fill('virginica'),
  ] as string[],
}

const split = holdoutSplit(
  { rows: [...IRIS.features.keys()], labels: IRIS.labels },
  { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
)

function run(algorithm: string, hyperparameters: Record<string, unknown> = {}) {
  const pick = (indices: readonly number[]) => indices.map((i) => IRIS.features[i] as number[])
  const labelsOf = (indices: readonly number[]) => indices.map((i) => IRIS.labels[i] as string)

  const predict = fit(algorithm, {
    features: pick(split.trainIndices),
    target: labelsOf(split.trainIndices),
    hyperparameters,
    randomState: 42,
  })
  return evaluate('classification', labelsOf(split.testIndices), predict(pick(split.testIndices)))
}

describe('등록부가 서로 맞는다', () => {
  it('mljs로 선언된 알고리즘은 전부 여기 구현이 있다', () => {
    const declared = ALGORITHMS.filter((a) => a.runtimes.includes('mljs')).map((a) => a.id)
    for (const id of declared) {
      expect(MLJS_ALGORITHMS, id).toContain(id)
    }
  })

  it('구현만 있고 등록되지 않은 알고리즘은 없다 - 화면에 안 나오면 없는 것이다', () => {
    const declared = new Set(ALGORITHMS.map((a) => a.id))
    for (const id of MLJS_ALGORITHMS) {
      expect(declared.has(id), id).toBe(true)
    }
  })

  it('svm은 여기 없다 - 순수 JS 후보가 WASM뿐이다', () => {
    expect(MLJS_ALGORITHMS).not.toContain('svm')
  })
})

describe('엔진 버전이 의존성에 묶여 있다', () => {
  it('ml.js 버전이 바뀌면 알아차린다', () => {
    // 여기가 깨지면 숫자가 움직였는지 확인하고 MLJS_ENGINE.version을 올릴지 정하라.
    // 재실행 대조가 엔진 버전에 걸려 있어서(architecture.md 3.2), 조용히 올라가면
    // 옛 .mlpx가 "재현되지 않음"으로 뒤집힌다.
    expect({
      'ml-cart': packageJson.dependencies['ml-cart'],
      'ml-knn': packageJson.dependencies['ml-knn'],
      'ml-logistic-regression': packageJson.dependencies['ml-logistic-regression'],
      'ml-naivebayes': packageJson.dependencies['ml-naivebayes'],
      'ml-random-forest': packageJson.dependencies['ml-random-forest'],
      'ml-regression-multivariate-linear':
        packageJson.dependencies['ml-regression-multivariate-linear'],
    }).toEqual({
      'ml-cart': '^2.1.1',
      'ml-knn': '^3.0.0',
      'ml-logistic-regression': '^2.0.0',
      'ml-naivebayes': '^4.0.0',
      'ml-random-forest': '^2.1.0',
      'ml-regression-multivariate-linear': '^2.0.4',
    })
  })

  it('엔진 이름이 실행 방법의 engineKind와 같다', () => {
    expect(MLJS_ENGINE.kind).toBe('mljs')
  })
})

describe('재현 가능성', () => {
  for (const algorithm of ['decision_tree', 'knn', 'random_forest', 'naive_bayes']) {
    it(`${algorithm}은 두 번 돌려도 같은 결과다`, () => {
      expect(run(algorithm).metrics).toEqual(run(algorithm).metrics)
    })
  }

  it('랜덤포레스트는 시드가 다르면 모델도 다를 수 있다', () => {
    // 시드를 안 넘기면 매번 다르다. 넘긴다는 것 자체가 여기서 확인된다.
    const first = run('random_forest')
    const second = run('random_forest')
    expect(second.metrics).toEqual(first.metrics)
  })
})

describe('붓꽃을 실제로 학습한다', () => {
  /**
   * **숫자를 그대로 못 박는다.**
   *
   * 임의의 하한선("0.8 이상")은 아무것도 지키지 못한다 - 의존성이 올라가면서 결과가
   * 0.89에서 0.82로 움직여도 통과한다. 그런데 재실행 대조는 지표가 재현되는지를 보므로
   * (mlpx-spec.md 7), 그 움직임이 곧 옛 .mlpx의 "재현되지 않음"이다.
   *
   * 여기가 깨졌다는 것은 **학생의 결과가 바뀌었다**는 뜻이다. 값을 고쳐 통과시키기 전에
   * MLJS_ENGINE.version을 올릴지부터 정하라.
   *
   * **naive_bayes가 낮은 것은 알고 있는 사실이다.** 이 표본은 21행이라 유난히 낮게
   * 나오고, 붓꽃 전체에서도 0.70이다(sklearn은 같은 분할에서 0.9667).
   * 그래도 빼지 않는다 - 어디까지가 "구현 차이"이고 어디부터가 "빼야 할 것"인지
   * 그을 선이 없다. 대신 run.engine에 무엇으로 만들었는지 남긴다.
   */
  const PINNED: Record<string, number> = {
    decision_tree: 7 / 9,
    knn: 8 / 9,
    random_forest: 8 / 9,
    logistic_regression: 1,
    naive_bayes: 3 / 9,
  }

  for (const [algorithm, accuracy] of Object.entries(PINNED)) {
    it(`${algorithm}의 붓꽃 정확도가 그대로다`, () => {
      const { metrics, confusionMatrix } = run(algorithm)
      expect(Number.isFinite(metrics.accuracy)).toBe(true)
      expect(confusionMatrix?.labels).toEqual(['setosa', 'versicolor', 'virginica'])
      expect(metrics.accuracy, algorithm).toBeCloseTo(accuracy, 10)
    })
  }

  it('예측 결과가 학습에서 본 라벨 안에서만 나온다', () => {
    const known = new Set(IRIS.labels)
    const { confusionMatrix } = run('decision_tree')
    for (const label of confusionMatrix?.labels ?? []) {
      expect(known.has(label), label).toBe(true)
    }
  })
})

describe('하이퍼파라미터', () => {
  it('넘긴 값이 실제로 쓰인다 - 깊이 1이면 성능이 떨어진다', () => {
    const shallow = run('decision_tree', { maxDepth: 1 }).metrics.accuracy ?? 0
    const deep = run('decision_tree', { maxDepth: 100 }).metrics.accuracy ?? 0
    expect(shallow).toBeLessThan(deep)
  })

  it('모르는 값은 무시하고 기본값으로 돈다', () => {
    expect(run('knn', { max_depth: 3, 이상한값: 'x' }).metrics).toEqual(run('knn').metrics)
  })

  it('숫자가 아닌 값이 와도 기본값으로 떨어진다', () => {
    expect(run('knn', { k: null }).metrics).toEqual(run('knn', { k: 5 }).metrics)
  })
})

describe('회귀', () => {
  it('선형 회귀가 직선을 찾는다', () => {
    // y = 2x + 1
    const features = [[0], [1], [2], [3], [4]]
    const predict = fit('linear_regression', {
      features,
      target: [1, 3, 5, 7, 9],
      hyperparameters: {},
      randomState: 42,
    })
    const { metrics } = evaluate('regression', [11, 13], predict([[5], [6]]))
    expect(metrics.r2).toBeGreaterThan(0.99)
    expect(metrics.mae).toBeLessThan(0.01)
  })
})

describe('모르는 알고리즘', () => {
  it('ALGORITHM_UNSUPPORTED로 실패한다', () => {
    try {
      fit('없는알고리즘', { features: [[1]], target: ['a'], hyperparameters: {}, randomState: 1 })
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('ALGORITHM_UNSUPPORTED')
        expect(error.params.algorithm).toBe('없는알고리즘')
      }
    }
  })
})
