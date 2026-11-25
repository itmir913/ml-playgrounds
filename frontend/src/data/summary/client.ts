/**
 * 메인 스레드 쪽. 표 하나에 워커 하나를 띄우고 **어떤 경로로 끝나든 종료한다** (`data/image/client.ts`와 같은 짜임).
 */

import { ClientError, failureDetail, toClientErrorCode } from '@/errors'
import type { SummarizeMessage, SummarizeRequest, TableSummary } from './protocol'

export interface SummaryWorker {
  onmessage: ((event: MessageEvent<SummarizeMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: SummarizeRequest): void
  terminate(): void
}

export interface SummaryHandle {
  readonly result: Promise<TableSummary>
  readonly cancel: () => void
}

export function summarizeTable(
  request: SummarizeRequest,
  createWorker: () => SummaryWorker,
): SummaryHandle {
  const worker = createWorker()

  let resolve!: (value: TableSummary) => void
  let reject!: (reason: ClientError) => void
  const result = new Promise<TableSummary>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })

  let finished = false
  const settle = (act: () => void): void => {
    if (finished) return
    finished = true
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    act()
  }
  const fail = (detail: unknown): void =>
    settle(() => reject(new ClientError('UNEXPECTED_ERROR', failureDetail(detail))))

  worker.onmessage = (event) => {
    const message = event.data
    if (message.type === 'done') settle(() => resolve(message.summary))
    else settle(() => reject(new ClientError(toClientErrorCode(message.code), message.params)))
  }
  worker.onerror = (event) => fail(event.message)
  worker.onmessageerror = () => fail('messageerror')

  // **복제가 동기로 던질 수 있다.** 밖으로 새면 워커가 남는다.
  try {
    worker.postMessage(request)
  } catch (error) {
    fail(error)
  }

  return { result, cancel: () => settle(() => reject(new ClientError('JOB_CANCELLED'))) }
}
