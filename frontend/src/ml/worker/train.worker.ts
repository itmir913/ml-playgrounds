/**
 * 학습 워커의 진입점. **판단은 여기 없다** - ml/worker/handler.ts에 있다.
 *
 * 이 파일이 짧은 것이 목적이다. jsdom에는 Worker가 없어서 여기는 테스트로 덮이지 않고,
 * 덮이지 않는 곳에는 틀릴 수 있는 것을 두지 않는다.
 */

import { handleRequest } from './handler'
import type { WorkerMessage, WorkerRequest } from './protocol'

/**
 * 우리가 워커 전역에서 쓰는 것 전부.
 *
 * `DedicatedWorkerGlobalScope`는 lib.webworker.d.ts에 있고 이 프로젝트의 tsconfig는
 * DOM으로 검사한다. 워커 하나 때문에 tsconfig를 쪼개는 대신 필요한 두 개만 적는다.
 */
interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerMessage): void
}

const scope = self as unknown as WorkerScope

/**
 * **요청은 온 순서대로 하나씩.** handleRequest가 비동기가 되면서(신경망이 조각 워커들의
 * 답을 스텝마다 기다린다) **두 요청이 겹칠 수 있게 됐다** — 사슬로 묶어 동기이던 시절의
 * 순서를 그대로 지킨다.
 *
 * **지금 그 겹침이 실제로 나는 길은 없다** (2026-09-04 R26 C-3 — 전에 이 자리가
 * *"앞지를 수 있게 됐다"*고 단정했다). 메인 스레드는 학습 하나가 끝나기 전에 다음
 * 요청을 안 보내고, 취소는 메시지가 아니라 `terminate` 하나다(`ml/worker/client.ts`).
 * **그래도 남긴다** — 요청을 하나 더 보내는 순간 되살아나는 종류의 결함이고, 사슬은
 * 값이 거의 안 든다. 거절은 handleRequest 안에서 이미 failed 메시지가 되므로 사슬이
 * 여기서 끊길 일은 없지만, 만약을 위해 삼킨다.
 */
let queue: Promise<void> = Promise.resolve()

scope.onmessage = (event) => {
  // 앞 요청이 어떻게 끝났든 이번 요청은 돈다 — 삼키는 것은 앞의 거절이지 이번 일이 아니다.
  queue = queue
    .catch(() => undefined)
    .then(() => handleRequest(event.data, (message) => scope.postMessage(message)))
}
