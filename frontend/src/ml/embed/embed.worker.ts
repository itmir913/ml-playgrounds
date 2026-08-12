/**
 * 임베딩 워커의 진입점. **판단은 여기 없다** — ml/embed/handler.ts에 있다.
 *
 * 이 파일이 짧은 것이 목적이다. jsdom에는 Worker가 없어서 여기는 테스트로 덮이지 않고,
 * 덮이지 않는 곳에는 틀릴 수 있는 것을 두지 않는다 (ml/worker/train.worker.ts와 같다).
 */

import { handleEmbed } from './handler'
import type { EmbedMessage, EmbedRequest } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<EmbedRequest>) => void) | null
  postMessage(message: EmbedMessage): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  void handleEmbed(event.data, (message) => scope.postMessage(message))
}
