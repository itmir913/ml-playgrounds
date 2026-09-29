// @vitest-environment jsdom
/**
 * **`.mlpx` 엔트리 수 한계는 진짜 입구에서 막는다** (open-decisions.md ".mlpx 한 파일의
 * 엔트리 수는 ZIP64 없이 쓸 수 있는 만큼이다").
 *
 * 세는 판정은 `archive-entry-limit.spec.ts`가 함수로 잰다. 여기서는 **입구마다 그 판정을
 * 부르는가**를 화면을 지나 본다 — 사진 추가(훈련·테스트·예측)와 포트폴리오 첨부다.
 *
 * **한계는 실제 값 그대로다.** `limits.ts`를 갈아 끼우면 먼저 읽힌 모듈이 진짜 값을 쥔 채라
 * 입구가 그 가짜를 못 본다(해 보니 그랬다). 그래서 **다른 자리의 사진으로 한계 바로 아래까지
 * 채운다** — 한 장이 둘(정본 + 임베딩)을 늘리므로 다음 한 장이 넘는다. 자리마다의 장수 상한은
 * 이 검사의 주제가 아니라 풀어 둔다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { MAX_ARCHIVE_ENTRIES } from '../src/limits'
import { newProjectDocument } from '../src/project/create'
import { BACKBONES } from '../src/ml/backbones'
import { embeddingPath } from '../src/project/embeddings'
import {
  archiveEntryCount,
  archiveEntryParts,
  IMAGE_PREDICT_DIR,
  IMAGE_TEST_DIR,
  type ProjectFile,
} from '../src/project/format'
import { addImages, readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import PortfolioView from '../src/views/PortfolioView.vue'
import SectionCard from '../src/views/portfolio/SectionCard.vue'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import {
  dropEvent,
  HARNESS_BACKBONE,
  imagePredictProject,
  resetImageWorkers,
  stubDialogElement,
  stubObjectUrls,
  workerState,
} from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

vi.mock('../src/limits-switch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/limits-switch')>()
  return { ...actual, maxImageCount: () => Number.POSITIVE_INFINITY }
})

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

// 자리 판정은 이 검사의 주제가 아니다.
vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

/** 첨부 굽기는 jsdom에 없다(캔버스가 없다) — 한 장씩 구워진 것으로 둔다. */
vi.mock('../src/project/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/attachments')>()
  return {
    ...actual,
    bakeAttachments: async (files: readonly File[]) =>
      files.map(() => ({
        bytes: new Uint8Array([1, 2, 3]),
        extension: '.webp',
        mime: 'image/webp',
      })),
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

const refusals = () =>
  useToastStore()
    .items.map((one) => one.key)
    .filter((key) => key === 'client.PROJECT_FILE_TOO_MANY_ENTRIES')

const file = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

function labeled(category: string, name: string): File {
  const one = file(name)
  Object.defineProperty(one, 'webkitRelativePath', { value: `${category}/${name}` })
  return one
}

/** 범주 둘에 두 장씩. 학습 유형까지 정해 두어 전처리 화면이 테스트 사진을 받는다. */
function imageDataProject(): ProjectFile {
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
    document,
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

/** 한 장이 다 붙은 뒤 차지하는 엔트리 — 정본 하나와 백본마다 임베딩 하나. */
const PER_PHOTO = 1 + BACKBONES.length

/** 사진 입구가 세는 수 — 이미 있는 사진도 임베딩이 다 붙은 것으로 센다(`requireRoomForPhotos`). */
function projected(project: ProjectFile): number {
  const { total, images, embeddings } = archiveEntryParts(project)
  return total - images - embeddings + images * PER_PHOTO
}

/**
 * **`room`개 모자라게** 다른 자리의 사진으로 채운다. 이름은 해시 모양의 가짜다 — 굽지 않고
 * 세기만 한다. 채우는 사진마다 임베딩도 붙여 지금 수와 입구가 세는 수를 같게 두고, 한 장의 몫으로
 * 안 나눠떨어지는 나머지는 가리키는 첨부(한 엔트리)로 채운다. 참조도 함께 세운다.
 */
function filled(project: ProjectFile, role: 'test' | 'predict', room = 1): ProjectFile {
  const directory = role === 'test' ? `${IMAGE_TEST_DIR}개/` : IMAGE_PREDICT_DIR
  const field = role === 'test' ? 'testDataset' : 'predictDataset'
  const need = MAX_ARCHIVE_ENTRIES - room - projected(project)
  const images = new Map(project.images)
  const embeddings = new Map(project.embeddings)
  const attachments = new Map(project.attachments)
  const bytes = new Uint8Array([7])
  for (let index = 0; index < Math.floor(need / PER_PHOTO); index += 1) {
    const hash = index.toString(16).padStart(64, '0')
    images.set(`${directory}${hash}.webp`, bytes)
    for (const backbone of BACKBONES) embeddings.set(embeddingPath(backbone.id, hash), bytes)
  }
  const extra: string[] = []
  for (let index = 0; index < need % PER_PHOTO; index += 1) {
    const path = `portfolio/attachments/filler-${index}.webp`
    attachments.set(path, bytes)
    extra.push(path)
  }
  const portfolio = project.document.portfolio
  const result: ProjectFile = {
    ...project,
    document: {
      ...project.document,
      settings: {
        ...project.document.settings,
        data: {
          ...project.document.settings.data,
          [field]: {
            path: role === 'test' ? IMAGE_TEST_DIR : IMAGE_PREDICT_DIR,
            canonicalSize: 224,
            format: 'webp',
            quality: 0.65,
          },
        },
      },
      portfolio:
        extra.length === 0
          ? portfolio
          : { ...portfolio, attachments: { ...portfolio.attachments, filler: extra } },
    },
    images,
    embeddings,
    attachments,
  }
  expect(projected(result)).toBe(MAX_ARCHIVE_ENTRIES - room)
  return result
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
  stubObjectUrls()
  await setLocale('ko')
})

afterEach(async () => {
  useProjectStore().close()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

describe('사진 추가 — 굽기 전에 막는다', { timeout: 60_000 }, () => {
  it('훈련 사진: 판에 세우지 않고 말한다', async () => {
    useProjectStore().file = filled(imagePredictProject([]), 'test')
    const wrapper = mount(ImagePanel, { props: { accept: 'image/*' }, global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as { onDrop: (event: Event) => void; pending: unknown }

    panel.onDrop(dropEvent([file('a.jpg')]))
    await settle()

    expect(panel.pending).toBeNull()
    expect(refusals()).toHaveLength(1)
    wrapper.unmount()
  })

  it('테스트 사진: 굽지 않고 말한다', async () => {
    const project = useProjectStore()
    project.file = filled(imageDataProject(), 'predict')
    const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.findAll('input[name="image-test-data-choice"]')[1]?.trigger('change')
    await flushPromises()

    wrapper
      .find('[class*="border-dashed"]')
      .element.dispatchEvent(dropEvent([labeled('개', 'a.jpg'), labeled('고양이', 'b.jpg')]))
    await settle()

    expect(workerState.baked).toBe(0)
    expect(readImages(project.file, 'test')).toHaveLength(0)
    expect(refusals()).toHaveLength(1)
    wrapper.unmount()
  })

  it('예측 사진: 굽지 않고 말한다', async () => {
    const project = useProjectStore()
    project.file = filled(imagePredictProject(['a']), 'test')
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as { onDrop: (event: Event) => void }

    panel.onDrop(dropEvent([file('b.jpg')]))
    await settle()

    expect(workerState.baked).toBe(0)
    expect(readImages(project.file, 'predict')).toHaveLength(1)
    expect(refusals()).toHaveLength(1)
    wrapper.unmount()
  })

  /** 한계에 두 엔트리 남았다 — 한 장이 딱 들어간다. 경계가 한 칸 어긋나면 운다. */
  it('한계에 딱 맞는 한 장은 받는다 - 훈련 사진이 판에 선다', async () => {
    useProjectStore().file = filled(imagePredictProject([]), 'test', 2)
    const wrapper = mount(ImagePanel, { props: { accept: 'image/*' }, global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as { onDrop: (event: Event) => void; pending: unknown }

    panel.onDrop(dropEvent([file('a.jpg')]))
    await settle()

    expect(panel.pending).not.toBeNull()
    expect(refusals()).toEqual([])
    wrapper.unmount()
  })

  /**
   * **굽기 직전에 다시 센다** (검토 C-1, architecture.md §8.10.4). 굽는 동안 놓은 둘째 묶음은 **앞
   * 묶음이 아직 안 앉은 수**로 받을 때의 확인을 지난다. 두 장 자리만 남긴 채 한 장을 굽는 동안 두
   * 장을 더 놓으면, 받을 때는 통과하고 앞 한 장이 앉은 뒤 [이 사진 사용]에서 막혀야 한다.
   */
  it('굽는 동안 놓은 둘째 묶음은 굽기 직전에 막힌다', async () => {
    const project = useProjectStore()
    await project.save(filled(imagePredictProject([]), 'test', 2 * PER_PHOTO))
    const wrapper = mount(ImagePanel, { props: { accept: 'image/*' }, global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as {
      onDrop: (event: Event) => void
      bake: () => Promise<void>
      pending: readonly { path: string }[] | null
    }

    panel.onDrop(dropEvent([file('a.jpg')]))
    await settle()
    workerState.holdBake = true
    const baking = panel.bake()
    await flushPromises()
    expect(workerState.baked).toBe(1)

    // 앞 한 장이 아직 안 앉았다 — 두 장은 받을 때의 확인을 지난다.
    panel.onDrop(dropEvent([file('b.jpg'), file('c.jpg')]))
    await settle()
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg', 'c.jpg'])
    expect(refusals()).toEqual([])

    workerState.bake[0]?.deliver()
    await baking
    await settle()
    expect(readImages(project.file)).toHaveLength(1)

    workerState.holdBake = false
    await panel.bake()
    await settle()

    expect(workerState.baked).toBe(1)
    expect(readImages(project.file)).toHaveLength(1)
    expect(refusals()).toHaveLength(1)
    wrapper.unmount()
  })
})

describe('포트폴리오 첨부', { timeout: 60_000 }, () => {
  /** 문항 하나짜리 포트폴리오를 단 이미지 프로젝트. */
  function withSection(project: ProjectFile): ProjectFile {
    return {
      ...project,
      document: { ...project.document, portfolio: projectFile().document.portfolio },
    }
  }

  async function attach(files: readonly File[]) {
    const view = mount(PortfolioView, { global: { plugins: [i18n] } })
    view.findComponent(SectionCard).vm.$emit('attach', files)
    await settle()
    return view
  }

  // 첨부 한 장은 엔트리 하나다 — 한계와 **같게** 채워야 넘는다. 첨부는 **구운 뒤, 붙이기 전**에 센다.
  it('한계를 넘기는 첨부는 붙이지 않고 말한다', async () => {
    const start = filled(withSection(imagePredictProject([])), 'predict', 0)
    expect(archiveEntryCount(start)).toBe(MAX_ARCHIVE_ENTRIES)
    useProjectStore().file = start

    const view = await attach([file('a.png')])

    expect(useProjectStore().file?.attachments.size).toBe(start.attachments.size)
    expect(refusals()).toHaveLength(1)
    view.unmount()
  })

  it('한계에 딱 맞는 첨부는 붙인다', async () => {
    const start = filled(withSection(imagePredictProject([])), 'predict', 1)
    expect(archiveEntryCount(start)).toBe(MAX_ARCHIVE_ENTRIES - 1)
    useProjectStore().file = start

    const view = await attach([file('a.png')])

    expect(useProjectStore().file?.attachments.size).toBe(start.attachments.size + 1)
    expect(refusals()).toEqual([])
    view.unmount()
  })

  /**
   * **글을 칠 때는 세지 않는다** (검토 C-2, `PortfolioView.vue`의 `apply`). 성능 조건이다 — 사진 수천
   * 장을 한 글자마다 세면 교실 PC에서 타자가 끊긴다. 사진 맵을 읽은 횟수로 잰다. 탐침이 도는지는
   * 첨부를 붙여(바이트가 바뀌어) 세는 쪽으로 확인한다.
   */
  it('글을 칠 때는 사진을 세지 않는다', async () => {
    class CountingMap extends Map<string, Uint8Array> {
      reads = 0;
      override [Symbol.iterator]() {
        this.reads += 1
        return super[Symbol.iterator]()
      }
      override keys() {
        this.reads += 1
        return super.keys()
      }
      override entries() {
        this.reads += 1
        return super.entries()
      }
    }
    const base = withSection(imagePredictProject(['a', 'b']))
    const images = new CountingMap(base.images)
    useProjectStore().file = { ...base, images }
    const view = mount(PortfolioView, { global: { plugins: [i18n] } })
    await settle()

    images.reads = 0
    const box = view.find('textarea')
    ;(box.element as HTMLTextAreaElement).value = '꽃이 좋아서 골랐다'
    await box.trigger('input')
    expect(images.reads, 'typing counts the photos').toBe(0)

    view.findComponent(SectionCard).vm.$emit('attach', [file('a.png')])
    await settle()
    expect(images.reads, 'the probe sees an attachment being counted').toBeGreaterThan(0)
    view.unmount()
  })
})
