/**
 * `mlpx-tree-v1` — 결정트리와 랜덤포레스트 (mlpx-spec.md 5.3).
 *
 * **결정트리는 나무가 한 그루인 포레스트다.** 그래서 이 파일에 알고리즘 분기가 없다.
 * 나무 수로 갈랐다면 형식 하나가 payload 둘을 갖는 셈이고, 그건 mlpx-spec.md 5가 금지한
 * 분기를 형식 **안쪽**으로 옮긴 것에 불과하다.
 *
 * **ml.js를 import하지 않는다.** 여기가 그 경계이고, 경계가 하는 일은 라이브러리를 갈아도
 * 옛 파일이 열리게 하는 것이다. 직렬화기(ml/engines/mljs-serialize.ts)는 알아도 된다.
 *
 * 검증은 **읽을 때 한 번** 한다. 통과한 뒤에는 예측 전용 표현(TypedArray)으로 바꿔 두고,
 * 예측 루프에서는 아무것도 확인하지 않는다 - 확인을 루프 안에 두면 나무 100그루 × 행 수
 * 만큼 반복되고, 그렇다고 안 하면 손으로 고친 파일이 조용히 틀린 숫자를 낸다.
 */

import { z } from 'zod'

import { ClientError, type ClientErrorParams } from '../../errors'
import type { ModelFile, Predict } from './types'

export const TREE_FORMAT = 'mlpx-tree-v1'

/**
 * 잎 표시. **열 자리와 자식 자리에 모두 쓴다** (mlpx-spec.md 5.3).
 *
 * 잎은 `[-1, 클래스 번호, -1, -1]`이다. 자식 자리까지 -1로 채우는 것은 자리를 아끼는 것보다
 * 검증할 수 있는 편이 낫기 때문이다 - 0으로 두면 "0번 노드를 가리키는 잎"과 구분되지 않는다.
 */
export const LEAF = -1

/** `[열, 임계값, 왼쪽, 오른쪽]`. 잎이면 `[-1, 클래스 번호, -1, -1]`. */
export type TreeNode = readonly [number, number, number, number]

export interface TreeModel extends ModelFile {
  readonly format: typeof TREE_FORMAT
  /** 라벨을 **정렬한** 순서. 잎의 클래스 번호가 이 배열의 인덱스다. */
  readonly classes: readonly string[]
  /** 전처리를 마친 행렬의 열 수. 이 값과 안 맞는 입력은 거부한다. */
  readonly featureCount: number
  readonly trees: readonly { readonly nodes: readonly TreeNode[] }[]
}

/**
 * 모양만 본다. **값의 범위는 zod가 아니라 compile()이 확인한다.**
 *
 * 정수인지·범위 안인지를 여기서 나누면 실패 자리가 두 곳이 되고, zod의 수치 경계
 * 의미(NaN을 받는가)에 우리 판정이 딸려 간다. 어차피 노드를 한 번 훑어야 하므로
 * 그 자리에서 전부 본다.
 */
const nodeSchema = z.tuple([z.number(), z.number(), z.number(), z.number()])

const treeModelSchema = z.looseObject({
  format: z.literal(TREE_FORMAT),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  trees: z.array(z.looseObject({ nodes: z.array(nodeSchema).min(1) })).min(1),
})

/**
 * 예측 전용 표현. **읽기만 하는 나무 하나를 네 배열로 편다.**
 *
 * TypedArray라서 인덱스 접근에 `?? 0` 같은 폴백이 필요 없다 - 그 폴백이 하나라도 있으면
 * 깨진 파일이 예외 대신 그럴듯한 숫자를 내게 된다.
 */
interface CompiledTree {
  readonly column: Int32Array
  readonly value: Float64Array
  readonly left: Int32Array
  readonly right: Int32Array
}

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field } satisfies ClientErrorParams)
}

function isIndex(value: number, limit: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < limit
}

/**
 * 검증하면서 예측 전용 표현으로 옮긴다.
 *
 * **자식은 반드시 자기보다 뒤에 있어야 한다.** 전위 순서로 적으므로 정상 파일은 항상
 * 그렇고, 이 조건 하나가 순환을 구조적으로 불가능하게 만든다 - 그래서 classify()의
 * 루프가 반드시 끝난다. 손으로 고친 파일이 브라우저를 얼리지 못한다.
 */
function compile(
  nodes: readonly TreeNode[],
  classCount: number,
  featureCount: number,
): CompiledTree {
  const size = nodes.length
  const column = new Int32Array(size)
  const value = new Float64Array(size)
  const left = new Int32Array(size)
  const right = new Int32Array(size)

  nodes.forEach((node, index) => {
    const [nodeColumn, nodeValue, nodeLeft, nodeRight] = node

    if (nodeColumn === LEAF) {
      if (!isIndex(nodeValue, classCount)) invalid('leafClass')
      if (nodeLeft !== LEAF || nodeRight !== LEAF) invalid('leafChild')
    } else {
      if (!isIndex(nodeColumn, featureCount)) invalid('column')
      if (!Number.isFinite(nodeValue)) invalid('threshold')
      if (!isIndex(nodeLeft, size) || nodeLeft <= index) invalid('left')
      if (!isIndex(nodeRight, size) || nodeRight <= index) invalid('right')
    }

    column[index] = nodeColumn
    value[index] = nodeValue
    left[index] = nodeLeft
    right[index] = nodeRight
  })

  return { column, value, left, right }
}

/**
 * 나무 하나가 고른 클래스 번호. 자식 인덱스가 단조 증가하므로 루프는 반드시 끝난다.
 *
 * **범위 확인이 남아 있는 것은 타입 때문이지 못 믿어서가 아니다.** compile()이 이미
 * 인덱스를 범위 안으로 묶었으므로 여기 닿지 않는다. 그래도 `?? 0` 같은 폴백으로 때우지는
 * 않는다 - 그 폴백 하나가 곧 조용히 틀린 예측이고, 이 저장소가 규정한 최악이 그것이다.
 */
function classify(tree: CompiledTree, row: Float64Array): number {
  let index = 0
  for (;;) {
    const column = tree.column[index]
    const value = tree.value[index]
    if (column === undefined || value === undefined) invalid('node')
    if (column === LEAF) return value

    const feature = row[column]
    const left = tree.left[index]
    const right = tree.right[index]
    if (feature === undefined || left === undefined || right === undefined) invalid('node')
    index = feature < value ? left : right
  }
}

/**
 * 다수결. **동점이면 그 표수에 먼저 도달한 나무 쪽이 이긴다** (mlpx-spec.md 5.3).
 *
 * 번호가 작은 클래스가 이기는 규칙이 **아니다.** 저장한 모델이 원본 run과 다르게 예측하면
 * 그 순간 이 형식은 쓸모가 없어지므로, 규칙은 편한 것이 아니라 원본과 같은 것이어야 한다.
 * 나무가 하나면 그 나무의 답이 그대로 나온다 - 결정트리에 분기가 필요 없는 이유다.
 */
function vote(votes: readonly number[]): number {
  const counts = new Map<number, number>()
  let best = LEAF
  let bestCount = 0
  for (const value of votes) {
    const count = (counts.get(value) ?? 0) + 1
    counts.set(value, count)
    if (count > bestCount) {
      bestCount = count
      best = value
    }
  }
  return best
}

/** 파일 내용을 예측 함수로. 형식과 안 맞으면 던진다. */
export function loadTreeModel(file: unknown): Predict {
  const parsed = treeModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { classes, featureCount } = parsed.data
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  const trees = parsed.data.trees.map((tree) => compile(tree.nodes, classes.length, featureCount))

  return (features) =>
    features.map((row) => {
      // **전처리기가 다르면 여기서 걸린다.** 폭이 다른 입력을 그냥 읽으면 다른 열로
      // 예측하고, 그건 실패가 아니라 조용히 틀린 숫자다.
      if (row.length !== featureCount) invalid('featureCount')

      const values = Float64Array.from(row)
      const label = classes[vote(trees.map((tree) => classify(tree, values)))]
      // 검증이 클래스 번호를 이미 범위 안으로 묶었으므로 여기 닿지 않는다. 방어선은
      // 남긴다 - ml/engines/mljs.ts의 decode가 범위 밖 번호를 던지는 것과 같은 이유다.
      if (label === undefined) invalid('classes')
      return label
    })
}
