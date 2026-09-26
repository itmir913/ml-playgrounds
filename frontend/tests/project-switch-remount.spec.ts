// @vitest-environment jsdom
/**
 * **단계는 같고 프로젝트만 다른 이동은 화면을 새로 띄운다** (`open-decisions.md` "같은 라우트
 * 레코드 안에서 프로젝트를 옮기면 화면을 어떻게 할 것인가", `architecture.md` §8.2).
 *
 * `/project/A/<단계>` → `/project/B/<단계>`는 같은 라우트 레코드다. `App.vue`가 `RouterView`에
 * 프로젝트 id를 키로 주지 않으면 vue-router가 화면을 다시 쓰고, A에서 세운 초안과 도는 일이
 * B의 화면에 남는다. 여기서는 **진짜 `App.vue`와 진짜 라우터**로 옮기고 판마다 그 초안이
 * B에 안 남는지, 남았던 초안이 B에 안 앉는지를 본다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'

import App from '../src/App.vue'
import { hashBytes } from '../src/hash'
import { DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages, imageCategories, readImages } from '../src/project/images'
import { dataSettings, type Experiment } from '../src/project/schema'
import { closeStorage, DB_NAME, loadProject, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import TabularPredictPanel from '../src/views/predict/TabularPredictPanel.vue'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import {
  dropEvent,
  HARNESS_BACKBONE,
  resetImageWorkers,
  stubDialogElement,
  stubObjectUrls,
  workerState,
} from './fixtures/image-workers'
import { experiment } from './fixtures/project'
import { irisProject, trainedIrisProject } from './fixtures/trained'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return { spawnEmbedWorker: fakeEmbedWorker }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

const FIRST_ID = '11111111-1111-4111-8111-111111111111'
const SECOND_ID = '22222222-2222-4222-8222-222222222222'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
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

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  stubObjectUrls()
  window.scrollTo = () => {}
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  await setLocale('ko')
})

/** 띄운 앱. **실패한 판도 치운다** — 남으면 다음 판이 옛 앱과 옛 라우트 위에서 시작한다. */
const mounted: VueWrapper[] = []

afterEach(async () => {
  await router.push('/')
  await settle()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

function withId(file: ProjectFile, projectId: string): ProjectFile {
  const { manifest } = file.document
  return { ...file, document: { ...file.document, manifest: { ...manifest, projectId } } }
}

/** 범주 폴더에 든 사진 한 장. 범주는 폴더 이름에서 나온다 (`data/image/upload.ts`). */
function photo(category: string, name: string): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'webkitRelativePath', { value: `${category}/${name}` })
  return file
}

/**
 * 사진 프로젝트의 실험 하나. **기록의 `data`가 사진의 모양이어야** 파일이 열린다 — 표의
 * 모양이면 `PROJECT_FILE_INVALID`로 목록에 돌아간다.
 */
function imageExperiment(): Experiment {
  const base = experiment('experiment-1', [])
  return {
    ...base,
    settings: {
      ...base.settings,
      selectedAlgorithms: [{ algorithm: 'decision_tree', runtime: 'mljs' }],
      data: {
        categories: ['개', '고양이'],
        backboneId: DEFAULT_BACKBONE_ID,
        categoryCounts: [2, 2],
        unlabeledCount: 0,
      },
    },
  }
}

/** `개`·`고양이` 사진 넷이 든 분류 프로젝트. */
function imageProject(projectId: string, withExperiment: boolean): ProjectFile {
  const backbone = HARNESS_BACKBONE
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    { projectId, createdAt: '2026-09-26T08:00:00.000Z', randomState: 42 },
  )
  const empty: ProjectFile = {
    document: withExperiment
      ? { ...document, runs: { experiments: [imageExperiment()] } }
      : document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    ['개', '개', '고양이', '고양이'].map((category, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${projectId}:${category}:${index}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-26T09:00:00.000Z', format: 'webp' },
  ).project
}

function emptyTabularProject(projectId: string): ProjectFile {
  const document = newProjectDocument(
    { name: '표 프로젝트', locale: 'ko', dataType: 'tabular' },
    { projectId, createdAt: '2026-09-26T08:00:00.000Z', randomState: 42 },
  )
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

function csv(name: string): File {
  return new File(['a,b\n1,2\n3,4\n'], name, { type: 'text/csv' })
}

/**
 * 판이 설 때까지 기다린다. **판은 지연 로딩이다** (`data/kinds.ts`) — 처음 받는 판은 틱 몇
 * 번으로 안 선다.
 */
async function waitFor(check: () => boolean): Promise<void> {
  for (let round = 0; round < 100 && !check(); round += 1) await settle()
  expect(check()).toBe(true)
}

/** 진짜 `App.vue`를 띄우고 A의 그 단계로 간다. `panel`이 설 때까지 기다린다. */
async function openApp(first: ProjectFile, second: ProjectFile, step: string, panel: Component) {
  await saveProject(withId(first, FIRST_ID))
  await saveProject(withId(second, SECOND_ID))
  const wrapper = mount(App, { global: { plugins: [i18n, router] } })
  mounted.push(wrapper)
  await router.push('/')
  await router.isReady()
  await router.push(`/project/${FIRST_ID}/${step}`)
  await waitFor(() => wrapper.findComponent(panel).exists())
  expect(useProjectStore().projectId).toBe(FIRST_ID)
  const switchToSecond = async (): Promise<void> => {
    await router.push(`/project/${SECOND_ID}/${step}`)
    await settle()
    await waitFor(() => wrapper.findComponent(panel).exists())
    expect(useProjectStore().projectId).toBe(SECOND_ID)
  }
  return { wrapper, switchToSecond }
}

/** 떠 있는 대화상자. 닫힌 `<dialog>`도 DOM에 남으므로 `open`으로 가른다. */
function openDialogs(wrapper: VueWrapper): number {
  return wrapper.findAll('dialog').filter((one) => (one.element as HTMLDialogElement).open).length
}

/** 판 안쪽. **떠난 판과 새로 뜬 판을 가르는 것이 이 값들이다.** */
interface ImagePrepInternals {
  busy: boolean
  pendingTest: unknown
  testAttaching: boolean
  manualTestChoice: unknown
}

describe('전처리(이미지) — 테스트 사진', { timeout: 30_000 }, () => {
  async function prepApp(firstHasExperiment: boolean, secondHasExperiment: boolean) {
    const opened = await openApp(
      imageProject(FIRST_ID, firstHasExperiment),
      imageProject(SECOND_ID, secondHasExperiment),
      'preprocess',
      ImagePrepPanel,
    )
    const panel = () => opened.wrapper.findComponent(ImagePrepPanel)
    await panel().findAll('input[name="image-test-data-choice"]')[1]?.trigger('change')
    await settle()
    const zone = () => panel().find('[class*="border-dashed"]')
    expect(zone().exists()).toBe(true)
    const internals = () => panel().vm as unknown as ImagePrepInternals
    return { ...opened, panel, zone, internals }
  }

  /** 읽기 구간에서 옮기면 A에 놓은 zip이 B의 테스트 사진이 되지 않는다. */
  it('zip을 읽는 동안 옮기면 B에 테스트 사진이 안 앉는다', async () => {
    const { zone, internals, switchToSecond } = await prepApp(false, false)
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
    expect(internals().busy).toBe(true)

    await switchToSecond()
    release()
    await settle()

    expect(workerState.baked).toBe(0)
    const second = useProjectStore().file
    expect(readImages(second, 'test')).toHaveLength(0)
    expect(second?.document.settings.split.method).not.toBe('provided')
    expect(readImages(await loadProject(SECOND_ID), 'test')).toHaveLength(0)
    expect(internals().busy).toBe(false)
  })

  /** 확인 창에 든 사진과 고른 ②가 B의 판에 안 남는다. */
  it('확인을 기다리는 사진과 ② 선택이 B에 안 남는다', async () => {
    const { wrapper, zone, internals, switchToSecond } = await prepApp(true, true)
    zone().element.dispatchEvent(dropEvent([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')]))
    await settle()
    expect(internals().testAttaching).toBe(true)
    expect(internals().pendingTest).not.toBeNull()
    expect(internals().manualTestChoice).toBe('provided')

    await switchToSecond()

    expect(internals().testAttaching).toBe(false)
    expect(internals().pendingTest).toBeNull()
    expect(internals().manualTestChoice).toBeNull()
    expect(openDialogs(wrapper)).toBe(0)
    const second = useProjectStore().file
    expect(readImages(second, 'test')).toHaveLength(0)
    expect(second?.document.runs.experiments).toHaveLength(1)
  })

  /** A에서 굽던 것이 옮기는 순간 끊기고, B의 판은 잠기지 않는다. */
  it('굽는 동안 옮기면 굽기가 끊기고 B의 판이 안 잠긴다', async () => {
    const { zone, internals, switchToSecond } = await prepApp(false, false)
    workerState.holdBake = true
    zone().element.dispatchEvent(dropEvent([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')]))
    await settle()
    expect(workerState.baked).toBe(1)
    expect(internals().busy).toBe(true)

    await switchToSecond()

    expect(workerState.terminated.bake).toBe(1)
    expect(internals().busy).toBe(false)
    workerState.bake[0]?.deliver()
    await settle()
    expect(readImages(useProjectStore().file, 'test')).toHaveLength(0)
  })
})

describe('데이터(이미지) — 확인 판의 묶음', { timeout: 30_000 }, () => {
  /** A에서 세운 `강아지` 묶음이 B의 판에 안 서고, 그래서 B에 안 구워진다. */
  it('확인 판에 세운 묶음이 B에 안 남는다', async () => {
    const { wrapper, switchToSecond } = await openApp(
      imageProject(FIRST_ID, false),
      imageProject(SECOND_ID, false),
      'data',
      ImagePanel,
    )
    const panel = () => wrapper.findComponent(ImagePanel)
    panel()
      .find('[class*="min-h-full"]')
      .element.dispatchEvent(dropEvent([photo('강아지', 'x.jpg'), photo('강아지', 'y.jpg')]))
    await settle()
    const pending = () => (panel().vm as unknown as { pending: unknown }).pending
    expect(pending()).not.toBeNull()

    await switchToSecond()

    expect(pending()).toBeNull()
    expect(workerState.baked).toBe(0)
    expect(imageCategories(useProjectStore().file)).not.toContain('강아지')
  })
})

describe('데이터(표) — 판에 올린 파일', { timeout: 30_000 }, () => {
  /** A에서 연 `fromA.csv`가 B의 판에 안 서고, 그래서 B의 정본이 되지 않는다. */
  it('판에 올린 표가 B에 안 남는다', async () => {
    const { wrapper, switchToSecond } = await openApp(
      emptyTabularProject(FIRST_ID),
      emptyTabularProject(SECOND_ID),
      'data',
      TabularPanel,
    )
    const panel = () => wrapper.findComponent(TabularPanel)
    panel()
      .find('[class*="min-h-full"]')
      .element.dispatchEvent(dropEvent([csv('fromA.csv')]))
    await settle()
    const opened = () => (panel().vm as unknown as { opened: unknown }).opened
    expect(opened()).not.toBeNull()

    await switchToSecond()

    expect(opened()).toBeNull()
    expect(wrapper.text()).not.toContain('fromA.csv')
    const second = useProjectStore().file
    expect(second ? dataSettings('tabular', second.document.settings).dataset : null).toBeFalsy()
  })
})

describe('전처리(표) — 테스트 표', { timeout: 30_000 }, () => {
  /** `openedTest`. A에서 연 테스트 표가 B의 판에 안 선다. */
  it('판에 올린 테스트 표가 B에 안 남는다', async () => {
    const { wrapper, switchToSecond } = await openApp(
      await irisProject(['decision_tree']),
      await irisProject(['decision_tree']),
      'preprocess',
      TabularPrepPanel,
    )
    const panel = () => wrapper.findComponent(TabularPrepPanel)
    await panel().findAll('input[name="test-data-choice"]')[1]?.trigger('change')
    await settle()
    const zone = panel().find('[class*="ml-6"][class*="flex-col"]')
    expect(zone.exists()).toBe(true)
    zone.element.dispatchEvent(dropEvent([csv('testFromA.csv')]))
    await settle()
    const openedTest = () => (panel().vm as unknown as { openedTest: unknown }).openedTest
    expect(openedTest()).not.toBeNull()

    await switchToSecond()

    expect(openedTest()).toBeNull()
    expect(wrapper.text()).not.toContain('testFromA.csv')
    const second = useProjectStore().file
    expect(
      second ? dataSettings('tabular', second.document.settings).testDataset : null,
    ).toBeFalsy()
  })
})

describe('예측(표) — 일괄 예측 파일', { timeout: 60_000 }, () => {
  /** `BatchPredict`의 `opened`. A에서 연 예측 파일이 B의 판에 안 선다. */
  it('판에 올린 예측 파일이 B에 안 남는다', async () => {
    const { wrapper, switchToSecond } = await openApp(
      await trainedIrisProject(['decision_tree']),
      await trainedIrisProject(['decision_tree']),
      'predict',
      TabularPredictPanel,
    )
    await wrapper.findAll('input[name="predict-input-mode"]')[1]?.trigger('change')
    await settle()
    const batch = () => wrapper.findComponent(BatchPredict)
    expect(batch().exists()).toBe(true)
    batch()
      .find('[class*="border-dashed"]')
      .element.dispatchEvent(dropEvent([csv('predictA.csv')]))
    await settle()
    expect((batch().vm as unknown as { opened: unknown }).opened).not.toBeNull()

    await switchToSecond()

    // 새 판은 값 입력으로 선다. 파일 판이 서 있다면 그것은 A의 판이다.
    expect(batch().exists()).toBe(false)
    expect(wrapper.text()).not.toContain('predictA.csv')
    const second = useProjectStore().file
    expect(second?.document.settings.data.predictDataset).toBeUndefined()
  })
})
