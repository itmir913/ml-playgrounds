// @vitest-environment jsdom
/**
 * 이미지 예측 화면에서 **두 계산이 겹칠 때** 학생의 사진이 남아 있는가.
 *
 * **여기서만 보인다.** 굽기와 임베딩은 각각 워커를 열고, 둘이 겹치는 창은 컴포넌트를
 * 띄우고 워커의 끝나는 시점을 손으로 정해야 만들어진다 — 순수 함수 검사로는 이 자리에
 * 닿지 않는다 (하니스는 `fixtures/image-workers.ts`).
 *
 * **R20 감사가 실측한 결함이다** (2026-09-02). 사진 한 장으로 예측을 누르고 임베딩을
 * 기다리는 동안 한 장을 더 놓으면, 예측이 끝날 때 **화면도 IndexedDB도 한 장으로
 * 돌아갔다.** 원인은 잠금이 아니라 쓰기의 모양이었다 — 긴 계산이 시작할 때 붙든 파일의
 * 파생물을 통째로 저장했다 (architecture.md §8.10.3).
 *
 * **거절이 아니라 보존을 고른 자리이기도 하다.** 예측 중 사진 놓기를 막으면 이 검사는
 * 초록이 되지 못한다 — 막힌 사진은 남는 것이 아니라 사라진 것이기 때문이다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { readImages } from '../src/project/images'
import { closeStorage, DB_NAME, loadProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import {
  dropEvent,
  imagePredictProject,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return { spawnEmbedWorker: fakeEmbedWorker }
})

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

// 자리 판정은 이 검사의 주제가 아니다. 모자란 자리는 `image-room.spec.ts`가 본다.
vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

interface PanelInternals {
  run: () => Promise<void>
  onDrop: (event: Event) => void
  predicting: boolean
  busy: boolean
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
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  await setLocale('ko')
})

afterEach(async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

describe('예측이 도는 동안 사진을 놓으면', () => {
  it('놓은 사진이 예측이 끝난 뒤에도 화면과 IndexedDB 양쪽에 남는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()

    // [예측하기]. 모델이 없어도 임베딩부터 뽑으므로 **긴 창이 열린다.**
    const panel = wrapper.vm as unknown as PanelInternals
    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)
    expect(panel.predicting).toBe(true)

    // 그 창에서 학생이 판 위에 사진을 놓는다.
    panel.onDrop(
      dropEvent([new File([new Uint8Array([1, 2, 3])], 'new.jpg', { type: 'image/jpeg' })]),
    )
    await flushPromises()
    await tick()
    await flushPromises()
    // **놓은 것이 실제로 들어갔는지 먼저 본다** — 거절당했다면 아래가 통과해도 뜻이 없다.
    expect(readImages(project.file, 'predict')).toHaveLength(2)

    // 이제 백본이 도착해 임베딩이 앉는다. 여기가 옛 스냅샷을 쓰던 자리다.
    workerState.embed[0]?.deliver()
    await running
    await flushPromises()

    expect(readImages(project.file, 'predict')).toHaveLength(2)
    const stored = await loadProject(project.file?.document.manifest.projectId ?? '')
    expect(readImages(stored, 'predict')).toHaveLength(2)
  })
})

describe('사진을 굽는 동안 예측이 돌면', () => {
  it('구운 사진과 뽑은 임베딩이 서로를 지우지 않는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a', 'b']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()

    // 굽기를 열어 둔 채로 시작한다 — 워커가 답하지 않는다.
    workerState.holdBake = true
    const panel = wrapper.vm as unknown as PanelInternals
    panel.onDrop(dropEvent([new File([new Uint8Array([9])], 'late.jpg', { type: 'image/jpeg' })]))
    await flushPromises()
    expect(workerState.baked).toBe(1)

    // 굽는 중에 예측이 돈다(쪽을 넘기면 저절로 도는 길이 이것이다). 임베딩이 먼저 앉는다.
    const running = panel.run()
    await tick()
    await flushPromises()
    workerState.embed[0]?.deliver()
    await running
    await flushPromises()
    expect(project.file?.embeddings.size).toBe(2)

    // **이제 굽기가 끝난다.** 붙든 파일로 통째로 쓰면 방금 앉은 임베딩이 여기서 사라진다.
    workerState.bake[0]?.deliver()
    await flushPromises()
    await tick()
    await flushPromises()

    // **뽑은 벡터가 남아 있어야 한다** — 굽기가 붙든 파일로 통째로 덮으면 0이 된다.
    // 하니스의 워커는 4차원을 내므로 `readEmbeddings`(백본 차원으로 거른다)가 아니라
    // 파일에 실제로 든 항목을 센다.
    expect(project.file?.embeddings.size).toBe(2)
    // 구운 사진도 함께 남는다 — 처음 둘에 나중에 놓은 하나.
    expect(readImages(project.file, 'predict')).toHaveLength(3)
  })
})

/**
 * **취소는 실패가 아니다** (2026-09-02 R20 C-2).
 *
 * 굽는 중에 화면을 떠나면 언마운트가 워커를 끊고 그 거절이 `readPicked`의 `catch`로
 * 온다. 그것을 알림으로 올리면 **다음 화면에 빨간 "학습을 멈췄습니다"가 뜬다** — 학생이
 * 스스로 떠난 것이고, 게다가 굽기는 학습이 아니다. 데이터 화면은 같은 자리를 삼킨다.
 */
describe('사진을 굽는 중에 화면을 떠나면', () => {
  it('취소가 알림으로 남지 않는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()

    workerState.holdBake = true
    const panel = wrapper.vm as unknown as PanelInternals
    panel.onDrop(dropEvent([new File([new Uint8Array([7])], 'gone.jpg', { type: 'image/jpeg' })]))
    await flushPromises()
    expect(workerState.baked).toBe(1)

    wrapper.unmount()
    await flushPromises()
    await tick()
    await flushPromises()

    expect(useToastStore().items).toEqual([])
  })
})

/**
 * **예측이 도는 동안 사진을 지우거나 옮기는 버튼이 잠기는가** (`photosLocked`).
 *
 * 놓는 것은 이제 안전하지만 **지우는 것은 아니다** — 답 루프가 삭제 전에 뜬 사본을 매 장
 * 다시 써서 지운 사진의 답을 되돌려 놓는다. 그 잠금이 **무검사였다** (2026-09-02 R20 B-3):
 * `photosLocked`에서 `predicting`을 빼도 전체 2,749개가 초록이었다.
 */
describe('예측이 도는 동안', () => {
  const addButton = (wrapper: ReturnType<typeof mount>) =>
    wrapper.findAll('button').find((button) => button.text() === '사진 추가')

  it('사진을 늘리고 지우는 버튼이 잠긴다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    // 아무것도 안 도는 동안에는 열려 있다 — 잠긴 채로 시작하면 위 단언이 뜻을 잃는다.
    expect(addButton(wrapper)?.attributes('disabled')).toBeUndefined()

    const panel = wrapper.vm as unknown as PanelInternals
    const running = panel.run()
    await tick()
    await flushPromises()
    expect(addButton(wrapper)?.attributes('disabled')).toBeDefined()

    workerState.embed[0]?.deliver()
    await running
    await flushPromises()
    expect(addButton(wrapper)?.attributes('disabled')).toBeUndefined()
  })
})

/**
 * **떠난 뒤에 도착한 임베딩은 앉히지 않는다** (`if (!alive) return`).
 *
 * 이 화면의 저장은 이제 지금 파일에 얹지만, **어느 프로젝트의 조각인지는 스토어가 모른다**
 * (architecture.md §8.10.3). 그래서 떠난 뒤의 앉히기는 화면이 스스로 막아야 한다.
 * 이 가드도 무검사였다 — `ui-rules.spec.ts`의 "도는 판은 떠나면 멈춘다"는 파일에
 * `if (!alive)`가 **하나라도** 있으면 통과라, 둘 중 하나가 빠져도 못 봤다 (R20 B-7).
 */
describe('임베딩을 기다리는 중에 화면을 떠나면', () => {
  it('아직 안 온 벡터는 워커가 끊겨 오지 않는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()

    const panel = wrapper.vm as unknown as PanelInternals
    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)

    wrapper.unmount()
    await flushPromises()
    workerState.embed[0]?.deliver()
    await running
    await flushPromises()

    expect(project.file?.embeddings.size).toBe(0)
  })

  /**
   * **벡터가 이미 도착한 뒤에 떠나는 창.** 여기서는 끊기가 늦어 아무 일도 안 하고
   * (`settle`이 이미 지났다), 앉히기를 막는 것은 `if (!alive) return` 그것 하나다.
   * **그 줄을 지우면 이 검사만 운다** — 위엣것은 그대로 초록이다.
   */
  it('도착한 뒤에 떠나도 앉히지 않는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()

    const panel = wrapper.vm as unknown as PanelInternals
    const running = panel.run()
    await tick()
    await flushPromises()

    // 벡터가 도착해 약속이 풀린다. **이어지는 코드는 아직 안 돌았다** — 마이크로태스크다.
    workerState.embed[0]?.deliver()
    // 그 사이에 떠난다.
    wrapper.unmount()
    await running
    await flushPromises()

    expect(project.file?.embeddings.size).toBe(0)
  })
})

/**
 * **굽기와 임베딩이 겹친 채 떠나면 둘 다 끊기는가** (architecture.md §8.10.4).
 *
 * R20이 예측 중 사진 놓기를 허용하면서 이 겹침이 생겼는데, 손잡이 칸은 하나로 남아
 * 있었다 — **먼저 끝난 쪽이 남의 손잡이를 지운다.** R21 감사가 두 순서 모두에서 실측했다:
 * 떠나도 끊긴 것은 굽기뿐이고, 아무도 안 듣는 백본 12.4MB 내려받기가 뒤에 남았다.
 */
describe('굽기와 임베딩이 겹친 채 화면을 떠나면', () => {
  const late = (): File => new File([new Uint8Array([1, 2, 3])], 'late.jpg', { type: 'image/jpeg' })

  it('예측 → 드롭 순서에서 둘 다 끊긴다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)

    workerState.holdBake = true
    panel.onDrop(dropEvent([late()]))
    await flushPromises()
    await tick()
    await flushPromises()
    expect(workerState.baked).toBe(1)

    wrapper.unmount()
    await flushPromises()

    expect(workerState.terminated).toEqual({ embed: 1, bake: 1 })

    // 늦게 온 벡터는 닫힌 화면 뒤에 아무것도 안 앉힌다.
    workerState.embed[0]?.deliver()
    await running
    await flushPromises()
    expect(project.file?.embeddings.size ?? 0).toBe(0)
  })

  it('드롭 → 예측 순서에서, 굽기가 먼저 끝나도 임베딩이 끊긴다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    workerState.holdBake = true
    panel.onDrop(dropEvent([late()]))
    await flushPromises()
    await tick()
    await flushPromises()
    expect(workerState.baked).toBe(1)

    const running = panel.run()
    await tick()
    await flushPromises()
    expect(workerState.embed).toHaveLength(1)

    // **굽기가 먼저 끝난다** — 칸이 하나였을 때 이 `finally`가 임베딩의 손잡이를 지웠다.
    workerState.bake[0]?.deliver()
    for (let index = 0; index < 50 && panel.busy; index += 1) {
      await flushPromises()
      await tick()
    }

    wrapper.unmount()
    await flushPromises()

    expect(workerState.terminated.embed).toBe(1)
    workerState.embed[0]?.deliver()
    await running
    await flushPromises()
    expect(project.file?.embeddings.size ?? 0).toBe(0)
  })
})

/**
 * **굽는 동안 놓은 사진은 거절되고, 거절은 학생에게 말이 간다** (§8.10.4).
 *
 * 데이터 화면과 답이 갈리는 자리다. 거기는 확인 판이 있어 받아 두지만 여기는 받은 즉시
 * 굽는데, 정본 워커를 둘 띄우는 것은 저사양 교실 PC라는 기준에 안 맞는다. **거절 자체는
 * 결정이고, 말없이 거절하는 것이 결함이었다** (R21 B-3) — 학생은 사진을 놓았는데 아무
 * 일도 안 일어난 것을 보고 고장으로 읽는다.
 */
describe('굽는 동안 사진을 더 놓으면', () => {
  it('거절하되 그렇다고 말한다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject(['a']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    workerState.holdBake = true
    panel.onDrop(
      dropEvent([new File([new Uint8Array([1, 2, 3])], 'first.jpg', { type: 'image/jpeg' })]),
    )
    await flushPromises()
    await tick()
    await flushPromises()
    expect(workerState.baked).toBe(1)

    panel.onDrop(
      dropEvent([new File([new Uint8Array([4, 5, 6])], 'second.jpg', { type: 'image/jpeg' })]),
    )
    await flushPromises()
    await tick()
    await flushPromises()

    // 둘째 굽기는 안 열리고, **대신 말이 간다.**
    expect(workerState.baked).toBe(1)
    expect(useToastStore().items.map((one) => one.key)).toEqual(['predict.image.addWhileBusy'])

    workerState.bake[0]?.deliver()
    for (let index = 0; index < 50 && panel.busy; index += 1) {
      await flushPromises()
      await tick()
    }
    expect(readImages(project.file, 'predict')).toHaveLength(2)
  })

  it('받을 수 없는 동안에는 놓는 자리가 색을 안 바꾼다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    await wrapper.find('div').trigger('dragover')
    expect(wrapper.find('.border-dashed').classes()).toContain('border-brand')

    workerState.holdBake = true
    panel.onDrop(
      dropEvent([new File([new Uint8Array([1, 2, 3])], 'first.jpg', { type: 'image/jpeg' })]),
    )
    await flushPromises()
    await tick()
    await flushPromises()
    expect(panel.busy).toBe(true)

    await wrapper.find('div').trigger('dragover')
    expect(wrapper.find('.border-dashed').classes()).not.toContain('border-brand')

    workerState.bake[0]?.deliver()
    for (let index = 0; index < 50 && panel.busy; index += 1) {
      await flushPromises()
      await tick()
    }
  })
})
