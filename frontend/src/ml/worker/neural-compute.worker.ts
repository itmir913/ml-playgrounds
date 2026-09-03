/**
 * 신경망 조각 계산 워커의 진입점. **판단은 여기 없다** — neural-compute.ts에 있다.
 *
 * 이 파일이 짧은 것이 목적이다 (train.worker.ts와 같은 사정). jsdom에는 Worker가 없어서
 * 여기는 테스트로 덮이지 않고, 덮이지 않는 곳에는 틀릴 수 있는 것을 두지 않는다.
 */

import {
  createNeuralComputeHandler,
  type NeuralComputeReply,
  type NeuralComputeRequest,
} from './neural-compute'

interface WorkerScope {
  onmessage: ((event: MessageEvent<NeuralComputeRequest>) => void) | null
  postMessage(message: NeuralComputeReply, transfer: Transferable[]): void
}

const scope = self as unknown as WorkerScope
const handle = createNeuralComputeHandler()

scope.onmessage = (event) => {
  handle(event.data, (reply, transfer) => scope.postMessage(reply, transfer))
}
