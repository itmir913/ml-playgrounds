/**
 * 표 요약 워커의 진입점. **판단은 `handler.ts`에 있다** — jsdom에 Worker가 없어 여기는 검사로 안 덮인다.
 */

import { handleSummarize } from './handler'
import type { SummarizeMessage, SummarizeRequest } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<SummarizeRequest>) => void) | null
  postMessage(message: SummarizeMessage): void
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event) => {
  handleSummarize(event.data, (message) => scope.postMessage(message))
}
