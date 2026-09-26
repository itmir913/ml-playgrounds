// @vitest-environment jsdom
/**
 * **이미지 예측 판이 답을 낸다** — 모델이 있는 사진 프로젝트를 앉혀 [예측]을 답까지 몬다.
 *
 * 답 루프(`run()`의 임베딩 뒤), 쪽을 넘길 때 이어 도는 길, 그 사이의 프로젝트 확인을 여기서 돈다.
 * 모델은 **학생이 만드는 경로 그대로** 세운다 — 사진을 `addImages`로
 * 앉히고, 임베딩을 `addEmbeddings`로 붙이고, `trainingSourceOf` → `runExperiment` →
 * `applyExperiment`로 진짜 전처리기와 모델을 담는다.
 *
 * **벡터는 사진 바이트가 정한다.** 가짜 백본이 `dog`가 든 사진과 `cat`이 든 사진에 서로 다른
 * 벡터를 주므로, 모델의 답이 맞는지까지 볼 수 있다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { IMAGE_PREDICT_PAGE_SIZE } from '../src/limits'
import type { EmbedWorker } from '../src/ml/embed/client'
import type { EmbedMessage } from '../src/ml/embed/protocol'
import { runExperiment } from '../src/ml/experiment'
import type { Answer } from '../src/ml/predict'
import { trainingSourceOf } from '../src/ml/training-source'
import { applyExperiment } from '../src/project/attach'
import { newProjectDocument } from '../src/project/create'
import { addEmbeddings } from '../src/project/embeddings'
import { IMAGE_UNLABELED, type ProjectFile } from '../src/project/format'
import { addImages, readImages } from '../src/project/images'
import { withSelectedAlgorithms } from '../src/project/settings'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import { HARNESS_BACKBONE, stubDialogElement, stubObjectUrls } from './fixtures/image-workers'

/** 사진 바이트 -> 벡터. `dog`가 들었으면 앞 절반이, 아니면 뒤 절반이 켜진다. */
function vectorOf(bytes: Uint8Array, dim: number): Float32Array {
  const dog = new TextDecoder().decode(bytes).includes('dog')
  const vector = new Float32Array(dim)
  for (let index = 0; index < dim; index += 1) {
    const firstHalf = index < dim / 2
    vector[index] = firstHalf === dog ? 1 : 0
  }
  return vector
}

/** 임베딩 요청 수. 쪽을 넘길 때 다시 뽑는지 이것으로 센다. */
const embeds = vi.hoisted(() => ({ requests: 0 }))

vi.mock('../src/ml/embed/spawn', async () => {
  const { backboneFor, DEFAULT_BACKBONE_ID } = await import('../src/ml/backbones')
  const dim = backboneFor(DEFAULT_BACKBONE_ID)?.embeddingDim ?? 0
  return {
    spawnEmbedWorker: (): EmbedWorker => {
      const worker: EmbedWorker = {
        onmessage: null,
        onerror: null,
        onmessageerror: null,
        postMessage(request) {
          embeds.requests += 1
          const vectors = new Float32Array(request.images.length * dim)
          for (const [index, image] of request.images.entries()) {
            vectors.set(vectorOf(new Uint8Array(image), dim), index * dim)
          }
          const message: EmbedMessage = { type: 'done', vectors, dim }
          queueMicrotask(() => worker.onmessage?.({ data: message } as MessageEvent<EmbedMessage>))
        },
        terminate() {},
      }
      return worker
    },
  }
})

/** 저장을 붙드는 손잡이. 참이면 `saveProject`가 검사가 풀 때까지 안 끝난다. */
const gate = vi.hoisted(() => ({ hold: false, waiting: [] as (() => void)[] }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (gate.hold) await new Promise<void>((resolve) => gate.waiting.push(resolve))
      return actual.saveProject(file)
    },
  }
})

function releaseSaves(): void {
  gate.hold = false
  for (const one of gate.waiting.splice(0)) one()
}

const NOW = '2026-09-26T09:00:00.000Z'
const OTHER_ID = '77777777-7777-4777-8777-777777777777'
const ALGORITHMS = ['decision_tree', 'knn'] as const
/** 범주마다 학습 사진 수. 트리가 가를 수 있을 만큼은 있어야 답이 범주와 맞는다. */
const TRAINING_PER_CATEGORY = 10

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

/** 예측이 끝날 때까지. 답 루프는 사진마다 비켜 주므로 틱 몇 번으로는 안 끝난다. */
async function untilIdle(panel: { predicting: boolean }): Promise<void> {
  await settle()
  for (let round = 0; round < 200 && panel.predicting; round += 1) await settle()
  expect(panel.predicting).toBe(false)
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

function backbone() {
  const spec = HARNESS_BACKBONE
  if (!spec) throw new Error('backbone not found')
  return spec
}

/**
 * `개`·`고양이` 사진으로 학습하고, 예측 자리에 `predict`개의 사진을 둔 프로젝트.
 * 예측 사진은 `dog`·`cat`이 번갈아 들고 **임베딩이 없다** — [예측]이 뽑는다.
 */
async function trainedImageProject(predict: number): Promise<ProjectFile> {
  const spec = backbone()
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-26T08:00:00.000Z',
      randomState: 42,
    },
  )
  const empty: ProjectFile = {
    document: withSelectedAlgorithms(
      document,
      ALGORITHMS.map((algorithm) => ({ algorithm, runtime: 'mljs' })),
      NOW,
    ),
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  const training = Array.from({ length: TRAINING_PER_CATEGORY * 2 }, (_, index) => {
    const dog = index < TRAINING_PER_CATEGORY
    const bytes = new TextEncoder().encode(`train:${dog ? 'dog' : 'cat'}:${index}`)
    return { hash: hashBytes(bytes), bytes, category: dog ? '개' : '고양이' }
  })
  let project = addImages(empty, training, {
    canonicalSize: spec.canonicalSize,
    now: NOW,
    format: 'webp',
  }).project
  project = addEmbeddings(
    project,
    spec.id,
    new Map(training.map((one) => [one.hash, vectorOf(one.bytes, spec.embeddingDim)])),
  )

  const source = await trainingSourceOf({ project, taskType: 'classification' })
  const result = await runExperiment({
    dataset: source.dataset,
    testDataset: source.testDataset,
    taskType: 'classification',
    dataType: 'image',
    settings: source.settings,
    context: {
      serverStatus: 'unavailable',
      limitsOff: false,
      rowCount: source.dataset.rows.length,
      dataType: 'image',
    },
    snapshot: source.snapshot,
  })
  project = applyExperiment(source.project, result, NOW)

  return addImages(
    project,
    Array.from({ length: predict }, (_, index) => {
      const bytes = predictBytes(index)
      return { hash: hashBytes(bytes), bytes, category: IMAGE_UNLABELED }
    }),
    { canonicalSize: spec.canonicalSize, now: NOW, role: 'predict', format: 'webp' },
  ).project
}

/** 예측 사진 하나. `dog`·`cat`이 번갈아 든다 — 짝수 번째가 개다. */
function predictBytes(index: number): Uint8Array {
  return new TextEncoder().encode(`predict:${index % 2 === 0 ? 'dog' : 'cat'}:${index}`)
}

/** 예측 사진의 해시 -> 맞는 범주. */
function expectedLabels(count: number): Map<string, string> {
  return new Map(
    Array.from({ length: count }, (_, index) => [
      hashBytes(predictBytes(index)),
      index % 2 === 0 ? '개' : '고양이',
    ]),
  )
}

interface PanelInternals {
  answers: Map<string, Map<string, Answer>>
  predicted: boolean
  predicting: boolean
  page: number
}

const mounted: VueWrapper[] = []

beforeEach(async () => {
  setActivePinia(createPinia())
  embeds.requests = 0
  gate.hold = false
  gate.waiting.length = 0
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  stubObjectUrls()
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  await setLocale('ko')
})

afterEach(async () => {
  releaseSaves()
  await settle()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

async function openPanel(predict: number) {
  const project = useProjectStore()
  await project.save(await trainedImageProject(predict))
  const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
  mounted.push(wrapper)
  await settle()
  const panel = wrapper.vm as unknown as PanelInternals
  const button = (key: string) =>
    wrapper.findAll('button').find((one) => one.text() === i18n.global.t(key))
  return { project, wrapper, panel, button }
}

/** 옮겨 갈 프로젝트. **다른 id면 충분하다** — 판의 `claim`이 보는 것이 id와 열기다. */
function otherProject(file: ProjectFile): ProjectFile {
  const { manifest } = file.document
  return { ...file, document: { ...file.document, manifest: { ...manifest, projectId: OTHER_ID } } }
}

/** 답의 라벨. 실패한 답이면 `undefined`다. */
function labels(perRun: ReadonlyMap<string, Answer> | undefined): unknown[] {
  return [...(perRun?.values() ?? [])].map((answer) =>
    'value' in answer ? answer.value : undefined,
  )
}

describe('[예측]을 누르면 답이 선다', { timeout: 60_000 }, () => {
  it('사진마다 두 모델의 답이 서고, 답이 사진의 범주와 맞는다', async () => {
    const { project, panel, button } = await openPanel(2)
    const run = button('predict.run')
    expect(run, 'run button').toBeDefined()
    await run!.trigger('click')
    await untilIdle(panel)

    expect(embeds.requests).toBe(1)
    expect(panel.predicted).toBe(true)
    const photos = readImages(project.file, 'predict')
    expect(panel.answers.size).toBe(photos.length)
    const expected = expectedLabels(photos.length)
    for (const photo of photos) {
      const perRun = panel.answers.get(photo.hash)
      expect(perRun?.size).toBe(ALGORITHMS.length)
      expect(labels(perRun)).toEqual(ALGORITHMS.map(() => expected.get(photo.hash)))
    }
    // 뽑은 임베딩이 지금 파일에 앉는다 — 다음에 다시 안 뽑는다.
    for (const photo of photos) {
      expect(
        [...(project.file?.embeddings.keys() ?? [])].some((path) => path.includes(photo.hash)),
      ).toBe(true)
    }
  })

  it('다음 쪽으로 넘기면 그 쪽의 답을 이어서 낸다', async () => {
    const { panel, button } = await openPanel(IMAGE_PREDICT_PAGE_SIZE + 1)
    await button('predict.run')!.trigger('click')
    await untilIdle(panel)
    expect(panel.answers.size).toBe(IMAGE_PREDICT_PAGE_SIZE)

    const next = button('common.nextPage')
    expect(next, 'next page button').toBeDefined()
    await next!.trigger('click')
    await untilIdle(panel)

    expect(panel.page).toBe(1)
    expect(embeds.requests).toBe(2)
    expect(panel.answers.size).toBe(IMAGE_PREDICT_PAGE_SIZE + 1)
  })
})

/**
 * **답 루프 도중에 프로젝트가 바뀌면 멈춘다** (`ImagePredictPanel.vue`의 `run`, `claim`).
 *
 * 앱에서는 `App.vue`의 화면 키가 판을 새로 띄워 `alive`가 내려간다
 * (`project-switch-remount.spec.ts`). 여기서는 판을 띄운 채 스토어만 바꿔 **파일이 바뀐 뒤 판이
 * 내려가기 전의 틈**을 잰다 — 그 틈을 지키는 것이 `ours()`다.
 */
describe('답 루프 도중에 프로젝트가 바뀌면', { timeout: 60_000 }, () => {
  it('임베딩을 저장하는 동안 바뀌면 답을 내지 않는다', async () => {
    const { project, panel, button } = await openPanel(2)
    gate.hold = true
    await button('predict.run')!.trigger('click')
    for (let round = 0; round < 50 && gate.waiting.length === 0; round += 1) await settle()
    // 임베딩이 끝나 저장이 붙들려 있다 — 판은 그 저장 뒤에서 기다린다.
    expect(gate.waiting.length).toBeGreaterThan(0)
    expect(panel.predicting).toBe(true)

    const current = project.file
    if (!current) throw new Error('no project')
    void project.save(otherProject(current))
    expect(project.projectId).toBe(OTHER_ID)
    releaseSaves()
    await untilIdle(panel)

    expect(panel.predicted).toBe(false)
    expect(panel.answers.size).toBe(0)
    expect(panel.predicting).toBe(false)
  })

  it('사진 하나의 답을 낸 뒤 바뀌면 나머지를 돌지 않는다', async () => {
    const { project, panel, button } = await openPanel(2)
    const current = project.file
    if (!current) throw new Error('no project')
    // 첫 답이 서는 순간 옮긴다 — 판이 다음 사진으로 넘어가기 전에 비켜 주는 자리다.
    const stop = watch(
      () => panel.answers.size,
      (size) => {
        if (size === 1) project.file = otherProject(current)
      },
      { flush: 'sync' },
    )
    await button('predict.run')!.trigger('click')
    await untilIdle(panel)
    stop()

    expect(project.projectId).toBe(OTHER_ID)
    expect(panel.answers.size).toBe(1)
    expect(panel.predicted).toBe(false)
    expect(panel.predicting).toBe(false)
  })
})
