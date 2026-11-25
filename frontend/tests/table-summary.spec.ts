/**
 * 표 요약 워커 (`data/summary/`, open-decisions.md 122).
 */

import { describe, expect, it } from 'vitest'

import { summarizeTable, type SummaryWorker } from '../src/data/summary/client'
import { handleSummarize, summarizeCanonical } from '../src/data/summary/handler'
import type { SummarizeMessage } from '../src/data/summary/protocol'

const request = (csv: string) => ({ bytes: new TextEncoder().encode(csv), hasHeader: true })

class FakeWorker implements SummaryWorker {
  onmessage: SummaryWorker['onmessage'] = null
  onerror: SummaryWorker['onerror'] = null
  onmessageerror: NonNullable<SummaryWorker['onmessageerror']> | null = null
  terminated = 0
  refuse = false
  postMessage(): void {
    if (this.refuse) throw new Error('DataCloneError')
  }
  terminate(): void {
    this.terminated += 1
  }
}

function opened(refuse = false) {
  const worker = new FakeWorker()
  worker.refuse = refuse
  return { worker, handle: summarizeTable(request('a\n1'), () => worker) }
}

describe('표 요약', () => {
  it('종류·결측·고유값과 분포를 낸다', () => {
    const summary = summarizeCanonical(request('a,b\n1,x\n2,\n3,y\n4,x\n1000,x'))
    expect(summary).toMatchObject({ rowCount: 5, columnCount: 2 })
    expect(summary.columns[0]).toMatchObject({
      name: 'a',
      kind: 'numeric',
      distribution: { min: 1, median: 3, max: 1000, outlierCount: 1 },
    })
    expect(summary.columns[1]).toMatchObject({
      kind: 'categorical',
      missing: 1,
      unique: 2,
      distribution: null,
    })
  })

  it('못 읽는 표는 던지지 않고 사유를 보낸다', () => {
    const sent: SummarizeMessage[] = []
    handleSummarize(request('a,b\n"1,2'), (message) => sent.push(message))
    expect(sent).toMatchObject([{ type: 'failed', code: 'DATASET_PARSE_FAILED' }])
  })
})

describe('표 요약 워커의 끝', () => {
  it('결과가 오면 종료한다', async () => {
    const { worker, handle } = opened()
    const summary = { rowCount: 1, columnCount: 1, columns: [] }
    worker.onmessage?.({
      data: { type: 'done', summary },
    } as unknown as MessageEvent<SummarizeMessage>)
    await expect(handle.result).resolves.toEqual(summary)
    expect(worker.terminated).toBe(1)
  })

  it('죽어도 종료하고 거절한다', async () => {
    const { worker, handle } = opened()
    worker.onerror?.({ message: 'out of memory' } as ErrorEvent)
    await expect(handle.result).rejects.toMatchObject({ code: 'UNEXPECTED_ERROR' })
    expect(worker.terminated).toBe(1)
  })

  it('취소하면 종료하고 거절한다', async () => {
    const { worker, handle } = opened()
    handle.cancel()
    handle.cancel()
    await expect(handle.result).rejects.toMatchObject({ code: 'JOB_CANCELLED' })
    expect(worker.terminated).toBe(1)
  })

  it('복제가 동기로 던져도 워커를 안 남긴다', async () => {
    const { worker, handle } = opened(true)
    await expect(handle.result).rejects.toMatchObject({ code: 'UNEXPECTED_ERROR' })
    expect(worker.terminated).toBe(1)
  })
})
