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
  KMEANS_FORMAT,
  SUPPORTED_MODEL_FORMATS,
  LINEAR_V2_FORMAT,
  LINEAR_REGRESSION_FORMAT,
  NAIVE_BAYES_FORMAT,
  REFERENCE_FORMAT,
  TREE_FORMAT,
  assertContext,
  interpreterFor,
  knnPredict,
  loadModel,
  loadModelProba,
  type LinearModelV2,
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
    taskType: 'classification',
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
      // 학습에 쓴 행 전부로 본다. 테스트 데이터만 보면 지나는 잎이 얼마 안 되고,
      // 그러면 잘못 옮긴 가지가 있어도 아무도 그 길로 안 지나간다.
      expect(reloaded(IRIS_FEATURES)).toEqual(predict(IRIS_FEATURES))
    })
  }

  /**
   * **동점 잎에서도 같은 답이어야 한다** (2026-09-02 R19 감사 — 검사가 없던 자리).
   *
   * ml.js는 잎의 분포에 `maxRowIndex`를 걸어 고르고, 그건 `>` 비교라 **동점이면 번호가
   * 작은 쪽이 이긴다.** `mljs-serialize.ts`의 `leafClass`가 그 규칙을 미리 접어 두는데,
   * **그 비교를 `>=`로 바꿔도 아무것도 안 울었다** — 붓꽃 픽스처의 잎에 동점 분포가
   * 하나도 없어서다.
   *
   * **틀리면 학생 파일 속 모델이 학습 직후와 다른 답을 낸다.** 그리고 **지표가 그대로일
   * 수 있어 재실행 대조도 표본에 따라 통과한다** — 조용히 틀리는 자리다.
   *
   * **동점을 억지로 만들지 않고 데이터로 만든다.** 같은 특성에 두 클래스가 같은 수로
   * 있으면 어떤 분할도 이득이 없어 뿌리가 그대로 잎이 되고, 그 잎의 분포가 `[2, 2]`다.
   */
  describe('동점 잎', () => {
    const features = [[0], [0], [1], [1]]
    const target = ['a', 'b', 'a', 'b']

    function trained() {
      return fit('decision_tree', {
        features,
        rowIndices: features.map((_, index) => index),
        target,
        taskType: 'classification',
        hyperparameters: {},
        randomState: 42,
      })
    }

    /**
     * **픽스처가 실제로 동점인지부터 못 박는다.** 안 그러면 이 검사는 아무것도 안 재면서
     * 초록으로 남는다 — R12 A-2가 *"상수와 픽스처가 우연히 같으면 그 연산은 사라진다"*로
     * 이름 붙인 병이다.
     */
    it('픽스처가 잎 하나짜리 나무를 만든다 - 동점이라 나눌 이득이 없다', () => {
      const { model } = trained()
      const tree = model as TreeModel
      expect(tree.trees).toHaveLength(1)
      // 잎 하나뿐. 두 클래스가 같은 수이므로 그 잎의 분포가 동점이다.
      expect(tree.trees[0]?.nodes).toHaveLength(1)
      expect(target.filter((one) => one === 'a')).toHaveLength(2)
      expect(target.filter((one) => one === 'b')).toHaveLength(2)
    })

    it('동점이면 번호가 작은 쪽이다 - ml.js의 `>` 비교와 같은 규칙', () => {
      const { predict } = trained()
      // 클래스 배열은 등장 순이라 'a'가 0번이다.
      expect(predict(features)).toEqual(['a', 'a', 'a', 'a'])
    })

    it('파일로 갔다 온 모델도 같은 답을 낸다', () => {
      const { predict, model } = trained()
      const reloaded = loadModel(roundTrip(model))
      expect(reloaded(features)).toEqual(predict(features))
    })
  })

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
            taskType: 'classification',
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
describe('훈련 행이 필요한 형식', () => {
  /**
   * **등록부를 돈다. 목록을 손으로 적지 않는다.**
   *
   * 예전에는 형식 셋을 배열에 박아 두었는데 등록부에는 일곱이 있었다 - SVM 항목의 축을
   * 뒤집어도 이 파일은 안 울었고(`svm.spec.ts`가 잡았다), 그래서 **이 describe가 스스로
   * 내건 "축 하나가 형식 이름을 대신한다"를 정작 이 검사가 안 지키고 있었다**
   * (2026-08-30, R12 감사 C-4). 형식이 늘면 이 검사도 저절로 는다.
   */
  it('참조형만 훈련 행을 요구하고 나머지는 전부 자체 완결형이다', () => {
    // 0개를 돌고 통과하는 것을 막는 바닥. 등록부가 비면 아래 루프가 공허해진다.
    expect(SUPPORTED_MODEL_FORMATS.length).toBeGreaterThanOrEqual(7)

    const needy = SUPPORTED_MODEL_FORMATS.filter(
      (format) => interpreterFor(format)?.needsTrainingRows === true,
    )
    expect(needy).toEqual([REFERENCE_FORMAT])
  })

  it('요구하는데 안 주면 던진다 - 빈 훈련 데이터로 그럴듯한 답을 내지 않는다', () => {
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
 * `mlpx-linear-v2` (mlpx-spec.md §5.4.1).
 *
 * **이 형식의 요구는 하나다 — 저장했다가 다시 읽은 모델의 예측이 원본과 하나도 다르지
 * 않아야 한다.** 지표만 대조하면 어긋난 예측이 상쇄로 가려진다. 그리고 여기는 특히
 * 위험하다 — 부호 하나를 뒤집으면 **에러 없이 정확히 반대인 답**이 나온다.
 *
 * **`mlpx-linear-v1`은 2026-08-15에 지웠다** (§5.4). 그쪽은 `argmin`이라 방향이 반대였고,
 * 엔진이 안 만든 지 오래였으며 읽을 파일도 없었다.
 */
describe('mlpx-linear-v2', () => {
  const trained = train('logistic_regression')

  it('로지스틱 회귀가 우리 형식으로 담긴다', () => {
    expect(trained.model?.format).toBe(LINEAR_V2_FORMAT)
    expect(trained.modelOmittedDetail).toBeUndefined()
  })

  it('읽은 모델의 예측이 원본과 한 줄도 다르지 않다', () => {
    const restored = loadModel(JSON.parse(JSON.stringify(trained.model)))
    expect(restored(IRIS_FEATURES)).toEqual(trained.predict(IRIS_FEATURES))
  })

  it('클래스마다 가중치 한 줄과 절편 하나다 - 가중치는 원래 좌표계다', () => {
    const model = trained.model as LinearModelV2
    expect(model.weights).toHaveLength(model.classes.length)
    expect(model.intercepts).toHaveLength(model.classes.length)
    for (const row of model.weights) expect(row).toHaveLength(model.featureCount)
    expect(model.featureCount).toBe(IRIS_FEATURES[0]?.length)
  })

  it('절편이 점수에 실제로 더해진다 - 0인 모델과 답이 갈린다', () => {
    // 가중치가 0이면 점수는 절편뿐이다. **argmax이므로** 절편이 큰 쪽이 이긴다
    // (mlpx-spec.md §5.4.1 - v1의 argmin과 반대다).
    const base = { classes: ['a', 'b'], featureCount: 1, weights: [[0], [0]] }
    const tilted = loadModel({ format: LINEAR_V2_FORMAT, ...base, intercepts: [-5, 5] })
    expect(tilted([[1]])).toEqual(['b'])
    // 동점이면 첫 최댓값 - 정렬 순서가 앞선 클래스다.
    const flat = loadModel({ format: LINEAR_V2_FORMAT, ...base, intercepts: [0, 0] })
    expect(flat([[1]])).toEqual(['a'])
  })

  it('절편 수가 클래스 수와 다르면 거부한다', () => {
    expectCode(
      () =>
        loadModel({
          format: LINEAR_V2_FORMAT,
          classes: ['a', 'b'],
          featureCount: 1,
          weights: [[1], [2]],
          intercepts: [1],
        }),
      'MODEL_FILE_INVALID',
    )
  })

  /**
   * 확률 (mlpx-spec.md §5.4).
   *
   * **여기서 지키는 것은 라벨과 확률이 같은 말을 하는가 하나다.** 둘을 따로 계산하면
   * "예측: A, P(A)=12%"라는 자기모순이 **에러 없이** 화면에 뜨고, 그건 부호가 뒤집혔다는
   * 뜻인데 지표만 보면 상쇄로 가려진다 - 이 형식이 실제로 겪은 그 자리다.
   */
  describe('확률', () => {
    const file = roundTrip(trained.model)
    const classes = (trained.model as LinearModelV2).classes

    /** 확률이 가장 높은 칸. 화면이 하는 일과 같다. */
    function argmax(row: Float64Array): number {
      let best = 0
      row.forEach((value, index) => {
        if (value > (row[best] ?? 0)) best = index
      })
      return best
    }

    it('해석기가 자기 라벨을 함께 준다 - 화면이 모델 파일을 뒤지지 않는다', () => {
      expect(loadModelProba(file)?.classes).toEqual(classes)
    })

    it('합이 1이다', () => {
      const rows = loadModelProba(file)?.predict(IRIS_FEATURES) ?? []
      expect(rows).toHaveLength(IRIS_FEATURES.length)
      for (const row of rows) {
        expect(row).not.toBeNull()
        if (row) expect([...row].reduce((sum, one) => sum + one, 0)).toBeCloseTo(1, 10)
      }
    })

    it('라벨이 확률의 argmax와 같다 - 포화하지 않으면 두 판정이 어긋날 수 없다', () => {
      const labels = loadModel(file)(IRIS_FEATURES)
      const rows = loadModelProba(file)?.predict(IRIS_FEATURES) ?? []

      // **길이 바닥.** 빈 배열이 오면 아래 forEach가 0회 돌고 조용히 통과한다
      // (2026-08-30, R12 감사 C-3). 형제 검사의 바닥에 얹혀 있던 것을 스스로 세운다.
      expect(rows).toHaveLength(IRIS_FEATURES.length)
      rows.forEach((row, index) => {
        expect(row).not.toBeNull()
        if (row) expect(classes[argmax(row)]).toBe(labels[index])
      })
    })

    /**
     * **이진에서도 판별기가 2개다** (실측, mlpx-spec.md §5.4). sklearn은 이진을 특수
     * 경로로 다루지만 `ml-logistic-regression`에는 그 갈림이 없다. 공용 픽스처가
     * 3클래스라 이 경로가 통째로 안 덮여 있었다.
     */
    it('클래스가 2개여도 담기고 읽히고 확률이 나온다', () => {
      const [first, second] = [...new Set(IRIS_LABELS)].sort()
      const picked = IRIS_LABELS.flatMap((label, index) =>
        label === first || label === second ? [index] : [],
      )
      const features = picked.map((index) => IRIS_FEATURES[index] ?? [])

      const binary = fit('logistic_regression', {
        features,
        rowIndices: picked,
        target: picked.map((index) => IRIS_LABELS[index] ?? ''),
        taskType: 'classification',
        hyperparameters: {},
        randomState: 42,
      })

      const model = binary.model as LinearModelV2
      expect(model?.format).toBe(LINEAR_V2_FORMAT)
      expect(model.classes).toEqual([first, second])
      expect(model.weights).toHaveLength(2)
      expect(model.intercepts).toHaveLength(2)

      const saved = roundTrip(model)
      expect(loadModel(saved)(features)).toEqual(binary.predict(features))

      const rows = loadModelProba(saved)?.predict(features) ?? []
      const labels = loadModel(saved)(features)
      rows.forEach((row, index) => {
        expect(row).not.toBeNull()
        if (!row) return
        expect([...row].reduce((sum, one) => sum + one, 0)).toBeCloseTo(1, 10)
        expect(model.classes[argmax(row)]).toBe(labels[index])
      })
    })

    it('확률을 안 내는 형식은 null이다 - 화면은 형식 이름을 보지 않는다', () => {
      expect(loadModelProba(roundTrip(train('decision_tree').model))).toBeNull()
      expect(loadModelProba(roundTrip(train('naive_bayes').model))).toBeNull()
    })
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
    // 훈련 행렬이 통째로 들어가면 안 된다.
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

  /**
   * 규칙 3 — 득표가 같으면 정렬 순서가 앞선 클래스 (mlpx-spec.md §5.6, 2026-08-10에
   * 바꿨다). sklearn `KNeighborsClassifier`와 같은 답이다 — 1만 행 실측에서 갈린
   * 9행이 전부 이 규약 차이였다.
   */
  it('득표가 같으면 정렬 순서가 앞선 클래스가 이긴다 - sklearn과 같은 답이다', () => {
    const predict = knnPredict({
      k: 2,
      featureCount: 1,
      rows: [[5], [1]],
      labels: ['a', 'b'],
      indices: [0, 1],
    })
    // 1대1 동점이고 b가 훨씬 가깝지만, sklearn은 정렬 순서가 앞선 a를 낸다.
    expect(predict([[0]])).toEqual(['a'])
  })

  it('거리까지 같은 득표 동점에서도 정렬 순서가 앞선 클래스다', () => {
    const predict = knnPredict({
      k: 2,
      featureCount: 1,
      rows: [[-1], [1]],
      labels: ['b', 'a'],
      indices: [7, 3],
    })
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

  it('이웃 수가 훈련 행보다 많으면 있는 만큼만 본다', () => {
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
  /** 완전 정렬판. 규칙 1~3을 그대로 옮긴 것이고 빠르지 않아도 된다. */
  function naive(input: NeighborhoodInput): (query: readonly number[]) => string {
    const { k, rows, labels, indices } = input
    return (query) => {
      const scored = rows.map((row, position) => ({
        distance: row.reduce((sum, value, column) => sum + (value - (query[column] ?? 0)) ** 2, 0),
        index: indices[position] ?? 0,
        label: labels[position] ?? '',
      }))
      scored.sort((a, b) => a.distance - b.distance || a.index - b.index)

      const votes = new Map<string, number>()
      for (const near of scored.slice(0, Math.min(k, scored.length))) {
        votes.set(near.label, (votes.get(near.label) ?? 0) + 1)
      }

      // 득표 동점은 정렬 순서가 앞선 클래스 (mlpx-spec.md §5.6).
      let best = ''
      let bestCount = -1
      for (const [label, count] of votes) {
        if (count > bestCount || (count === bestCount && label < best)) {
          best = label
          bestCount = count
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
    taskType: 'regression',
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

describe('mlpx-kmeans-v1', () => {
  /** 세 중심점. 군집 번호가 곧 그 자리다. */
  function model(): unknown {
    return {
      format: KMEANS_FORMAT,
      featureCount: 2,
      k: 3,
      centroids: [
        [0, 0],
        [10, 0],
        [0, 10],
      ],
    }
  }

  it('가장 가까운 중심점의 번호를 문자열로 준다', () => {
    // 문자열인 이유는 분류와 같은 경로를 타기 위해서다 (mlpx-spec.md §5.10).
    const predict = loadModel(JSON.parse(JSON.stringify(model())))
    expect(
      predict([
        [1, 1],
        [9, 1],
        [1, 9],
      ]),
    ).toEqual(['0', '1', '2'])
  })

  it('거리가 같으면 번호가 앞선 중심점이 이긴다', () => {
    // 결정적이어야 한다 - 같은 파일을 두 번 열어 다른 군집을 보면 안 된다.
    const predict = loadModel(JSON.parse(JSON.stringify(model())))
    expect(predict([[5, 5]])).toEqual(['0'])
  })

  it('폭이 다른 입력을 거부한다', () => {
    // **조용히 틀릴 자리다.** 짧은 벡터를 0으로 채워 거리를 재면 그럴듯한 군집 번호가
    // 나오고, 그것이 다른 실험의 전처리기를 끼운 입력에서 실제로 온다.
    const predict = loadModel(JSON.parse(JSON.stringify(model())))
    expectCode(() => predict([[1]]), 'MODEL_FILE_INVALID')
  })

  it('중심점 개수가 k와 다르면 거부한다', () => {
    expectCode(() => loadModel({ ...(model() as object), k: 4 }), 'MODEL_FILE_INVALID')
  })

  it('중심점의 폭이 featureCount와 다르면 거부한다', () => {
    expectCode(
      () => loadModel({ ...(model() as object), centroids: [[0], [1], [2]] }),
      'MODEL_FILE_INVALID',
    )
  })
})
