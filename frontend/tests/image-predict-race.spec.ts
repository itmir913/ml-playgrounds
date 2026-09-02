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
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import {
  dropEvent,
  imagePredictProject,
  resetImageWorkers,
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
