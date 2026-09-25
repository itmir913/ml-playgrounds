// @vitest-environment jsdom
/**
 * **학습 도중에 주소창으로 다른 프로젝트의 학습 화면으로 간다.** `/project/A/train` →
 * `/project/B/train`은 같은 라우트 레코드라 화면이 재사용되고 떠나기 가드가 안 돈다. A에서
 * 시작한 학습은 옮기는 순간 끊기고, 끝난 것이 있어도 B에 앉지 않는다(`claim`).
 *
 * **워커는 진짜 로직을 태우되 보고를 붙잡아 둔다** (`option-cascade-train.spec.ts`와 같다) —
 * "학습 도중"이라는 순간이 있어야 보이는 자리다.
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
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME, loadProject, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { stubDialogElement } from './fixtures/image-workers'
import { irisProject } from './fixtures/trained'

const t = (key: string): string => i18n.global.t(key)
const OTHER_ID = '33333333-3333-4333-8333-333333333333'

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
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

/** 대화상자 밖의 단추 글자들. 닫힌 `<dialog>` 안의 단추는 안 센다. */
function actionButtons(wrapper: {
  findAll: (selector: string) => { text: () => string; element: Element }[]
}): string[] {
  return wrapper
    .findAll('button')
    .filter((one) => one.element.closest('dialog') === null)
    .map((one) => one.text())
}

const Host = defineComponent({ render: () => h(RouterView) })

function withId(file: ProjectFile, projectId: string): ProjectFile {
  const { manifest } = file.document
  return { ...file, document: { ...file.document, manifest: { ...manifest, projectId } } }
}

/**
 * 붙잡은 보고를 **첫 모델이 끝났다는 보고까지** 흘린다. 그 뒤에 멈추면 끝난 것이 남는다
 * (open-decisions.md "멈추기가 끝난 것을 남긴다") — 끊어도 결과가 오는 자리다.
 */
async function releaseFirstModel(): Promise<void> {
  for (let round = 0; round < 400; round += 1) {
    await settle()
    const next = held.shift()
    if (!next) throw new Error('the first model never finished')
    next.worker.onmessage?.({ data: next.message })
    if ((next.message as { type?: string }).type === 'progress') return
  }
}

/**
 * **`claim`은 같은 열기를 붙든다** (`stores/project.ts`). A → B → A로 돌아오면 id는 같아도
 * 다른 열기라 거짓이다 — 그 사이 다른 탭이 A를 고쳤을 수 있다.
 */
describe('claim', { timeout: 30_000 }, () => {
  it('떠났다 돌아온 프로젝트의 옛 붙듦은 거짓이다', async () => {
    const first = await irisProject(['decision_tree'])
    const firstId = first.document.manifest.projectId
    await saveProject(first)
    await saveProject(withId(await irisProject(['decision_tree']), OTHER_ID))
    const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${firstId}/data`)
    await settle()

    const project = useProjectStore()
    const held = project.claim()
    expect(held()).toBe(true)
    await router.push(`/project/${OTHER_ID}/data`)
    await settle()
    expect(held()).toBe(false)
    await router.push(`/project/${firstId}/data`)
    await settle()
    expect(project.projectId).toBe(firstId)
    expect(held()).toBe(false)
    expect(project.claim()()).toBe(true)
    wrapper.unmount()
  })
})

describe('학습 도중에 다른 프로젝트로 옮긴다', { timeout: 60_000 }, () => {
  /**
   * `firstDone`이면 첫 모델이 끝난 뒤에 옮긴다 — 끊어도 **끝난 것이 결과로 온다.** 그 결과를
   * 버리는 것은 `startTraining`의 프로젝트 확인이고, 끊는 것은 `projectId` 감시다. 둘을 따로 문다.
   */
  it.each([
    ['첫 모델이 도는 중', false],
    ['첫 모델이 끝난 뒤', true],
  ])('%s에 옮기면 A의 학습이 B에 앉지 않고 B에 [멈추기]가 안 남는다', async (_, firstDone) => {
    const first = await irisProject(['decision_tree', 'knn'])
    const second = withId(await irisProject(['decision_tree']), OTHER_ID)
    const firstId = first.document.manifest.projectId
    expect(firstId).not.toBe(OTHER_ID)
    await saveProject(first)
    await saveProject(second)

    const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${firstId}/train`)
    await settle()
    await drain()

    const start = wrapper.findAll('button').find((one) => one.text() === t('train.start'))
    expect(start, 'start button').toBeDefined()
    await start!.trigger('click')
    for (let round = 0; round < 50 && held.length === 0; round += 1) await settle()
    // 학습이 돌고 있다 — 보고가 붙잡혀 있고 [멈추기]가 섰다.
    expect(held.length, 'the training must be in flight').toBeGreaterThan(0)
    expect(actionButtons(wrapper)).toContain(t('train.stop'))
    if (firstDone) await releaseFirstModel()

    // **주소창으로 B의 학습 화면으로 간다.** 같은 라우트라 화면이 재사용된다.
    await router.push(`/project/${OTHER_ID}/train`)
    await settle()
    expect(useProjectStore().projectId).toBe(OTHER_ID)
    // **옮긴 순간 끊긴다** — 남은 보고를 흘리기 전에 B의 화면에 A의 [멈추기]가 없다.
    expect(actionButtons(wrapper), 'switching must stop the training').not.toContain(
      t('train.stop'),
    )

    await drain()
    await settle()

    // B에는 아무 실험도 안 앉는다.
    expect(useProjectStore().file?.document.runs.experiments ?? []).toHaveLength(0)
    expect((await loadProject(OTHER_ID))?.document.runs.experiments ?? []).toHaveLength(0)
    // B의 화면에 A의 [멈추기]가 안 남는다. **동작 바의 단추만 센다** — 멈추기 대화상자의
    // 단추도 같은 글자라 닫힌 채 DOM에 있다.
    expect(actionButtons(wrapper)).toContain(t('train.start'))
    expect(actionButtons(wrapper)).not.toContain(t('train.stop'))
    wrapper.unmount()
  })
})
