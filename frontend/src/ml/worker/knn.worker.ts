/**
 * KNN 예측 워커의 진입점. **판단은 여기 없다** — `knn-compute.ts`에 있다.
 *
 * 이 파일이 짧은 것이 목적이다 (`train.worker.ts`와 같은 사정).
 */

import {
  createKnnComputeHandler,
  type KnnComputeReply,
  type KnnComputeRequest,
} from './knn-compute'

interface WorkerScope {
  onmessage: ((event: MessageEvent<KnnComputeRequest>) => void) | null
  postMessage(message: KnnComputeReply): void
}

const scope = self as unknown as WorkerScope
const handle = createKnnComputeHandler()

scope.onmessage = (event) => {
  handle(event.data, (reply) => scope.postMessage(reply))
}
