/**
 * 컴퓨트 워커 풀들이 함께 쓰는 것 — 일감 배분 · 왕복 · 워커 수
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * **여기 있는 것은 전부 결과와 무관하다.** 무엇을 계산하는지도, 어떤 순서로 접는지도
 * 모른다 — 그 보장은 각 알고리즘이 갖는다(신경망은 조각 접기, 포레스트는 씨앗 사슬,
 * KNN은 행 독립). 이 층이 정하는 것은 **속도뿐**이다.
 */

import { PARALLEL_WORKER_CAP } from '../../limits'

/** `[start, end)` 반열림 구간. */
export interface Span {
  readonly start: number
  readonly end: number
}

/**
 * 일감 `count`개를 워커 `workers`명에게 **이어진 덩어리로** 배분한 경계들.
 * 몫이 없는 워커는 아예 안 나온다.
 *
 * **이어진 덩어리인 이유**: 답들을 워커 번호 순서로 이어 붙이면 그대로 일감 번호
 * 순서가 되게 하려는 것이다 — 흩뿌리면 재조립에 색인이 필요해지고, 그 색인이 틀리는
 * 길이 하나 생긴다.
 */
export function assignSpans(count: number, workers: number): Span[] {
  const lanes = Math.max(1, Math.min(workers, count))
  const base = Math.floor(count / lanes)
  const extra = count % lanes
  const spans: Span[] = []
  let start = 0
  for (let index = 0; index < lanes; index += 1) {
    const size = base + (index < extra ? 1 : 0)
    if (size === 0) continue
    spans.push({ start, end: start + size })
    start += size
  }
  return spans
}

/**
 * 이 기기에서 띄울 워커 수. `min(일감 수, 천장, 코어 - 1)`이고, 하나는 접고 걸음을
 * 걷는 이 스레드 몫으로 남긴다. **둘이 안 되면 `0`** — 가르는 값이 없다는 뜻이다.
 */
export function poolWorkerCount(jobs: number): number {
  if (typeof Worker === 'undefined') return 0
  const cores = typeof navigator === 'undefined' ? 1 : (navigator.hardwareConcurrency ?? 1)
  const count = Math.min(PARALLEL_WORKER_CAP, Math.max(1, cores - 1), Math.max(1, jobs))
  return count < 2 ? 0 : count
}

/**
 * 워커 하나에게 요청 하나를 보내고 답 하나를 기다린다. **끝나는 길을 전부 듣는다** —
 * 안 들리는 길이 하나라도 있으면 부르는 쪽이 **영원히 기다린다.**
 *
 * 길이 셋이다: 답(`message`), 워커가 죽음(`error`), 그리고 **답이 복제에 실패함**
 * (`messageerror`). 셋째를 2026-09-04(R26 B-6)에 더했다 — 같은 저장소의
 * `ml/worker/client.ts`는 처음부터 듣고 있었는데 이쪽만 빠져 있었다.
 */
export function askWorker<Request, Reply>(worker: Worker, request: Request): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<Reply>): void => {
      cleanup()
      resolve(event.data)
    }
    const onError = (event: ErrorEvent): void => {
      cleanup()
      reject(new Error(event.message || 'compute worker failed'))
    }
    const onMessageError = (): void => {
      cleanup()
      reject(new Error('compute worker reply could not be cloned'))
    }
    function cleanup(): void {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
      worker.removeEventListener('messageerror', onMessageError)
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.addEventListener('messageerror', onMessageError)
    worker.postMessage(request)
  })
}

/**
 * 워커 `count`명을 띄운다. **하나라도 못 뜨면 이미 뜬 것을 거두고 `null`을 낸다.**
 *
 * 결정문은 *"중첩 워커가 없는 환경은 직렬로 돈다"*고 적었는데 그 폴백은
 * `typeof Worker` 하나뿐이었다 — **`Worker`는 있는데 스폰이 던지는 환경**(CSP가
 * `worker-src`를 막거나, 청크를 못 받거나)에서는 학습이 통째로 실패했다. 학생은
 * 직렬로 조금 느린 대신 **아무 결과도 못 받는다.** (2026-09-04 R26 B-5)
 */
export function spawnPool(count: number, spawn: () => Worker): Worker[] | null {
  const workers: Worker[] = []
  try {
    for (let index = 0; index < count; index += 1) workers.push(spawn())
  } catch {
    for (const worker of workers) worker.terminate()
    return null
  }
  return workers
}
