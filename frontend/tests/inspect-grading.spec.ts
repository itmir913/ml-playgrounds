// @vitest-environment jsdom
/**
 * 점검 화면의 채점 자료 (`InspectView.vue`의 `downloadGrading`, open-decisions.md 122).
 * 워커의 끝을 검사가 쥔다 — **요약하는 도중**이라는 순간이 있어야 보이는 자리다.
 */

import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { unzipSync } from 'fflate'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SummaryWorker } from '../src/data/summary/client'

const spawned = vi.hoisted(() => [] as { worker: SummaryWorker; terminated: boolean }[])
const downloads = vi.hoisted(() => [] as Blob[])
const spawning = vi.hoisted(() => ({ fail: false }))

vi.mock('../src/data/summary/spawn', () => ({
  spawnSummaryWorker: () => {
    if (spawning.fail) throw new Error('no worker')
    const one = { terminated: false } as { worker: SummaryWorker; terminated: boolean }
    one.worker = {
      onmessage: null,
      onerror: null,
      postMessage: () => undefined,
      terminate: () => {
        one.terminated = true
      },
    }
    spawned.push(one)
    return one.worker
  },
}))
vi.mock('../src/project/download', async (real) => ({
  ...(await real<typeof import('../src/project/download')>()),
  downloadBlob: (blob: Blob) => downloads.push(blob),
}))

const { i18n, setLocale } = await import('../src/i18n')
const { mountInspect, pickFiles, submissionWithExperiment, brokenFile } =
  await import('./fixtures/inspect-screen')

function button(wrapper: VueWrapper, key: string) {
  return wrapper.findAll('button').find((one) => one.text().trim() === i18n.global.t(key))
}

async function settleUntil(done: () => boolean): Promise<void> {
  await vi.waitFor(async () => {
    await flushPromises()
    expect(done()).toBe(true)
  })
}

function answer(): void {
  const one = spawned.at(-1)!
  const summary = { rowCount: 7, columnCount: 2, columns: [] }
  one.worker.onmessage?.({ data: { type: 'done', summary } } as never)
}

async function begin(files: File[]): Promise<VueWrapper> {
  const wrapper = await mountInspect(files)
  await settleUntil(() => button(wrapper, 'inspect.grading') !== undefined)
  await button(wrapper, 'inspect.grading')!.trigger('click')
  return wrapper
}

describe('채점 자료', () => {
  beforeEach(() => {
    setLocale('ko')
    spawned.length = 0
    downloads.length = 0
    spawning.fail = false
  })

  it('요약이 끝날 때까지 기다려 못 읽은 줄과 함께 내려받는다', async () => {
    const wrapper = await begin([
      await submissionWithExperiment('a.mlpx'),
      brokenFile('broken.mlpx'),
    ])
    await settleUntil(() => spawned.length === 1)
    expect(downloads).toHaveLength(0)
    answer()
    await settleUntil(() => downloads.length === 1)
    const files = unzipSync(new Uint8Array(await downloads[0]!.arrayBuffer()))
    const lines = new TextDecoder().decode(files['submissions.jsonl']).trimEnd().split('\n')
    expect(lines.map((line) => JSON.parse(line) as unknown)).toMatchObject([
      { source: 'a.mlpx', data: { tables: { dataset: { summary: { rowCount: 7 } } } } },
      { source: 'broken.mlpx', failure: { code: 'PROJECT_FILE_NOT_ZIP' } },
    ])
    wrapper.unmount()
  })

  it('워커를 못 띄워도 그 표만 비우고 내려받는다', async () => {
    spawning.fail = true
    const wrapper = await begin([await submissionWithExperiment('a.mlpx')])
    await settleUntil(() => downloads.length === 1)
    const files = unzipSync(new Uint8Array(await downloads[0]!.arrayBuffer()))
    expect(JSON.parse(new TextDecoder().decode(files['submissions.jsonl']))).toMatchObject({
      data: { tables: { dataset: { summary: null, failure: { code: 'UNEXPECTED_ERROR' } } } },
    })
    wrapper.unmount()
  })

  it('멈추면 워커를 끊고 안 내려받으며 단추가 풀린다', async () => {
    const wrapper = await begin([
      await submissionWithExperiment('a.mlpx'),
      await submissionWithExperiment('b.mlpx'),
    ])
    await settleUntil(() => spawned.length === 1)
    await button(wrapper, 'train.stop')!.trigger('click')
    await settleUntil(() => button(wrapper, 'inspect.grading') !== undefined)
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.terminated).toBe(true)
    expect(downloads).toHaveLength(0)
    wrapper.unmount()
  })

  it('앞 파일을 다 읽은 뒤에 멈춰도 절반짜리를 안 내려받는다', async () => {
    const wrapper = await begin([
      await submissionWithExperiment('a.mlpx'),
      await submissionWithExperiment('b.mlpx'),
    ])
    await settleUntil(() => spawned.length === 1)
    answer()
    await settleUntil(() => spawned.length === 2)
    await button(wrapper, 'train.stop')!.trigger('click')
    await settleUntil(() => button(wrapper, 'inspect.grading') !== undefined)
    expect(downloads).toHaveLength(0)
    wrapper.unmount()
  })

  it('명렬을 갈아 끼우면 워커를 끊고 안 내려받는다', async () => {
    const wrapper = await begin([await submissionWithExperiment('a.mlpx')])
    await settleUntil(() => spawned.length === 1)
    await pickFiles(wrapper, [await submissionWithExperiment('c.mlpx')])
    await settleUntil(() => button(wrapper, 'inspect.grading') !== undefined)
    expect(spawned[0]!.terminated).toBe(true)
    expect(downloads).toHaveLength(0)
    wrapper.unmount()
  })

  it('떠나면 워커를 끊고 안 내려받는다', async () => {
    const wrapper = await begin([await submissionWithExperiment('a.mlpx')])
    await settleUntil(() => spawned.length === 1)
    wrapper.unmount()
    await flushPromises()
    expect(spawned[0]!.terminated).toBe(true)
    expect(downloads).toHaveLength(0)
  })
})
