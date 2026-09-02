// @vitest-environment jsdom
/**
 * **붙여넣기는 놓는 것과 같은 일이다** (`open-decisions.md` "이미지 붙여넣기").
 *
 * 그래서 여기서 지키는 것은 **새 규칙이 없다는 것**이다 — 붙여넣기가 드롭이 쓰는 그
 * 함수로 들어가는지, 그리고 §8.10.4가 드롭에 대해 정한 것들(굽는 중에 데이터 화면은
 * 받아 두고 예측 화면은 거절하며 말한다, 떠나면 안 앉는다)이 **새 입구에도 그대로
 * 걸리는지**를 잰다.
 *
 * **표와 전처리는 무반응이어야 한다.** 표는 사진을 안 받고, 전처리의 테스트 사진은
 * 범주가 정확히 같아야 채점이 성립해서 범주 없는 사진을 언제나 거절한다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePasteImages } from '../src/composables/usePasteImages'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import {
  imagePredictProject,
  pasteEvent,
  pastedPhoto,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

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

interface DataInternals {
  busy: boolean
  pending: readonly { path: string; category: string }[] | null
  bake: () => Promise<void>
}

interface PredictInternals {
  busy: boolean
}

function emptyTabularProject(): ProjectFile {
  const document = newProjectDocument(
    { name: '표 프로젝트', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
  )
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
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

/** 사진 없는 이미지 프로젝트로 데이터 화면을 띄운다. */
async function dataPanel() {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePanel, {
    props: { accept: 'image/*' },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return { project, wrapper, panel: wrapper.vm as unknown as DataInternals }
}

describe('데이터 화면에 사진을 붙여넣으면', () => {
  /**
   * **범주 없음으로 들어온다** — 판에 끌어다 놓았을 때와 한 글자도 다르지 않다.
   * 범주를 묻는 모달은 만들지 않기로 했다(`open-decisions.md`).
   */
  it('확인 판에 범주 없음으로 선다', async () => {
    const { wrapper, panel } = await dataPanel()

    window.dispatchEvent(pasteEvent([pastedPhoto()]))
    await settle()

    expect(panel.pending).toHaveLength(1)
    expect(panel.pending?.[0]?.category).toBe('_unlabeled')

    wrapper.unmount()
  })

  /**
   * **이름이 겹치면 안 된다.** 클립보드의 사진은 전부 `image.png`라, 그대로 두면 확인
   * 판이 같은 줄만 되풀이하고 굽기 결과를 범주로 되돌리는 맵이 한 칸으로 접힌다.
   */
  it('붙여넣을 때마다 이름이 갈린다', async () => {
    const { wrapper, panel } = await dataPanel()

    window.dispatchEvent(pasteEvent([pastedPhoto([1]), pastedPhoto([2])]))
    await settle()

    const names = panel.pending?.map((one) => one.path) ?? []
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)

    wrapper.unmount()
  })

  it('구우면 사진이 앉는다', async () => {
    const { project, wrapper, panel } = await dataPanel()

    window.dispatchEvent(pasteEvent([pastedPhoto()]))
    await settle()
    await panel.bake()
    await settle()

    expect(readImages(project.file)).toHaveLength(1)
    expect(useToastStore().items.map((one) => one.key)).toContain('data.image.added')

    wrapper.unmount()
  })

  /**
   * **글자를 쓰는 자리에서 누른 붙여넣기는 글자 붙여넣기다.** 범주 이름을 바꾸는 칸과
   * 프로젝트 이름 칸이 이 화면들 안에 있다.
   */
  it('글자 칸에서 누른 것은 안 받는다', async () => {
    const { wrapper, panel } = await dataPanel()

    const input = document.createElement('input')
    document.body.append(input)
    window.dispatchEvent(pasteEvent([pastedPhoto()], input))
    await settle()

    expect(panel.pending).toBeNull()
    input.remove()
    wrapper.unmount()
  })

  it('사진이 아닌 것을 붙여넣으면 아무 일도 안 한다', async () => {
    const { wrapper, panel } = await dataPanel()

    window.dispatchEvent(pasteEvent([new File(['가나다'], 'note.txt', { type: 'text/plain' })]))
    await settle()

    expect(panel.pending).toBeNull()
    // **거절이라고 말하지 않는다** — 학생이 하지도 않은 일을 실패로 읽는다.
    expect(useToastStore().items).toEqual([])

    wrapper.unmount()
  })
})

describe('굽는 동안 붙여넣으면', () => {
  /**
   * **드롭과 같은 규칙이다** (§8.10.4). 데이터 화면은 확인 판이 있으므로 받아 두었다가
   * 굽기가 끝난 뒤 그 자리에 세운다 — 붙여넣기가 새 규칙을 만들지 않는다.
   */
  it('데이터 화면은 받아 두고 자물쇠는 안 풀린다', async () => {
    const { wrapper, panel } = await dataPanel()

    window.dispatchEvent(pasteEvent([pastedPhoto([1])]))
    await settle()
    workerState.holdBake = true
    const baking = panel.bake()
    await flushPromises()
    expect(panel.busy).toBe(true)

    window.dispatchEvent(pasteEvent([pastedPhoto([2])]))
    await settle()

    expect(panel.busy).toBe(true)
    expect(panel.pending).toHaveLength(1)

    workerState.bake[0]?.deliver()
    await baking
    await settle()
    wrapper.unmount()
  })

  /**
   * **예측 화면은 거절하되 말한다** (§8.10.4). 확인 판이 없어 받은 즉시 굽는데, 정본
   * 워커를 둘 띄우는 것은 저사양 교실 PC라는 기준에 안 맞는다.
   */
  it('예측 화면은 거절하고 그렇다고 말한다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PredictInternals

    workerState.holdBake = true
    window.dispatchEvent(pasteEvent([pastedPhoto([1])]))
    await settle()
    expect(panel.busy).toBe(true)
    expect(workerState.baked).toBe(1)

    window.dispatchEvent(pasteEvent([pastedPhoto([2])]))
    await settle()

    expect(workerState.baked).toBe(1)
    expect(useToastStore().items.map((one) => one.key)).toContain('predict.image.addWhileBusy')

    workerState.bake[0]?.deliver()
    await settle()
    wrapper.unmount()
  })
})

describe('표 데이터 화면은', () => {
  /**
   * **아무 일도 안 한다.** 사진을 안 받는 화면이고, 리스너를 판마다 걸었으므로 여기에는
   * 아예 없다 (`open-decisions.md`).
   */
  it('사진을 붙여넣어도 반응하지 않는다', async () => {
    const project = useProjectStore()
    await project.save(emptyTabularProject())
    const wrapper = mount(TabularPanel, {
      props: { accept: '.csv' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    window.dispatchEvent(pasteEvent([pastedPhoto()]))
    await settle()

    expect(useToastStore().items).toEqual([])
    expect(readImages(project.file)).toHaveLength(0)

    wrapper.unmount()
  })
})

/**
 * **원시 연산을 직접 잰다.**
 *
 * 화면 너머로만 재면 **떠날 때 리스너를 떼는지 알 수 없다** — 죽은 화면으로 간 붙여넣기는
 * `alive()`에 막혀 아무것도 안 남기므로, 리스너가 새도 화면에서는 똑같아 보인다.
 * 실제로 처음에 그렇게 써서 `removeEventListener`를 지워도 아홉 개가 초록이었다.
 */
describe('붙여넣기 리스너 자체는', () => {
  function listening() {
    const taken: string[][] = []
    const host = defineComponent({
      setup() {
        usePasteImages((files) => taken.push(files.map((one) => one.name)))
        return () => h('div')
      },
    })
    return { taken, wrapper: mount(host) }
  }

  it('붙여넣은 것을 화면에 넘긴다', async () => {
    const { taken, wrapper } = listening()

    window.dispatchEvent(pasteEvent([pastedPhoto()]))
    await flushPromises()

    expect(taken).toHaveLength(1)
    wrapper.unmount()
  })

  it('떠나면 리스너를 뗀다', async () => {
    const { taken, wrapper } = listening()
    wrapper.unmount()

    window.dispatchEvent(pasteEvent([pastedPhoto()]))
    await flushPromises()

    expect(taken).toEqual([])
  })

  it('이름은 화면이 사는 동안 안 되돌아간다', async () => {
    const { taken, wrapper } = listening()

    window.dispatchEvent(pasteEvent([pastedPhoto([1])]))
    window.dispatchEvent(pasteEvent([pastedPhoto([2])]))
    await flushPromises()

    expect(taken.flat()).toEqual(['pasted-1.png', 'pasted-2.png'])
    wrapper.unmount()
  })
})
