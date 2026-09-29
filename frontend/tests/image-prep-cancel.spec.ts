// @vitest-environment jsdom
/**
 * **전처리의 테스트 사진 굽기에 [취소]가 선다** (architecture.md §8.10.4, 코드 소유자 결정 11).
 *
 * 전에는 굽기가 시작되면 멈출 길이 떠나기뿐이었다. [취소]는 **그 받기 하나만** 끊는다 — 부분
 * 결과는 버리고(테스트 사진도, 실험 지우기도 안 일어난다) 원래 상태로 돌아간다. 다시 놓으면
 * 정상으로 굽는다.
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
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import { dropEvent, HARNESS_BACKBONE, stubDialogElement } from './fixtures/image-workers'
import { experiment } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

const bakers = vi.hoisted(() => ({ workers: [] as CanonicalizeWorker[], terminated: 0 }))

vi.mock('../src/data/image/spawn', () => ({
  spawnCanonicalizeWorker: (): CanonicalizeWorker => {
    const worker: CanonicalizeWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() {},
      terminate() {
        bakers.terminated += 1
      },
    }
    bakers.workers.push(worker)
    return worker
  },
}))

const room = vi.hoisted(() => ({ gate: null as Promise<void> | null }))

vi.mock('../src/data/image/room', () => ({
  imageRoomShortfall: async () => {
    if (room.gate) await room.gate
    return null
  },
}))

/**
 * **압축 파일 읽기를 붙들 수 있다.** 읽기에는 맡길 손잡이가 없어, 그 사이에 눌린 [취소]는 일의
 * 표지로만 남는다 — 붙든 동안 누르고 풀어서 그 표지를 보는지 잰다. 붙들지 않으면 진짜로 읽는다.
 */
const reader = vi.hoisted(() => ({ gate: null as Promise<void> | null }))

vi.mock('../src/data/image/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/image/upload')>()
  return {
    ...actual,
    readImageZip: async (...args: Parameters<typeof actual.readImageZip>) => {
      if (reader.gate) {
        await reader.gate
        return actual.readImageFiles([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])
      }
      return actual.readImageZip(...args)
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

interface PanelInternals {
  busy: boolean
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

/** 붙든 굽기 워커를 끝낸다. 사진 이름이 곧 원래 경로다(`범주/이름`). */
function deliver(worker: CanonicalizeWorker | undefined, paths: readonly string[]): void {
  worker?.onmessage?.({
    data: {
      type: 'done',
      format: 'webp',
      images: paths.map((path) => {
        const bytes = new TextEncoder().encode(`baked:${path}`)
        return { sourceName: path, hash: hashBytes(bytes), bytes }
      }),
      skipped: [],
    },
  } as unknown as MessageEvent<never>)
}

beforeEach(async () => {
  setActivePinia(createPinia())
  bakers.workers.length = 0
  bakers.terminated = 0
  room.gate = null
  reader.gate = null
  closeStorage()
  await resetDatabase()
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
  await resetDatabase()
})

const CANCEL = () => i18n.global.t('common.cancel')

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
  /** 대화상자 밖의 [취소]. 확인 창에도 같은 글자가 있다. */
  const cancelButton = () =>
    wrapper
      .findAll('button')
      .find((one) => one.text() === CANCEL() && one.element.closest('dialog') === null)
  return { project, wrapper, drop, cancelButton, panel: wrapper.vm as unknown as PanelInternals }
}

const PHOTOS = () => [photo('개', 'a.jpg'), photo('고양이', 'b.jpg')]

describe('테스트 사진을 굽는 중에 [취소]를 누른다', () => {
  it('굽기를 끊고 아무것도 안 앉히며, 다시 놓으면 정상으로 굽는다', async () => {
    const { project, drop, cancelButton, panel } = await panelWithDropzone()
    expect(cancelButton()).toBeUndefined()

    await drop(PHOTOS())
    expect(bakers.workers).toHaveLength(1)
    expect(cancelButton(), 'cancel button while baking').toBeDefined()
    await cancelButton()!.trigger('click')
    await settle()

    expect(bakers.terminated).toBe(1)
    deliver(bakers.workers[0], ['개/a.jpg', '고양이/b.jpg'])
    await settle()
    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(project.file?.document.settings.split.method).not.toBe('provided')
    expect(useToastStore().items).toEqual([])
    expect(panel.busy).toBe(false)
    expect(cancelButton()).toBeUndefined()

    // 다시 시도하면 정상이다.
    await drop(PHOTOS())
    expect(bakers.workers).toHaveLength(2)
    deliver(bakers.workers[1], ['개/a.jpg', '고양이/b.jpg'])
    await settle()
    expect(readImages(project.file, 'test')).toHaveLength(2)
  })

  it('자리를 묻는 동안 누르면 워커를 띄우지 않는다', async () => {
    const { project, drop, cancelButton, panel } = await panelWithDropzone()
    let open!: () => void
    room.gate = new Promise((resolve) => {
      open = resolve
    })
    await drop(PHOTOS())
    expect(cancelButton(), 'cancel button while asking for room').toBeDefined()
    await cancelButton()!.trigger('click')
    open()
    await settle()

    expect(bakers.workers).toHaveLength(0)
    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(panel.busy).toBe(false)
    expect(useToastStore().items).toEqual([])
  })

  /**
   * **저장이 시작되면 [취소]는 내려간다.** 그 뒤로는 끊을 것이 없다 — 선 채로 두면 눌러도 사진이
   * 앉는 [취소]가 된다.
   */
  it('구운 것을 저장하는 동안에는 [취소]가 없다', async () => {
    const { project, drop, cancelButton } = await panelWithDropzone()
    const real = project.save.bind(project)
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    vi.spyOn(project, 'save').mockImplementation(async (...args) => {
      await gate
      return real(...args)
    })
    await drop(PHOTOS())
    deliver(bakers.workers[0], ['개/a.jpg', '고양이/b.jpg'])
    await settle()

    expect(cancelButton(), 'no cancel while saving').toBeUndefined()
    open()
    await settle()
    expect(readImages(project.file, 'test')).toHaveLength(2)
  })

  it('압축 파일을 읽는 동안 누르면 확인 창도 굽기도 없다', async () => {
    const { project, drop, cancelButton, panel } = await panelWithDropzone(true)
    let open!: () => void
    reader.gate = new Promise((resolve) => {
      open = resolve
    })
    await drop([new File([new Uint8Array([1])], 'test.zip', { type: 'application/zip' })])
    expect(cancelButton(), 'cancel button while reading').toBeDefined()
    await cancelButton()!.trigger('click')
    open()
    await settle()

    expect((panel as unknown as { testAttaching: boolean }).testAttaching).toBe(false)
    expect(bakers.workers).toHaveLength(0)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
    expect(panel.busy).toBe(false)
    expect(useToastStore().items).toEqual([])
  })

  it('실험이 있어 확인을 받은 뒤에 끊어도 실험은 그대로다', async () => {
    const { project, wrapper, drop, cancelButton } = await panelWithDropzone(true)
    await drop(PHOTOS())
    const confirm = wrapper.findAll('button').find((one) => one.text() === '추가하기')
    await confirm?.trigger('click')
    await settle()
    expect(bakers.workers).toHaveLength(1)

    await cancelButton()!.trigger('click')
    await settle()
    expect(bakers.terminated).toBe(1)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(useToastStore().items).toEqual([])
  })
})
