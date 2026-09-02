// @vitest-environment jsdom
/**
 * **학습 화면의 실패 경로.** 학생이 눌렀는데 **아무 일도 안 일어나거나, 화면이 잠긴 채
 * 안 풀리는** 것을 잡는다.
 *
 * **스물세 라운드가 전부 성공 경로를 겨눴다** (2026-09-02 R23). 그동안 실패 쪽은
 * `catch`의 알림을 지우거나 `finally`의 `done()`을 지워도 **관문이 초록이었다** —
 * 열한 자리에서 그랬고, 그중 하나는 학생을 화면에 가두는 모양이었다.
 *
 * **여기서 재는 것은 셋이다**: 잠금이 풀리는가 · 학생에게 말하는가 · 잃은 것이 없는가.
 *
 * 씨앗: 임베딩 워커 사망 · 학습 워커 사망 · **정상 종료**. 잠금이 걸리는 쪽만 재고
 * 풀리는 쪽은 안 보던 자리다 (R22 B-4의 짝).
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
import type { WorkerMessage, WorkerRequest } from '../src/ml/worker/protocol'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { ROUTE_PROJECTS, router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { resetImageWorkers, stubDialogElement, workerState } from './fixtures/image-workers'

const reportFirst = vi.hoisted(() => ({ value: false }))

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return {
    spawnEmbedWorker: () => {
      const worker = fakeEmbedWorker()
      const post = worker.postMessage.bind(worker)
      worker.postMessage = (request) => {
        post(request)
        if (!reportFirst.value) return
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

/** Training workers created for 'train' requests; the test answers or kills them by hand. */
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
  await flushPromises()
  await tick()
  await flushPromises()
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
  reportFirst.value = false
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
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

async function trainScreenAfterStart() {
  await saveProject(trainableImageProject())
  const wrapper = mount(Host, { global: { plugins: [router, i18n] } })
  await router.push(`/project/${PROJECT_ID}/train`)
  await settle()
  expect(router.currentRoute.value.name).toBe('train')
  const buttons = () => wrapper.findAll('button')
  const startButton = () => buttons().find((one) => one.text().includes('학습하기'))
  expect(startButton()?.attributes('disabled')).toBeUndefined()
  await startButton()?.trigger('click')
  await settle()
  expect(workerState.embed).toHaveLength(1)
  return { wrapper, buttons, startButton, project: useProjectStore() }
}

function axesInert(wrapper: ReturnType<typeof mount>): boolean {
  const value = wrapper.find('div.transition-opacity').attributes('inert')
  return value === '' || value === 'true'
}

const DONE = (): WorkerMessage =>
  ({
    type: 'done',
    experiment: {
      id: 'experiment-r23',
      startedAt: '2026-09-02T10:00:00Z',
      settings: {
        taskType: 'classification',
        runtime: 'mljs',
        selectedAlgorithms: [{ algorithm: 'decision_tree', runtime: 'mljs' }],
        data: { features: ['f0'], target: 'label', preprocessing: {} },
        split: { method: 'holdout', testSize: 0.25, stratify: false },
        trainIndices: [0, 1, 2],
        testIndices: [3],
      },
      preprocessor: {
        format: 'mlpx-preprocess-v1',
        path: 'model/preprocessor-experiment-r23.json',
      },
      runs: [
        {
          id: 'run-r23',
          algorithm: 'decision_tree',
          hyperparameters: {},
          computedBy: 'browser',
          trainedAt: '2026-09-02T10:00:01Z',
          status: 'done',
          metrics: { accuracy: 1 },
        },
      ],
    },
    preprocessor: { format: 'mlpx-preprocess-v1', columns: [] },
    models: new Map(),
  }) as unknown as WorkerMessage

describe('R23: preparing was reported, then the embed worker dies', SLOW, () => {
  it('unlocks fully', async () => {
    reportFirst.value = true
    const { wrapper, startButton } = await trainScreenAfterStart()
    expect(axesInert(wrapper)).toBe(true)
    expect(wrapper.text()).toContain('다운로드하는 중')

    workerState.embed[0]?.fail()
    await settle()

    expect(axesInert(wrapper)).toBe(false)
    expect(startButton()?.attributes('disabled')).toBeUndefined()
    expect(wrapper.findAll('button').filter((one) => one.text() === '제거')).toHaveLength(2)
    await router.push('/')
    await settle()
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    wrapper.unmount()
  })
})

describe('R23: training finishes normally', SLOW, () => {
  it('unlocks, seats the experiment, and lets the student leave', async () => {
    reportFirst.value = true
    const { wrapper, startButton, project } = await trainScreenAfterStart()
    expect(axesInert(wrapper)).toBe(true)

    workerState.embed[0]?.deliver()
    await settle()
    await settle()
    expect(trainers.workers).toHaveLength(1)
    // training is running now: axes still locked, [stop] visible
    expect(axesInert(wrapper)).toBe(true)
    expect(wrapper.findAll('button').some((one) => one.text() === '멈추기')).toBe(true)

    trainers.workers[0]?.onmessage?.({ data: DONE() } as MessageEvent<WorkerMessage>)
    await settle()
    await settle()

    expect(axesInert(wrapper)).toBe(false)
    expect(startButton()?.attributes('disabled')).toBeUndefined()
    expect(wrapper.findAll('button').filter((one) => one.text() === '제거')).toHaveLength(2)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
    expect(useToastStore().items.map((one) => `${one.tone}:${one.key}`)).toContain(
      'success:train.finished',
    )
    await router.push('/')
    await settle()
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    wrapper.unmount()
  })

  it('training worker dies: unlocks and tells', async () => {
    const { wrapper, startButton, project } = await trainScreenAfterStart()
    workerState.embed[0]?.deliver()
    await settle()
    await settle()
    expect(trainers.workers).toHaveLength(1)

    trainers.workers[0]?.onerror?.({ message: 'train worker crashed' } as ErrorEvent)
    await settle()
    await settle()

    expect(axesInert(wrapper)).toBe(false)
    expect(startButton()?.attributes('disabled')).toBeUndefined()
    expect(project.file?.document.runs.experiments).toHaveLength(0)
    expect(useToastStore().items.filter((one) => one.tone === 'danger')).toHaveLength(1)
    expect(wrapper.text()).toContain('실패')
    await router.push('/')
    await settle()
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    wrapper.unmount()
  })
})
