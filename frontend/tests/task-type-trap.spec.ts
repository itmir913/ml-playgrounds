// @vitest-environment jsdom
/**
 * **유형을 고른 화면이 그 선택으로 잠기지 않는다** (architecture.md §10.5).
 *
 * **교실에서 온 보고다** (2026-09-02). 사진을 `범주 없음`으로 올리고 학습 화면에서
 * [분류]를 누르면 **그 순간 학습 탭이 잠기고 다시 못 들어갔다.** 유형을 바꾸는 손잡이는
 * 그 화면 안에 있으므로, 되돌리는 길은 **원치 않는 일(범주를 만들어 라벨 붙이기)**뿐이었다.
 *
 * **진짜 라우터를 태운다.** 잠금은 `resolveStep`이 실제로 어디에 앉히는지로만 드러난다 —
 * 순수 함수만 재면 "들어갈 수 있다"까지밖에 못 본다.
 */

import 'fake-indexeddb/auto'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

import { dataKindFor, lockedSentenceFor } from '../src/data/kinds'
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
import { withoutComments } from './fixtures/source'

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

/** `범주 없음`으로만 사진이 든 이미지 프로젝트. 교실 보고의 그 상태다. */
function unlabeledPhotos(count: number): ProjectFile {
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
    Array.from({ length: count }, (_, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${index}`)
      return { hash: hashBytes(bytes), bytes, category: '_unlabeled' }
    }),
    { canonicalSize: backbone.canonicalSize, now: '2026-09-02T09:00:00.000Z', format: 'webp' },
  ).project
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
   * **이 줄이 교실 보고 그 자체다.** 고치기 전에는 `preprocess`에 앉았다 — 학생은 방금
   * 자기가 누른 화면에서 쫓겨났고, 되돌릴 손잡이는 그 안에 있었다.
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
   * **잠금이 사라진 것이 아니라 옮겨졌다** (§10.5). 못 하는 유형은 축의 카드가 이유와
   * 함께 잠근다 — 그 판정이 여기서 나온다.
   */
  it('분류는 카드가 이유와 함께 잠근다', async () => {
    await saveProject(unlabeledPhotos(2))
    const project = useProjectStore()
    await project.open(PROJECT_ID)
    await flushPromises()

    const { taskTypeBlockers } = await import('../src/router/steps')
    expect(taskTypeBlockers('train', project.facts, 'classification', 'image')).toEqual([
      'targetChosen',
    ])
    expect(taskTypeBlockers('train', project.facts, 'clustering', 'image')).toEqual([])
  })
})

/**
 * **잠기는 자리는 카드다** (architecture.md §10.5, §9.4).
 *
 * 판정만 재면 부족하다 — 실제로 `taskTypeBlockers`를 부르고도 `enabled: true`를 박아 둔
 * 채로 초록이었다. **화면이 그 판정을 쓰는지**까지 재야 한다.
 */
describe('유형 축의 카드는', () => {
  function axes(locks: Partial<Record<'classification' | 'clustering', string>>) {
    return mount(ModelAxes, {
      props: {
        taskTypes: ['classification', 'clustering'] as const,
        taskTypeLocks: locks,
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

  /**
   * **`disabled`가 아니라 `aria-disabled`다** (`AppChoices`). `disabled`는 클릭 자체가
   * 안 잡혀 **사유에 도달할 방법이 없어진다** — 꺼진 칸을 눌러야 이유가 뜬다.
   */
  it('못 하는 유형을 잠그고, 누르면 이유를 말한다', async () => {
    const wrapper = axes({ classification: '먼저 마쳐야 할 일이 있습니다.' })

    const card = cardFor(wrapper, '분류')
    expect(card?.attributes('aria-disabled')).toBe('true')

    await card?.trigger('click')
    expect(wrapper.text()).toContain('먼저 마쳐야 할 일이 있습니다.')
    wrapper.unmount()
  })

  it('할 수 있는 유형은 열어 둔다', () => {
    const wrapper = axes({ classification: '먼저 마쳐야 할 일이 있습니다.' })

    expect(cardFor(wrapper, '군집')?.attributes('aria-disabled')).toBe('false')
    wrapper.unmount()
  })

  it('막는 것이 없으면 둘 다 열려 있다', () => {
    const wrapper = axes({})

    expect(cardFor(wrapper, '분류')?.attributes('aria-disabled')).toBe('false')
    expect(cardFor(wrapper, '군집')?.attributes('aria-disabled')).toBe('false')
    wrapper.unmount()
  })
})

/**
 * **배선도 못 박는다.** 판정과 카드를 각각 재도 **학습 화면이 그 판정을 안 넘기면**
 * 카드는 언제나 열린다 — 실제로 그 자리에 검사가 없어 돌연변이가 조용했다.
 *
 * `train-preparing.spec.ts`가 잠금 신호를 모양으로 재는 것과 같은 관용구다.
 */
describe('학습 화면의 배선', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'src', 'views', 'TrainView.vue'), 'utf-8')

  /** `<ModelAxes …>`의 여는 태그. 못 찾으면 빈 문자열이 아니라 실패다. */
  function axesTag(code: string): string {
    return /<ModelAxes[\s\S]*?\/?>/.exec(code)?.[0] ?? ''
  }

  it('검사기가 자리를 못 찾으면 빈 문자열을 준다 - 아래가 그것을 실패로 친다', () => {
    expect(axesTag('아무것도 없는 소스')).toBe('')
  })

  it('유형 축에 잠금 판정을 넘긴다', () => {
    const tag = axesTag(withoutComments(SOURCE).join('\n'))
    expect(tag).not.toBe('')
    expect(tag).toContain(':task-type-locks="taskTypeLocks"')
  })
})

/**
 * **셀 수 있는 것은 세고 나서 시작한다** (architecture.md §10.5).
 *
 * 카드가 분류를 막지만 **파일에 분류가 남은 채 라벨을 뗀 프로젝트**를 열면 [학습하기]까지
 * 갈 수 있다. 그때 전에는 백본 12.4MB를 받고 사진을 전부 돌린 **뒤에야** 섰다 — 학생은
 * 몇 분을 기다린 끝에 화면에 사진이 있는데 "데이터가 0개"를 읽었다.
 */
describe('라벨 없는 사진만 있는 분류 프로젝트에서 학습을 시작하면', () => {
  it('백본을 받기 전에 선다', async () => {
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
    ).rejects.toMatchObject({ code: 'SPLIT_TOO_FEW_ROWS' })

    expect(spawned).toBe(0)
  })

  it('군집은 같은 사진으로 그대로 지나간다 - 라벨이 필요 없다', async () => {
    const { trainableRowsOf } = await import('../src/ml/training-source')
    expect(trainableRowsOf(unlabeledPhotos(2), 'clustering')).toBe(2)
    expect(trainableRowsOf(unlabeledPhotos(2), 'classification')).toBe(0)
  })

  /**
   * **문턱은 분류만의 것이다.** 군집은 나누지 않으므로 `MIN_SPLIT_ROWS`가 걸릴 자리가
   * 없고, 한 장짜리 군집 프로젝트도 임베딩까지 간다(그쪽 최소는 `CLUSTER_TOO_FEW_ROWS`가
   * 따로 답한다). 위 검사는 세는 함수만 보므로, 면제 조건을 뒤집어도 사진 두 장에서는
   * 조용했다 — 여기서 **한 장으로 입구 자체**를 지난다.
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
 * **학습 화면을 실제로 띄워 카드의 글자를 읽는다** (2026-09-03 R24 재검토 B-N1·B-N2).
 *
 * 위의 카드 검사는 사유 문장을 손으로 박아 넣고, 배선 검사는 prop 이름 글자만 본다. 그
 * 사이에서 **화면이 실제로 만드는 문장**이 무검사였다 — 잠금 판정을 뒤집어도 초록이었고,
 * 학생은 `(tasks.image.targetChosen)`을 읽었다. 여기서는 그 둘을 한 번에 잰다: 분류는
 * 잠기고 군집은 열려 있는가, 잠긴 카드의 사유가 **레일과 같은 함수의 문장**인가.
 */
describe('학습 화면을 띄우면', { timeout: 20_000 }, () => {
  const Host = defineComponent({ render: () => h(RouterView) })
  const translate = (key: string, params?: Record<string, string>): string =>
    i18n.global.t(key, params ?? {})

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

  it('분류 카드는 잠기고, 누르면 레일과 같은 문장을 말한다 - 키가 아니다', async () => {
    const { wrapper, card } = await trainScreen()
    const classification = card('분류')
    expect(classification?.attributes('aria-disabled')).toBe('true')

    await classification?.trigger('click')
    await flushPromises()
    const said = wrapper.findAll('[role="status"]').map((one) => one.text())
    const rail = lockedSentenceFor(
      dataKindFor('image'),
      'train',
      ['targetChosen'],
      'image',
      translate,
    )
    expect(said).toContain(rail)
    // 번역을 빠뜨리면 여기에 로케일 키가 그대로 선다.
    expect(said.join(' ')).not.toContain('tasks.')
    wrapper.unmount()
  })

  it('군집 카드는 열려 있다 - 잠금이 뒤집히지 않았다', async () => {
    const { wrapper, card } = await trainScreen()
    expect(card('군집')?.attributes('aria-disabled')).toBe('false')
    wrapper.unmount()
  })
})
