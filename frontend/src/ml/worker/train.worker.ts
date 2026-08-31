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

scope.onmessage = (event) => {
  handleRequest(event.data, (message) => scope.postMessage(message))
}
