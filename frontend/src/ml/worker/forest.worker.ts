/**
 * 랜덤포레스트 트리 학습 워커의 진입점. **판단은 여기 없다** — `forest-compute.ts`에 있다.
 *
 * 이 파일이 짧은 것이 목적이다 (`train.worker.ts`와 같은 사정). jsdom에는 Worker가
 * 없어서 여기는 검사로 덮이지 않고, 덮이지 않는 곳에는 틀릴 수 있는 것을 두지 않는다.
 */

import {
  createForestComputeHandler,
  type ForestComputeReply,
  type ForestComputeRequest,
} from './forest-compute'

interface WorkerScope {
  onmessage: ((event: MessageEvent<ForestComputeRequest>) => void) | null
  postMessage(message: ForestComputeReply): void
}

const scope = self as unknown as WorkerScope
const handle = createForestComputeHandler()

scope.onmessage = (event) => {
  handle(event.data, (reply) => scope.postMessage(reply))
}
