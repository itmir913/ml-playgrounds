// @vitest-environment jsdom
/**
 * **학습 워커가 도중에 죽어도 끝난 모델은 남는다** (open-decisions.md "멈추기가 끝난 것을
 * 남긴다" §7).
 *
 * 전에는 다섯 중 넷이 끝난 뒤 다섯째가 워커를 죽이면(메모리, 못 받은 청크) 실험 전체가
 * `JOB_FAILED`로 버려졌다 — [멈추기]는 같은 넷을 남기는데. 이제 멈추기와 같은 조립으로 앉고,
 * 학생에게는 "일부 실패"로 알리며 죽은 사유는 알림의 기술 정보로만 간다. **앉은 실험은
 * 저장되고 내보내기에도 실린다** — 멈춘 실험과 같은 모양이라 파일에는 표지가 없다.
 *
 * **워커는 진짜 로직을 태우되 보고를 붙잡아 둔다** (`train-stop-dialog.spec.ts`와 같다). 죽는
 * 것은 검사가 `onerror`를 불러 만든다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

interface HeldWorker {
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: { message: string }) => void) | null
}

/** 붙잡아 둔 보고. 검사가 흘린다. */
const held: { worker: HeldWorker; message: unknown }[] = []
/** 뜬 학습 워커들. 죽이는 것은 검사가 한다. */
const spawned: HeldWorker[] = []

vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: () => {
    const worker = {
      onmessage: null as HeldWorker['onmessage'],
      onerror: null as HeldWorker['onerror'],
      onmessageerror: null,
      async postMessage(request: unknown) {
        const { handleRequest } = await import('../src/ml/worker/handler')
        handleRequest(request as never, (message) => held.push({ worker, message }))
      },
      terminate() {},
    }
    spawned.push(worker)
    return worker
  },
}))

import { i18n, setLocale } from '../src/i18n'
import { readProject, writeProject } from '../src/project/format'
import { closeStorage, DB_NAME, loadProject, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { stubDialogElement } from './fixtures/image-workers'
import { irisProject } from './fixtures/trained'

const t = (key: string): string => i18n.global.t(key)

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 붙잡은 보고를 전부 흘린다. */
async function drain(): Promise<void> {
  for (let round = 0; round < 400; round += 1) {
    await settle()
    const next = held.shift()
    if (!next) return
    next.worker.onmessage?.({ data: next.message })
  }
}

/** 붙잡은 보고를 **첫 모델이 끝났다는 보고까지** 흘린다. */
async function releaseFirstModel(): Promise<void> {
  for (let round = 0; round < 400; round += 1) {
    await settle()
    const next = held.shift()
    if (!next) throw new Error('the first model never finished')
    next.worker.onmessage?.({ data: next.message })
    if ((next.message as { type?: string }).type === 'progress') return
  }
}

beforeEach(async () => {
  held.length = 0
  spawned.length = 0
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  window.scrollTo = () => {}
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
  await setLocale('ko')
})

afterEach(async () => {
  useProjectStore().close()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

const Host = defineComponent({ render: () => h(RouterView) })

/** 학습 화면을 띄우고 [학습하기]를 눌러 학습이 도는 상태로 둔다. */
async function training(algorithms: string[]) {
  const project = await irisProject(algorithms)
  const id = project.document.manifest.projectId
  await saveProject(project)

  const wrapper = mount(Host, { global: { plugins: [i18n, router] }, attachTo: document.body })
  await router.push('/')
  await router.isReady()
  await router.push(`/project/${id}/train`)
  await settle()
  await drain()

  const start = wrapper.findAll('button').find((one) => one.text() === t('train.start'))
  expect(start, 'start button').toBeDefined()
  await start!.trigger('click')
  for (let round = 0; round < 50 && held.length === 0; round += 1) await settle()
  expect(held.length, 'the training must be in flight').toBeGreaterThan(0)
  return { wrapper, id }
}

/** 학습 워커를 죽인다. 붙잡은 보고는 버린다 — 죽은 워커는 더 말하지 않는다. */
async function kill(message: string): Promise<void> {
  held.length = 0
  spawned.at(-1)?.onerror?.({ message })
  await settle()
}

describe('학습 워커가 도중에 죽는다', { timeout: 60_000 }, () => {
  it('끝난 모델이 앉고 "일부 실패"를 사유와 함께 알리며, 저장되고 내보내진다', async () => {
    const { wrapper, id } = await training(['decision_tree', 'knn'])
    await releaseFirstModel()
    await kill('out of memory')

    const project = useProjectStore()
    const experiments = project.file?.document.runs.experiments ?? []
    expect(experiments).toHaveLength(1)
    expect(experiments[0]?.runs.map((one) => one.algorithm)).toEqual(['decision_tree'])
    // **죽인 모델을 실패 run으로 덧붙이지 않는다** — 대조가 그 run까지 다시 돌린다.
    expect(experiments[0]?.runs.map((one) => one.status)).toEqual(['done'])

    const toasts = useToastStore().items
    const partly = toasts.find((one) => one.key === 'train.partlyFailed')
    expect(partly?.tone).toBe('caution')
    expect(partly?.params).toMatchObject({ count: 1, detail: 'out of memory' })
    // 성공으로도, 실험 전체의 실패로도 부르지 않는다.
    expect(toasts.map((one) => one.key)).not.toContain('train.finished')
    expect(toasts.filter((one) => one.tone === 'danger')).toHaveLength(0)
    // 원문은 `detail`로 간다 — 알림(`AppToast.vue`)이 그 칸을 기술 정보로 그린다.

    // 다시 누를 수 있다.
    expect(wrapper.findAll('button').some((one) => one.text() === t('train.start'))).toBe(true)

    // 저장된다.
    await project.flush()
    const stored = await loadProject(id)
    expect(stored?.document.runs.experiments ?? []).toHaveLength(1)

    // 내보내면 그 실험과 모델이 실리고, 다시 열면 그대로다 — 사유는 파일에 없다.
    const current = project.file!
    const { blob } = await writeProject(current, '')
    const { project: reopened, integrity } = await readProject(
      new Uint8Array(await blob.arrayBuffer()),
    )
    expect(integrity.status).toBe('UNCHANGED')
    const run = reopened.document.runs.experiments[0]?.runs[0]
    expect(run?.algorithm).toBe('decision_tree')
    expect(run?.model?.path && reopened.models.has(run.model.path)).toBe(true)
    expect(JSON.stringify(reopened.document)).not.toContain('out of memory')
    wrapper.unmount()
  })

  /**
   * **일부 실패도 동작 바의 실패 줄에 남는다** (결정문 39 §7의 코드 소유자 후속). 알림은 몇 초 뒤
   * 사라진다 — 전체 실패처럼 사유가 [학습하기] 곁에 남고, 원문은 눌러서 편다. 끝난 모델은 결과에
   * 그대로 있다.
   */
  it('일부 실패는 실패 줄에 사유와 원문을 남긴다', async () => {
    const { wrapper } = await training(['decision_tree', 'knn'])
    await releaseFirstModel()
    await kill('out of memory')

    // 줄은 일부 실패의 글자다 — 끝난 모델이 남았는데 전부 실패처럼 말하지 않는다(소유자 후속).
    expect(wrapper.findAll('button').map((one) => one.text())).not.toContain(t('train.failedHere'))
    const line = wrapper.findAll('button').find((one) => one.text() === t('train.partlyFailedHere'))
    expect(line, 'the failure line must stay').toBeDefined()
    await line!.trigger('click')
    await settle()
    const said = i18n.global.t('train.partlyFailed', { count: 1, detail: 'out of memory' })
    expect(document.body.textContent).toContain(said)
    expect(document.body.textContent).toContain('out of memory')
    // 같은 말을 알림으로 두 번 하지 않는다 — 알림은 하나다.
    expect(useToastStore().items.filter((one) => one.key === 'train.partlyFailed')).toHaveLength(1)
    // 끝난 모델은 남는다.
    expect(useProjectStore().file?.document.runs.experiments).toHaveLength(1)
    wrapper.unmount()
  })

  it('끝난 모델이 없으면 지금처럼 실패로 알리고 아무것도 안 앉힌다', async () => {
    const { wrapper } = await training(['decision_tree', 'knn'])
    await kill('out of memory')

    expect(useProjectStore().file?.document.runs.experiments ?? []).toHaveLength(0)
    const toasts = useToastStore().items
    expect(toasts.map((one) => one.key)).not.toContain('train.partlyFailed')
    expect(toasts.filter((one) => one.tone === 'danger')).toHaveLength(1)
    // 동작 바의 줄은 전체 실패의 옛 글자 그대로다.
    const lines = wrapper.findAll('button').map((one) => one.text())
    expect(lines).toContain(t('train.failedHere'))
    expect(lines).not.toContain(t('train.partlyFailedHere'))
    wrapper.unmount()
  })
})
