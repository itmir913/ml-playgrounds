// @vitest-environment jsdom
/**
 * **이미지 예측 판의 필터도 새 학습 뒤에 남는다** (`open-decisions.md` 55 표의 7, R38-D55-V C-3).
 *
 * 표 판의 같은 배선은 `predict-invalidation.spec.ts`가 문다. 이미지 판은 아무도 안 물어서 감시자를
 * `defaultFilter`로 되돌려도(B5i) 34개가 초록이었다. **필터는 모델 목록만 본다** — 실험 id와
 * 알고리즘 이름이다. 그래서 모델 파일 없는 실험으로 판을 띄운다(카드는 사유와 함께 서고, 필터는
 * 그 목록으로 선다). 답 루프는 이 검사의 주제가 아니다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import PredictFilters from '../src/views/predict/PredictFilters.vue'
import { imagePredictProject, resetImageWorkers, stubDialogElement } from './fixtures/image-workers'
import { experiment, run } from './fixtures/project'

vi.mock('../src/ml/embed/spawn', async () => {
  const { fakeEmbedWorker } = await import('./fixtures/image-workers')
  return { spawnEmbedWorker: fakeEmbedWorker }
})

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

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

/** 결정트리와 KNN을 돌린 실험 하나. 모델 파일은 없다 — 필터는 목록만 본다. */
function trained(id: string) {
  return experiment(id, [
    run(`${id}-tree`, { algorithm: 'decision_tree' }),
    run(`${id}-knn`, { algorithm: 'knn' }),
  ])
}

function withExperiments(file: ProjectFile, ids: readonly string[]): ProjectFile {
  return {
    ...file,
    document: { ...file.document, runs: { experiments: ids.map(trained) } },
  }
}

function chip(wrapper: VueWrapper, label: string) {
  const found = wrapper
    .findComponent(PredictFilters)
    .findAll('button[aria-pressed]')
    .find((one) => one.text() === label)
  expect(found, label).toBeDefined()
  return found!
}

describe('이미지 예측 필터는 새 학습 뒤에도 남는다', () => {
  it('끈 알고리즘은 꺼진 채이고 새 실험은 켜진다', async () => {
    const project = useProjectStore()
    await project.save(withExperiments(imagePredictProject(['a']), ['experiment-1']))
    const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
    await flushPromises()

    const knn = i18n.global.t('algorithms.knn')
    await chip(wrapper, knn).trigger('click')
    expect(chip(wrapper, knn).attributes('aria-pressed')).toBe('false')

    // 한 번 더 학습한 셈이다 — 실험이 하나 는다.
    project.update((live) => withExperiments(live, ['experiment-1', 'experiment-2']))
    await flushPromises()

    expect(chip(wrapper, knn).attributes('aria-pressed')).toBe('false')
    const tree = i18n.global.t('algorithms.decision_tree')
    const pressed = wrapper
      .findComponent(PredictFilters)
      .findAll('button[aria-pressed="true"]')
      .filter((one) => one.text() !== tree)
    expect(pressed.length, 'both experiments are on').toBe(2)
    wrapper.unmount()
  })
})
