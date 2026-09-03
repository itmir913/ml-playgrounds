/**
 * 랜덤포레스트 트리를 나눠 받는 워커 풀
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * **코디네이터가 씨앗 사슬을 돌리고, 워커는 나무만 짓는다.** 사슬은 표집 함수 둘에서만
 * 진화하므로(`forest-compute.ts` 머리말) 여기서 한 번 돌아 나무마다의 씨앗을 뽑으면
 * 나머지는 순서와 무관해진다. 사슬 재생이 학습의 **0.1~0.5%**라 이 직렬 구간은
 * 병렬화의 천장이 되지 않는다 (실측 2026-09-04).
 *
 * **학습 워커 안에서 산다** — 취소(학습 워커 terminate)가 부모를 죽이면 자식도 함께
 * 죽고, 그보다 좁은 실패는 부르는 쪽의 `finally`가 `dispose`로 거둔다.
 */

import { Matrix } from 'ml-matrix'
import { examplesBaggingWithReplacement, featureBagging } from 'ml-random-forest/src/utils.js'

import { MLJS_FOREST_PARALLEL_MIN_TREE_ROWS } from '../../limits'
import type { ForestPoolFactory, ForestTree } from '../pools'
import type { ForestComputeReply, ForestComputeRequest } from './forest-compute'
import { askWorker, assignSpans, poolWorkerCount } from './pool'
import { spawnForestWorker } from './spawn'

/**
 * **가를 만큼 큰 일인가.** `행 수 × 나무 수`가 문턱(`limits.ts`) 아래면 스폰 고정비가
 * 아끼는 시간을 먹는다. **속도만 가르고 결과를 못 가른다.**
 */
export function shouldSplitForest(rowCount: number, treeCount: number): boolean {
  return rowCount * treeCount >= MLJS_FOREST_PARALLEL_MIN_TREE_ROWS
}

/**
 * 나무마다의 **시작 씨앗**. 라이브러리의 학습 루프가 나무 앞에서 들고 있는 그 값이다
 * (`RandomForestBase.train`의 `currentSeed`).
 *
 * **라이브러리의 표집 함수를 그대로 부른다.** 뽑기 횟수를 우리가 다시 세면 그 규칙이
 * 두 군데 살고, 저쪽이 바뀌면 조용히 어긋난다 — 여기서는 저쪽이 바뀌면 함께 바뀐다.
 */
export function forestSeeds(
  matrix: Matrix,
  targets: number[],
  treeCount: number,
  randomState: number,
  featureSampleCount: number,
  replacement: boolean,
): number[] {
  const seeds: number[] = []
  let current = randomState
  for (let index = 0; index < treeCount; index += 1) {
    seeds.push(current)
    const bag = examplesBaggingWithReplacement(matrix, targets, current)
    const picked = featureBagging(bag.X, featureSampleCount, replacement, bag.seed)
    current = picked.seed
  }
  return seeds
}

/**
 * 풀을 세운다. `null`은 "이 환경에서는 못 가른다" 또는 "가를 만큼 크지 않다"이고,
 * 그때 부르는 쪽은 라이브러리의 직렬 학습을 그대로 쓴다 — **결과는 같다.**
 */
export const forestPoolFactory: ForestPoolFactory = (seed) => {
  if (!shouldSplitForest(seed.features.length, seed.treeCount)) return null
  const count = poolWorkerCount(seed.treeCount)
  if (count === 0) return null

  const columns = seed.features[0]?.length ?? 0
  const rows = new Float64Array(seed.features.length * columns)
  for (let index = 0; index < seed.features.length; index += 1) {
    const row = seed.features[index] as readonly number[]
    for (let column = 0; column < columns; column += 1)
      rows[index * columns + column] = row[column] as number
  }
  const targets = Float64Array.from(seed.targets)

  const workers = Array.from({ length: count }, () => spawnForestWorker())
  for (const worker of workers) {
    // 씨앗은 답이 없는 요청이다. 워커 메시지는 순서를 지키므로 뒤의 스텝이 앞지르지 못한다.
    worker.postMessage({
      type: 'seed',
      rows,
      columns,
      targets,
      featureSampleCount: seed.featureSampleCount,
      replacement: seed.replacement,
      treeOptions: seed.treeOptions,
    } satisfies ForestComputeRequest)
  }

  return {
    async grow() {
      const chain = forestSeeds(
        Matrix.checkMatrix(seed.features.map((row) => [...row])),
        [...seed.targets],
        seed.treeCount,
        seed.randomState,
        seed.featureSampleCount,
        seed.replacement,
      )
      const spans = assignSpans(chain.length, workers.length)
      const answers = await Promise.all(
        spans.map((span, index) =>
          askWorker<ForestComputeRequest, ForestComputeReply>(workers[index] as Worker, {
            type: 'step',
            seeds: chain.slice(span.start, span.end),
          }),
        ),
      )
      // 이어진 덩어리를 워커 번호 순서로 이어 붙이면 나무 번호 순서다.
      const trees: ForestTree[] = []
      for (const answer of answers) for (const tree of answer.trees) trees.push(tree)
      return trees
    },
    dispose() {
      for (const worker of workers) worker.terminate()
    },
  }
}
