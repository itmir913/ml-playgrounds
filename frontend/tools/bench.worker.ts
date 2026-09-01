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
  | {
      readonly ok: true
      readonly elapsed: number
      readonly heapMb: number | null
      /** 힙을 **무엇이** 답했나. `null`이면 아무도 안 답했다는 뜻이다. */
      readonly heapSource: 'performance.memory' | 'measureUserAgentSpecificMemory' | null
    }
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
 * 힙을 **둘 중 답하는 쪽에** 묻는다.
 *
 * `performance.memory`는 크로미움의 비표준 확장이고 **창에만 열려 있을 수 있다** — 그러면
 * 워커로 옮긴 뒤 힙이 통째로 `null`이 되고, 상한을 정할 때 쓰던 증거가 사라진다
 * (`limits.ts`의 SVM 칸이 *"8,000행이면 512MB"*를 그렇게 적었다).
 *
 * 그래서 표준 쪽(`measureUserAgentSpecificMemory`)도 물어본다. 이쪽은
 * `crossOriginIsolated`가 아니면 던지므로 **되면 좋고 안 되면 `null`이다.**
 *
 * **누가 답했는지를 함께 싣는다.** 안 그러면 다음에 이 JSON을 읽는 사람이 `null`을
 * *"힙이 안 늘었다"*로 읽는다.
 */
async function heapNow(): Promise<{
  heapMb: number | null
  heapSource: 'performance.memory' | 'measureUserAgentSpecificMemory' | null
}> {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  if (memory) {
    return {
      heapMb: Math.round(memory.usedJSHeapSize / 1_000_000),
      heapSource: 'performance.memory',
    }
  }
  const standard = (
    performance as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }
  ).measureUserAgentSpecificMemory
  if (typeof standard === 'function') {
    try {
      const { bytes } = await standard.call(performance)
      return { heapMb: Math.round(bytes / 1_000_000), heapSource: 'measureUserAgentSpecificMemory' }
    } catch {
      // 격리되지 않은 문서에서는 던진다. 그러면 답한 것이 없다.
    }
  }
  return { heapMb: null, heapSource: null }
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const request = event.data
  let elapsed: number
  try {
    elapsed =
      request.kind === 'job'
        ? measure(request.job)
        : runLadderPoint(request.ladderId, request.point)
  } catch (error) {
    scope.postMessage({ ok: false, error: String(error) })
    return
  }
  // **시계가 멈춘 뒤에 묻는다.** 힙을 재느라 걸린 시간이 그 점의 값에 섞이면 안 된다.
  void heapNow().then((heap) => {
    scope.postMessage({ ok: true, elapsed, ...heap })
  })
}

/** 사다리 하나의 한 점. **없는 `id`는 던진다** — 조용히 0ms를 적으면 그게 기준표가 된다. */
function runLadderPoint(ladderId: string, point: number): number {
  const ladder = ALL_LADDERS.find((one) => one.id === ladderId)
  if (ladder === undefined) throw new Error(`모르는 사다리: ${ladderId}`)
  return ladder.run ? ladder.run(point) : measure(ladder.job(point))
}
