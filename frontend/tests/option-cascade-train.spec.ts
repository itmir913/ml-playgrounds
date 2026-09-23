// @vitest-environment jsdom
/**
 * **잠긴 줄을 가운데 둔 진짜 학습** (`open-decisions.md` 55, R38-D55 C-7 (가)).
 *
 * 학습에는 잠긴 줄을 뺀 목록이 가므로 워커가 보내는 자리는 **그 목록의** 자리다. 학습 화면이
 * 그것을 담긴 줄 자리로 옮긴다(`byChosenRow`). `option-cascade.spec.ts`는 그 함수를 단위로
 * 물었는데 **화면의 배선은 안 물렸다** — 배선을 자리 그대로 넘기게 바꿔도(N18·N19), [학습하기]
 * 잠금을 `every`에서 `some`으로 바꿔도(N6) 조용했다. 섞인 목록으로 학습을 돌리는 스펙이 없었다.
 *
 * **워커는 진짜 로직을 태운다** (`train-walk.spec.ts`와 같다). 다만 보고를 **붙잡아 두었다가
 * 하나씩** 흘린다 — 한꺼번에 흘리면 중간 상태를 못 보고 끝난 목록(`[]`)만 보인다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

interface HeldWorker {
  onmessage: ((event: { data: unknown }) => void) | null
}

/** 붙잡아 둔 보고. 테스트가 하나씩 흘린다. */
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
import ChosenModels from '../src/views/train/ChosenModels.vue'
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

/** 붙잡은 보고를 전부 흘린다 — 화면이 뜨며 시킨 기기 교정처럼 이 검사의 주제가 아닌 것. */
async function drain(): Promise<void> {
  for (let round = 0; round < 50; round += 1) {
    await settle()
    const next = held.shift()
    if (!next) return
    next.worker.onmessage?.({ data: next.message })
  }
}

describe('잠긴 줄을 가운데 둔 학습', { timeout: 60_000 }, () => {
  /** 분류 — 가운데 줄(회귀 전용)이 잠긴다. */
  const CHOSEN = ['decision_tree', 'linear_regression', 'knn'] as const
  const LOCKED = 1

  async function trainScreen(): Promise<VueWrapper> {
    const file = await irisProject(CHOSEN)
    await saveProject(file)
    const Host = defineComponent({ render: () => h(RouterView) })
    const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${file.document.manifest.projectId}/train`)
    await settle()
    await drain()
    return wrapper
  }

  it('[학습하기]는 섞인 목록에서 안 잠기고, 상태와 시각이 제 줄에 앉는다', async () => {
    const wrapper = await trainScreen()
    const start = wrapper.findAll('button').find((one) => one.text() === t('train.start'))
    expect(start, 'start button').toBeDefined()
    // **한 줄이라도 돌 수 있으면 누를 수 있다** (N6) — 잠긴 줄이 하나 있다고 잠그면 안 된다.
    expect(start!.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain(t('train.nothingTrainable'))

    await start!.trigger('click')

    const statuses: (readonly unknown[])[] = []
    const startedAt: (readonly unknown[])[] = []
    for (let round = 0; round < 400; round += 1) {
      await settle()
      const next = held.shift()
      if (!next) {
        if (!useProjectStore().file?.document.runs.experiments.length) continue
        break
      }
      next.worker.onmessage?.({ data: next.message })
      await settle()
      const rows = wrapper.findComponent(ChosenModels)
      statuses.push(rows.props('statuses') as readonly unknown[])
      startedAt.push(rows.props('startedAt') as readonly unknown[])
    }

    // 학습이 끝났다 — 돈 모델은 잠기지 않은 둘이다.
    const experiments = useProjectStore().file?.document.runs.experiments ?? []
    expect(experiments).toHaveLength(1)
    expect(experiments[0]!.runs.map((run) => run.algorithm)).toEqual(['decision_tree', 'knn'])

    // **잠긴 줄에는 어떤 보고에서도 상태도 시각도 안 앉는다** (N18·N19).
    expect(statuses.length, 'no report was observed').toBeGreaterThan(0)
    for (const row of statuses) expect(row[LOCKED] ?? null).toBeNull()
    for (const row of startedAt) expect(row[LOCKED] ?? null).toBeNull()
    // 그리고 셋째 줄(knn)은 제 자리에서 상태와 시각을 받는다 — 자리 그대로 붙이면 이 자리는
    // 영영 비고 가운데 줄이 knn의 상태를 받는다.
    expect(statuses.some((row) => row[2] !== undefined && row[2] !== null)).toBe(true)
    expect(startedAt.some((row) => typeof row[2] === 'number')).toBe(true)
    wrapper.unmount()
  })
})
