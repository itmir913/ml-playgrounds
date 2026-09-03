/**
 * 신경망 조각을 나눠 받는 워커 풀 — `fitNeural`의 `NeuralPoolFactory` 실물이다
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * **워커 수가 결과를 못 바꾸는 이유는 여기 없다.** 그 보장은 엔진의 조각 접기 순서가
 * 갖고, 여기가 하는 일은 둘뿐이다 — 조각을 **앞에서부터 이어진 덩어리로** 워커들에
 * 나누고, 답을 **조각 번호 순서로** 되돌려 주는 것. 그 재조립이 깨지면 어떻게 우는지는
 * `neural-parallel.spec.ts`가 못 박는다.
 *
 * **학습 워커 안에서 산다.** 취소(학습 워커 terminate)가 부모를 죽이면 자식들도 함께
 * 죽고, 그보다 좁은 실패는 `fitNeural`의 finally가 `dispose`로 거둔다.
 */

import {
  MLJS_NEURAL_PARALLEL_MIN_WEIGHT_ROWS,
  NEURAL_BATCH_SIZE,
  PARALLEL_WORKER_CAP,
} from '../../limits'
import {
  weightCellCount,
  type NeuralChunkGrads,
  type NeuralPool,
  type NeuralPoolFactory,
} from '../engines/neural'
import type { NeuralComputeReply, NeuralComputeRequest } from './neural-compute'
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
 * 워커 `count`명에게 조각 `chunkCount`개를 이어진 덩어리로 배분한 경계들.
 * `[start, end)` 반열림이고, 몫이 없는 워커는 아예 안 나온다.
 *
 * **이어진 덩어리인 이유**: 워커 답들을 워커 번호 순서로 이어 붙이면 그대로 조각 번호
 * 순서가 되게 하려는 것이다 — 흩뿌리면 재조립에 색인이 필요해지고, 그 색인이 틀리는
 * 길이 하나 생긴다.
 */
export function assignChunks(
  chunkCount: number,
  count: number,
): { readonly start: number; readonly end: number }[] {
  const workers = Math.max(1, Math.min(count, chunkCount))
  const base = Math.floor(chunkCount / workers)
  const extra = chunkCount % workers
  const spans: { start: number; end: number }[] = []
  let start = 0
  for (let index = 0; index < workers; index += 1) {
    const size = base + (index < extra ? 1 : 0)
    if (size === 0) continue
    spans.push({ start, end: start + size })
    start += size
  }
  return spans
}

/** 워커 하나에게 요청 하나를 보내고 답 하나를 기다린다. 오류는 거절로 돌아온다. */
function ask(worker: Worker, request: NeuralComputeRequest): Promise<NeuralComputeReply> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<NeuralComputeReply>): void => {
      cleanup()
      resolve(event.data)
    }
    const onError = (event: ErrorEvent): void => {
      cleanup()
      reject(new Error(event.message || 'neural compute worker failed'))
    }
    function cleanup(): void {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage(request)
  })
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
  if (typeof Worker === 'undefined') return null
  if (!shouldSplitNeural(seed.sizes, seed.features.length)) return null
  const cores = typeof navigator === 'undefined' ? 1 : (navigator.hardwareConcurrency ?? 1)
  const count = Math.min(PARALLEL_WORKER_CAP, Math.max(1, cores - 1))
  if (count < 2) return null

  const columns = seed.features[0]?.length ?? 0
  const rows = new Float64Array(seed.features.length * columns)
  for (let i = 0; i < seed.features.length; i += 1) {
    const row = seed.features[i] as readonly number[]
    for (let j = 0; j < columns; j += 1) rows[i * columns + j] = row[j] as number
  }
  const targets = Float64Array.from(seed.targets)

  const workers = Array.from({ length: count }, () => spawnNeuralComputeWorker())
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
      const spans = assignChunks(chunks.length, workers.length)
      const answers = await Promise.all(
        spans.map((span, index) =>
          ask(workers[index] as Worker, {
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
