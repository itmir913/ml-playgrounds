/**
 * **실측 하니스가 실제로 계산하는 곳.** 화면은 `bench.ts`, 일감은 `workloads.ts`,
 * 여기는 그 둘을 잇는 워커다.
 *
 * **메인 스레드에서 재면 답이 안 갈린다** (2026-09-01). 상한을 찾는 사다리가 찾는 것은
 * **깨지는 지점**인데(`open-decisions.md` "그러면 상한은 시간으로 정하는 것이 아니다"),
 * 메인에서 돌리면 오래 걸리는 것도 탭을 죽이는 것도 똑같이 *"브라우저가 멈췄다"*로
 * 보인다. **그 둘은 다른 답이다** — 느린 것은 상한이 아니고, 죽는 것은 상한이다.
 * 워커로 옮기면 화면이 살아 있으므로 셋이 갈린다: 던지고 돌아온다 · 워커가 죽는다 ·
 * 그냥 오래 걸린다.
 *
 * **앱이 그렇게 돈다는 것이 두 번째 이유다.** 학습도 교정 일감도 워커에서 돈다
 * (`ml/worker/handler.ts`). 메인에서 잰 값은 학생이 만나는 값이 아니다.
 *
 * **판단은 여기 없다.** 사다리를 고르는 것도 멈추는 것도 `bench.ts`이고, 이 파일은
 * 시킨 점 하나를 돌려 시간을 돌려준다 — 워커는 테스트가 안 덮는 자리다
 * (`ml/worker/train.worker.ts`와 같은 이유).
 */

import { ALL_LADDERS, measure, type Job } from './workloads'

/** 점 하나를 시키는 말. **함수는 못 건넌다** — 사다리는 `id`로 가리키고 워커가 찾는다. */
export type BenchRequest =
  | { readonly kind: 'ladder'; readonly ladderId: string; readonly point: number }
  | { readonly kind: 'job'; readonly job: Job }

/**
 * 그 점의 답. **던진 것도 답이다** — 메모리가 모자라면 그렇게 오고, 그 자리가 상한이다.
 *
 * **워커가 통째로 죽는 경우는 여기 없다.** 그건 메시지가 아니라 `bench.ts`가
 * `onerror`와 침묵으로 읽는다.
 */
export type BenchReply =
  | { readonly ok: true; readonly elapsed: number; readonly heapMb: number | null }
  | { readonly ok: false; readonly error: string }

/**
 * 우리가 워커 전역에서 쓰는 것 전부. `DedicatedWorkerGlobalScope`가 이 tsconfig에
 * 없어 필요한 둘만 적는다 (`ml/worker/train.worker.ts`와 같은 사정).
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<BenchRequest>) => void) | null
  postMessage(message: BenchReply): void
}

/**
 * 크로미움이 주면 준다. **워커에도 있는지는 재 보고 적을 일이다** — 없으면 `null`이고,
 * 그것도 사실이다. 지어내지 않는다.
 */
function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory ? Math.round(memory.usedJSHeapSize / 1_000_000) : null
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const request = event.data
  try {
    const elapsed =
      request.kind === 'job'
        ? measure(request.job)
        : runLadderPoint(request.ladderId, request.point)
    scope.postMessage({ ok: true, elapsed, heapMb: heapMb() })
  } catch (error) {
    scope.postMessage({ ok: false, error: String(error) })
  }
}

/** 사다리 하나의 한 점. **없는 `id`는 던진다** — 조용히 0ms를 적으면 그게 기준표가 된다. */
function runLadderPoint(ladderId: string, point: number): number {
  const ladder = ALL_LADDERS.find((one) => one.id === ladderId)
  if (ladder === undefined) throw new Error(`모르는 사다리: ${ladderId}`)
  return ladder.run ? ladder.run(point) : measure(ladder.job(point))
}
