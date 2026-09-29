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
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { readImages } from '../src/project/images'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import {
  dropEvent,
  imagePredictProject,
  withUsableModel,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'
import { resetDatabase } from './fixtures/database'

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

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')
const addButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.text() === '사진 추가')
const runButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.text().includes('예측'))

describe('R23: embed worker dies while predicting', () => {
  it('unlocks add/remove and the predict button, and tells', async () => {
    const project = useProjectStore()
    await project.save(withUsableModel(imagePredictProject(['a'])))
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
    // 모델이 하나 있으므로(`withUsableModel`) [예측하기]도 다시 열린다.
    expect(runButton(wrapper)?.text()).toBe('예측하기')
    expect(runButton(wrapper)?.attributes('disabled')).toBeUndefined()
    expect(dangers().map((one) => one.key)).toEqual(['client.BACKBONE_UNAVAILABLE'])
  })
})

/**
 * **[예측하기]는 백본을 받기 전에 거절한다** (결정문 65 "감사 뒤 더한 것"). 전에는 잠금만
 * 있었고 `run()`은 사진·모델을 안 봤다 — 잠금이 빠지면 백본 12.4MB를 받고 사진을 임베딩한 뒤
 * **답 없이 말없이** 끝났다. 이제 잠금과 같은 판정(`predictBlock`)으로 먼저 알린다.
 */
describe('decision 65: predicting with nothing to predict', () => {
  const cautions = () =>
    useToastStore()
      .items.filter((one) => one.tone === 'caution')
      .map((one) => one.key)

  async function pressed(file: ProjectFile): Promise<PanelInternals> {
    await useProjectStore().save(file)
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    // 잠금을 건너 직접 부른다.
    await panel.run()
    await settle()
    return panel
  }

  it('잠금을 건너 눌러도 모델이 없으면 백본을 받기 전에 이유를 알린다', async () => {
    const panel = await pressed(imagePredictProject(['a']))
    expect(cautions()).toEqual(['predict.image.noModel'])
    expect(workerState.embed, 'the backbone is not downloaded').toHaveLength(0)
    expect(panel.predicting).toBe(false)
  })

  it('잠금을 건너 눌러도 사진이 없으면 이유를 알린다', async () => {
    const panel = await pressed(withUsableModel(imagePredictProject([])))
    // **다음에 할 일까지 한 문장이다** (결정문 65 "거절 알림은 다음에 할 일까지 말한다").
    expect(cautions()).toEqual(['predict.image.emptyRefused'])
    expect(workerState.embed).toHaveLength(0)
    expect(panel.predicting).toBe(false)
  })
})

/**
 * **[예측하기]는 모델이 없는 상태에서도 서 있고, 누르면 답한다** (구조 뒤 감사 B-4, 결정문 65
 * "구조 뒤 감사에서 더한 것"). `v-if`로 감추면 위의 검사는 전부 초록이다 — 전부 `run()`을 직접
 * 부르기 때문이다. 단추를 **찾아서 누른다.** 잠금은 진행 중뿐이라 모델이 없어도 잠겨 있지 않다.
 */
describe('decision 65: the predict button stands with no model', () => {
  const cautions = () =>
    useToastStore()
      .items.filter((one) => one.tone === 'caution')
      .map((one) => one.key)

  for (const [name, file, key] of [
    ['photos but no model', () => imagePredictProject(['a']), 'predict.image.noModel'],
    [
      'a model but no photo',
      () => withUsableModel(imagePredictProject([])),
      'predict.image.emptyRefused',
    ],
  ] as const) {
    it(`${name}: the button is there, pressable, and says why`, async () => {
      await useProjectStore().save(file())
      const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
      await flushPromises()
      const button = runButton(wrapper)
      expect(button?.exists(), 'the button is hidden').toBe(true)
      expect(button?.attributes('disabled'), 'the button is locked').toBeUndefined()
      await button?.trigger('click')
      await settle()
      expect(cautions()).toEqual([key])
      expect(workerState.embed, 'the backbone is not downloaded').toHaveLength(0)
    })
  }
})

describe('R23: removing a photo releases its job', () => {
  it('busy goes back to false after removeOne', async () => {
    const project = useProjectStore()
    await project.save(withUsableModel(imagePredictProject(['a', 'b'])))
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
    await project.save(withUsableModel(imagePredictProject(['a'])))
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
 * **전부 건너뛰면 저장하지 않는다** (2026-09-28 감사 A-1). 앉히면 사진 없는 예측 참조가 남아
 * 내보내기와 다시 열기가 둘 다 막혔다.
 */
describe('A-1: every predict photo is skipped', () => {
  it('예측 사진이 전부 건너뛰면 저장하지 않는다', async () => {
    const project = useProjectStore()
    await project.save(withUsableModel(imagePredictProject([])))
    const before = project.file
    // **저장을 부르지 않는 것까지 본다.** `addImages`가 빈 목록에 참조를 안 세우므로 파일만
    // 보면 화면의 거름이 빠져도 초록이다 — 그때는 답이 지워지고 쓰기가 한 번 돈다.
    const saving = vi.spyOn(project, 'save')
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([new File([new Uint8Array([9])], 'IMG_1.HEIC')]))
    await flushPromises()
    await tick()
    await flushPromises()
    expect(bakers.workers).toHaveLength(1)
    bakers.workers[0]?.onmessage?.({
      data: { type: 'done', format: 'webp', images: [], skipped: [{ sourceName: 'IMG_1.HEIC' }] },
    } as unknown as MessageEvent<never>)
    await settle()

    expect(saving, 'the panel must not save').not.toHaveBeenCalled()
    expect(project.file, 'nothing may be written').toBe(before)
    expect(project.file?.document.settings.data).not.toHaveProperty('predictDataset')
    expect(useToastStore().items.map((one) => `${one.tone}:${one.key}`)).toEqual([
      'caution:data.image.skipped',
    ])
    expect(panel.busy).toBe(false)
    const { writeProject } = await import('../src/project/format')
    await expect(writeProject(project.file!, '# x\n')).resolves.toBeDefined()
    wrapper.unmount()
  })
})

/**
 * **굽거나 뽑는 동안 다른 프로젝트로 옮겨도 그쪽에 안 앉는다** (`stores/project.ts`의 `claim`).
 *
 * 앱에서는 `App.vue`의 화면 키가 옮기는 순간 이 판을 새로 띄운다(`project-switch-remount.spec.ts`).
 * 여기서는 판을 띄운 채 **스토어에 B를 앉혀** `alive`가 안 내려가는 틈 — 파일이 바뀐 뒤 판이
 * 내려가기 전 — 을 잰다. 그 틈을 지키는 것이 `claim`이다.
 */
describe('switching project while a predict job runs', () => {
  const OTHER_ID = '55555555-5555-4555-8555-555555555555'

  async function switchTo(seeds: readonly string[]): Promise<void> {
    const other = withUsableModel(imagePredictProject(seeds))
    const { manifest } = other.document
    await useProjectStore().save({
      ...other,
      document: { ...other.document, manifest: { ...manifest, projectId: OTHER_ID } },
    })
    expect(useProjectStore().projectId).toBe(OTHER_ID)
  }

  it('baked photos do not land on the other project', async () => {
    const project = useProjectStore()
    await project.save(withUsableModel(imagePredictProject(['a'])))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([new File([new Uint8Array([9])], 'late.jpg', { type: 'image/jpeg' })]))
    await flushPromises()
    await tick()
    await flushPromises()
    expect(bakers.workers).toHaveLength(1)

    await switchTo(['b', 'c'])
    const bytes = new TextEncoder().encode('baked:late.jpg')
    bakers.workers[0]?.onmessage?.({
      data: {
        type: 'done',
        format: 'webp',
        images: [{ sourceName: 'late.jpg', hash: hashBytes(bytes), bytes }],
        skipped: [],
      },
    } as unknown as MessageEvent<never>)
    await settle()

    expect(readImages(project.file, 'predict')).toHaveLength(2)
    wrapper.unmount()
  })

  it('embeddings do not land on the other project', async () => {
    const project = useProjectStore()
    await project.save(withUsableModel(imagePredictProject(['a'])))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)

    await switchTo(['b'])
    const before = project.file?.embeddings.size
    workerState.embed[0]?.deliver()
    await running
    await settle()

    expect(project.file?.embeddings.size).toBe(before)
    wrapper.unmount()
  })
})

/**
 * **읽는 동안 떠나면 아무것도 안 앉는다** (architecture.md §8.10.4, 2026-09-02 R23 B-2).
 * 전처리 화면과 같은 병이고 자리만 예측이다.
 */
describe('R23: leaving while the zip is still being read', () => {
  it('nothing is spawned or seated after unmount', async () => {
    const project = useProjectStore()
    await project.save(withUsableModel(imagePredictProject(['a'])))
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

/**
 * **모르는 백본을 가리키는 파일에서 말없이 돌아가지 않는다** (2026-09-02 R23 B-3).
 *
 * `backboneId`는 스키마가 `z.string()`이라 등록부에 없는 값도 열린다. 그때 사진을 놓거나
 * [예측하기]를 눌러도 **워커 0 · 알림 0 · `busy` false**였다 — 버튼이 고장난 것으로
 * 읽힌다. 학습·전처리·데이터 화면은 셋 다 이 코드를 띄운다.
 */
describe('R23: the file points at a backbone this app does not know', () => {
  it('drop and predict both tell the student', async () => {
    const project = useProjectStore()
    const seed = withUsableModel(imagePredictProject(['a']))
    const settings = seed.document.settings as unknown as { data: { backboneId: string } }
    settings.data.backboneId = 'backbone-from-the-future'
    await project.save(seed)
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([new File([new Uint8Array([9])], 'late.jpg', { type: 'image/jpeg' })]))
    await settle()
    expect(useToastStore().items.map((one) => one.key)).toEqual(['client.BACKBONE_UNAVAILABLE'])

    useToastStore().clear()
    await panel.run()
    await settle()
    expect(useToastStore().items.map((one) => one.key)).toEqual(['client.BACKBONE_UNAVAILABLE'])
    expect(bakers.workers).toHaveLength(0)
    expect(panel.busy).toBe(false)
    expect(panel.predicting).toBe(false)

    wrapper.unmount()
  })
})
