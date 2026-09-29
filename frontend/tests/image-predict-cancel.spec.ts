// @vitest-environment jsdom
/**
 * **예측 사진 굽기에 [취소]가 선다** (architecture.md §8.10.4, 코드 소유자 결정 11).
 *
 * 전에는 굽기가 시작되면 멈출 길이 떠나기뿐이었다 — 깨진 사진 하나에 워커가 오래 붙들리면
 * 학생은 화면을 옮겨야 했다. [취소]는 **그 굽기 하나만** 끊는다: 부분 결과는 버리고(프로젝트에
 * 아무것도 안 앉는다), 같은 화면에서 겹쳐 도는 예측의 임베딩은 그대로다. 다시 놓으면 정상으로
 * 굽는다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CanonicalizeWorker } from '../src/data/image/client'
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
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
  withUsableModel,
  workerState,
} from './fixtures/image-workers'

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return { spawnEmbedWorker: fakeEmbedWorker }
})

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
    // **검사가 자리 묻기를 붙들 수 있다.** 맡길 손잡이가 없는 구간이다.
    if (room.gate) await room.gate
    return null
  },
}))

/**
 * **압축 파일 읽기를 붙들 수 있다.** 읽기에는 맡길 손잡이가 없어, 그 사이에 눌린 [취소]는 일의
 * 표지로만 남는다. 붙들지 않으면 진짜로 읽는다.
 */
const reader = vi.hoisted(() => ({ gate: null as Promise<void> | null }))

vi.mock('../src/data/image/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/data/image/upload')>()
  return {
    ...actual,
    readImageZip: async (...args: Parameters<typeof actual.readImageZip>) => {
      if (reader.gate) {
        await reader.gate
        return actual.readImageFiles([jpg('inside.jpg')])
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
  busy: boolean
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  bakers.workers.length = 0
  bakers.terminated = 0
  room.gate = null
  reader.gate = null
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

const CANCEL = () => i18n.global.t('common.cancel')

/** 대화상자 밖의 [취소]. 사진 비우기 대화상자에도 같은 글자가 있다. */
function cancelButton(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('button')
    .find((one) => one.text() === CANCEL() && one.element.closest('dialog') === null)
}

function jpg(name: string): File {
  return new File([new Uint8Array([9])], name, { type: 'image/jpeg' })
}

/** 붙든 굽기 워커를 끝낸다. */
function deliver(worker: CanonicalizeWorker | undefined, name: string): void {
  const bytes = new TextEncoder().encode(`baked:${name}`)
  worker?.onmessage?.({
    data: {
      type: 'done',
      format: 'webp',
      images: [{ sourceName: name, hash: hashBytes(bytes), bytes }],
      skipped: [],
    },
  } as unknown as MessageEvent<never>)
}

async function mounted() {
  const project = useProjectStore()
  await project.save(withUsableModel(imagePredictProject(['a'])))
  const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  return { project, wrapper, panel: wrapper.vm as unknown as PanelInternals }
}

describe('예측 사진을 굽는 중에 [취소]를 누른다', () => {
  it('굽기를 끊고 아무것도 안 앉히며, 다시 놓으면 정상으로 굽는다', async () => {
    const { project, wrapper, panel } = await mounted()
    // 굽기 전에는 [취소]가 없다.
    expect(cancelButton(wrapper)).toBeUndefined()

    panel.onDrop(dropEvent([jpg('late.jpg')]))
    await settle()
    expect(bakers.workers).toHaveLength(1)
    const cancel = cancelButton(wrapper)
    expect(cancel, 'cancel button while baking').toBeDefined()

    await cancel!.trigger('click')
    await settle()
    expect(bakers.terminated).toBe(1)
    // 늦게 온 답도 안 앉는다 — 끊긴 워커의 말은 버린다.
    deliver(bakers.workers[0], 'late.jpg')
    await settle()
    expect(readImages(project.file, 'predict')).toHaveLength(1)
    expect(useToastStore().items).toEqual([])
    expect(panel.busy).toBe(false)
    expect(cancelButton(wrapper)).toBeUndefined()

    // 다시 시도하면 정상이다.
    panel.onDrop(dropEvent([jpg('again.jpg')]))
    await settle()
    expect(bakers.workers).toHaveLength(2)
    deliver(bakers.workers[1], 'again.jpg')
    await settle()
    expect(readImages(project.file, 'predict')).toHaveLength(2)
    wrapper.unmount()
  })

  it('자리를 묻는 동안 누르면 워커를 띄우지 않는다', async () => {
    const { project, wrapper, panel } = await mounted()
    let open!: () => void
    room.gate = new Promise((resolve) => {
      open = resolve
    })
    panel.onDrop(dropEvent([jpg('late.jpg')]))
    await settle()
    const cancel = cancelButton(wrapper)
    expect(cancel, 'cancel button while asking for room').toBeDefined()
    await cancel!.trigger('click')
    open()
    await settle()

    expect(bakers.workers).toHaveLength(0)
    expect(readImages(project.file, 'predict')).toHaveLength(1)
    expect(panel.busy).toBe(false)
    expect(useToastStore().items).toEqual([])
    wrapper.unmount()
  })

  /**
   * **저장이 시작되면 [취소]는 내려간다.** 그 뒤로는 끊을 것이 없다 — 선 채로 두면 눌러도 사진이
   * 앉는 [취소]가 된다.
   */
  it('구운 것을 저장하는 동안에는 [취소]가 없다', async () => {
    const { project, wrapper, panel } = await mounted()
    const real = project.save.bind(project)
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    vi.spyOn(project, 'save').mockImplementation(async (...args) => {
      await gate
      return real(...args)
    })
    panel.onDrop(dropEvent([jpg('late.jpg')]))
    await settle()
    deliver(bakers.workers[0], 'late.jpg')
    await settle()

    expect(cancelButton(wrapper), 'no cancel while saving').toBeUndefined()
    open()
    await settle()
    expect(readImages(project.file, 'predict')).toHaveLength(2)
    wrapper.unmount()
  })

  it('압축 파일을 읽는 동안 누르면 굽지 않는다', async () => {
    const { project, wrapper, panel } = await mounted()
    let open!: () => void
    reader.gate = new Promise((resolve) => {
      open = resolve
    })
    panel.onDrop(dropEvent([new File([new Uint8Array([1])], 'more.zip')]))
    await settle()
    const cancel = cancelButton(wrapper)
    expect(cancel, 'cancel button while reading').toBeDefined()
    await cancel!.trigger('click')
    open()
    await settle()

    expect(bakers.workers).toHaveLength(0)
    expect(readImages(project.file, 'predict')).toHaveLength(1)
    expect(panel.busy).toBe(false)
    expect(useToastStore().items).toEqual([])
    wrapper.unmount()
  })

  it('겹쳐 도는 예측의 임베딩은 안 끊는다', async () => {
    const { wrapper, panel } = await mounted()
    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)

    panel.onDrop(dropEvent([jpg('late.jpg')]))
    await settle()
    expect(bakers.workers).toHaveLength(1)
    await cancelButton(wrapper)!.trigger('click')
    await settle()

    expect(bakers.terminated).toBe(1)
    expect(workerState.terminated.embed).toBe(0)
    workerState.embed[0]?.deliver()
    await running
    await settle()
    expect(useToastStore().items.filter((one) => one.tone === 'danger')).toEqual([])
    wrapper.unmount()
  })
})
