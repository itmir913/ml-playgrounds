// @vitest-environment jsdom
/**
 * **학습 준비(백본 받기)에 [취소]가 선다** (architecture.md §8.10.4, 코드 소유자 결정 11).
 *
 * 전에는 [학습하기]를 누른 뒤 준비 단계(백본 12.4MB를 받고 사진을 통과시키는 동안)에는 멈출
 * 길이 떠나기뿐이었다 — [멈추기]는 학습이 시작된 뒤에야 섰다. 느린 학교 회선에서 학생은 화면을
 * 옮겨야 했다.
 *
 * [취소]는 준비 일감을 끊는다 — 워커 terminate다(워커 안의 내려받기가 함께 끊기는 것은 HTML
 * 명세의 워커 종료이고 여기서는 terminate가 불렸는지만 잰다). **부분 결과는 버린다**: 임베딩도
 * 실험도 안 앉는다. 다시 누르면 새 워커로 처음부터 받는다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import type { TrainWorker } from '../src/ml/worker/client'
import type { WorkerRequest } from '../src/ml/worker/protocol'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { resetImageWorkers, stubDialogElement, workerState } from './fixtures/image-workers'

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return {
    spawnEmbedWorker: () => {
      const worker = fakeEmbedWorker()
      const post = worker.postMessage.bind(worker)
      // **받는 중이라고 먼저 말한다** — 준비 줄이 서는 진짜 순서다.
      worker.postMessage = (request) => {
        post(request)
        queueMicrotask(() => {
          worker.onmessage?.({
            data: { type: 'preparing', state: 'downloading' },
          } as MessageEvent<never>)
        })
      }
      return worker
    },
  }
})

const trainers = vi.hoisted(() => ({ workers: [] as TrainWorker[] }))

vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: (): TrainWorker => {
    const worker: TrainWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(message: WorkerRequest) {
        structuredClone(message)
        if (message.type === 'train') trainers.workers.push(worker)
      },
      terminate() {},
    }
    return worker
  },
}))

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'

function trainableImageProject(): ProjectFile {
  const backbone = backboneFor(DEFAULT_BACKBONE_ID)
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    { projectId: PROJECT_ID, createdAt: '2026-09-02T08:00:00.000Z', randomState: 42 },
  )
  const empty: ProjectFile = {
    document: {
      ...document,
      settings: {
        ...document.settings,
        selectedAlgorithms: [{ algorithm: 'decision_tree' }, { algorithm: 'knn' }],
      },
    },
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  const seeds: [string, string][] = [
    ['a', '개'],
    ['b', '개'],
    ['c', '고양이'],
    ['d', '고양이'],
  ]
  return addImages(
    empty,
    seeds.map(([seed, category]) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${seed}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-02T09:00:00.000Z', format: 'webp' },
  ).project
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

const Host = defineComponent({ render: () => h(RouterView) })
const SLOW = { timeout: 20_000 }

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  resetImageWorkers()
  trainers.workers.length = 0
  closeStorage()
  await deleteDatabase()
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  stubDialogElement()
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  localStorage.clear()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  useProjectStore().close()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

const t = (key: string): string => i18n.global.t(key)

/** 대화상자 밖의 단추. 닫힌 `<dialog>` 안의 같은 글자는 안 센다. */
function barButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper
    .findAll('button')
    .find((one) => one.text() === label && one.element.closest('dialog') === null)
}

describe('학습 준비 중에 [취소]를 누른다', SLOW, () => {
  it('받기를 끊고 아무것도 안 앉히며, 다시 누르면 처음부터 받는다', async () => {
    await saveProject(trainableImageProject())
    const wrapper = mount(Host, { global: { plugins: [router, i18n] } })
    await router.push(`/project/${PROJECT_ID}/train`)
    await settle()
    // 도는 것이 없으면 [취소]도 없다.
    expect(barButton(wrapper, t('common.cancel'))).toBeUndefined()

    await barButton(wrapper, t('train.start'))!.trigger('click')
    await settle()
    expect(workerState.embed).toHaveLength(1)
    expect(wrapper.text()).toContain('다운로드하는 중')
    const cancel = barButton(wrapper, t('common.cancel'))
    expect(cancel, 'cancel button while preparing').toBeDefined()

    await cancel!.trigger('click')
    await settle()
    // 워커를 끊었다 — 워커 안의 내려받기도 함께 끊긴다.
    expect(workerState.terminated.embed).toBe(1)
    // 늦게 온 답도 안 앉는다.
    workerState.embed[0]?.deliver()
    await settle()
    const project = useProjectStore()
    expect(project.file?.embeddings.size).toBe(0)
    expect(project.file?.document.runs.experiments).toHaveLength(0)
    expect(trainers.workers).toHaveLength(0)
    expect(useToastStore().items).toEqual([])
    expect(barButton(wrapper, t('common.cancel'))).toBeUndefined()
    expect(wrapper.text()).not.toContain('다운로드하는 중')

    // 다시 누르면 새 워커로 처음부터 받고, 학습까지 간다.
    const again = barButton(wrapper, t('train.start'))
    expect(again?.attributes('disabled')).toBeUndefined()
    await again!.trigger('click')
    await settle()
    expect(workerState.embed).toHaveLength(2)
    workerState.embed[1]?.deliver()
    await settle()
    expect(trainers.workers).toHaveLength(1)
    // 학습이 돌면 [취소]가 아니라 [멈추기]다.
    expect(barButton(wrapper, t('common.cancel'))).toBeUndefined()
    expect(barButton(wrapper, t('train.stop'))).toBeDefined()
    wrapper.unmount()
  })
})
