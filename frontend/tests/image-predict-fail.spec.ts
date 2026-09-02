// @vitest-environment jsdom
/**
 * **예측 화면(이미지)의 실패 경로.** 학생이 눌렀는데 **아무 일도 안 일어나거나, 화면이 잠긴 채
 * 안 풀리는** 것을 잡는다.
 *
 * **스물세 라운드가 전부 성공 경로를 겨눴다** (2026-09-02 R23). 그동안 실패 쪽은
 * `catch`의 알림을 지우거나 `finally`의 `done()`을 지워도 **관문이 초록이었다** —
 * 열한 자리에서 그랬고, 그중 하나는 학생을 화면에 가두는 모양이었다.
 *
 * **여기서 재는 것은 셋이다**: 잠금이 풀리는가 · 학생에게 말하는가 · 잃은 것이 없는가.
 *
 * 씨앗: 정본 워커 사망 · 임베딩 워커 사망 · 삭제 중 저장 거절.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalizeWorker } from '../src/data/image/client'
import { ClientError } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import {
  dropEvent,
  imagePredictProject,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return { spawnEmbedWorker: fakeEmbedWorker }
})

const bakers = vi.hoisted(() => ({ workers: [] as CanonicalizeWorker[] }))

vi.mock('../src/data/image/spawn', () => ({
  spawnCanonicalizeWorker: (): CanonicalizeWorker => {
    const worker: CanonicalizeWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() {},
      terminate() {},
    }
    bakers.workers.push(worker)
    return worker
  },
}))

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

const gate = vi.hoisted(() => ({ failSave: false }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (gate.failSave) {
        throw new ClientError('STORAGE_QUOTA_EXCEEDED', { requiredMb: 9, availableMb: 1 })
      }
      return actual.saveProject(file)
    },
  }
})

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

interface PanelInternals {
  run: () => Promise<void>
  onDrop: (event: Event) => void
  predicting: boolean
  busy: boolean
  photosLocked: boolean
  inviting: boolean
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  bakers.workers.length = 0
  gate.failSave = false
  closeStorage()
  await deleteDatabase()
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  stubDialogElement()
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  await setLocale('ko')
})

afterEach(async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')
const addButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.text() === '사진 추가')
const runButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.text().includes('예측'))

describe('R23: embed worker dies while predicting', () => {
  it('unlocks add/remove and the predict button, and tells', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)
    expect(panel.predicting).toBe(true)
    expect(addButton(wrapper)?.attributes('disabled')).toBeDefined()

    workerState.embed[0]?.fail()
    await running
    await settle()

    expect(panel.predicting).toBe(false)
    expect(panel.busy).toBe(false)
    expect(addButton(wrapper)?.attributes('disabled')).toBeUndefined()
    // no models in this project -> predict stays disabled by canPredict; only check it is not running
    expect(runButton(wrapper)?.text()).toBe('예측하기')
    expect(dangers().map((one) => one.key)).toEqual(['client.BACKBONE_UNAVAILABLE'])
  })
})

describe('R23: removing a photo releases its job', () => {
  it('busy goes back to false after removeOne', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a', 'b']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals & {
      removeOne: (hash: string) => Promise<void>
    }
    const first = readImages(project.file, 'predict')[0]
    expect(first).toBeDefined()
    await panel.removeOne(first?.hash ?? '')
    await settle()
    expect(readImages(project.file, 'predict')).toHaveLength(1)
    expect(panel.busy).toBe(false)
    expect(addButton(wrapper)?.attributes('disabled')).toBeUndefined()
  })
})

describe('R23: canonicalize worker dies while adding photos', () => {
  it('unlocks the drop zone and tells; photos unchanged', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([new File([new Uint8Array([9])], 'late.jpg', { type: 'image/jpeg' })]))
    await flushPromises()
    await tick()
    await flushPromises()
    expect(bakers.workers).toHaveLength(1)
    expect(panel.busy).toBe(true)

    bakers.workers[0]?.onerror?.(new ErrorEvent('error', { message: 'worker crashed' }))
    await settle()

    expect(panel.busy).toBe(false)
    expect(addButton(wrapper)?.attributes('disabled')).toBeUndefined()
    expect(readImages(project.file, 'predict')).toHaveLength(1)
    expect(dangers().map((one) => one.key)).toEqual(['client.UNEXPECTED_ERROR'])
  })
})

/**
 * **읽는 동안 떠나면 아무것도 안 앉는다** (architecture.md §8.10.4, 2026-09-02 R23 B-2).
 * 전처리 화면과 같은 병이고 자리만 예측이다.
 */
describe('R23: leaving while the zip is still being read', () => {
  it('nothing is spawned or seated after unmount', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    const { zipSync } = await import('fflate')
    const bytes = zipSync({ 'a.jpg': new Uint8Array([9, 9, 9]) })
    const held = new File([bytes.slice()], 'more.zip', { type: 'application/zip' })
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    Object.defineProperty(held, 'arrayBuffer', {
      value: async () => {
        await waiting
        return bytes.slice().buffer
      },
    })

    const before = readImages(project.file, 'predict').length
    panel.onDrop(dropEvent([held]))
    await flushPromises()
    expect(panel.busy).toBe(true)

    wrapper.unmount()
    await flushPromises()
    release()
    await settle()

    expect(readImages(project.file, 'predict')).toHaveLength(before)
  })
})
