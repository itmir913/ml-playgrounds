// @vitest-environment jsdom
/**
 * **학습·굽기가 도는 동안 탭을 닫거나 새로고침하면 브라우저가 묻는다** (open-decisions.md 83).
 *
 * 앱 안의 이동은 학습 화면의 떠나기 창(`TrainView`)과 라우터 가드가 멈춘다. 탭 닫기와 새로고침은
 * 가드를 안 지나서, 몇 분 돌던 학습이나 사진 굽기가 경고 없이 사라졌다(2026-09-29 야간 감사 N4 Q5).
 *
 * **진짜 입구로 잰다** — 학습은 `TrainView`의 [학습하기]를, 굽기는 데이터 화면의 굽기를 실제로 태우고
 * 브라우저 경고는 `useUnloadWarning`이 건 `beforeunload`에 사건을 던져 본다.
 *
 * **회귀도 잰다** — 도는 일이 없으면(끝난 뒤, 막지만 경고와 무관한 일) 경고하지 않는다.
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

/** 붙잡아 둔 학습 보고. 검사가 흘린다 (`train-leave-keeps.spec.ts`와 같은 하니스). */
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

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

/** 자리 판정은 이 검사의 주제가 아니다 — 언제나 자리가 있다. */
vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

import { unloadWarningReasons, useUnloadWarning } from '../src/composables/useUnloadWarning'
import { useWork, workHoldsPage } from '../src/composables/useWork'
import { i18n, setLocale } from '../src/i18n'
import { closeStorage, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import {
  dropEvent,
  imagePredictProject,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'
import { irisProject } from './fixtures/trained'
import { resetDatabase } from './fixtures/database'

const t = (key: string): string => i18n.global.t(key)

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 붙잡은 학습 보고를 전부 흘린다. */
async function drain(): Promise<void> {
  for (let round = 0; round < 400; round += 1) {
    await settle()
    const next = held.shift()
    if (!next) return
    next.worker.onmessage?.({ data: next.message })
  }
}

/** 탭 닫기·새로고침. 브라우저가 물으면 참이다. */
function unload(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** 앱 껍데기가 하는 일 — `App.vue`가 `useUnloadWarning()`을 부른다. */
const Warning = defineComponent({
  setup() {
    useUnloadWarning()
    return () => h('div')
  },
})

beforeEach(async () => {
  held.length = 0
  setActivePinia(createPinia())
  resetImageWorkers()
  closeStorage()
  await resetDatabase()
  stubDialogElement()
  window.scrollTo = () => {}
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
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
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await resetDatabase()
})

describe('결정 83: 판정은 한 곳이다', () => {
  it('메모리에만 있는 편집과 도는 일을 각각 이유로 돌려준다', () => {
    expect(unloadWarningReasons({ stranded: false, workHoldsPage: false })).toEqual([])
    expect(unloadWarningReasons({ stranded: true, workHoldsPage: false })).toEqual([
      'UNSAVED_EDITS',
    ])
    expect(unloadWarningReasons({ stranded: false, workHoldsPage: true })).toEqual(['WORK_RUNNING'])
    expect(unloadWarningReasons({ stranded: true, workHoldsPage: true })).toEqual([
      'UNSAVED_EDITS',
      'WORK_RUNNING',
    ])
  })

  it('경고를 거는 일만 세고, 놓으면 풀린다 — 화면이 여럿이어도 한 셈이다', () => {
    const first = useWork()
    const second = useWork()
    const plain = first.start()
    expect(workHoldsPage.value, 'an ordinary job does not warn').toBe(false)

    const bake = first.start({ warnsOnUnload: true })
    const train = second.start({ warnsOnUnload: true })
    expect(workHoldsPage.value).toBe(true)

    // **먼저 끝난 쪽이 남의 것을 놓지 않는다** (`useWork`의 셈과 같은 규칙).
    bake.done()
    bake.done()
    expect(workHoldsPage.value).toBe(true)
    train.done()
    expect(workHoldsPage.value).toBe(false)
    plain.done()
  })

  it('막지 않는 일도 경고를 걸 수 있다', () => {
    const work = useWork()
    const embedding = work.start({ blocks: false, warnsOnUnload: true })
    expect(work.busy.value).toBe(false)
    expect(workHoldsPage.value).toBe(true)
    embedding.done()
    expect(workHoldsPage.value).toBe(false)
  })
})

describe('결정 83: 학습 중에 탭을 닫으면', { timeout: 60_000 }, () => {
  it('도는 동안 묻고, 끝나면 안 묻는다', async () => {
    const project = await irisProject(['decision_tree', 'knn'])
    const id = project.document.manifest.projectId
    await saveProject(project)

    const warning = mount(Warning)
    const wrapper = mount(RouterView, {
      global: { plugins: [i18n, router] },
      attachTo: document.body,
    })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${id}/train`)
    await settle()
    await drain()
    expect(unload(), 'no warning before training').toBe(false)

    const start = wrapper.findAll('button').find((one) => one.text() === t('train.start'))
    expect(start, 'start button').toBeDefined()
    await start!.trigger('click')
    for (let round = 0; round < 50 && held.length === 0; round += 1) await settle()
    expect(held.length, 'the training must be in flight').toBeGreaterThan(0)

    expect(unload(), 'training in flight').toBe(true)

    await drain()
    await vi.waitFor(() => expect(unload(), 'training finished').toBe(false))
    wrapper.unmount()
    warning.unmount()
  })
})

describe('결정 83: 사진을 굽는 중에 탭을 닫으면', () => {
  interface PanelInternals {
    bake: () => Promise<void>
    onDrop: (event: Event) => void
    busy: boolean
    pending: readonly { path: string }[] | null
  }

  it('굽는 동안 묻고, 끝나면 안 묻는다', async () => {
    const warning = mount(Warning)
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { props: { accept: 'image/*' }, global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    panel.onDrop(
      dropEvent([new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })]),
    )
    await settle()
    expect(panel.pending?.map((one) => one.path)).toEqual(['a.jpg'])
    // **읽는 일은 경고와 무관하다** — 파일은 학생의 디스크에 그대로 있다.
    expect(unload(), 'a photo waiting on the panel').toBe(false)

    workerState.holdBake = true
    const baking = panel.bake()
    await flushPromises()
    expect(workerState.baked).toBe(1)
    expect(unload(), 'baking in flight').toBe(true)

    workerState.bake[0]?.deliver()
    await baking
    await settle()
    expect(panel.busy).toBe(false)
    expect(unload(), 'baking finished').toBe(false)

    wrapper.unmount()
    warning.unmount()
  })
})
