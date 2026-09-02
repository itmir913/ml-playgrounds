// @vitest-environment jsdom
/**
 * **유형을 고르는 자리는 잠기지 않는다** (architecture.md §10.5).
 *
 * **교실에서 두 번 온 보고다.**
 *
 * ① 2026-09-02 — 사진을 `범주 없음`으로 올리고 학습 화면에서 [분류]를 누르면 **그 순간
 * 학습 탭이 잠기고 다시 못 들어갔다.** 유형을 바꾸는 손잡이는 그 화면 안에 있으므로,
 * 되돌리는 길은 **원치 않는 일(범주를 만들어 라벨 붙이기)**뿐이었다. 그때 잠금을 단계
 * 진입에서 **축의 카드**로 옮겼다.
 *
 * ② 2026-09-03 — **옮긴 자리도 같은 덫이었다.** 군집을 고르면 데이터 화면의 체크리스트에서
 * `범주 지정하기`가 **면제되어 사라지는데**(고른 유형이 군집이므로) 분류 카드는 바로 그
 * 범주를 요구하며 잠겼다. **잠금을 풀 방법이 화면에서 사라진 채로 잠긴다.** 그래서 카드에서도
 * 걷어냈고, 못 하는 조합은 [학습하기]가 사유와 함께 세운다.
 *
 * **진짜 라우터와 진짜 화면을 태운다.** 잠금은 `resolveStep`이 실제로 어디에 앉히는지와
 * 화면이 실제로 그리는 카드로만 드러난다 — 순수 함수만 재면 "들어갈 수 있다"까지밖에 못 본다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { withTaskType } from '../src/project/settings'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import ModelAxes from '../src/views/train/ModelAxes.vue'
import { resetImageWorkers, stubDialogElement } from './fixtures/image-workers'

/** 학습 화면이 뜨자마자 기기 교정을 워커에 시킨다. **아무 말도 안 하는 워커**로 갈아 끼운다. */
vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: () => ({
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage() {},
    terminate() {},
  }),
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

/**
 * 사진이 든 이미지 프로젝트. **범주를 장마다 준다** — `_unlabeled`도 그냥 범주 이름으로
 * 넘긴다(그 상수의 값이 바로 그것이다).
 */
function photosIn(categories: readonly string[]): ProjectFile {
  const backbone = backboneFor(DEFAULT_BACKBONE_ID)
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '사진만 올린 프로젝트', locale: 'ko', dataType: 'image' },
    { projectId: PROJECT_ID, createdAt: '2026-09-02T08:00:00.000Z', randomState: 42 },
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
    categories.map((category, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${index}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-02T09:00:00.000Z', format: 'webp' },
  ).project
}

/** `범주 없음`으로만 사진이 든 프로젝트. 교실 보고의 그 상태다. */
function unlabeledPhotos(count: number): ProjectFile {
  return photosIn(Array.from({ length: count }, () => '_unlabeled'))
}

/** 라우터에게 학습 화면을 청하고 **실제로 어디에 앉았는지** 돌려준다. */
async function askForTrain(): Promise<string> {
  await router.push('/')
  await router.isReady()
  await router.push(`/project/${PROJECT_ID}/train`)
  await flushPromises()
  return String(router.currentRoute.value.name)
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

describe('범주 없음 사진만 있는 프로젝트에서', () => {
  it('유형을 고르기 전에는 학습 화면이 열린다', async () => {
    await saveProject(unlabeledPhotos(2))
    expect(await askForTrain()).toBe('train')
  })

  /**
   * **이 줄이 2026-09-02 교실 보고 그 자체다.** 고치기 전에는 `preprocess`에 앉았다 —
   * 학생은 방금 자기가 누른 화면에서 쫓겨났고, 되돌릴 손잡이는 그 안에 있었다.
   */
  it('분류를 고른 뒤에도 학습 화면에 그대로 있다', async () => {
    await saveProject(unlabeledPhotos(2))
    const project = useProjectStore()
    await project.open(PROJECT_ID)
    project.update((live) => ({
      ...live,
      document: withTaskType(live.document, 'classification', [], '2026-09-02T10:00:00.000Z'),
    }))
    await flushPromises()

    expect(await askForTrain()).toBe('train')
  })

  it('군집을 고른 뒤에도 마찬가지다', async () => {
    await saveProject(unlabeledPhotos(2))
    const project = useProjectStore()
    await project.open(PROJECT_ID)
    project.update((live) => ({
      ...live,
      document: withTaskType(live.document, 'clustering', [], '2026-09-02T10:00:00.000Z'),
    }))
    await flushPromises()

    expect(await askForTrain()).toBe('train')
  })

  /**
   * **판정 자체는 살아 있다.** 걷어낸 것은 잠금이 서는 자리이지 "갈릴 것이 없다"는 판정이
   * 아니다 — 데이터 화면의 체크리스트가 이것으로 그려지고, [학습하기]의 거절이 같은 것을
   * 센다 (`project/images.ts`의 `labeledCategoryCount`).
   */
  it('그래도 범주는 아직 안 정해진 것으로 센다 - 체크리스트가 그것을 그린다', async () => {
    await saveProject(unlabeledPhotos(2))
    const project = useProjectStore()
    await project.open(PROJECT_ID)
    await flushPromises()

    expect(project.facts.targetChosen).toBe(false)
    expect(project.facts.datasetReady).toBe(true)
  })
})

/**
 * **유형 축은 아무것도 꺼지지 않는다** (architecture.md §10.5).
 *
 * 여기 있던 검사는 *"못 하는 유형을 잠그고, 누르면 이유를 말한다"*였다. 2026-09-03에
 * 뒤집혔다 — **고르는 것은 묻는 일이지 저지르는 일이 아니다.**
 *
 * **꺼짐만 재면 부족하다.** `aria-disabled`는 `AppChoices`가 그리는 글자일 뿐이고, 진짜
 * 판정은 **눌렀을 때 고름이 실제로 나가는가**다 — `press()`가 꺼진 칸에서 emit을 삼킨다.
 */
describe('유형 축의 카드는', () => {
  function axes() {
    return mount(ModelAxes, {
      props: {
        taskTypes: ['classification', 'clustering'] as const,
        options: [],
        chosen: [],
        preferredRuntime: 'mljs',
      },
      global: { plugins: [i18n] },
    })
  }

  function cardFor(wrapper: ReturnType<typeof axes>, label: string) {
    return wrapper.findAll('button').find((one) => one.text().startsWith(label))
  }

  it('전부 열려 있다', () => {
    const wrapper = axes()

    expect(cardFor(wrapper, '분류')?.attributes('aria-disabled')).toBe('false')
    expect(cardFor(wrapper, '군집')?.attributes('aria-disabled')).toBe('false')
    wrapper.unmount()
  })

  it('누르면 그 유형이 실제로 나간다 - 삼켜지지 않는다', async () => {
    const wrapper = axes()

    await cardFor(wrapper, '분류')?.trigger('click')
    expect(wrapper.emitted('pickTaskType')).toEqual([['classification']])

    await cardFor(wrapper, '군집')?.trigger('click')
    expect(wrapper.emitted('pickTaskType')).toEqual([['classification'], ['clustering']])
    wrapper.unmount()
  })
})

/**
 * **잠금이 사라진 것이 아니라 옮겨졌다** (architecture.md §10.5).
 *
 * 카드가 열렸으므로 라벨 없는 사진으로도 [학습하기]까지 간다. 그때 **백본 12.4MB를 받기
 * 전에** 서야 하고, 문장이 학생이 할 일을 말해야 한다 — *"데이터가 0개"*는 화면에 사진이
 * 보이는 학생에게 틀린 문장이다.
 */
describe('사진 분류를 시작하면', () => {
  it('범주가 하나도 없으면 백본을 받기 전에 선다', async () => {
    const { TRAINING_SOURCES } = await import('../src/ml/training-source')
    let spawned = 0

    await expect(
      TRAINING_SOURCES.image({
        project: unlabeledPhotos(2),
        taskType: 'classification',
        createEmbedWorker: () => {
          spawned += 1
          throw new Error('the worker must not be reached')
        },
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_FEW_CATEGORIES', params: { categories: 0 } })

    expect(spawned).toBe(0)
  })

  /**
   * **이 경우는 전에 아무 데도 판정이 없었다.** 카드가 `targetChosen`으로 막고 있어서
   * [학습하기]에 닿은 적이 없었고, 카드를 걷어내면 곧바로 닿는다. 행 수는 넉넉하므로
   * `SPLIT_TOO_FEW_ROWS`는 여기서 아무 말도 안 한다 — 그대로 두면 무엇을 넣어도 `개`를
   * 답하는 모델이 정확도 100%로 나온다.
   */
  it('범주가 하나뿐이면 그것도 선다 - 갈릴 것이 없다', async () => {
    const { TRAINING_SOURCES } = await import('../src/ml/training-source')
    let spawned = 0

    await expect(
      TRAINING_SOURCES.image({
        project: photosIn(['개', '개', '개']),
        taskType: 'classification',
        createEmbedWorker: () => {
          spawned += 1
          throw new Error('the worker must not be reached')
        },
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_FEW_CATEGORIES', params: { categories: 1 } })

    expect(spawned).toBe(0)
  })

  /**
   * **막지 말아야 할 것을 막지 않는다.** 위 둘만 있으면 판정을 `categories < 99`로 굳혀도
   * 초록이다 — 통과하는 쪽을 함께 재야 문턱이 문턱으로 산다.
   */
  it('범주가 둘이면 지나가서 임베딩으로 간다', async () => {
    const { TRAINING_SOURCES } = await import('../src/ml/training-source')
    let spawned = 0

    await expect(
      TRAINING_SOURCES.image({
        project: photosIn(['개', '고양이']),
        taskType: 'classification',
        createEmbedWorker: () => {
          spawned += 1
          throw new Error('reached the worker')
        },
      }),
    ).rejects.toThrow('reached the worker')

    expect(spawned).toBe(1)
  })

  /** **`_unlabeled`는 범주가 아니라 상태다.** 섞여 있어도 갈리는 범주 수만 센다. */
  it('라벨 없는 사진이 섞여 있어도 갈리는 범주만 센다', async () => {
    const { TRAINING_SOURCES } = await import('../src/ml/training-source')

    await expect(
      TRAINING_SOURCES.image({
        project: photosIn(['개', '_unlabeled', '_unlabeled']),
        taskType: 'classification',
        createEmbedWorker: () => {
          throw new Error('the worker must not be reached')
        },
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_FEW_CATEGORIES', params: { categories: 1 } })
  })

  it('군집은 같은 사진으로 그대로 지나간다 - 라벨이 필요 없다', async () => {
    const { trainableRowsOf } = await import('../src/ml/training-source')
    expect(trainableRowsOf(unlabeledPhotos(2), 'clustering')).toBe(2)
    expect(trainableRowsOf(unlabeledPhotos(2), 'classification')).toBe(0)
  })

  /**
   * **문턱은 분류만의 것이다.** 군집은 나누지 않으므로 범주도 `MIN_SPLIT_ROWS`도 걸릴
   * 자리가 없고, 한 장짜리 군집 프로젝트도 임베딩까지 간다(그쪽 최소는
   * `CLUSTER_TOO_FEW_ROWS`가 따로 답한다). 위 검사는 세는 함수만 보므로, 면제 조건을
   * 뒤집어도 사진 두 장에서는 조용했다 — 여기서 **한 장으로 입구 자체**를 지난다.
   */
  it('군집은 사진 한 장이어도 조기 거절 없이 임베딩으로 간다', async () => {
    const { TRAINING_SOURCES } = await import('../src/ml/training-source')
    let spawned = 0

    await expect(
      TRAINING_SOURCES.image({
        project: unlabeledPhotos(1),
        taskType: 'clustering',
        createEmbedWorker: () => {
          spawned += 1
          throw new Error('reached the worker')
        },
      }),
    ).rejects.toThrow('reached the worker')

    expect(spawned).toBe(1)
  })
})

/**
 * **학습 화면을 실제로 띄워 카드를 읽는다.**
 *
 * 위의 축 검사는 `ModelAxes`를 혼자 띄우므로 **화면이 잠금을 도로 넘기는 것**은 못 본다 —
 * 실제로 2026-09-02~09-03 사이에는 `TrainView`가 판정을 계산해 prop으로 넘겼고, 그 배선이
 * 있는 한 축만 재는 검사는 초록이었다. 여기서는 진짜 프로젝트로 진짜 화면을 띄운다.
 */
describe('라벨 없는 사진으로 학습 화면을 띄우면', { timeout: 20_000 }, () => {
  const Host = defineComponent({ render: () => h(RouterView) })

  beforeEach(() => {
    window.scrollTo = () => {}
    resetImageWorkers()
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
    })
    stubDialogElement()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  })

  /** 범주 없음 두 장짜리 프로젝트의 학습 화면. 카드는 라벨 글자로 찾는다. */
  async function trainScreen() {
    await saveProject(unlabeledPhotos(2))
    const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${PROJECT_ID}/train`)
    await flushPromises()
    await flushPromises()
    expect(String(router.currentRoute.value.name)).toBe('train')
    const card = (label: string) =>
      wrapper.findAll('button').find((one) => one.text().startsWith(label))
    return { wrapper, card }
  }

  it('분류 카드가 열려 있다', async () => {
    const { wrapper, card } = await trainScreen()
    expect(card('분류')?.attributes('aria-disabled')).toBe('false')
    expect(card('군집')?.attributes('aria-disabled')).toBe('false')
    wrapper.unmount()
  })

  /**
   * **눌러서 실제로 고를 수 있어야 한다.** 카드가 켜져 보여도 고름이 삼켜지면 학생에게는
   * 같은 고장이다 — 유형이 정해져야 아래 두 축이 뜬다.
   */
  it('분류를 누르면 모델 축이 열린다 - 고름이 삼켜지지 않는다', async () => {
    const { wrapper, card } = await trainScreen()
    await card('분류')?.trigger('click')
    await flushPromises()

    expect(useProjectStore().taskType).toBe('classification')
    expect(wrapper.text()).not.toContain(i18n.global.t('train.noTaskTypeReason'))
    wrapper.unmount()
  })

  /**
   * **잠금의 문장이 화면에 없다.** 카드가 다시 잠기면 `AppChoices`가 그 문장을
   * `role="status"`로 띄운다 — 그 자리가 비어 있는지로 잔다.
   */
  it('먼저 마쳐야 할 일 문장이 축에 뜨지 않는다', async () => {
    const { wrapper, card } = await trainScreen()
    await card('분류')?.trigger('click')
    await flushPromises()

    const said = wrapper.findAll('[role="status"]').map((one) => one.text())
    expect(said.join(' ')).not.toContain(i18n.global.t('tasks.lockedBy', { task: '' }).slice(0, 12))
    wrapper.unmount()
  })
})
