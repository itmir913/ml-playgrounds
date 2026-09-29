// @vitest-environment jsdom
/**
 * **묻는 사이에 학습이 끝나면 [멈추기] 대화상자가 닫힌다** (2026-09-29 감사 F C-2).
 *
 * [멈추기]는 바로 멈추지 않고 한 번 묻는다(`TrainView`의 `askStop`). 학생이 답하는 사이에
 * 마지막 모델이 끝나면 학습은 끝났는데 *"학습을 멈출까요?"*가 그 위에 남아 있었다 — 대화상자의
 * 열림이 `stopping` 하나만 보고 학습이 끝나도 아무도 그것을 비우지 않았다.
 *
 * **워커는 진짜 로직을 태우되 보고를 붙잡아 둔다** (`train-project-switch.spec.ts`와 같다) —
 * "묻는 동안 학습이 돈다"는 순간이 있어야 보이는 자리다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

interface HeldWorker {
  onmessage: ((event: { data: unknown }) => void) | null
}

/** 붙잡아 둔 보고. 검사가 흘린다. */
const held: { worker: HeldWorker; message: unknown }[] = []

vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: () => {
    const worker = {
      onmessage: null as HeldWorker['onmessage'],
      onerror: null,
      onmessageerror: null,
      async postMessage(request: unknown) {
        const { handleRequest } = await import('../src/ml/worker/handler')
        handleRequest(request as never, (message) => held.push({ worker, message }))
      },
      terminate() {},
    }
    return worker
  },
}))

import { i18n, setLocale } from '../src/i18n'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
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

beforeEach(async () => {
  held.length = 0
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

/** [멈추기]를 묻는 대화상자. 제목 글자로 찾는다. */
function stopDialog(wrapper: { element: Element }): HTMLDialogElement {
  const found = [...wrapper.element.querySelectorAll('dialog')].find((one) =>
    one.textContent?.includes(t('train.stopTitle')),
  )
  if (!found) throw new Error('stop dialog not rendered')
  return found
}

describe('[멈추기]를 묻는 사이에 학습이 끝난다', { timeout: 60_000 }, () => {
  it('학습이 끝나면 묻는 대화상자가 닫힌다', async () => {
    const project = await irisProject(['decision_tree'])
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

    // 동작 바의 [멈추기]를 누른다 — 대화상자 안의 같은 글자 단추는 빼고.
    const stop = wrapper
      .findAll('button')
      .find((one) => one.text() === t('train.stop') && one.element.closest('dialog') === null)
    expect(stop, 'stop button').toBeDefined()
    await stop!.trigger('click')
    await settle()
    expect(stopDialog(wrapper).open, 'asking must open the dialog').toBe(true)

    // 답하지 않은 채 학습이 끝난다.
    await drain()
    await settle()
    expect(useProjectStore().file?.document.runs.experiments ?? []).toHaveLength(1)
    expect(stopDialog(wrapper).open, 'the dialog outlived the training').toBe(false)
    wrapper.unmount()
  })
})
