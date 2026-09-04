/**
 * **컴퓨트 워커 풀들을 진짜로 돌려 보는 하니스** (2026-09-04 R26 A-1).
 *
 * 세 풀 공장(`forestPoolFactory`·`knnPoolFactory`·`neuralPoolFactory`)은 첫 줄에서
 * `typeof Worker`를 보고, jsdom에는 그것이 없다. 그래서 **어떤 스펙도 공장의 문을
 * 못 넘었다** — 평탄화·span↔워커 짝짓기·재조립·`dispose`가 전부 검사 0줄인 채
 * 병렬 스펙들은 **공장을 부르는 대신 다시 구현하고** 있었다. 재조립 순서를 뒤집어도,
 * 평탄화 값을 통째로 어긋내도, 실물 배선을 지워도 관문이 초록이었다.
 *
 * **여기 있는 가짜 워커는 진짜 경계를 흉내 내는 것이 요점이다.** 양쪽 방향 모두
 * `structuredClone`을 태운다 — 안 태우면 가짜가 진짜보다 관대해지고, 정확히 그
 * 차이만큼이 사각이 된다 (`worker-boundary-strips-prototypes`: `toJSON()`이 낸 살아
 * 있는 `Matrix`가 프로토타입을 잃고 예측이 죽은 것을 제자리 풀이 못 봤다).
 *
 * **관대한 자리 셋을 조였다** (2026-09-04 R27 C). 조일 당시 셋 다 **아무 검사도 안
 * 울었다** — 지금 이 차이에 걸리는 코드가 없다는 뜻이고, 그래서 **조이는 비용이 0**이다.
 * 지금 조여 두는 이유는 다음에 취소 경로를 만질 때 그물이 미리 서 있어야 해서다.
 *
 * 1. **`terminate()` 뒤에는 아무것도 안 배달한다.** 세기만 하던 동안에는 이미 큐에 든
 *    답이 그대로 나갔다 — 진짜 워커는 죽은 뒤 아무 말도 안 한다.
 * 2. **이관 목록은 실제로 중립화한다.** 세기만 하면 넘긴 버퍼를 워커가 계속 쓸 수
 *    있어서, 진짜에서는 죽는 코드가 여기서는 산다.
 * 3. **답은 마이크로태스크가 아니라 태스크로 온다.** 진짜 워커는 훨씬 늦게 답한다.
 */

import { vi } from 'vitest'

/** 하니스가 센 것. `beforeEach`에서 `resetComputeWorkers()`를 부른다. */
export const computeWorkerLog = {
  /** 띄운 워커 수. 게이트가 `null`을 내면 0이고, **그때 아래 단언들은 아무것도 안 잰다.** */
  spawned: 0,
  /** `dispose`가 끊은 워커 수. 학습이 던져도 이것이 `spawned`와 같아야 한다. */
  terminated: 0,
  /** `emit`의 둘째 인자로 넘어온 이관 목록의 길이 합. 신경망만 채운다. */
  transferred: 0,
  /** 워커마다 받은 요청들 — 씨앗이 스텝보다 먼저 갔는지를 여기서 본다. */
  requests: [] as { worker: number; type: string }[],
}

export function resetComputeWorkers(): void {
  computeWorkerLog.spawned = 0
  computeWorkerLog.terminated = 0
  computeWorkerLog.transferred = 0
  computeWorkerLog.requests.length = 0
}

/**
 * 컴퓨트 워커 하나. **`postMessage`가 요청을 복제해 손에 넘기고, 답도 복제해서
 * `message` 이벤트로 되돌린다** — 진짜 워커가 하는 그것이다.
 *
 * 손이 던지면 `error` 이벤트로 나간다. 진짜 워커도 그렇고, `askWorker`가 그것을
 * 거절로 바꾼다 (`pool.ts`).
 */
export function fakeComputeWorker<Request, Reply>(
  handle: (request: Request, emit: (reply: Reply, transfer?: Transferable[]) => void) => void,
): Worker {
  const index = computeWorkerLog.spawned
  computeWorkerLog.spawned += 1
  const target = new EventTarget()
  /** 살아 있는가. `terminate()` 뒤에는 받지도 배달하지도 않는다 — 진짜가 그렇다. */
  let alive = true
  const worker = {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(request: unknown): void {
      // 죽은 워커는 아무것도 안 받는다.
      if (!alive) return
      // 경계 ① 가는 쪽. 여기서 프로토타입이 벗겨진다.
      const received = structuredClone(request) as Request
      const kind = (received as { type?: unknown }).type
      computeWorkerLog.requests.push({ worker: index, type: String(kind) })
      // **진짜 워커는 다른 스레드에 있고, 훨씬 늦게 답한다.** 마이크로태스크로 답하면
      // 이 가짜가 진짜보다 이르고, 순서에 기대는 코드가 그 차이에 안 걸린다.
      setTimeout(() => {
        if (!alive) return
        try {
          handle(received, (reply, transfer) => {
            if (!alive) return
            computeWorkerLog.transferred += transfer?.length ?? 0
            // 경계 ② 오는 쪽. **이관 목록은 실제로 중립화한다** — `transfer`를 주면
            // 넘긴 버퍼가 이쪽에서 분리되어, 넘기고 나서 다시 쓰는 코드가 여기서도
            // 진짜처럼 죽는다. 목록에 답에 없는 것이 들어 있으면 진짜처럼 던진다.
            const data = structuredClone(reply, transfer ? { transfer } : undefined)
            target.dispatchEvent(new MessageEvent('message', { data }))
          })
        } catch (error) {
          target.dispatchEvent(
            new ErrorEvent('error', { message: error instanceof Error ? error.message : 'failed' }),
          )
        }
      }, 0)
    },
    terminate(): void {
      computeWorkerLog.terminated += 1
      // **죽은 뒤에는 아무 말도 안 한다.** 이미 큐에 든 답도 나가면 안 된다.
      alive = false
    },
  }
  return worker as unknown as Worker
}

/**
 * 공장들이 문을 열게 한다 — `typeof Worker`와 코어 수.
 *
 * **코어를 고정하는 것이 요점이다.** 안 하면 `poolWorkerCount`가 기기마다 다른 답을
 * 내고, **코어 2개 기기에서 검사가 갈린다.** 다섯을 주면 `min(천장 4, 5-1) = 4`다.
 */
export function installComputeWorkers(cores = 5): void {
  // 공장은 존재만 본다 — 진짜 생성자는 `spawn.ts`를 `vi.mock`으로 갈아 끼운다.
  vi.stubGlobal('Worker', class {})
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
    value: cores,
    configurable: true,
  })
}
