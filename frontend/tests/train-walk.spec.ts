// @vitest-environment jsdom
/**
 * **학생이 실제로 밟는 걸음** (2026-09-03 R25 C-1·C-3).
 *
 * 유형 카드의 잠금을 걷어내면서(`86058ad`) **못 하는 조합이 [학습하기]까지 간다.** 거절은
 * 거기서 사유와 함께 서야 한다. 그 길의 조각은 셋 다 검사가 있었다 — 단계 판정
 * (`steps.spec`) · 계획 거절(`plan.spec`) · 워커의 실패 전달(`worker.spec`) — **그런데 한
 * 줄로 잇는 검사가 없었다.** 조각마다 초록인데 길이 끊겨 있을 수 있다는 것이 이 저장소가
 * R10에서 배운 것이다.
 *
 * **커밋 메시지의 "dev 서버로 밟았다"가 그 자리의 유일한 증거였다** — 사람 확인이다.
 * 여기서 기계가 밟는다.
 *
 * **워커는 진짜 로직을 태운다.** `handleRequest`를 목 안에서 그대로 부른다 — 가짜 실패
 * 메시지를 만들어 넣으면 **잇는 검사가 아니라 화면 검사**가 되고, 거절이 실제로 거기서
 * 나온다는 것을 아무도 안 본다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

import { toCanonicalCsv } from '../src/data/serialize'
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { DATA_TYPES, TASK_TYPES, type Settings, type TaskType } from '../src/project/schema'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { NO_FACTS, STEP_IDS, stepBlockers, type ProjectFacts } from '../src/router/steps'
import { useProjectStore } from '../src/stores/project'
import { irisDataset, IRIS_FEATURE_COLUMNS } from './fixtures/iris'
import { resetImageWorkers, stubDialogElement } from './fixtures/image-workers'

/**
 * **진짜 학습 로직을 태운 워커 목.** `postMessage`가 오면 `handleRequest`를 그대로 부르고
 * 나오는 메시지를 `onmessage`로 되돌린다 — 실제 워커 껍데기가 하는 일과 같다.
 */
vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: () => {
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      onmessageerror: null,
      async postMessage(request: unknown) {
        const { handleRequest } = await import('../src/ml/worker/handler')
        handleRequest(request as never, (message) => worker.onmessage?.({ data: message }))
      },
      terminate() {},
    }
    return worker
  },
}))

const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440000'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** `범주 없음`으로만 사진이 든 프로젝트. */
function unlabeledPhotos(count: number): ProjectFile {
  const backbone = backboneFor(DEFAULT_BACKBONE_ID)
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '사진만 올린 프로젝트', locale: 'ko', dataType: 'image' },
    { projectId: PROJECT_ID, createdAt: '2026-09-03T08:00:00.000Z', randomState: 42 },
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
    Array.from({ length: count }, (_, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${index}`)
      return { hash: hashBytes(bytes), bytes, category: '_unlabeled' }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-03T09:00:00.000Z', format: 'webp' },
  ).project
}

/** 특성만 고르고 **타깃을 안 고른** 표 프로젝트. */
function tableWithoutTarget(): ProjectFile {
  const document = newProjectDocument(
    { name: '타깃 없는 표', locale: 'ko', dataType: 'tabular' },
    { projectId: PROJECT_ID, createdAt: '2026-09-03T08:00:00.000Z', randomState: 42 },
  )
  const table = irisDataset()
  const settings = {
    ...document.settings,
    data: {
      ...document.settings.data,
      dataset: {
        path: 'dataset/data.csv',
        originalFileName: 'iris.csv',
        hasHeader: true,
        encoding: 'utf-8',
      },
      features: [...IRIS_FEATURE_COLUMNS],
      preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
    },
  } as Settings
  const bytes = toCanonicalCsv([[...table.columns], ...table.rows.map((row) => [...row])])
  return {
    document: { ...document, settings },
    dataset: { bytes, hash: 'x'.repeat(64) },
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  await setLocale('ko')
  window.scrollTo = () => {}
  resetImageWorkers()
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  stubDialogElement()
})

afterEach(async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

const Host = defineComponent({ render: () => h(RouterView) })

async function trainScreen(project: ProjectFile) {
  await saveProject(project)
  const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
  await router.push('/')
  await router.isReady()
  await router.push(`/project/${PROJECT_ID}/train`)
  await flushPromises()
  await flushPromises()
  const buttons = () => wrapper.findAll('button')
  const card = (label: string) => buttons().find((one) => one.text().startsWith(label))
  return { wrapper, buttons, card }
}

async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) await flushPromises()
}

/**
 * [학습하기]를 누르고 **실패 팝오버를 열어 그 안의 문장**을 돌려준다.
 *
 * **버튼이 떴는지만 보면 안 된다.** 처음에 그렇게 썼더니 사유 코드를 바꾸는 돌연변이 둘이
 * 조용했다 — 어떤 실패든 같은 버튼을 띄우기 때문이다. **무는 것은 문장이다.**
 */
async function trainAndReadFailure(
  wrapper: ReturnType<typeof mount>,
  buttons: () => ReturnType<ReturnType<typeof mount>['findAll']>,
): Promise<string> {
  const start = buttons().find((one) => one.text().includes('학습하기'))
  expect(
    start?.attributes('disabled'),
    'the train button is disabled, so this walk cannot happen',
  ).toBe(undefined)
  await start?.trigger('click')

  /**
   * **고정 대기가 아니라 조건 대기다.** 여기 `setTimeout(50)`이 있었는데, 학습 경로가
   * 비동기로 길어지자(`fit`이 약속을 돌려주게 된 2026-09-04) 부하가 걸린 전체 실행에서
   * 50ms를 넘겨 **가짜 빨강**이 났다 — 격리하면 늘 통과하는 그 모양이다.
   * 실패가 화면에 닿을 때까지 기다리고, 안 닿으면 아래 단언이 그 사실을 말한다.
   */
  const label = i18n.global.t('train.failedHere')
  const findOpener = (): ReturnType<typeof buttons>[number] | undefined =>
    buttons().find((one) => one.text() === label)
  for (let round = 0; round < 100 && findOpener() === undefined; round += 1) {
    await settle()
    await new Promise((resolve) => setTimeout(resolve, 10))
  }

  const opener = findOpener()
  expect(opener, 'the failure never reached the screen').toBeDefined()
  await opener?.trigger('click')
  await settle()
  // **팝오버는 `Teleport to="body"`다** — wrapper 밖에 뜬다 (`AppPopover.vue`).
  return `${wrapper.text()}${document.body.textContent ?? ''}`
}

describe('못 하는 조합이 [학습하기]에서 사유와 함께 선다', { timeout: 30_000 }, () => {
  /**
   * **사진: 범주가 없다.** 거절은 임베딩 **전에** 주 스레드에서 난다
   * (`IMAGE_TOO_FEW_CATEGORIES`) — 백본 12.4MB를 안 받는다.
   */
  it('범주 없는 사진: 분류 → 모델 추가 → [학습하기] → 실패와 범주 문장', async () => {
    const { wrapper, buttons, card } = await trainScreen(unlabeledPhotos(6))
    expect(String(router.currentRoute.value.name)).toBe('train')

    await card('분류')?.trigger('click')
    await settle()
    expect(useProjectStore().taskType).toBe('classification')

    const add = buttons().find((one) => one.text() === i18n.global.t('train.addModel'))
    expect(add?.attributes('disabled')).toBeUndefined()
    await add?.trigger('click')
    await settle()

    // **문장을 통째로 못 박는다.** 범주 수까지 들어간 그 문장이어야 한다.
    expect(await trainAndReadFailure(wrapper, buttons)).toContain(
      i18n.global.t('client.IMAGE_TOO_FEW_CATEGORIES', { categories: 0 }),
    )
    wrapper.unmount()
  })

  /**
   * **표: 타깃을 안 골랐다.** 이쪽 거절은 **워커 안**이다(`planRunOrThrow`의
   * `TARGET_NOT_SELECTED`). 목이 진짜 로직을 태우므로 그 사유가 실제로 거기서 나온다.
   */
  it('타깃 없는 표: 같은 걸음에서 실패가 화면까지 온다', async () => {
    const { wrapper, buttons, card } = await trainScreen(tableWithoutTarget())
    expect(String(router.currentRoute.value.name)).toBe('train')

    await card('분류')?.trigger('click')
    await settle()

    const add = buttons().find((one) => one.text() === i18n.global.t('train.addModel'))
    expect(add?.attributes('disabled')).toBeUndefined()
    await add?.trigger('click')
    await settle()

    expect(await trainAndReadFailure(wrapper, buttons)).toContain(
      i18n.global.t('errors.TARGET_NOT_SELECTED'),
    )
    wrapper.unmount()
  })
})

/**
 * **`targetChosen`은 어느 단계도 안 막는다** — `router/steps.ts`의 단정을 표 전체로 잰다.
 *
 * 그 주석이 *"그 사실을 `requires`에 든 단계가 `train` 하나이고 거기가 유형을 고르는
 * 자리이기 때문"*이라고 이유까지 적는다. **이유가 아니라 결론을 잰다** — 단계·종류·유형을
 * 전부 돌려 막는 조합이 하나도 없어야 한다.
 */
describe('targetChosen은 어느 단계도 안 막는다', () => {
  it('6단계 × 2종류 × (3유형 + 미정)에서 그 사실 하나로 막히는 조합이 없다', () => {
    const allButTarget: ProjectFacts = {
      ...NO_FACTS,
      datasetReady: true,
      featuresChosen: true,
      taskTypeChosen: true,
      algorithmsChosen: true,
      trainingDone: true,
      modelReady: true,
      portfolioAnswered: true,
      targetChosen: false,
    }
    const offenders: string[] = []
    for (const step of STEP_IDS) {
      for (const dataType of DATA_TYPES) {
        for (const taskType of [...TASK_TYPES, undefined] as (TaskType | undefined)[]) {
          const blockers = stepBlockers(step, allButTarget, taskType, dataType)
          if (blockers.length > 0) {
            offenders.push(`${step}/${dataType}/${taskType ?? '미정'}: ${blockers.join(',')}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
