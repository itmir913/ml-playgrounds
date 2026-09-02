// @vitest-environment jsdom
/**
 * **전처리 화면(이미지)의 실패 경로.** 학생이 눌렀는데 **아무 일도 안 일어나거나, 화면이 잠긴 채
 * 안 풀리는** 것을 잡는다.
 *
 * **스물세 라운드가 전부 성공 경로를 겨눴다** (2026-09-02 R23). 그동안 실패 쪽은
 * `catch`의 알림을 지우거나 `finally`의 `done()`을 지워도 **관문이 초록이었다** —
 * 열한 자리에서 그랬고, 그중 하나는 학생을 화면에 가두는 모양이었다.
 *
 * **여기서 재는 것은 셋이다**: 잠금이 풀리는가 · 학생에게 말하는가 · 잃은 것이 없는가.
 *
 * 씨앗: 테스트 사진 굽기 워커 사망 · 저장 거절 · 자리 묻기 예외 · 확인 창을 연 채 떠나기.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalizeWorker } from '../src/data/image/client'
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages, readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import { dropEvent, HARNESS_BACKBONE, stubDialogElement } from './fixtures/image-workers'
import { experiment } from './fixtures/project'

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

const room = vi.hoisted(() => ({ fails: false }))

vi.mock('../src/data/image/room', () => ({
  imageRoomShortfall: async () => {
    if (room.fails) throw new Error('room check unavailable')
    return null
  },
}))

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
  busy: boolean
  testAttaching: boolean
  pendingTest: unknown
}

function photo(category: string, name: string): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'webkitRelativePath', { value: `${category}/${name}` })
  return file
}

function imageDataProject(withExperiment: boolean): ProjectFile {
  const backbone = HARNESS_BACKBONE
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
  )
  const empty: ProjectFile = {
    document: withExperiment
      ? { ...document, runs: { experiments: [experiment('experiment-1', [])] } }
      : document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    ['개', '개', '고양이', '고양이'].map((category, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${category}:${index}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-02T09:00:00.000Z', format: 'webp' },
  ).project
}

beforeEach(async () => {
  setActivePinia(createPinia())
  bakers.workers.length = 0
  room.fails = false
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

async function panelWithDropzone(withExperiment = false) {
  const project = useProjectStore()
  await project.save(imageDataProject(withExperiment))
  const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  const provided = wrapper.findAll('input[name="image-test-data-choice"]')[1]
  await provided?.trigger('change')
  await flushPromises()
  const zone = () => wrapper.find('[class*="border-dashed"]')
  expect(zone().exists()).toBe(true)
  const drop = async (files: readonly File[]): Promise<void> => {
    zone().element.dispatchEvent(dropEvent(files))
    await settle()
  }
  return { project, wrapper, zone, drop, panel: wrapper.vm as unknown as PanelInternals }
}

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')

describe('R23: worker dies while baking test photos', () => {
  it('unlocks, nothing seated, student is told, zone invites again', async () => {
    const { project, wrapper, zone, drop, panel } = await panelWithDropzone()
    await drop([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])
    expect(bakers.workers).toHaveLength(1)
    expect(panel.busy).toBe(true)

    bakers.workers[0]?.onerror?.(new ErrorEvent('error', { message: 'worker crashed' }))
    await settle()

    expect(panel.busy).toBe(false)
    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(dangers().map((one) => one.key)).toEqual(['client.UNEXPECTED_ERROR'])
    await zone().trigger('dragover')
    expect(zone().classes()).toContain('border-brand')
    const buttons = wrapper.findAll('button').filter((one) => one.text().includes('추가'))
    for (const button of buttons) expect(button.attributes('disabled')).toBeUndefined()
  })

  it('room check throws: unlocks and tells', async () => {
    const { drop, panel } = await panelWithDropzone()
    room.fails = true
    await drop([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])
    expect(bakers.workers).toHaveLength(0)
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
  })
})

describe('R23: confirm dialog branch (experiments exist)', () => {
  it('drop opens the dialog; leaving with it open is quiet', async () => {
    const { wrapper, drop, panel } = await panelWithDropzone(true)
    await drop([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])
    expect(panel.testAttaching).toBe(true)
    expect(bakers.workers).toHaveLength(0)
    expect(panel.busy).toBe(false)

    wrapper.unmount()
    await settle()
    expect(useToastStore().items).toEqual([])
  })

  it('confirm bakes the held photos', async () => {
    const { wrapper, drop, panel, project } = await panelWithDropzone(true)
    await drop([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])
    expect(panel.testAttaching).toBe(true)
    const confirm = wrapper.findAll('button').find((one) => one.text() === '추가하기')
    expect(confirm).toBeDefined()
    await confirm?.trigger('click')
    await settle()
    expect(bakers.workers).toHaveLength(1)
    expect(panel.busy).toBe(true)
    expect(panel.testAttaching).toBe(false)

    // worker dies -> unlock; experiments untouched
    bakers.workers[0]?.onerror?.(new ErrorEvent('error', { message: 'worker crashed' }))
    await settle()
    expect(panel.busy).toBe(false)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
  })
})

/**
 * **읽는 동안 떠나면 아무것도 안 앉는다** (architecture.md §8.10.4, 2026-09-02 R23 B-2).
 *
 * 읽기 구간에는 맡길 손잡이가 없어 `retire()`가 끊을 것이 없다. 그 전에는 읽기가 끝난 뒤
 * **죽은 화면이 워커를 열어 지금 열린 파일에 테스트 사진을 얹었다** — 그 사이 학생이
 * 다른 프로젝트를 열었으면 그쪽에 앉는다.
 */
describe('R23: leaving while the zip is still being read', () => {
  it('nothing is spawned or seated after unmount, and the read is a job', async () => {
    const { project, wrapper, zone, panel } = await panelWithDropzone()
    const { zipSync } = await import('fflate')
    const bytes = zipSync({
      '개/a.jpg': new Uint8Array([1, 2, 3]),
      '고양이/b.jpg': new Uint8Array([4, 5, 6]),
    })
    const held = new File([bytes.slice()], 'test.zip', { type: 'application/zip' })
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

    zone().element.dispatchEvent(dropEvent([held]))
    await flushPromises()
    // **읽는 것도 도는 일이다** (R23 C-2). 그 전에는 여기가 거짓이라 드롭존이 초대색이었다.
    expect(panel.busy).toBe(true)
    expect(bakers.workers).toHaveLength(0)

    wrapper.unmount()
    await flushPromises()
    release()
    await settle()

    // **떠난 뒤에는 워커가 안 뜬다.**
    expect(bakers.workers).toHaveLength(0)
    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(project.file?.document.settings.split.method).not.toBe('provided')
  })
})
