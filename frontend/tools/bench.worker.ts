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

import { benchOutcome } from './workloads'
import type { CalibrationJob } from '../src/ml/calibration'

/** 점 하나를 시키는 말. **함수는 못 건넌다** — 사다리는 `id`로 가리키고 워커가 찾는다. */
export type BenchRequest =
  | { readonly kind: 'ladder'; readonly ladderId: string; readonly point: number }
  /** 교정 일감 하나. **앱의 `measureJob`으로 잰다** — 사다리와 절차가 다르다 (감사 B-4). */
  | { readonly kind: 'calibration'; readonly job: CalibrationJob }
  /**
   * 교정 일감 **전부를 한 번**. `CALIBRATION_BASELINE_MS`가 정의된 양이 이것이다 —
   * 앱은 새 워커 하나에서 일감 둘을 이어 돌린다(`ml/worker/handler.ts`).
   */
  | { readonly kind: 'calibration-set' }

/**
 * 그 점의 답. **던진 것도 답이다** — 메모리가 모자라면 그렇게 오고, 그 자리가 상한이다.
 *
 * **워커가 통째로 죽는 경우는 여기 없다.** 그건 메시지가 아니라 `bench.ts`가
 * `onerror`와 침묵으로 읽는다.
 */
/** 힙을 **무엇이** 답했나. `null`이면 아무도 안 답했다는 뜻이다. */
export type HeapSource = 'performance.memory' | null

export type BenchReply =
  | {
      readonly ok: true
      readonly elapsed: number
      /**
       * 일을 **시작하기 전**의 힙. 점마다 워커가 새로 뜨므로 이것이 그 isolate의 바닥이고,
       * 아래 `heapMb`에서 이 값을 빼야 **이 점이 얼마나 늘렸는지**가 나온다.
       *
       * **워커로 옮기며 잃었던 것이 그 증가분이다** (2026-09-01 감사 B-2). 메인에서 재던
       * 동안은 힙이 점을 넘어 자라서 증가가 보였고, `limits.ts`의 SVM 칸이 *"8,000행이면
       * 512MB"*를 그 모양으로 적었다. 절대값만으로는 그 문장을 다시 못 쓴다.
       */
      readonly heapBeforeMb: number | null
      readonly heapMb: number | null
      readonly heapSource: HeapSource
      /**
       * K-평균의 Lloyd 반복 횟수. **다른 사다리는 안 싣는다.**
       *
       * 특성 축의 곡선이 내려가는 것이 **열 비용**인지 **반복 횟수**인지를 ms 하나로는
       * 못 가른다 (2026-09-01 R17 감사 C-3). 나눠 보라고 함께 보낸다.
       */
      readonly iterations?: number
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
 * 힙을 묻는다. **크로미움의 `performance.memory` 하나뿐이다.**
 *
 * **표준 쪽 폴백을 지웠다** (2026-09-01 R16-B-5). `measureUserAgentSpecificMemory`는
 * `crossOriginIsolated`를 요구하고 그것은 **COOP + COEP 헤더**가 있어야 서는데, 감사자가
 * 개발 서버의 응답을 직접 받아 보니 **두 헤더가 다 없다.** 즉 그 가지는 **한 번도 지나갈
 * 수 없었다** — 이 저장소가 xlsx 폴백에서 이미 한 번 밟은 모양이다
 * (`xlsx-fallback-was-untested`). **있지만 안 도는 가지가 가장 나쁘다**: 힙 칸이 비었을 때
 * 다음 사람이 폴백을 믿고 딴 데를 뒤진다.
 *
 * **헤더를 붙이는 쪽은 안 골랐다** — COEP `require-corp`는 백본을 CDN에서 받는 경로를
 * 막을 수 있어 앱 쪽 확인이 함께 필요하다 (`pages-traffic-budget`).
 *
 * **그래서 `heapSource: null`의 뜻이 하나다 — 이 브라우저에서는 힙을 못 잰다.**
 * `heapMb`가 `null`인 것을 *"힙이 안 늘었다"*로 읽으면 안 된다.
 *
 * **쟀다: 워커는 안 답한다** (2026-09-01, Edge 152 / Windows). [교정 일감만]을 돌린
 * JSON의 두 점이 **둘 다 `source: null`**이었다. 크로미움이 `performance.memory`를 창에만
 * 열어 두었을 가능성이 크고, 그러면 이 가지는 **워커에서 구조적으로 못 돈다** — 이
 * 저장소가 COOP/COEP 폴백에서 이미 한 번 밟은 모양이다.
 *
 * **아직 안 지운다. 갈래가 둘로 남아 있기 때문이다** — ① 크로미움이 창에만 연 것(그러면
 * 워커에서 영영 죽은 가지다), ② 이 브라우저가 아예 안 여는 것(그러면 다른 데서는 산다).
 * **`device()`가 이제 메인 스레드의 힙을 함께 싣는다**(`heapWindowMb`) — 창은 답하는데
 * 워커가 `null`이면 ①이 확정이고, 그때 이 가지를 지운다.
 *
 * **그동안 메모리를 답하는 것은 힙이 아니라 워커의 죽음이다** — `failed[…].how`가
 * `'워커가 죽었다'`인 자리가 곧 상한이고, 그것이 이 하니스가 원래 찾던 것이다.
 */
function heapNow(): { heapMb: number | null; heapSource: HeapSource } {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return memory
    ? { heapMb: Math.round(memory.usedJSHeapSize / 1_000_000), heapSource: 'performance.memory' }
    : { heapMb: null, heapSource: null }
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const request = event.data
  // **일을 시작하기 전에 한 번 묻는다.** 시계 밖이고, 이 값이 이 isolate의 바닥이다.
  const { heapMb: heapBeforeMb } = heapNow()
  // **판단은 `workloads.ts`가 한다** — 여기 두면 검사가 못 닿는다(감사 B-2).
  const outcome =
    request.kind === 'calibration-set'
      ? benchOutcome({ kind: 'calibration-set' })
      : request.kind === 'calibration'
        ? benchOutcome({ kind: 'calibration', job: request.job })
        : benchOutcome({ kind: 'ladder', ladderId: request.ladderId, point: request.point })
  if (!outcome.ok) {
    scope.postMessage({ ok: false, error: outcome.error })
    return
  }
  // **시계가 멈춘 뒤에 다시 묻는다.** 힙을 재느라 걸린 시간이 그 점의 값에 섞이면 안 된다.
  scope.postMessage({
    ok: true,
    elapsed: outcome.elapsed,
    // **없는 칸은 아예 안 싣는다.** `0`을 실으면 *"한 번도 안 돌았다"*로 읽힌다.
    ...(outcome.iterations === undefined ? {} : { iterations: outcome.iterations }),
    heapBeforeMb,
    ...heapNow(),
  })
}
