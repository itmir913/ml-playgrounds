// @vitest-environment jsdom
/**
 * 학습 화면의 **준비 단계를 진짜 라우터 위에 띄워서** 본다.
 *
 * `train-preparing.spec.ts`는 축·가드·잠금이 **같은 신호를 보는지**까지만 지키는 모양
 * 검사다. **실제로 막히는지는 안 잰다** — 그 자리가 R21 감사의 B-1이었다: 신호는 하나로
 * 맞았는데 **그 신호가 늦게 켜졌다.** `preparing`은 워커의 첫 마디에서야 값을 받고,
 * 그전까지(워커 스크립트를 받아 실행하는 동안, 표 경로는 정본을 파싱하는 내내) 축이 안
 * 잠기고 나가기도 안 막혔다.
 *
 * **여기서 재는 것은 시점이다.** [학습하기]를 누른 직후에 이미 잠기는가, 그리고 그
 * 상태에서 나가면 워커가 끊기고 늦게 온 계산이 아무 데도 안 앉는가.
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
import { closeStorage, DB_NAME, loadProject, saveProject } from '../src/project/storage'
import { ROUTE_PROJECTS, router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { resetImageWorkers, stubDialogElement, workerState } from './fixtures/image-workers'

/**
 * 참이면 워커가 요청을 받자마자 `preparing`을 보고한다 — **진짜 워커의 첫 마디다.**
 * 거짓이면 그 마디가 영영 안 오고, 그 침묵이 R21 B-1의 창이다.
 */
const reportFirst = vi.hoisted(() => ({ value: false }))

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return {
    spawnEmbedWorker: () => {
      const worker = fakeEmbedWorker()
      const post = worker.postMessage.bind(worker)
      worker.postMessage = (request) => {
        post(request)
        if (!reportFirst.value) return
        queueMicrotask(() => {
          worker.onmessage?.({
            data: { type: 'preparing', state: 'downloading' },
          } as MessageEvent<never>)
        })
      }
      return worker
    },
  }
})

/** 학습 워커. **아무 말도 안 한다** — 준비 창만 보는 검사라 학습까지 안 간다. */
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

/** 모델 둘을 고른 이미지 분류 프로젝트. 사진 넷이면 준비가 실제로 돈다. */
function trainableImageProject(): ProjectFile {
  const backbone = backboneFor(DEFAULT_BACKBONE_ID)
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    { projectId: PROJECT_ID, createdAt: '2026-09-02T08:00:00.000Z', randomState: 42 },
  )
  const empty: ProjectFile = {
    document: {
      ...document,
      settings: {
        ...document.settings,
        selectedAlgorithms: [{ algorithm: 'decision_tree' }, { algorithm: 'knn' }],
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
    { canonicalSize: backbone.canonicalSize, now: '2026-09-02T09:00:00.000Z', format: 'webp' },
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

/**
 * **진짜 라우터 위에 화면을 통째로 띄우는 검사들이라 느리다.** 격리 실행은 넷이 5초
 * 안이지만 관문이 파일 120개를 나란히 돌릴 때는 그것을 넘고, **시간 초과로 죽은 검사의
 * 워커가 다음 검사의 셈에 섞여** 엉뚱한 자리가 빨개진다 — 가짜 빨강이 진짜 빨강을 가린다.
 */
const SLOW = { timeout: 20_000 }

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  resetImageWorkers()
  reportFirst.value = false
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
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

/** 학습 화면을 띄우고 [학습하기]까지 누른다. 임베딩은 손잡이를 부를 때까지 안 끝난다. */
async function trainScreenAfterStart() {
  await saveProject(trainableImageProject())
  const wrapper = mount(Host, { global: { plugins: [router, i18n] } })
  await router.push(`/project/${PROJECT_ID}/train`)
  await settle()
  expect(router.currentRoute.value.name).toBe('train')

  const buttons = () => wrapper.findAll('button')
  const startButton = () => buttons().find((one) => one.text().includes('학습하기'))
  // 누르기 전에는 열려 있다 — 잠긴 채로 시작하면 아래 단언이 뜻을 잃는다.
  expect(startButton()?.attributes('disabled')).toBeUndefined()

  await startButton()?.trigger('click')
  await settle()
  expect(workerState.embed).toHaveLength(1)

  return { wrapper, buttons, startButton, project: useProjectStore() }
}

/**
 * 모델 축이 잠겼는가. **jsdom에는 `inert` 프로퍼티가 없어** Vue가 `inert="false"`라는
 * 문자열을 남긴다 — 있는지가 아니라 값까지 봐야 한다.
 */
function axesInert(wrapper: ReturnType<typeof mount>): boolean {
  const value = wrapper.find('div.transition-opacity').attributes('inert')
  return value === '' || value === 'true'
}

describe('[학습하기]를 누르고 워커가 아직 아무 말도 안 했을 때', SLOW, () => {
  it('그 창에서도 축이 잠기고 나가기가 막힌다', async () => {
    const { wrapper, startButton } = await trainScreenAfterStart()

    // **이 셋이 R21 B-1의 자리다.** `preparing`만 보던 때는 셋 다 열려 있었다.
    expect(startButton()?.attributes('disabled')).toBeDefined()
    expect(axesInert(wrapper)).toBe(true)

    await router.push('/')
    await settle()
    expect(router.currentRoute.value.name).toBe('train')
    expect(wrapper.text()).toContain('학습이 아직 끝나지 않았습니다')

    wrapper.unmount()
  })

  /**
   * **담은 목록도 그 창에서 닫힌다** (2026-09-02 R22 A-1).
   *
   * 축은 `inert`가 잠그지만 담은 목록은 그 밖의 형제라(§8.17) **자기 신호로 닫는다.**
   * `training.running`을 보던 때는 백본 12.4MB를 받는 십수 초 동안 [제거]가 눌렸고,
   * 학습은 [학습하기]를 누른 순간의 스냅샷으로 도므로 **뺀 모델이 그대로 학습됐다** —
   * 파일에는 뺀 것으로 남고 결과에는 선다.
   *
   * **누르기 전에 열려 있는 것부터 잰다.** 처음부터 0개면 이 단언은 아무것도 안 지킨다.
   */
  it('담은 목록의 [제거]와 하이퍼파라미터도 닫힌다', async () => {
    await saveProject(trainableImageProject())
    const wrapper = mount(Host, { global: { plugins: [router, i18n] } })
    await router.push(`/project/${PROJECT_ID}/train`)
    await settle()

    const removes = () => wrapper.findAll('button').filter((one) => one.text() === '제거')
    const tunings = () => wrapper.findAll('details')
    // 누르기 전에는 모델 둘의 [제거]와 조정 상자가 열려 있다.
    expect(removes()).toHaveLength(2)
    expect(tunings().length).toBeGreaterThan(0)

    const start = wrapper.findAll('button').find((one) => one.text().includes('학습하기'))
    await start?.trigger('click')
    await settle()
    expect(workerState.embed).toHaveLength(1)

    // **워커는 아직 한 마디도 안 했다.** `preparing`은 거짓이고 `starting`만 참인 창이다.
    expect(removes()).toHaveLength(0)
    expect(tunings()).toHaveLength(0)

    await router.push('/')
    await settle()
    const leave = wrapper.findAll('button').find((one) => one.text() === '나가고 학습 멈추기')
    await leave?.trigger('click')
    await settle()
    wrapper.unmount()
  })
})

describe('백본을 받는 동안 화면을 떠나면', SLOW, () => {
  it('워커가 끊기고, 늦게 온 벡터는 아무 데도 안 앉고, 알림도 안 뜬다', async () => {
    reportFirst.value = true
    const { wrapper, buttons, project } = await trainScreenAfterStart()
    expect(axesInert(wrapper)).toBe(true)

    await router.push('/')
    await settle()
    const leave = buttons().find((one) => one.text() === '나가고 학습 멈추기')
    expect(leave).toBeDefined()
    await leave?.trigger('click')
    await settle()
    await settle()

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    expect(project.file).toBeNull()
    // **끊은 것은 실패가 아니다.** 이 자리를 안 삼키면 다음 화면에 빨간 알림이 뜬다.
    expect(useToastStore().items).toEqual([])

    // 늦게 도착한 벡터. 닫힌 스토어를 되살리지도, 디스크에 앉지도 않는다.
    workerState.embed[0]?.deliver()
    await settle()
    expect(project.file).toBeNull()
    expect((await loadProject(PROJECT_ID))?.embeddings.size).toBe(0)

    wrapper.unmount()
  })
})

describe('준비가 끝나 임베딩을 앉힐 때', SLOW, () => {
  it('붙든 파일이 아니라 조각으로 얹어, 그 사이의 편집이 산다', async () => {
    reportFirst.value = true
    const { wrapper, project } = await trainScreenAfterStart()

    // 화면은 잠겨 있다. **스토어 쪽 편집(다른 경로·자동 저장)에 해당한다** — 얹기가
    // 조각이 아니면 이 이름이 준비가 끝나며 되돌아간다.
    project.update((live) => ({
      ...live,
      document: {
        ...live.document,
        manifest: { ...live.document.manifest, name: '준비 중에 바뀐 이름' },
      },
    }))
    await flushPromises()

    workerState.embed[0]?.deliver()
    await settle()

    expect(project.name).toBe('준비 중에 바뀐 이름')
    // 뽑은 벡터는 사진 수만큼 앉는다 — 조각을 안 돌려주면 하나도 안 앉는다.
    expect(project.file?.embeddings.size).toBe(4)

    await router.push('/')
    await settle()
    const leave = wrapper.findAll('button').find((one) => one.text() === '나가고 학습 멈추기')
    await leave?.trigger('click')
    await settle()
    wrapper.unmount()
  })

  /**
   * **끊기보다 벡터가 먼저 도착하는 순서.** 워커를 끊으면 그 거절이 먼저 와서 `alive`
   * 가드에 닿지도 않는다 — 그래서 이 가드는 R20·R21 두 라운드에서 무검사로 남았다.
   * **답이 온 바로 뒤에 떠나야** 이 줄이 유일한 방어가 된다 (R20 B-7과 같은 모양).
   */
  it('벡터가 온 직후에 떠나면 그것도 안 앉는다', async () => {
    reportFirst.value = true
    const { wrapper, project } = await trainScreenAfterStart()

    // 워커가 답한다. **이어지는 계산은 아직 한 줄도 안 돌았다** — 마이크로태스크에 있다.
    workerState.embed[0]?.deliver()
    // 그 사이에 학생이 화면을 떠난다.
    wrapper.unmount()
    await settle()

    expect(project.file?.embeddings.size ?? 0).toBe(0)
  })
})
