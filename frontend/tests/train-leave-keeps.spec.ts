// @vitest-environment jsdom
/**
 * **학습 도중에 떠나도 끝난 모델은 남는다** (open-decisions.md "멈추기가 끝난 것을 남긴다" §7).
 *
 * 떠나기는 [학습을 중단하고 이동]을 누르는 것이고, 그 손은 [멈추기]와 같은 `training.cancel()`을
 * 부른다(`TrainView`의 `leave`). 멈추기가 끝난 것을 실험으로 조립해 돌려주므로 결과가 오긴
 * 오는데, **화면이 떠나는 중이라 그 결과가 앉는지는 순서에 달렸다** — 결과가 오기 전에 화면이
 * 내려가면(`alive`가 거짓) 버려진다. 같은 프로젝트의 다른 단계로 갈 때와 목록으로 나갈 때(가드가
 * `close()`를 부른다)를 따로 잰다.
 *
 * **워커는 진짜 로직을 태우되 보고를 붙잡아 둔다** (`train-stop-dialog.spec.ts`와 같다).
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
import { closeStorage, loadProject, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { stubDialogElement } from './fixtures/image-workers'
import { irisProject } from './fixtures/trained'
import { resetDatabase } from './fixtures/database'

const t = (key: string): string => i18n.global.t(key)
const WAIT_MS = 10_000

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
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
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
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await resetDatabase()
})

const Host = defineComponent({ render: () => h(RouterView) })

/** 떠날지 묻는 대화상자의 [학습을 중단하고 이동]. */
function leaveButton(wrapper: { element: Element }): HTMLButtonElement {
  const dialog = [...wrapper.element.querySelectorAll('dialog')].find((one) =>
    one.textContent?.includes(t('train.leaveTitle')),
  )
  const button = [...(dialog?.querySelectorAll('button') ?? [])].find(
    (one) => one.textContent?.trim() === t('train.leaveGo'),
  )
  if (!button) throw new Error('leave dialog not rendered')
  return button
}

describe('학습 도중에 떠난다', { timeout: 60_000 }, () => {
  /**
   * **몇 번 돌려도 같은지 본다** — 떠나는 이동과 결과 도착의 순서가 틱에 매여 있으면 어느 판에서
   * 갈린다. 같은 줄을 세 번 돈다.
   */
  it.each([
    ['같은 프로젝트의 다른 단계로', 'data', 1],
    ['같은 프로젝트의 다른 단계로', 'data', 2],
    ['같은 프로젝트의 다른 단계로', 'data', 3],
    ['목록으로', 'list', 1],
    ['목록으로', 'list', 2],
    ['목록으로', 'list', 3],
  ])('%s 나가면 끝난 모델이 남는다 (%s, %i회)', async (_, where) => {
    const project = await irisProject(['decision_tree', 'knn'])
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
    await releaseFirstModel()

    // 떠나려 하면 묻는다.
    const target = where === 'list' ? '/' : `/project/${id}/data`
    await router.push(target)
    await settle()
    expect(router.currentRoute.value.path, 'the guard must hold the route').toBe(
      `/project/${id}/train`,
    )
    leaveButton(wrapper).click()
    await settle()
    await drain()
    // **끝 상태를 기다린다** (2026-09-29). 이동은 라우터 가드가 미뤄 둔 저장(`flush`)을 끝낸 뒤에야
    // 끝나는데(`router/index.ts`), 그 쓰기는 `fake-indexeddb`의 비동기 차례를 타서 정해진 틱 수 안에
    // 끝난다는 보장이 없다 — 전체 관문에서 한 번 이동이 아직 `train`에 머문 채 단언이 먼저 걸렸다.
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe(target), WAIT_MS)

    // 끝난 한 모델이 실험으로 남고, 저장까지 갔다. **경로가 닿았으면 가드의 `flush`가 끝났으므로 바로
    // 읽는다** — 여기서 기다리면 뒤늦은 자동 저장 타이머가 빠진 `flush`를 가린다.
    const stored = await loadProject(id)
    expect(stored?.document.runs.experiments ?? [], 'stored experiments').toHaveLength(1)
    expect(stored?.document.runs.experiments[0]?.runs ?? [], 'stored runs').toHaveLength(1)
    if (where === 'data') {
      expect(useProjectStore().file?.document.runs.experiments ?? []).toHaveLength(1)
    }
    // 멈췄다고 말한다 — "끝났습니다"가 아니다.
    const keys = useToastStore().items.map((one) => one.key)
    expect(keys).not.toContain('train.finished')
    wrapper.unmount()
  })
})
