/**
 * 랜덤포레스트 트리 학습 워커의 **판단 전부.** 워커 파일(`forest.worker.ts`)은 이것을
 * 부르는 몇 줄만 남는다 (`handler.ts`와 같은 사정 — jsdom에는 Worker가 없어 워커
 * 파일은 검사로 안 덮이고, 덮이지 않는 곳에는 틀릴 수 있는 것을 두지 않는다).
 *
 * **나무 하나는 자기 앞의 씨앗 하나에만 달려 있다** (open-decisions.md "학습을 코어로
 * 가른다 — 결과는 코어 수와 무관하다"). `ml-random-forest`의 `currentSeed`는 표집
 * 함수 둘에서만 진화하고 **트리 학습은 그것을 안 건드린다** — 그래서 코디네이터가
 * 사슬을 한 번 돌려 나무마다의 씨앗을 뽑아 두면, 나무를 아무 순서로 아무 워커에서
 * 지어도 **라이브러리가 직렬로 지은 것과 바이트 단위로 같은 숲**이 나온다.
 * (실측 2026-09-04: 사슬 재생은 학습의 0.1~0.5%이고, 재조립한 숲이 `동일: true`.)
 *
 * **남의 내부를 부르고 있다.** `ml-random-forest/src/utils.js`는 공개 API가 아니라
 * 내부 모듈이다 — 그 위험은 `forest-parallel.spec.ts`가 **라이브러리의 직렬 학습과
 * 우리 병렬 학습을 맞대어** 막는다. 라이브러리가 내부를 바꾸면 그 검사가 빨개진다.
 */

import { DecisionTreeClassifier } from 'ml-cart'
import { Matrix } from 'ml-matrix'
import { examplesBaggingWithReplacement, featureBagging } from 'ml-random-forest/src/utils.js'

import type { ForestTree } from '../pools'

/** 워커가 학습 시작에 한 번 받는 것. 표본은 여기서 한 번만 건너간다. */
export interface ForestSeedMessage {
  readonly type: 'seed'
  /** 행×열을 이어 붙인 표. 중첩 배열보다 복제가 훨씬 싸다. */
  readonly rows: Float64Array
  readonly columns: number
  /** 부호화한 라벨. 분류만 있으므로 정수다. */
  readonly targets: Float64Array
  /** 나무마다 고르는 특성 수 (`RandomForestBase`의 `n`). */
  readonly featureSampleCount: number
  /** 특성 표집에 중복을 허용하는가 (라이브러리 기본값 `true`). */
  readonly replacement: boolean
  /**
   * `ml-cart`에 그대로 넘기는 손잡이. **우리는 안 채운다** — 안 채우는 것이 지금
   * 동작이고, 채우기 시작하면 그 값이 파일에도 남아야 한다.
   */
  readonly treeOptions: object | undefined
}

/** 스텝 하나 — 이 워커 몫의 나무들. 씨앗마다 나무 하나다. */
export interface ForestStepMessage {
  readonly type: 'step'
  readonly seeds: readonly number[]
}

export type ForestComputeRequest = ForestSeedMessage | ForestStepMessage

export interface ForestComputeReply {
  readonly type: 'trees'
  /** 받은 씨앗 순서 그대로. 재조립은 풀이 나무 번호로 한다. */
  readonly trees: readonly ForestTree[]
}

/**
 * 씨앗 하나에서 나무 하나를 짓는다. **라이브러리의 학습 루프가 나무마다 하는 그
 * 세 줄이다** (`RandomForestBase.train`) — 표본 배깅, 특성 배깅, 그리고 학습.
 *
 * **여기서 씨앗을 이어 가지 않는다.** 다음 나무의 씨앗은 코디네이터가 이미 알고
 * 있고, 여기서 또 세면 같은 규칙이 두 군데 살게 된다.
 */
export function growTree(
  matrix: Matrix,
  targets: number[],
  seed: number,
  featureSampleCount: number,
  replacement: boolean,
  treeOptions: object | undefined,
): ForestTree {
  const bag = examplesBaggingWithReplacement(matrix, targets, seed)
  const picked = featureBagging(bag.X, featureSampleCount, replacement, bag.seed)
  const tree = new DecisionTreeClassifier(treeOptions)
  tree.train(picked.X, bag.y)
  return { tree: plainTree(tree.toJSON()), usedIndex: picked.usedIndex }
}

/**
 * **`toJSON()`이 이름과 달리 JSON이 아니다.** 살아 있는 `TreeNode`와 그 안의
 * `Matrix`(`distribution`)를 그대로 담아 돌려주는데, **`postMessage`의 구조화 복제는
 * 프로토타입을 벗긴다.**
 *
 * 되살리는 쪽이 그것을 정확히 가른다 (`ml-cart`의 `TreeNode.setNodeParameters`):
 *
 * ```js
 * this.distribution = node.distribution.constructor === Array
 *   ? new Matrix(node.distribution)   // JSON에서 온 것 — 되살린다
 *   : node.distribution               // 살아 있는 Matrix — 그대로 쓴다
 * ```
 *
 * 구조화 복제를 지난 `Matrix`는 **Array도 Matrix도 아닌 평범한 객체**라 두 갈래를 다
 * 비껴간다. 그러면 `classify()`가 그 객체를 그대로 내고 예측이
 * *"maxRowIndex is not a function"*으로 죽는다 — **학습이 멀쩡히 끝난 뒤에** 죽어서,
 * 학생은 오래 기다린 다음에 실패를 본다. (실측 2026-09-04: 그대로 통과 ·
 * structuredClone 실패 · JSON 왕복 통과.)
 *
 * **그래서 `root`만 JSON을 태운다.** 통째로 태우면 `options.maxDepth`의 `Infinity`가
 * `null`이 된다 — 예측에는 안 쓰이는 값이지만 **조용히 값이 바뀌는 것**이고,
 * `forest-parallel.spec.ts`의 라이브러리 대조가 정확히 그것을 잡았다. 손잡이 객체는
 * 평범한 값이라 구조화 복제가 `Infinity`째로 옮겨 준다.
 *
 * **직렬 경로도 이 함수를 쓴다** — 갈래마다 다른 값을 내면 "결과는 코어 수와
 * 무관하다"가 여기서 깨진다.
 */
function plainTree(json: unknown): unknown {
  if (json === null || typeof json !== 'object') return json
  const parts = json as { root?: unknown }
  if (parts.root === undefined) return json
  return { ...parts, root: JSON.parse(JSON.stringify(parts.root)) as unknown }
}

/**
 * 요청 하나를 처리하는 함수를 만든다. 씨앗 메시지가 준 표본을 이 클로저가 든다.
 */
export function createForestComputeHandler(): (
  request: ForestComputeRequest,
  emit: (reply: ForestComputeReply) => void,
) => void {
  let matrix: Matrix | null = null
  let targets: number[] = []
  let featureSampleCount = 0
  let replacement = true
  let treeOptions: object | undefined

  return (request, emit) => {
    if (request.type === 'seed') {
      const { columns } = request
      const rowCount = columns > 0 ? request.rows.length / columns : request.targets.length
      const table: number[][] = []
      for (let index = 0; index < rowCount; index += 1) {
        const row = new Array<number>(columns)
        for (let column = 0; column < columns; column += 1) {
          row[column] = request.rows[index * columns + column] as number
        }
        table.push(row)
      }
      matrix = Matrix.checkMatrix(table)
      targets = [...request.targets]
      featureSampleCount = request.featureSampleCount
      replacement = request.replacement
      treeOptions = request.treeOptions
      return
    }

    if (matrix === null) {
      // 씨앗 전에 스텝이 왔다 — 프로토콜 위반이다. 조용히 빈 답을 내면 숲에 나무가
      // 비는데 그 사실이 예측에서야 드러난다. 워커의 error 이벤트로 거절시킨다.
      throw new Error('forest compute: step before seed')
    }

    const held = matrix
    emit({
      type: 'trees',
      trees: request.seeds.map((seed) =>
        growTree(held, targets, seed, featureSampleCount, replacement, treeOptions),
      ),
    })
  }
}
