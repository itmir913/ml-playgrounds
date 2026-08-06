/**
 * 저장된 모델을 다시 읽는 계층 (mlpx-spec.md 5.3).
 *
 * **이 파일의 목적은 하나다 — 저장했다가 다시 읽은 모델이 원본과 똑같이 예측하는가.**
 * 지표만 대조하면 어긋난 예측이 상쇄로 가려진다. 정확도가 같아도 서로 다른 행을 틀리고
 * 있을 수 있고, 학생이 저장한 모델로 새 데이터를 넣어 보는 순간 그게 드러난다.
 *
 * 그래서 예측 배열을 통째로 비교하고, **JSON 문자열 왕복을 반드시 거친다** - 실제로
 * `.mlpx` 안에 들어가는 것은 객체가 아니라 바이트다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError, type ClientErrorCode } from '../src/errors'
import { MAX_MODEL_BYTES } from '../src/limits'
import { MLJS_ALGORITHMS, fit } from '../src/ml/engines/mljs'
import {
  LINEAR_FORMAT,
  LINEAR_REGRESSION_FORMAT,
  NAIVE_BAYES_FORMAT,
  REFERENCE_FORMAT,
  TREE_FORMAT,
  assertContext,
  interpreterFor,
  knnPredict,
  loadModel,
  type LinearModel,
  type LinearRegressionModel,
  type ModelInterpreter,
  type NaiveBayesModel,
  type NeighborhoodInput,
  type ReferenceModel,
  type TreeModel,
  type TreeNode,
} from '../src/ml/models'
import { IRIS_FEATURES, IRIS_LABELS } from './fixtures/iris'

/** 파일에 들어가는 바이트를 실제로 거친다. 객체를 그대로 넘기면 왕복을 안 한 것이다. */
function roundTrip(model: unknown): unknown {
  return JSON.parse(JSON.stringify(model)) as unknown
}

function expectCode(run: () => unknown, code: ClientErrorCode): void {
  try {
    run()
    expect.unreachable()
  } catch (error) {
    expect(isClientError(error)).toBe(true)
    if (isClientError(error)) expect(error.code).toBe(code)
  }
}

function train(algorithm: string, hyperparameters: Record<string, unknown> = {}) {
  return fit(algorithm, {
    features: IRIS_FEATURES,
    rowIndices: IRIS_FEATURES.map((_, index) => index),
    target: IRIS_LABELS,
    hyperparameters,
    randomState: 42,
  })
}

function leaf(classIndex: number): TreeNode {
  return [-1, classIndex, -1, -1]
}

/** 잎 하나짜리 나무. 무엇을 넣든 이 클래스를 낸다. */
function stump(classIndex: number): { nodes: TreeNode[] } {
  return { nodes: [leaf(classIndex)] }
}

function forestOf(votes: readonly number[]): TreeModel {
  return {
    format: TREE_FORMAT,
    classes: ['a', 'b', 'c'],
    featureCount: 1,
    trees: votes.map(stump),
  }
}

describe('라운드트립 — 예측이 원본과 하나도 다르지 않다', () => {
  for (const algorithm of ['decision_tree', 'random_forest']) {
    it(`${algorithm}: 직렬화 → JSON 왕복 → 역직렬화가 같은 예측을 낸다`, () => {
      const { predict, model } = train(algorithm)
      expect(model).toBeDefined()

      const reloaded = loadModel(roundTrip(model))
      // 학습에 쓴 행 전부로 본다. 평가셋만 보면 지나는 잎이 얼마 안 되고,
      // 그러면 잘못 옮긴 가지가 있어도 아무도 그 길로 안 지나간다.
      expect(reloaded(IRIS_FEATURES)).toEqual(predict(IRIS_FEATURES))
    })
  }

  it('결정트리는 나무가 한 그루다 — 그래서 해석기에 알고리즘 분기가 없다', () => {
    const { model } = train('decision_tree')
    expect((model as TreeModel).trees).toHaveLength(1)
    expect((model as TreeModel).format).toBe(TREE_FORMAT)
  })

  it('랜덤포레스트는 요청한 그루 수만큼 담는다', () => {
    const { model } = train('random_forest', { nEstimators: 12 })
    expect((model as TreeModel).trees).toHaveLength(12)
  })

  it('클래스는 라벨을 정렬한 순서다 — 행 순서가 바뀌어도 같은 모델이어야 한다', () => {
    const { model } = train('decision_tree')
    expect((model as TreeModel).classes).toEqual([...new Set(IRIS_LABELS)].sort())
  })

  /**
   * **이제 이 엔진의 모든 알고리즘이 우리 형식으로 담긴다** (2026-08-06). 회귀까지 붙으면서
   * `modelOmitted: 'engineUnsupported'`가 나올 경로가 이 엔진에는 남지 않았다.
   *
   * 그래서 이 검사가 앞을 지킨다 — **직렬화기 없이 알고리즘을 등록하면 여기가 빨개진다.**
   * 어휘 자체는 스키마에 남는다. 앞으로 들어올 엔진(pyodide·서버)에는 여전히 필요하다.
   */
  it('이 엔진의 모든 알고리즘이 우리 형식으로 담긴다', () => {
    const regressionOnly = new Set(['linear_regression'])
    for (const algorithm of MLJS_ALGORITHMS) {
      const trained = regressionOnly.has(algorithm)
        ? fit(algorithm, {
            features: [[0], [1], [2], [3]],
            rowIndices: [0, 1, 2, 3],
            target: [1, 3, 5, 7],
            hyperparameters: {},
            randomState: 42,
          })
        : train(algorithm)

      expect(trained.model, algorithm).toBeDefined()
      expect(trained.modelOmittedDetail, algorithm).toBeUndefined()
      // 담긴 형식은 반드시 이 빌드가 읽을 수 있어야 한다.
      expect(interpreterFor(trained.model?.format ?? ''), algorithm).toBeDefined()
    }
  })
})

describe('다수결', () => {
  it('동점이면 그 표수에 먼저 도달한 나무 쪽이 이긴다', () => {
    // 같은 표를 순서만 바꿔 넣으면 답이 갈린다. ml.js가 이렇게 고르므로 우리도 그래야
    // 하고, 아니면 저장한 모델이 원본 run과 다르게 예측한다.
    expect(loadModel(forestOf([1, 0, 0, 1]))([[0]])).toEqual(['a'])
    expect(loadModel(forestOf([0, 1, 1, 0]))([[0]])).toEqual(['b'])
  })

  it('번호가 작은 클래스가 이기는 규칙이 아니다', () => {
    expect(loadModel(forestOf([1, 1, 0, 0]))([[0]])).toEqual(['b'])
  })

  it('나무가 하나면 그 나무의 답이 그대로 나온다', () => {
    expect(loadModel(forestOf([2]))([[0]])).toEqual(['c'])
  })
})

describe('등록부', () => {
  it('모르는 형식은 파일 문제가 아니다 — 그 모델로 예측만 못 한다', () => {
    expectCode(() => loadModel({ format: 'onnx-v1' }), 'MODEL_FORMAT_UNSUPPORTED')
  })

  it('형식을 안 밝힌 것은 모르는 형식이 아니라 깨진 파일이다', () => {
    // 여기서 MODEL_FORMAT_UNSUPPORTED를 주면 화면이 "이 버전에서는 실행할 수 없습니다"를
    // 말하고, 학생은 고칠 수 없는 것을 고치러 앱 업데이트를 하러 간다.
    expectCode(() => loadModel({ classes: ['a'] }), 'MODEL_FILE_INVALID')
    expectCode(() => loadModel(null), 'MODEL_FILE_INVALID')
  })
})

describe('깨진 모델은 조용히 틀린 답을 내지 않는다', () => {
  const base = forestOf([0])

  function broken(nodes: TreeNode[]): TreeModel {
    return { ...base, featureCount: 2, trees: [{ nodes }] }
  }

  it('자식이 자기보다 앞을 가리키면 거부한다 — 순환이 될 자리다', () => {
    expectCode(() => loadModel(broken([[0, 1, 0, 1], leaf(0)])), 'MODEL_FILE_INVALID')
  })

  it('자식이 범위를 벗어나면 거부한다', () => {
    expectCode(() => loadModel(broken([[0, 1, 1, 9], leaf(0)])), 'MODEL_FILE_INVALID')
  })

  it('열 번호가 특성 개수를 넘으면 거부한다', () => {
    expectCode(() => loadModel(broken([[5, 1, 1, 2], leaf(0), leaf(1)])), 'MODEL_FILE_INVALID')
  })

  it('잎의 클래스 번호가 범위를 벗어나면 거부한다', () => {
    expectCode(() => loadModel(broken([leaf(9)])), 'MODEL_FILE_INVALID')
  })

  it('잎인데 자식이 있으면 거부한다', () => {
    expectCode(() => loadModel(broken([[-1, 0, 1, 1], leaf(0)])), 'MODEL_FILE_INVALID')
  })

  it('나무가 비어 있으면 거부한다', () => {
    expectCode(() => loadModel({ ...base, trees: [{ nodes: [] }] }), 'MODEL_FILE_INVALID')
  })

  it('임계값이 수가 아니면 거부한다', () => {
    expectCode(
      () => loadModel({ ...base, trees: [{ nodes: [['x', 1, -1, -1]] }] }),
      'MODEL_FILE_INVALID',
    )
  })

  it('특성 개수가 다른 입력은 거부한다 — 전처리기가 바뀐 파일이 여기서 걸린다', () => {
    const model = loadModel({ ...base, featureCount: 4 })
    expectCode(() => model([[1, 2, 3]]), 'MODEL_FILE_INVALID')
  })
})

describe('크기', () => {
  it('교실 크기 데이터의 기본 100그루가 개별 상한 안에 든다', () => {
    // #19의 실측이 이 값을 정한다. 여기서는 상한과 형식이 어긋나는 것을 막는 것이
    // 목적이다 - 형식을 바꿔 모델이 커지면 이 테스트가 먼저 깨진다.
    const { model } = train('random_forest')
    expect(new TextEncoder().encode(JSON.stringify(model)).length).toBeLessThan(MAX_MODEL_BYTES)
  })
})

/**
 * **축 하나가 형식 이름을 대신한다** (mlpx-spec.md §5.0). 화면은 "이 모델을 쓸 수 있나"를
 * `needsTrainingRows` 불리언으로 판정하고, 형식이 늘어도 그 판정은 안 바뀐다.
 */
describe('학습 행이 필요한 형식', () => {
  it('자체 완결형은 요구하지 않고 참조형만 요구한다', () => {
    for (const format of [TREE_FORMAT, LINEAR_FORMAT, NAIVE_BAYES_FORMAT]) {
      expect(interpreterFor(format)?.needsTrainingRows, format).toBe(false)
    }
    expect(interpreterFor(REFERENCE_FORMAT)?.needsTrainingRows).toBe(true)
  })

  it('요구하는데 안 주면 던진다 - 빈 학습셋으로 그럴듯한 답을 내지 않는다', () => {
    const needy: ModelInterpreter = {
      format: 'test-reference',
      includesPreprocessing: false,
      needsTrainingRows: true,
      load: () => () => ['nope'],
    }

    expectCode(() => assertContext(needy, {}), 'MODEL_NEEDS_DATASET')
    // 주면 통과한다. 안 그러면 위 검사가 "언제나 던진다"를 확인한 것에 불과하다.
    expect(() =>
      assertContext(needy, { trainingRows: { indices: [0], features: [[1]], target: ['a'] } }),
    ).not.toThrow()
  })

  it('요구하지 않는 형식은 행이 없어도 그냥 통과한다', () => {
    const interpreter = interpreterFor(TREE_FORMAT)
    expect(interpreter).toBeDefined()
    if (interpreter) expect(() => assertContext(interpreter, {})).not.toThrow()
  })
})

/**
 * `mlpx-linear-v1` (mlpx-spec.md §5.4).
 *
 * **이 형식의 요구는 하나다 — 저장했다가 다시 읽은 모델의 예측이 원본과 하나도 다르지
 * 않아야 한다.** 지표만 대조하면 어긋난 예측이 상쇄로 가려진다. 그리고 여기는 특히
 * 위험하다 — 예측이 `argmin`이라 부호 하나를 뒤집으면 **에러 없이 정확히 반대인 답**이
 * 나온다.
 */
describe('mlpx-linear-v1', () => {
  const trained = train('logistic_regression')

  it('로지스틱 회귀가 우리 형식으로 담긴다', () => {
    expect(trained.model?.format).toBe(LINEAR_FORMAT)
    expect(trained.modelOmittedDetail).toBeUndefined()
  })

  it('읽은 모델의 예측이 원본과 한 줄도 다르지 않다', () => {
    const restored = loadModel(JSON.parse(JSON.stringify(trained.model)))
    expect(restored(IRIS_FEATURES)).toEqual(trained.predict(IRIS_FEATURES))
  })

  it('클래스마다 한 줄이고 줄 길이가 특성 수다 - 절편은 없다', () => {
    const model = trained.model as LinearModel
    expect(model.weights).toHaveLength(model.classes.length)
    for (const row of model.weights) expect(row).toHaveLength(model.featureCount)
    expect(model.featureCount).toBe(IRIS_FEATURES[0]?.length)
  })

  it('점수가 낮은 클래스가 이긴다 - 뒤집으면 정확히 반대 답이 나온다', () => {
    // 0번 클래스에만 큰 음수 점수를 주는 가중치. argmin이면 0번, argmax면 마지막이다.
    const model = loadModel({
      format: LINEAR_FORMAT,
      classes: ['a', 'b', 'c'],
      featureCount: 1,
      weights: [[-10], [0], [10]],
    })
    expect(model([[1]])).toEqual(['a'])
  })

  it('동점이면 번호가 작은 클래스가 이긴다 - 포화에서 실제로 갈린다', () => {
    // 시그모이드가 전부 정확히 1.0으로 포화한다. 라이브러리가 엄격한 `<`로 갱신한다.
    const model = loadModel({
      format: LINEAR_FORMAT,
      classes: ['a', 'b'],
      featureCount: 1,
      weights: [[1000], [1000]],
    })
    expect(model([[1]])).toEqual(['a'])
  })

  it('줄 수가 클래스 수와 다르면 거부한다', () => {
    expectCode(
      () =>
        loadModel({ format: LINEAR_FORMAT, classes: ['a', 'b'], featureCount: 1, weights: [[1]] }),
      'MODEL_FILE_INVALID',
    )
  })

  it('특성 개수가 다른 입력은 거부한다 - 맞춰 읽으면 다른 열로 예측한다', () => {
    const model = loadModel({
      format: LINEAR_FORMAT,
      classes: ['a'],
      featureCount: 2,
      weights: [[1, 1]],
    })
    expectCode(() => model([[1]]), 'MODEL_FILE_INVALID')
  })
})

/**
 * `mlpx-naive-bayes-v1` (mlpx-spec.md §5.5).
 *
 * **요구는 §5.4와 같다 — 다시 읽은 모델의 예측이 원본과 한 줄도 다르면 안 된다.**
 * 여기는 학습 쪽과 해석기 쪽에 **같은 식이 두 벌** 있어서, 한쪽만 고치면 조용히 갈린다.
 */
describe('mlpx-naive-bayes-v1', () => {
  const trained = train('naive_bayes')

  it('나이브 베이즈가 우리 형식으로 담긴다', () => {
    expect(trained.model?.format).toBe(NAIVE_BAYES_FORMAT)
    expect(trained.modelOmittedDetail).toBeUndefined()
  })

  it('읽은 모델의 예측이 원본과 한 줄도 다르지 않다', () => {
    const restored = loadModel(JSON.parse(JSON.stringify(trained.model)))
    expect(restored(IRIS_FEATURES)).toEqual(trained.predict(IRIS_FEATURES))
  })

  it('계수의 줄 수가 전부 클래스 수와 같다', () => {
    const model = trained.model as NaiveBayesModel
    expect(model.logPriors).toHaveLength(model.classes.length)
    expect(model.means).toHaveLength(model.classes.length)
    expect(model.variances).toHaveLength(model.classes.length)
    for (const row of [...model.means, ...model.variances]) {
      expect(row).toHaveLength(model.featureCount)
    }
  })

  it('사전확률이 이미 로그다 - 확률로 되돌리지 않는다', () => {
    const model = trained.model as NaiveBayesModel
    // 로그 확률이므로 전부 0 이하이고, exp의 합이 1이다.
    expect(model.logPriors.every((value) => value <= 0)).toBe(true)
    const total = model.logPriors.reduce((sum, value) => sum + Math.exp(value), 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('분산이 0인 열은 점수에서 빠진다 - 나누면 전부 NaN이 된다', () => {
    // 두 클래스가 같은 평균을 갖고, 유일하게 갈리는 열의 분산이 0이다.
    const model = loadModel({
      format: NAIVE_BAYES_FORMAT,
      classes: ['a', 'b'],
      featureCount: 2,
      logPriors: [Math.log(0.5), Math.log(0.5)],
      means: [
        [0, 0],
        [0, 100],
      ],
      variances: [
        [1, 0],
        [1, 0],
      ],
    })
    // 건너뛰지 않으면 NaN 비교가 되어 아무도 못 이기고 던진다.
    expect(model([[0, 50]])).toEqual(['a'])
  })

  it('정규화 상수가 식에 있어야 한다 - 분산이 다르면 답이 갈린다', () => {
    // 두 클래스가 평균은 같고 분산만 다르다. 입력이 평균과 정확히 같으면 거리 항이 0이라
    // **정규화 상수만 남고**, 분산이 작은 쪽이 이긴다. 상수를 빼면 0 대 0 동점이 되어
    // 번호가 작은 a가 이긴다 - 붓꽃 왕복 테스트로는 이 차이가 안 잡힌다.
    const model = loadModel({
      format: NAIVE_BAYES_FORMAT,
      classes: ['a', 'b'],
      featureCount: 1,
      logPriors: [Math.log(0.5), Math.log(0.5)],
      means: [[0], [0]],
      variances: [[100], [0.01]],
    })
    expect(model([[0]])).toEqual(['b'])
  })

  it('줄 수가 어긋나면 거부한다', () => {
    expectCode(
      () =>
        loadModel({
          format: NAIVE_BAYES_FORMAT,
          classes: ['a', 'b'],
          featureCount: 1,
          logPriors: [-1],
          means: [[0]],
          variances: [[1]],
        }),
      'MODEL_FILE_INVALID',
    )
  })
})

/**
 * `mlpx-reference-v1` (mlpx-spec.md §5.6).
 *
 * **첫 `needsTrainingRows: true`다.** 그리고 학습 쪽과 해석기 쪽이 같은 함수를 쓰므로
 * 재현은 구조로 보장된다 — 여기서 확인하는 것은 그 구조가 실제로 이어져 있는지와,
 * **동점 규칙 넷이 각각 실제로 작동하는지**다.
 */
describe('mlpx-reference-v1', () => {
  const indices = IRIS_FEATURES.map((_, index) => index)
  const trained = train('knn', { k: 5 })
  const context = {
    trainingRows: { indices, features: IRIS_FEATURES, target: IRIS_LABELS },
  }

  it('KNN이 행 번호만 담는다 — 데이터를 중복 저장하지 않는다', () => {
    const model = trained.model as ReferenceModel
    expect(model.format).toBe(REFERENCE_FORMAT)
    expect(model.trainIndices).toEqual(indices)
    // 학습 행렬이 통째로 들어가면 안 된다.
    expect(JSON.stringify(model)).not.toContain(String(IRIS_FEATURES[0]?.[0]))
  })

  it('읽은 모델의 예측이 원본과 한 줄도 다르지 않다', () => {
    const restored = loadModel(JSON.parse(JSON.stringify(trained.model)), context)
    expect(restored(IRIS_FEATURES)).toEqual(trained.predict(IRIS_FEATURES))
  })

  it('원본 데이터가 없으면 예측을 만들지 않는다', () => {
    expectCode(() => loadModel(JSON.parse(JSON.stringify(trained.model))), 'MODEL_NEEDS_DATASET')
  })

  it('가리키는 행이 데이터에 없으면 거부한다 — 데이터가 없는 것과 다르다', () => {
    expectCode(
      () =>
        loadModel(
          { ...(trained.model as ReferenceModel), trainIndices: [9999] },
          { trainingRows: { indices, features: IRIS_FEATURES, target: IRIS_LABELS } },
        ),
      'MODEL_FILE_INVALID',
    )
  })

  /** 규칙 2 — 최다 득표. 나머지 규칙이 끼어들지 않는 평범한 경우다. */
  it('최다 득표 클래스가 이긴다', () => {
    const predict = knnPredict({
      k: 3,
      featureCount: 1,
      rows: [[0], [1], [10]],
      labels: ['a', 'a', 'b'],
      indices: [0, 1, 2],
    })
    expect(predict([[0.5]])).toEqual(['a'])
  })

  /** 규칙 3 — 득표가 같으면 가장 가까운 이웃을 가진 클래스가 이긴다. */
  it('득표가 같으면 더 가까운 이웃을 가진 클래스가 이긴다', () => {
    const predict = knnPredict({
      k: 2,
      featureCount: 1,
      rows: [[5], [1]],
      labels: ['a', 'b'],
      indices: [0, 1],
    })
    // 1대1 동점인데 b가 훨씬 가깝다. 번호 순으로 갈랐다면 a가 나온다.
    expect(predict([[0]])).toEqual(['b'])
  })

  /** 규칙 4 — 거리까지 같으면 행 번호가 작은 쪽. */
  it('거리까지 같으면 행 번호가 작은 쪽이 이긴다', () => {
    const predict = knnPredict({
      k: 2,
      featureCount: 1,
      rows: [[-1], [1]],
      labels: ['b', 'a'],
      indices: [7, 3],
    })
    // 거리가 완전히 같다. 라벨 순서(a<b)로 갈랐다면 a가 나온다.
    expect(predict([[0]])).toEqual(['a'])
  })

  /** 규칙 1 — k개를 고르는 것 자체도 (거리, 행 번호) 전순서를 따른다. */
  it('k개를 고를 때도 거리가 같으면 행 번호가 작은 쪽이 들어간다', () => {
    const predict = knnPredict({
      k: 1,
      featureCount: 1,
      rows: [[1], [-1]],
      labels: ['far', 'near'],
      indices: [5, 2],
    })
    // 둘 다 거리 1이다. 행 번호가 작은 2번(near)이 뽑혀야 한다.
    expect(predict([[0]])).toEqual(['near'])
  })

  it('이웃 수가 학습 행보다 많으면 있는 만큼만 본다', () => {
    const predict = knnPredict({
      k: 99,
      featureCount: 1,
      rows: [[0], [1]],
      labels: ['a', 'b'],
      indices: [0, 1],
    })
    expect(predict([[0]])).toEqual(['a'])
  })
})

/**
 * **힙으로 고른 k개가 완전 정렬로 고른 것과 같은가.**
 *
 * 이 성질이 깨지면 예측이 조용히 달라진다 - 에러도 안 나고 지표도 비슷하게 나온다.
 * 그래서 무작위 데이터로 두 구현을 맞대어 본다. 여기 있는 순진한 구현이 기준이다.
 */
describe('k개 고르기 — 힙이 완전 정렬과 같은 답을 낸다', () => {
  /** 완전 정렬판. 규칙 1~4를 그대로 옮긴 것이고 빠르지 않아도 된다. */
  function naive(input: NeighborhoodInput): (query: readonly number[]) => string {
    const { k, rows, labels, indices } = input
    return (query) => {
      const scored = rows.map((row, position) => ({
        distance: row.reduce((sum, value, column) => sum + (value - (query[column] ?? 0)) ** 2, 0),
        index: indices[position] ?? 0,
        label: labels[position] ?? '',
      }))
      scored.sort((a, b) => a.distance - b.distance || a.index - b.index)

      const votes = new Map<string, { count: number; distance: number; index: number }>()
      for (const near of scored.slice(0, Math.min(k, scored.length))) {
        const seen = votes.get(near.label)
        if (!seen) {
          votes.set(near.label, { count: 1, distance: near.distance, index: near.index })
          continue
        }
        seen.count += 1
        // 정렬돼 있으므로 먼저 만난 것이 언제나 더 가깝다.
      }

      let best = ''
      let bestVote = { count: -1, distance: 0, index: 0 }
      for (const [label, vote] of votes) {
        const wins =
          vote.count > bestVote.count ||
          (vote.count === bestVote.count &&
            (vote.distance < bestVote.distance ||
              (vote.distance === bestVote.distance && vote.index < bestVote.index)))
        if (wins) {
          best = label
          bestVote = vote
        }
      }
      return best
    }
  }

  it('무작위 데이터에서 두 구현이 한 줄도 다르지 않다', () => {
    // 좌표를 성기게 잡아 **동점이 실제로 생기게** 한다. 연속값만 쓰면 규칙 3·4가
    // 한 번도 안 밟히고, 그러면 이 테스트는 아무것도 확인하지 않는다.
    let seed = 20260806
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    const labels = ['a', 'b', 'c']

    for (const k of [1, 3, 4, 7]) {
      const rows = Array.from({ length: 40 }, () =>
        Array.from({ length: 2 }, () => Math.round(random() * 4)),
      )
      const rowLabels = rows.map(() => labels[Math.floor(random() * 3)] ?? 'a')
      const indices = rows.map((_, index) => index * 3)
      const input: NeighborhoodInput = { k, featureCount: 2, rows, labels: rowLabels, indices }

      const heap = knnPredict(input)
      const reference = naive(input)
      const queries = Array.from({ length: 30 }, () => [
        Math.round(random() * 4),
        Math.round(random() * 4),
      ])
      expect(heap(queries), `k=${k}`).toEqual(queries.map(reference))
    }
  })
})

/**
 * `mlpx-linear-regression-v1` (mlpx-spec.md §5.7).
 *
 * **회귀 해석기는 라벨이 아니라 수치를 돌려준다.** 분류 넷과 갈리는 유일한 자리다.
 */
describe('mlpx-linear-regression-v1', () => {
  // y = 2a + 3b + 1
  const features = [
    [0, 1],
    [1, 2],
    [2, 4],
    [3, 6],
    [4, 9],
  ]
  const target = features.map(([a, b]) => 2 * (a ?? 0) + 3 * (b ?? 0) + 1)
  const trained = fit('linear_regression', {
    features,
    rowIndices: features.map((_, index) => index),
    target,
    hyperparameters: {},
    randomState: 42,
  })

  it('선형 회귀가 우리 형식으로 담긴다', () => {
    expect(trained.model?.format).toBe(LINEAR_REGRESSION_FORMAT)
    expect(trained.modelOmittedDetail).toBeUndefined()
  })

  it('읽은 모델의 예측이 원본과 한 줄도 다르지 않다', () => {
    const restored = loadModel(roundTrip(trained.model))
    expect(restored(features)).toEqual(trained.predict(features))
  })

  it('계수와 절편이 학습한 식 그대로다', () => {
    const model = trained.model as LinearRegressionModel
    expect(model.coefficients[0]).toBeCloseTo(2, 6)
    expect(model.coefficients[1]).toBeCloseTo(3, 6)
    expect(model.intercept).toBeCloseTo(1, 6)
  })

  it('절편이 계수 배열에 섞여 있지 않다', () => {
    const model = trained.model as LinearRegressionModel
    expect(model.coefficients).toHaveLength(model.featureCount)
  })

  it('라벨이 아니라 수치를 돌려준다', () => {
    const restored = loadModel(roundTrip(trained.model))
    expect(typeof restored([[10, 10]])[0]).toBe('number')
  })

  it('계수 수가 특성 수와 다르면 거부한다 — 다른 열에 계수를 곱하게 된다', () => {
    expectCode(
      () =>
        loadModel({
          format: LINEAR_REGRESSION_FORMAT,
          featureCount: 2,
          coefficients: [1],
          intercept: 0,
        }),
      'MODEL_FILE_INVALID',
    )
  })

  it('특성 개수가 다른 입력은 거부한다', () => {
    const model = loadModel({
      format: LINEAR_REGRESSION_FORMAT,
      featureCount: 2,
      coefficients: [1, 1],
      intercept: 0,
    })
    expectCode(() => model([[1]]), 'MODEL_FILE_INVALID')
  })
})
