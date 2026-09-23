// @vitest-environment jsdom
/**
 * **이미지 전처리 판의 층화 잠금** (`open-decisions.md` 55, R38-D55 C-7 (다)).
 *
 * 표와 같은 판정(`stratifyBlockFor`)에 **같은 분할 설정**을 넘겨야 화면이 잠그는 조건과 학습이
 * 무시하는 조건이 같다. 이 판을 띄우는 스펙이 없어서 판정에 분할 설정을 안 넘겨도(N11), 아예
 * 안 잠가도(N22) 조용했다. 시험 비율이 층화를 막는 사유(`SPLIT_STRATIFY_SHARE_TOO_SMALL`)로
 * **양쪽을** 잰다 — 잠기는 비율과 풀리는 비율.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages } from '../src/project/images'
import { withSplit } from '../src/project/settings'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import { HARNESS_BACKBONE, resetImageWorkers, stubDialogElement } from './fixtures/image-workers'

const NOW = '2026-09-23T00:00:00.000Z'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 범주 셋에 두 장씩 — 여섯 장. 시험 몫이 셋보다 적으면 층화가 성립하지 않는다. */
function threeByTwo(testSize: number): ProjectFile {
  const backbone = HARNESS_BACKBONE
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '세 동물', locale: 'ko', dataType: 'image', taskType: 'classification' },
    { projectId: '550e8400-e29b-41d4-a716-446655440000', createdAt: NOW, randomState: 42 },
  )
  const empty: ProjectFile = {
    document: withSplit(document, { testSize, stratify: true }, NOW),
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    ['개', '개', '고양이', '고양이', '토끼', '토끼'].map((category, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${category}:${index}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    { canonicalSize: backbone.canonicalSize, now: NOW, format: 'webp' },
  ).project
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

async function panelWith(testSize: number): Promise<VueWrapper> {
  await useProjectStore().save(threeByTwo(testSize))
  const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  return wrapper
}

function stratifyBox(wrapper: VueWrapper): HTMLInputElement {
  const label = wrapper
    .findAll('label')
    .find((one) => one.text().trim() === i18n.global.t('preprocess.stratify'))
  expect(label, 'stratify checkbox').toBeDefined()
  return label!.find('input[type="checkbox"]').element as HTMLInputElement
}

describe('이미지 판의 층화 잠금은 시험 비율을 본다', () => {
  it('시험 몫이 범주 수보다 적으면 켜진 채 잠기고 이유를 말한다', async () => {
    const wrapper = await panelWith(0.2)
    const box = stratifyBox(wrapper)
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    expect(wrapper.text()).toContain('적용되지 않습니다')
    wrapper.unmount()
  })

  it('시험 몫이 범주 수만큼이면 풀린다', async () => {
    const wrapper = await panelWith(0.5)
    const box = stratifyBox(wrapper)
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)
    wrapper.unmount()
  })
})
