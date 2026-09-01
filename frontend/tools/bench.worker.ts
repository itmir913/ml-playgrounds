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
export type BenchReply =
  | {
      readonly ok: true
      readonly elapsed: number
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
 * **힙은 여기서 안 잰다. 워커가 못 보기 때문이다** (2026-09-01 실측, Edge 152 / Windows).
 *
 * 한때 `performance.memory`를 묻는 `heapNow()`가 있었고 점마다 `heapBeforeMb`·`heapMb`·
 * `heapSource`를 실었다. **한 번도 답한 적이 없다** — [교정 일감만]을 돌리니 두 점 다
 * `source: null`인데 **같은 실행의 메인 스레드는 58MB를 답했다**(`bench.ts`의 `device()`).
 * 즉 크로미움이 이것을 **창에만** 열어 두었고, 워커에서는 **구조적으로 못 돈다.**
 *
 * **그래서 지웠다. 있지만 안 도는 가지가 가장 나쁘다** — 이 저장소가 COOP/COEP 폴백에서
 * 이미 한 번 밟은 모양이고(`xlsx-fallback-was-untested`), 남겨 두면 `grewMb: null`을
 * *"힙이 안 늘었다"*로 읽어 **상한을 그 위에 세우게 된다.**
 *
 * **다시 넣지 마라 — 계산이 워커에 있는 한 답이 안 온다.** 넣으려면 계산을 메인으로
 * 되돌려야 하는데, 그러면 이 파일이 존재하는 이유(오래 걸리는 것과 죽는 것을 가르는 것)가
 * 사라진다.
 *
 * **지금 메모리를 답하는 것은 워커의 죽음이다.** `bench.ts`의 `failed[…].how`가
 * `'워커가 죽었다'`인 자리가 곧 상한이고, 그것이 이 하니스가 원래 찾던 것이다. 절대값이
 * 필요하면 개발자 도구의 메모리 패널을 쓴다.
 */

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  const request = event.data
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
  scope.postMessage({
    ok: true,
    elapsed: outcome.elapsed,
    // **없는 칸은 아예 안 싣는다.** `0`을 실으면 *"한 번도 안 돌았다"*로 읽힌다.
    ...(outcome.iterations === undefined ? {} : { iterations: outcome.iterations }),
  })
}
