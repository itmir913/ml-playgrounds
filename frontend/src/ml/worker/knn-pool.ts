/**
 * KNN 시험 행을 나눠 받는 워커 풀
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * **가르는 것이 학습이 아니라 예측이다.** KNN은 담는 것이 행 번호뿐이라 학습에 비용이
 * 없고, 비용이 전부 채점(시험 행마다 이웃 찾기)에 있다. 행마다 독립이라 갈라도 답이
 * 같고, 그래서 엔진 버전이 안 움직인다.
 *
 * **학습 워커 안에서 산다** — 취소가 부모를 죽이면 자식도 함께 죽는다.
 */

import { MLJS_KNN_PARALLEL_MIN_ROW_PRODUCT } from '../../limits'
import type { KnnPoolFactory } from '../pools'
import type { KnnComputeReply, KnnComputeRequest } from './knn-compute'
import { askWorker, assignSpans, poolWorkerCount, spawnPool } from './pool'
import { spawnKnnWorker } from './spawn'

/**
 * **가를 만큼 큰 일인가.** `시험 행 × 훈련 행`이 문턱(`limits.ts`) 아래면 스폰
 * 고정비가 아끼는 시간을 먹는다. **속도만 가르고 결과를 못 가른다.**
 */
export function shouldSplitKnn(testRows: number, trainRows: number): boolean {
  return testRows * trainRows >= MLJS_KNN_PARALLEL_MIN_ROW_PRODUCT
}

/** 행들을 이어 붙인다. 워커 경계를 넘는 모양이다 (`knn-compute.ts`의 `unflatten`). */
function flatten(rows: readonly (readonly number[])[], columns: number): Float64Array {
  const flat = new Float64Array(rows.length * columns)
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] as readonly number[]
    for (let column = 0; column < columns; column += 1)
      flat[index * columns + column] = row[column] as number
  }
  return flat
}

/**
 * 풀을 세운다. **여기서는 워커를 아직 안 띄운다** — 가를지는 시험 행 수를 알아야
 * 정해지고, 그건 `answer`가 불릴 때다. 못 가르면 `answer`가 `null`을 돌려주고 부르는
 * 쪽이 직렬 예측을 쓴다.
 */
export const knnPoolFactory: KnnPoolFactory = (seed) => {
  if (typeof Worker === 'undefined') return null

  let workers: Worker[] = []

  return {
    async answer(queries) {
      if (!shouldSplitKnn(queries.length, seed.rows.length)) return null
      const count = poolWorkerCount(queries.length)
      if (count === 0) return null

      if (workers.length === 0) {
        // 못 띄우면 직렬 예측으로 물러난다 — `null`이 그 신호다 (R26 B-5).
        const spawned = spawnPool(count, spawnKnnWorker)
        if (spawned === null) return null
        workers = spawned
        const rows = flatten(seed.rows, seed.featureCount)
        for (const worker of workers) {
          worker.postMessage({
            type: 'seed',
            k: seed.k,
            featureCount: seed.featureCount,
            rows,
            labels: [...seed.labels],
            indices: [...seed.indices],
          } satisfies KnnComputeRequest)
        }
      }

      const spans = assignSpans(queries.length, workers.length)
      const answers = await Promise.all(
        spans.map((span, index) =>
          askWorker<KnnComputeRequest, KnnComputeReply>(workers[index] as Worker, {
            type: 'step',
            queries: flatten(queries.slice(span.start, span.end), seed.featureCount),
          }),
        ),
      )
      const merged: string[] = []
      for (const answer of answers) for (const one of answer.answers) merged.push(one)
      return merged
    },
    dispose() {
      for (const worker of workers) worker.terminate()
      workers = []
    },
  }
}
