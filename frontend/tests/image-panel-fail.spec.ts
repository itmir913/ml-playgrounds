// @vitest-environment jsdom
/**
 * **데이터 화면(이미지)의 실패 경로.** 학생이 눌렀는데 **아무 일도 안 일어나거나, 화면이 잠긴 채
 * 안 풀리는** 것을 잡는다.
 *
 * **스물세 라운드가 전부 성공 경로를 겨눴다** (2026-09-02 R23). 그동안 실패 쪽은
 * `catch`의 알림을 지우거나 `finally`의 `done()`을 지워도 **관문이 초록이었다** —
 * 열한 자리에서 그랬고, 그중 하나는 학생을 화면에 가두는 모양이었다.
 *
 * **여기서 재는 것은 셋이다**: 잠금이 풀리는가 · 학생에게 말하는가 · 잃은 것이 없는가.
 *
 * 씨앗: 정본 워커 사망 · `messageerror` · 저장 쿼터 거절 · 손상된 zip · 빈 zip ·
 * `arrayBuffer` 거절 · 자리 묻기 예외.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalizeWorker } from '../src/data/image/client'
import { ClientError } from '../src/errors'
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import { dropEvent, imagePredictProject, stubDialogElement } from './fixtures/image-workers'

/** Canonicalize workers created so far; the test kills or answers them by hand. */
const bakers = vi.hoisted(() => ({
  workers: [] as CanonicalizeWorker[],
}))

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
  bake: () => Promise<void>
  onDrop: (event: Event) => void
  cancelBaking: () => void
  busy: boolean
  pending: readonly { path: string }[] | null
  baking: readonly { path: string }[] | null
}

const file = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

beforeEach(async () => {
  setActivePinia(createPinia())
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

async function panelWithPending() {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
  await flushPromises()
  const panel = wrapper.vm as unknown as PanelInternals
  panel.onDrop(dropEvent([file('a.jpg')]))
  await settle()
  expect(panel.pending?.map((one) => one.path)).toEqual(['a.jpg'])
  return { project, wrapper, panel }
}

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')

describe('R23: worker dies while baking', () => {
  it('unlocks, keeps the batch, and tells the student', async () => {
    const { project, wrapper, panel } = await panelWithPending()
    const baking = panel.bake()
    await flushPromises()
    expect(panel.busy).toBe(true)
    expect(bakers.workers).toHaveLength(1)

    bakers.workers[0]?.onerror?.(new ErrorEvent('error', { message: 'worker crashed' }))
    await baking
    await settle()

    expect(panel.busy).toBe(false)
    expect(panel.baking).toBeNull()
    expect(panel.pending?.map((one) => one.path)).toEqual(['a.jpg'])
    expect(readImages(project.file)).toHaveLength(0)
    expect(dangers().map((one) => one.key)).toEqual(['client.UNEXPECTED_ERROR'])
    const use = wrapper.findAll('button').find((one) => one.text() === '이 사진 사용')
    expect(use?.attributes('disabled')).toBeUndefined()
  })

  it('messageerror also unlocks', async () => {
    const { panel } = await panelWithPending()
    const baking = panel.bake()
    await flushPromises()
    bakers.workers[0]?.onmessageerror?.({ data: null } as MessageEvent<unknown>)
    await baking
    await settle()
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
  })
})

describe('R23: a plain save releases its job', () => {
  it('busy goes back to false after save()', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals & {
      save: (next: (live: ProjectFile) => ProjectFile) => Promise<void>
    }
    await panel.save((live) => live)
    await settle()
    expect(panel.busy).toBe(false)
  })
})

describe('R23: reading fails', () => {
  it('corrupt zip: unlocks and tells', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    panel.onDrop(dropEvent([new File([new Uint8Array([1, 2, 3])], 'broken.zip')]))
    await settle()
    expect(panel.busy).toBe(false)
    expect(panel.pending).toBeNull()
    expect(dangers()).toHaveLength(1)
  })

  it('empty zip: unlocks and tells', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    panel.onDrop(dropEvent([new File([], 'empty.zip')]))
    await settle()
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
  })

  it('arrayBuffer rejects: unlocks and tells', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    const bad = new File([new Uint8Array([1])], 'x.zip')
    Object.defineProperty(bad, 'arrayBuffer', {
      value: async () => {
        throw new DOMException('read failed', 'NotReadableError')
      },
    })
    panel.onDrop(dropEvent([bad]))
    await settle()
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
  })
})

/**
 * **저장이 거절돼도 확인 판은 접힌다** (2026-09-02 R23 B-1). 표 화면과 같은 병이고
 * 자리만 이미지다 — 사진은 이미 화면에 앉았는데 판이 남아, 다시 누르면 워커가 한 번
 * 더 돌고 아무것도 새로 안 뜬다.
 *
 * **워커가 죽은 것과는 다르다.** 그때는 앉은 것이 없으므로 묶음이 판에 남아야 학생이
 * 다시 누를 수 있다 — 위의 "unlocks, keeps the batch"가 그쪽을 지킨다.
 */
describe('R23: the save is refused by quota after baking', () => {
  it('takes the batch off the bar so a second press cannot double-bake', async () => {
    const { project, panel, wrapper } = await panelWithPending()

    gate.failSave = true
    const baking = panel.bake()
    await flushPromises()
    expect(bakers.workers).toHaveLength(1)
    // 워커는 제대로 답한다 — 거절하는 것은 저장이다.
    const bytes = new TextEncoder().encode('baked:a.jpg')
    bakers.workers[0]?.onmessage?.({
      data: {
        type: 'done',
        format: 'webp',
        images: [{ sourceName: 'a.jpg', hash: hashBytes(bytes), bytes }],
        skipped: [],
      },
    } as unknown as MessageEvent<never>)
    await baking
    await settle()

    expect(panel.pending).toBeNull()
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
    // 사진은 앉았다 — 스토어가 `file.value`를 먼저 바꾼다. 그래서 판을 접는 것이 맞다.
    expect(readImages(project.file)).toHaveLength(1)

    wrapper.unmount()
  })
})
