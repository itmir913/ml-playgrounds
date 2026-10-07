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
import { addCategory, addImages, readImages } from '../src/project/images'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import { dropEvent, HARNESS_BACKBONE, stubDialogElement } from './fixtures/image-workers'
import { experiment } from './fixtures/project'
import { resetDatabase } from './fixtures/database'

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

const room = vi.hoisted(() => ({ fails: false, gate: null as Promise<void> | null }))

vi.mock('../src/data/image/room', () => ({
  imageRoomShortfall: async () => {
    // **검사가 자리 묻기를 붙들 수 있다.** 그 창이 `hold()` 앞의 두 번째 `await`다.
    if (room.gate) await room.gate
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
  room.gate = null
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

/**
 * **전부 건너뛰면 저장하지 않는다** (2026-09-28 감사 A-1). 여기서 저장하면 실험이 지워지고
 * 사진 없는 테스트 참조가 남아 **완성된 프로젝트가 내보내기도 다시 열기도 못 했다.**
 */
describe('A-1: every test photo is skipped', () => {
  it('테스트 사진이 전부 건너뛰면 저장하지 않는다', async () => {
    const { project, drop, panel } = await panelWithDropzone()
    // **저장을 부르지 않는 것을 본다.** `applyTestImages`가 빈 목록이면 입력을 그대로 돌려주므로
    // 파일만 보면 화면의 거름이 빠져도 초록이다.
    const saving = vi.spyOn(project, 'save')
    await drop([photo('개', 'a.heic'), photo('고양이', 'b.heic')])
    expect(bakers.workers).toHaveLength(1)
    bakers.workers[0]?.onmessage?.({
      data: {
        type: 'done',
        format: 'webp',
        images: [],
        skipped: [{ sourceName: '개/a.heic' }, { sourceName: '고양이/b.heic' }],
      },
    } as unknown as MessageEvent<never>)
    await settle()

    expect(saving, 'the panel must not save').not.toHaveBeenCalled()
    expect(project.file?.document.settings.split.method).not.toBe('provided')
    expect(project.file?.document.settings.data).not.toHaveProperty('testDataset')
    expect(useToastStore().items.map((one) => `${one.tone}:${one.key}`)).toEqual([
      'caution:data.image.skipped',
    ])
    expect(panel.busy).toBe(false)
    const { writeProject } = await import('../src/project/format')
    await expect(writeProject(project.file!, '# x\n')).resolves.toBeDefined()
  })
})

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
 * **받을 수 없는 사진은 확인 창보다 먼저 거절한다** (결정문 65 "감사 뒤 더한 것"). 전에는
 * 실험이 있으면 "실험이 지워집니다"부터 물었고, 학생이 확인을 누른 뒤에야 거절을 읽었다.
 * 버튼도 잠그지 않는다 — 범주가 서기 전에도 누를 수 있고, 누르면 같은 판정으로 알린다.
 */
describe('decision 65: test photos are judged before the confirm dialog', () => {
  const cautions = () =>
    useToastStore()
      .items.filter((one) => one.tone === 'caution')
      .map((one) => one.key)

  it('a folder set that does not match is refused without asking', async () => {
    const { drop, panel, project } = await panelWithDropzone(true)
    await drop([photo('개', 'a.jpg'), photo('여우', 'b.jpg')])

    expect(panel.testAttaching, 'no confirm dialog for photos that cannot be used').toBe(false)
    expect(cautions()).toEqual(['client.TEST_IMAGES_CATEGORY_MISSING'])
    expect(bakers.workers).toHaveLength(0)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
  })

  /**
   * **빈 범주는 테스트 사진이 맞출 범주가 아니다** (결정 106 개정, 0.34.2 diff 감사 B-1). 올리기가 빈 범주까지 든 목록과 견주면 빈
   * 범주의 폴더를 요구하는데, 학습은 훈련 사진이 든 범주와 견줘 그렇게 받은 사진을 거절했다. 두 자리가 같은 목록을 부른다.
   */
  it('an empty category is not required in the test folders', async () => {
    const project = useProjectStore()
    await project.save(addCategory(imageDataProject(true), '여우', '2026-09-02T09:30:00.000Z'))
    const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.findAll('input[name="image-test-data-choice"]')[1]?.trigger('change')
    await flushPromises()
    wrapper
      .find('[class*="border-dashed"]')
      .element.dispatchEvent(dropEvent([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')]))
    await settle()

    expect(cautions(), 'the empty category must not be demanded').toEqual([])
    expect((wrapper.vm as unknown as PanelInternals).testAttaching).toBe(true)
    wrapper.unmount()
  })

  it('with no categories the buttons are not locked, and a drop says why', async () => {
    const project = useProjectStore()
    // 사진을 하나도 안 올린 프로젝트 — 범주가 아직 없다.
    const document = newProjectDocument(
      { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-09-02T08:00:00.000Z',
        randomState: 42,
      },
    )
    await project.save({
      document: { ...document, runs: { experiments: [experiment('experiment-1', [])] } },
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    })
    const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.findAll('input[name="image-test-data-choice"]')[1]?.trigger('change')
    await flushPromises()

    // 두 입구 다 — [폴더에서 추가]와 [압축 파일 선택].
    const buttons = wrapper
      .findAll('button')
      .filter((one) => one.text() === '폴더에서 추가' || one.text() === '압축 파일 선택')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) expect(button.attributes('disabled')).toBeUndefined()

    wrapper
      .find('[class*="border-dashed"]')
      .element.dispatchEvent(dropEvent([photo('개', 'a.jpg')]))
    await settle()
    const panel = wrapper.vm as unknown as PanelInternals
    expect(panel.testAttaching).toBe(false)
    expect(cautions()).toEqual(['client.TEST_IMAGES_NEED_CATEGORIES'])
    expect(bakers.workers).toHaveLength(0)

    // **단추를 눌러도 같은 판정으로 알린다** — 파일을 고르게 한 뒤에 거절하면 고른 시간을 버린다.
    // 숨은 파일 입력이 열리지 않아야 한다(열리면 `click`이 불린다).
    useToastStore().clear()
    const opened: string[] = []
    for (const input of wrapper.findAll('input[type="file"]')) {
      input.element.addEventListener('click', () => opened.push('picker'))
    }
    for (const button of buttons) {
      await button.trigger('click')
      await settle()
    }
    expect(cautions()).toEqual(['client.TEST_IMAGES_NEED_CATEGORIES'])
    expect(opened, 'the file picker opened before the refusal').toEqual([])
  })

  /**
   * **빈 범주만 있으면 범주가 없는 것과 같다** (결정 106 개정, 0.34.2 diff 재감사 C-6). 단추를 누를 때의 판정(`testBlock`)도 올리기와
   * 같은 목록(`trainedCategories`)을 봐야 한다 — 화면의 목록을 보면 빈 범주 둘이 "범주가 있다"로 읽혀 파일 고르기가 열리고, 고른
   * 뒤에야 거절당한다(`pickTest`가 막으려던 "고른 시간을 버린다").
   */
  it('with only empty categories the buttons say why before the picker opens', async () => {
    const project = useProjectStore()
    const document = newProjectDocument(
      { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-09-02T08:00:00.000Z',
        randomState: 42,
      },
    )
    const empty: ProjectFile = {
      document: { ...document, runs: { experiments: [experiment('experiment-1', [])] } },
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    const now = '2026-09-02T09:30:00.000Z'
    await project.save(addCategory(addCategory(empty, '개', now), '고양이', now))
    const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.findAll('input[name="image-test-data-choice"]')[1]?.trigger('change')
    await flushPromises()

    const opened: string[] = []
    for (const input of wrapper.findAll('input[type="file"]')) {
      input.element.addEventListener('click', () => opened.push('picker'))
    }
    const buttons = wrapper
      .findAll('button')
      .filter((one) => one.text() === '폴더에서 추가' || one.text() === '압축 파일 선택')
    expect(buttons).toHaveLength(2)
    for (const button of buttons) {
      await button.trigger('click')
      await settle()
    }
    expect(cautions()).toEqual(['client.TEST_IMAGES_NEED_CATEGORIES'])
    expect(opened, 'the file picker opened before the refusal').toEqual([])
    wrapper.unmount()
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

/**
 * **자리를 묻는 창에서 떠나도 아무것도 안 앉는다** (2026-09-02 R23 재감사 A-1).
 *
 * `alive()` 가드를 **읽기 뒤에만** 놓았더니 `hold()` 앞에 자리 묻기가 하나 더 있었고,
 * 그 창에서 떠나면 읽기 창과 똑같이 워커가 뜨고 프로젝트에 앉았다. **자리를 세는 처방은
 * 하나를 빠뜨린다** — 지금은 `hold()`가 떠난 뒤에 온 손잡이를 그 자리에서 끊는다.
 *
 * **워커가 뜨는 것 자체는 막지 않는다.** 뜨자마자 끊기므로 앉는 것이 없다.
 */
describe('R23: leaving while takeTest is asking for room', () => {
  it('nothing is seated after unmount, even though the worker spawned', async () => {
    const { project, wrapper, zone } = await panelWithDropzone()
    let release!: () => void
    room.gate = new Promise<void>((resolve) => {
      release = resolve
    })

    zone().element.dispatchEvent(dropEvent([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')]))
    await flushPromises()
    await flushPromises()

    wrapper.unmount()
    await flushPromises()
    release()
    await settle()

    // **워커가 답하게 만든다.** 안 그러면 `baking.result`가 영영 안 풀려 아무것도 안
    // 앉는 것이 당연해지고, 이 검사는 결함을 못 잡는다 — 처음에 그렇게 써서 안 울었다.
    const baked = ['개/a.jpg', '고양이/b.jpg'].map((name) => {
      const bytes = new TextEncoder().encode(`baked:${name}`)
      return { sourceName: name, hash: hashBytes(bytes), bytes }
    })
    bakers.workers[0]?.onmessage?.({
      data: { type: 'done', format: 'webp', images: baked, skipped: [] },
    } as unknown as MessageEvent<never>)
    await settle()

    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(project.file?.document.settings.split.method).not.toBe('provided')
    expect(useToastStore().items.filter((one) => one.tone === 'success')).toEqual([])
  })
})

/**
 * **굽는 동안 다른 프로젝트로 옮겨도 그쪽에 안 앉는다** (`stores/project.ts`의 `claim`).
 *
 * 앱에서는 `App.vue`의 화면 키가 옮기는 순간 이 판을 새로 띄운다(`project-switch-remount.spec.ts`).
 * 여기서는 판을 띄운 채 **스토어에 B를 앉혀** `alive`가 안 내려가는 틈 — 파일이 바뀐 뒤 판이
 * 내려가기 전 — 을 잰다. 앉으면 A의 테스트 사진이 B에 붙고 B의 실험이 지워진다
 * (`applyTestImages`).
 */
describe('switching project while test photos bake', () => {
  it('nothing lands on the other project and its experiments stay', async () => {
    const { project, drop } = await panelWithDropzone(false)
    await drop([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])
    expect(bakers.workers).toHaveLength(1)

    const other = imageDataProject(true)
    const otherId = '44444444-4444-4444-8444-444444444444'
    await project.save({
      ...other,
      document: {
        ...other.document,
        manifest: { ...other.document.manifest, projectId: otherId },
      },
    })
    expect(project.projectId).toBe(otherId)

    const baked = ['a.jpg', 'b.jpg'].map((name) => {
      const bytes = new TextEncoder().encode(`baked:${name}`)
      return { sourceName: name, hash: hashBytes(bytes), bytes }
    })
    bakers.workers[0]?.onmessage?.({
      data: { type: 'done', format: 'webp', images: baked, skipped: [] },
    } as unknown as MessageEvent<never>)
    await settle()

    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
  })
})
