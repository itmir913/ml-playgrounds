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
import { MLJS_ALGORITHMS, MLJS_ENGINE, fit, resolve } from '../src/ml/engines/mljs'
import { evaluate } from '../src/ml/metrics'
import { holdoutSplit } from '../src/ml/split'
import packageJson from '../package.json'
import { IRIS_FEATURES, IRIS_LABELS } from './fixtures/iris'

const split = holdoutSplit(
  { rows: [...IRIS_FEATURES.keys()], labels: IRIS_LABELS },
  { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
)

function run(algorithm: string, hyperparameters: Record<string, unknown> = {}) {
  const pick = (indices: readonly number[]) => indices.map((i) => IRIS_FEATURES[i] as number[])
  const labelsOf = (indices: readonly number[]) => indices.map((i) => IRIS_LABELS[i] as string)

  const { predict } = fit(algorithm, {
    features: pick(split.trainIndices),
    rowIndices: split.trainIndices,
    target: labelsOf(split.trainIndices),
    hyperparameters,
    randomState: 42,
  })
  return evaluate('classification', labelsOf(split.testIndices), predict(pick(split.testIndices)))
}

describe('등록부가 서로 맞는다', () => {
  it('mljs로 선언된 알고리즘은 전부 여기 구현이 있다', () => {
    const declared = ALGORITHMS.filter((a) => a.runtimes.mljs).map((a) => a.id)
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

  it('svm도 여기 있다 - 벤더링한 SMO가 들어왔다', () => {
    // 예전에는 없었고, 그 상태가 공식 배포의 기본값이라 대부분의 학생에게 SVM은
    // 없는 물건이었다 (open-decisions.md "순수 JS 서포트 벡터 머신을 넣는다").
    expect(MLJS_ALGORITHMS).toContain('svm')
    expect(ALGORITHMS.find((a) => a.id === 'svm')?.runtimes.mljs).toBe(true)
  })
})

describe('엔진 버전이 의존성에 묶여 있다', () => {
  it('ml.js 버전이 바뀌면 알아차린다', () => {
    // 여기가 깨지면 숫자가 움직였는지 확인하고 MLJS_ENGINE.version을 올릴지 정하라.
    // 재실행 대조가 엔진 버전에 걸려 있어서(architecture.md 3.2), 조용히 올라가면
    // 옛 .mlpx가 "재현되지 않음"으로 뒤집힌다.
    expect({
      'ml-cart': packageJson.dependencies['ml-cart'],
      'ml-logistic-regression': packageJson.dependencies['ml-logistic-regression'],
      'ml-random-forest': packageJson.dependencies['ml-random-forest'],
      'ml-regression-multivariate-linear':
        packageJson.dependencies['ml-regression-multivariate-linear'],
    }).toEqual({
      'ml-cart': '^2.1.1',
      'ml-logistic-regression': '^2.0.0',
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

  /**
   * **나무를 적게 잡아도 학습된다.**
   *
   * ml.js는 학습 끝에 out-of-bag 예측을 모으는데, 어떤 행이 모든 나무의 학습 표본에
   * 들어가면 그 행의 표가 빈 배열이 되고 거기서 던진다. 한 행이 그럴 확률이 나무 하나당
   * 약 0.632이므로 **나무가 적을수록 반드시 터진다** - 기본값 100그루에서는 확률이 0에
   * 수렴해서 안 보이고, 나무 개수를 줄여 본 학생만 만난다.
   *
   * 우리는 OOB를 안 쓰므로 꺼서 막았다(mljs.ts의 noOOB). 위의 고정된 숫자들이 그 변경으로
   * 모델이 안 달라졌음을 지킨다.
   */
  for (const nEstimators of [1, 3, 10]) {
    it(`랜덤포레스트를 ${nEstimators}그루로 잡아도 학습된다`, () => {
      expect(run('random_forest', { nEstimators }).metrics.accuracy).toBeGreaterThan(0)
    })
  }
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
   * **naive_bayes의 3/9는 라이브러리 결함의 숫자였다.** `ml-naivebayes`가 예측할 때
   * 특성을 앞 2개만 읽어서, 판별력 없는 꽃받침 둘만 쓴 모델의 값이 여기 고정돼 있었다.
   * 그리고 그 값이 "폭이 제일 크다"의 근거로 문서 두 곳에 올라가 있었다. 자체 구현으로
   * 바꾼 뒤 8/9다 (open-decisions.md "가우시안 나이브 베이즈는 의존성을 빼고 우리가
   * 구현한다").
   *
   * **고정 테스트가 결함을 못 잡는 자리가 여기다.** 값을 못 박는 것은 옳지만, 못 박은
   * 값이 처음부터 틀렸으면 고정은 그것을 지켜 줄 뿐이다. 낮은 숫자를 "구현 차이"로
   * 설명하고 넘어가기 전에 입력이 실제로 다 쓰이는지부터 본다.
   */
  /**
   * **logistic_regression은 9/9였다가 8/9가 됐다 (2026-08-10, V2 감사 1단계-A).**
   * 엔진이 내부 표준화와 절편을 넣으면서다(mlpx-spec.md 5.4.1) - 이 축소판(행 30개,
   * 평가 9행)에서는 한 줄 내려갔지만, 같은 변경이 붓꽃 150행 전체에서 0.9333→0.9667,
   * 값의 높낮이로 갈리는 교실 데이터에서 기준선 이하→sklearn 수준이다. 실측표는
   * open-decisions.md에 있다. 배포 전이라 MLJS_ENGINE.version은 안 올린다(파일 머리말).
   */
  const PINNED: Record<string, number> = {
    decision_tree: 7 / 9,
    knn: 8 / 9,
    random_forest: 8 / 9,
    logistic_regression: 8 / 9,
    naive_bayes: 8 / 9,
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
    const known = new Set(IRIS_LABELS)
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

describe('로지스틱 수렴 경고 (mlpx-spec.md 5.9)', () => {
  it('스텝이 모자라면 LOGISTIC_NOT_CONVERGED가 붙는다', () => {
    const { warning } = fit('logistic_regression', {
      features: IRIS_FEATURES,
      rowIndices: IRIS_FEATURES.map((_, index) => index),
      target: IRIS_LABELS,
      hyperparameters: { numSteps: 5 },
      randomState: 42,
    })
    expect(warning?.code).toBe('LOGISTIC_NOT_CONVERGED')
    // 파일에 남는 것은 판정의 근거다 - 기울기와 문턱이 함께 적힌다.
    expect(typeof warning?.params.gradient).toBe('number')
    expect(warning?.params.tol).toBe(1e-4)
  })

  it('기울기가 0인 데이터에서는 경고가 없다', () => {
    // 완전히 대칭인 데이터 - 최적점이 w=0이고 시작점이 곧 최적점이다.
    const { warning } = fit('logistic_regression', {
      features: [[0], [0], [1], [1]],
      rowIndices: [0, 1, 2, 3],
      target: ['a', 'b', 'a', 'b'],
      hyperparameters: {},
      randomState: 42,
    })
    expect(warning).toBeUndefined()
  })
})

describe('resolve - 무엇을 먹였는지 확정한다', () => {
  it('학생이 안 건드린 자리를 기본값으로 채운다', () => {
    // 이게 없으면 run.hyperparameters가 빈 객체로 남아, 교사가 파일을 열고 "이 결정트리는
    // 깊이 몇이었나"에 답할 수 없다 (mlpx-spec.md 3).
    expect(resolve('decision_tree', {})).toEqual({ maxDepth: 100, minNumSamples: 3 })
    expect(resolve('knn', {})).toEqual({ k: 5 })
  })

  it('학생이 준 값이 이긴다', () => {
    expect(resolve('decision_tree', { maxDepth: 3 })).toEqual({ maxDepth: 3, minNumSamples: 3 })
  })

  it('못 쓰는 값은 기본값으로 확정한다 - 파일과 엔진이 갈리면 안 된다', () => {
    // 파일에 k: null이라 적어 놓고 5로 도는 상태를 만들지 않는다. 확정이 곧 기록이다.
    expect(resolve('knn', { k: null })).toEqual({ k: 5 })
    expect(resolve('knn', { k: '다섯' })).toEqual({ k: 5 })
    expect(resolve('knn', { k: Number.NaN })).toEqual({ k: 5 })
  })

  it('모르는 키는 손대지 않고 통과시킨다', () => {
    // 엔진이 받고 무시한 것까지가 "먹인 것"의 사실이다. 버리면 실패한 run에서
    // 학생이 무엇을 시도했는지가 지워진다.
    expect(resolve('knn', { max_depth: 3 })).toEqual({ k: 5, max_depth: 3 })
  })

  it('손잡이가 없는 알고리즘은 빈 객체가 정답이다', () => {
    expect(resolve('naive_bayes', {})).toEqual({})
    expect(resolve('linear_regression', {})).toEqual({})
  })

  it('모르는 알고리즘이면 던지지 않고 준 값을 돌려준다', () => {
    // 판정은 fit의 일이다. 여기서 던지면 실패 run을 만들기도 전에 실험이 죽는다.
    expect(resolve('없는알고리즘', { k: 3 })).toEqual({ k: 3 })
  })

  it('두 번 걸어도 결과가 같다 - fit이 안에서 한 번 더 부른다', () => {
    const once = resolve('decision_tree', { maxDepth: 3 })
    expect(resolve('decision_tree', once)).toEqual(once)
  })

  it('fit은 resolve를 안 거친 호출에도 견딘다', () => {
    // 안 그러면 k가 0인 KNN처럼 조용히 망가지고, 원인은 여기서 멀리 떨어진 곳에서 터진다.
    expect(run('knn', {}).metrics.accuracy).toBeGreaterThan(0.5)
  })
})

describe('회귀', () => {
  it('선형 회귀가 직선을 찾는다', () => {
    // y = 2x + 1
    const features = [[0], [1], [2], [3], [4]]
    const { predict } = fit('linear_regression', {
      features,
      rowIndices: [0, 1, 2, 3, 4],
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
      fit('없는알고리즘', {
        features: [[1]],
        rowIndices: [0],
        target: ['a'],
        hyperparameters: {},
        randomState: 1,
      })
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
