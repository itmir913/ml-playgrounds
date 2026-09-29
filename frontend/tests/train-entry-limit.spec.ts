// @vitest-environment jsdom
/**
 * **[학습하기]도 시작하기 전에 엔트리 수를 센다** (open-decisions.md ".mlpx 한 파일의 엔트리 수는
 * ZIP64 없이 쓸 수 있는 만큼이다"의 코드 소유자 후속).
 *
 * 실험 하나는 모델마다 하나와 전처리기 하나를 파일에 더한다. 전에는 학습 입구가 그것을 안 세서, 한계
 * 바로 아래의 프로젝트가 백본을 받고 학습을 다 마친 뒤에야 내보내기에서 던졌다. 여기가 보는 것은
 * 진짜 입구(버튼)다 — 넘으면 **아무것도 시작하지 않고**(백본도 안 받는다) 알림과 동작 바의 실패 줄로
 * 말하고, 딱 맞으면 지금처럼 시작한다.
 *
 * **한계는 줄이지 않는다.** `limits.ts`를 흉내 내 보았으나 jsdom 스펙은 준비 파일(`tests/setup/lock-net.ts`)이
 * 등록부를 먼저 들여 `project/format.ts`가 진짜 값을 쥔 채였다 — 그래서 열린 프로젝트에 사진을 한계
 * 근처까지 **메모리로만** 더하고(저장소에는 넷뿐이다) 버튼을 누른다. 셈의 경계와 실제 학습과의 짝은
 * `archive-entry-limit.spec.ts`의 *"학습은 시작하기 전에 막는다"*가 잰다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

import { imageEntryPath } from '../src/data/image/canonical'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { MAX_ARCHIVE_ENTRIES } from '../src/limits'
import { backboneFor, BACKBONES, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import type { TrainWorker } from '../src/ml/worker/client'
import type { WorkerRequest } from '../src/ml/worker/protocol'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useToastStore } from '../src/stores/toasts'
import { useProjectStore } from '../src/stores/project'
import { resetImageWorkers, stubDialogElement, workerState } from './fixtures/image-workers'

/**
 * 사진 넷과 모델 셋인 프로젝트를 학습하면 담기는 수 — 문서 여섯, 사진마다 정본 하나와 백본마다 임베딩
 * 하나, 모델 셋, 전처리기 하나. 한 장을 더하면 `PER_PHOTO`만큼 는다. **모델이 셋인 것은 한계에 딱
 * 맞추려고다** — 아래 *"딱 맞으면"*이 한계에서 하나도 안 남아야 하나를 더 세는 틀림이 운다.
 */
const PER_PHOTO = 1 + BACKBONES.length
const SMALL = 6 + 4 * PER_PHOTO + 3 + 1

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return { spawnEmbedWorker: () => fakeEmbedWorker() }
})

const trainers = vi.hoisted(() => ({ workers: [] as TrainWorker[] }))

vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: (): TrainWorker => {
    const worker: TrainWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage(message: WorkerRequest) {
        structuredClone(message)
        if (message.type === 'train') trainers.workers.push(worker)
      },
      terminate() {},
    }
    return worker
  },
}))

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'

/** 사진 넷과 모델 셋을 담은 이미지 분류 프로젝트. 임베딩은 학습 준비가 붙인다. */
function imageProject(): ProjectFile {
  const backbone = backboneFor(DEFAULT_BACKBONE_ID)
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    { projectId: PROJECT_ID, createdAt: '2026-09-29T08:00:00.000Z', randomState: 42 },
  )
  const empty: ProjectFile = {
    document: {
      ...document,
      settings: {
        ...document.settings,
        selectedAlgorithms: [
          { algorithm: 'decision_tree' },
          { algorithm: 'knn' },
          { algorithm: 'logistic_regression' },
        ],
      },
    },
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  const seeds: [string, string][] = [
    ['a', '개'],
    ['b', '개'],
    ['c', '고양이'],
    ['d', '고양이'],
  ]
  return addImages(
    empty,
    seeds.map(([seed, category]) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${seed}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-29T09:00:00.000Z', format: 'webp' },
  ).project
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  await flushPromises()
  await tick()
  await flushPromises()
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

const Host = defineComponent({ render: () => h(RouterView) })

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  resetImageWorkers()
  trainers.workers.length = 0
  closeStorage()
  await deleteDatabase()
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  stubDialogElement()
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  localStorage.clear()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  useProjectStore().close()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

/** 학습해도 한계 안에 드는 가장 많은 더할 사진 수. 한 장 더하면 넘는다. */
const MOST = Math.floor((MAX_ARCHIVE_ENTRIES - SMALL) / PER_PHOTO)

/** 사진 `extra`장을 메모리에만 더하고 [학습하기]를 누른다. */
async function pressTrain(extra: number) {
  await saveProject(imageProject())
  const wrapper = mount(Host, { global: { plugins: [router, i18n] } })
  await router.push(`/project/${PROJECT_ID}/train`)
  await settle()
  expect(router.currentRoute.value.name).toBe('train')
  // 임베딩은 아직 없지만 입구는 다 붙은 뒤의 수로 센다(사진 입구와 같다).
  useProjectStore().update((live) => {
    const images = new Map(live.images)
    for (let index = 0; index < extra; index += 1) {
      const bytes = new TextEncoder().encode(`더한 사진 ${index}`)
      images.set(imageEntryPath('data', hashBytes(bytes), '개', CANONICAL_FORMATS.webp), bytes)
    }
    return { ...live, images }
  })
  const startButton = () => wrapper.findAll('button').find((one) => one.text().includes('학습하기'))
  expect(startButton()?.attributes('disabled')).toBeUndefined()
  await startButton()?.trigger('click')
  await settle()
  return { wrapper, startButton }
}

describe('학습 입구의 엔트리 수', { timeout: 60_000 }, () => {
  it('넘으면 아무것도 시작하지 않고, 알림과 실패 줄로 말한다', async () => {
    const { wrapper, startButton } = await pressTrain(MOST + 1)

    expect(workerState.embed, 'no backbone download').toHaveLength(0)
    expect(trainers.workers).toHaveLength(0)
    expect(useProjectStore().file?.document.runs.experiments).toHaveLength(0)
    expect(useToastStore().items.map((one) => `${one.tone}:${one.key}`)).toEqual([
      'danger:client.PROJECT_FILE_TOO_MANY_ENTRIES_TO_TRAIN',
    ])
    // 알림은 사라지므로 동작 바에 사유가 남는다.
    expect(wrapper.text()).toContain(i18n.global.t('train.failedHere'))
    // 잠기지 않았다 — 사진을 지우고 다시 누를 수 있다.
    expect(startButton()?.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('딱 맞으면 지금처럼 시작한다', async () => {
    // 한계에서 하나도 안 남는다 — 셈이 하나라도 더 세면 여기서 운다.
    expect(SMALL + MOST * PER_PHOTO).toBe(MAX_ARCHIVE_ENTRIES)
    const { wrapper } = await pressTrain(MOST)

    expect(workerState.embed).toHaveLength(1)
    expect(useToastStore().items).toEqual([])
    wrapper.unmount()
  })
})
