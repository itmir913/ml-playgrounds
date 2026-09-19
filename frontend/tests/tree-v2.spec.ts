/**
 * `mlpx-tree-v2` — **잎이 분포를 드는 숲** (`mlpx-spec.md` §5.3.1).
 *
 * **여기서 지키는 것은 규칙 둘이다.** 픽스처 대조(`sklearn-serialize.spec.ts`)가 387행을
 * sklearn과 견주지만, **그 대조로는 이 둘이 안 잡힌다** — 실제로 안 잡혔다(2026-09-19).
 *
 * 1. **확률을 평균한다. 다수결이 아니다.** 나무마다 분포의 최댓값을 세어 다수결을 해도
 *    픽스처 387행이 전부 같은 답을 냈다 — 그 벌들에서는 둘이 우연히 만난다.
 * 2. **잎의 분포를 합이 1이 되게 고쳐 읽는다.** sklearn 1.9의 `tree_.value`가 이미
 *    정규화된 값이라 나눗셈이 없는 것과 같았고, 그래서 정규화를 지워도 조용했다.
 *    **우리가 쓰는 Pyodide는 sklearn 1.8이다** — 그쪽이 표본 수를 담으면 정규화 없이는
 *    **표본이 많은 나무가 더 크게 말한다.**
 *
 * **그래서 손으로 만든 숲으로 두 규칙을 따로 찌른다.** 픽스처가 못 가르는 자리를 가르는
 * 것이 이 파일의 전부다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { TREE_V2_FORMAT, loadModel } from '../src/ml/models'

/** 나무 하나: 열 0이 `< 0.5`면 첫 잎, 아니면 둘째 잎. */
function stump(leaves: readonly (readonly number[])[]) {
  return {
    nodes: [
      [0, 0.5, 1, 2],
      [-1, 0, -1, -1],
      [-1, 1, -1, -1],
    ],
    leaves,
  }
}

function forest(trees: readonly ReturnType<typeof stump>[]) {
  return {
    format: TREE_V2_FORMAT,
    classes: ['가', '나'],
    featureCount: 1,
    trees,
  }
}

/** **파일을 거쳐 읽는다.** 만든 객체를 그대로 부르면 해석기의 검증을 건너뛴다. */
const read = (model: unknown) => loadModel(JSON.parse(JSON.stringify(model)) as unknown)

describe('확률을 평균한다 — 다수결이 아니다', () => {
  /**
   * 나무 셋 중 **둘이 "가"를 겨우** 고르고 **하나가 "나"를 확실히** 골랐다.
   *
   * - 다수결: 가 2표 · 나 1표 → **가**
   * - 확률 평균: 가 1.02 · 나 1.98 → **나** (sklearn이 이쪽이다)
   */
  it('겨우 이긴 둘보다 확실한 하나가 이긴다', () => {
    const weak = stump([
      [0.51, 0.49],
      [0.51, 0.49],
    ])
    const strong = stump([
      [0, 1],
      [0, 1],
    ])
    const predict = read(forest([weak, weak, strong]))
    expect(predict([[0]])).toEqual(['나'])
  })

  /** 위와 같은 숲에서 **잎 하나만 확신을 빼면** 답이 뒤집힌다. 그 민감함이 규칙의 증거다. */
  it('그 하나의 확신을 빼면 다시 다수결과 같아진다', () => {
    const weak = stump([
      [0.51, 0.49],
      [0.51, 0.49],
    ])
    const mild = stump([
      [0.49, 0.51],
      [0.49, 0.51],
    ])
    expect(read(forest([weak, weak, mild]))([[0]])).toEqual(['가'])
  })
})

describe('잎의 분포는 합이 1이 되게 읽는다', () => {
  /**
   * 한 나무의 잎에 **표본 100개**가, 다른 둘에 **1개씩** 담겼다.
   *
   * - 정규화하면: 가 1 · 나 2 → **나**
   * - 안 하면: 가 100 · 나 2 → **가** (표본이 많은 나무가 혼자 이긴다)
   */
  it('표본이 많은 나무가 더 크게 말하지 않는다', () => {
    const many = stump([
      [100, 0],
      [100, 0],
    ])
    const few = stump([
      [0, 1],
      [0, 1],
    ])
    expect(read(forest([many, few, few]))([[0]])).toEqual(['나'])
  })

  it('합이 0인 잎은 아무 말도 못 하므로 거부한다', () => {
    const empty = stump([
      [0, 0],
      [0, 0],
    ])
    expect(() => read(forest([empty]))).toThrowError(
      expect.objectContaining({ code: 'MODEL_FILE_INVALID' }),
    )
  })
})

describe('v1의 뜻으로 읽히지 않는다', () => {
  /**
   * **잎의 둘째 칸은 `leaves`의 번호다.** v1에서 그 자리가 클래스 번호였으므로, 범위를
   * 클래스 수로만 막으면 **클래스가 둘이고 잎도 둘일 때 그대로 통과한다** — 그때 읽히는
   * 것은 다른 잎의 분포이고, 아무 오류도 안 난다.
   */
  it('잎이 없는 분포를 가리키면 거부한다', () => {
    const broken = {
      ...forest([stump([[1, 0]])]),
    }
    // 잎 둘이 분포 하나를 가리키는데 둘째 잎은 번호 1을 든다 — 없는 자리다.
    expect(() => read(broken)).toThrowError(expect.objectContaining({ code: 'MODEL_FILE_INVALID' }))
  })

  it('분포의 길이가 클래스 수와 다르면 거부한다', () => {
    const wrong = forest([
      stump([
        [1, 0, 0],
        [0, 1, 0],
      ]),
    ])
    let code: string | undefined
    try {
      read(wrong)
    } catch (error) {
      if (isClientError(error)) code = error.code
    }
    expect(code).toBe('MODEL_FILE_INVALID')
  })
})
