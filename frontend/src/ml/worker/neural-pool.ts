/**
 * 신경망 조각을 나눠 받는 워커 풀 — `fitNeural`의 `NeuralPoolFactory` 실물이다
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * **워커 수가 결과를 못 바꾸는 이유는 여기 없다.** 그 보장은 엔진의 조각 접기 순서가
 * 갖고, 여기가 하는 일은 둘뿐이다 — 조각을 **앞에서부터 이어진 덩어리로** 워커들에
 * 나누고, 답을 **조각 번호 순서로** 되돌려 주는 것. 그 재조립을 진짜 워커 경계 위에서
 * 재는 것은 `tests/compute-pools.spec.ts`다 — `neural-parallel.spec.ts`는 엔진과
 * 컴퓨트 손을 재지 이 파일을 안 지나간다 (2026-09-04 R26 A-1).
 *
 * **학습 워커 안에서 산다.** 취소(학습 워커 terminate)가 부모를 죽이면 자식들도 함께
 * 죽고, 그보다 좁은 실패는 `fitNeural`의 finally가 `dispose`로 거둔다.
 */

import {
  MLJS_NEURAL_PARALLEL_MIN_WEIGHT_ROWS,
  NEURAL_BATCH_SIZE,
  NEURAL_PARALLEL_CHUNK_ROWS,
} from '../../limits'
import {
  weightCellCount,
  type NeuralChunkGrads,
  type NeuralPool,
  type NeuralPoolFactory,
} from '../engines/neural'
import type { NeuralComputeReply, NeuralComputeRequest } from './neural-compute'
import { askWorker, assignSpans, poolWorkerCount, spawnPool } from './pool'
import { spawnNeuralComputeWorker } from './spawn'

/**
 * **가를 만큼 큰 일인가.** `가중치 수 × 배치 행 수`가 문턱(`limits.ts`) 아래면 통신이
 * 계산을 이겨서 직렬이 더 빠르다. **속도만 가르고 결과를 못 가른다** — 직렬도 병렬도
 * 같은 조각 순서로 접는다.
 */
export function shouldSplitNeural(sizes: readonly number[], rowCount: number): boolean {
  const batch = Math.min(NEURAL_BATCH_SIZE, Math.max(1, rowCount))
  return weightCellCount(sizes) * batch >= MLJS_NEURAL_PARALLEL_MIN_WEIGHT_ROWS
}

/**
 * 풀을 세운다. `null`은 "이 환경에서는 못 가른다"이고 그때 엔진은 직렬로 돈다 —
 * 결과는 같고 속도만 다르다.
 *
 * 워커 수는 `min(상한, 코어 - 1)`이다 — 상한(4)은 개발 PC 사다리의 무릎이고
 * (`limits.ts`의 `PARALLEL_WORKER_CAP`), 하나는 조각을 접고 걸음을 걷는
 * 이 스레드 몫으로 남긴다. 둘이 안 되면 가르는 값이 없다.
 */
export const neuralPoolFactory: NeuralPoolFactory = (seed) => {
  if (!shouldSplitNeural(seed.sizes, seed.features.length)) return null
  /**
   * **스텝 하나가 낼 조각 수를 미리 센다.** 그것이 이 풀의 일감이다.
   *
   * 예전에는 코어 수만 보고 워커를 띄웠는데, 조각이 하나뿐이면 **워커 넷을 띄우고
   * 표를 넷으로 복제한 뒤 한 명만 일했다** — 아끼는 것 없이 스폰 고정비와 메모리만
   * 썼다 (2026-09-04 R26 B-9). 일감을 세어 넘기면 `poolWorkerCount`의 클램프가
   * 그 자리를 그냥 `0`으로 만든다.
   */
  const batch = Math.min(NEURAL_BATCH_SIZE, Math.max(1, seed.features.length))
  const count = poolWorkerCount(Math.ceil(batch / NEURAL_PARALLEL_CHUNK_ROWS))
  if (count === 0) return null

  const columns = seed.features[0]?.length ?? 0
  const rows = new Float64Array(seed.features.length * columns)
  for (let i = 0; i < seed.features.length; i += 1) {
    const row = seed.features[i] as readonly number[]
    for (let j = 0; j < columns; j += 1) rows[i * columns + j] = row[j] as number
  }
  const targets = Float64Array.from(seed.targets)

  // 못 띄우면 직렬로 돈다 — 결과는 같고 속도만 다르다 (R26 B-5).
  const workers = spawnPool(count, spawnNeuralComputeWorker)
  if (workers === null) return null
  for (const worker of workers) {
    // 씨앗은 답이 없는 요청이다. 워커 메시지는 순서를 지키므로 뒤의 스텝이 앞지르지 못한다.
    worker.postMessage({
      type: 'seed',
      rows,
      columns,
      targets,
      sizes: [...seed.sizes],
      task: seed.task,
    } satisfies NeuralComputeRequest)
  }

  const pool: NeuralPool = {
    async step(parameters, chunks) {
      const spans = assignSpans(chunks.length, workers.length)
      const answers = await Promise.all(
        spans.map((span, index) =>
          askWorker<NeuralComputeRequest, NeuralComputeReply>(workers[index] as Worker, {
            type: 'step',
            parameters,
            // 구조 복제를 위해 안쪽을 평범한 배열로 보낸다. 조각은 수십 개 숫자라 싸다.
            chunks: chunks.slice(span.start, span.end).map((rows) => [...rows]),
          }),
        ),
      )
      // 이어진 덩어리를 워커 번호 순서로 이어 붙이면 조각 번호 순서다.
      const results: NeuralChunkGrads[] = []
      for (const answer of answers) for (const chunk of answer.results) results.push(chunk)
      return results
    },
    dispose() {
      for (const worker of workers) worker.terminate()
    },
  }
  return pool
}
