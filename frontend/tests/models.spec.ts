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
import { fit } from '../src/ml/engines/mljs'
import { TREE_FORMAT, loadModel, type TreeModel, type TreeNode } from '../src/ml/models'
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

  it('직렬화기가 없는 알고리즘은 모델을 안 준다 — 실패가 아니라 지표만 남는 것이다', () => {
    const { predict, model } = train('knn')
    expect(model).toBeUndefined()
    expect(predict(IRIS_FEATURES)).toHaveLength(IRIS_FEATURES.length)
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
