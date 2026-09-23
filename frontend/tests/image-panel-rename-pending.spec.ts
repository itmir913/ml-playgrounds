// @vitest-environment jsdom
/**
 * **확인 판에 선 사진 묶음이 범주 이름을 들고 있는 동안 그 이름이 바뀌면** (2026-09-23,
 * R38 A-1).
 *
 * 범주 카드에 사진을 놓으면 묶음이 **그 범주 이름을 문자열로** 들고 확인 판에 선다.
 * 그동안 같은 화면의 [이름 변경]·[범주 삭제]가 잠기지 않는데(확인 판은 `busy`가 아니다),
 * 굽을 때 묶음의 **옛 이름**이 그대로 `addImages`에 가고 `addImages`는 목록에 없는 범주를
 * **새로 만든다.** 학생이 방금 지운 이름이 되살아나고, 새 사진이 **다른 클래스**로 학습된다.
 *
 * **두 시점 비교다.** 이름을 바꾼 **뒤** 굽기를, **처음부터** 새 이름 칸에 놓고 굽기와 견준다.
 * 둘이 같아야 한다.
 *
 * **진짜 입구로 몬다** — 카드의 놓기(`readPicked`)·이름 창(`naming`→`commitName`)·삭제
 * 창(`removingCategory`→`commitRemoveCategory`)·[이 사진 사용](`bake`). 굽기는 저장소의 가짜
 * 워커(`fixtures/image-workers`)다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { IMAGE_UNLABELED } from '../src/project/format'
import { imageCategories, readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import { imagePredictProject, resetImageWorkers, stubDialogElement } from './fixtures/image-workers'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

/** 화면 안쪽. 놓기·이름 창·삭제 창·굽기를 진짜 함수로 부른다. */
interface PanelInternals {
  readPicked: (files: readonly File[], into: string) => Promise<void>
  naming: { mode: 'create' | 'rename'; from: string; value: string } | null
  commitName: () => Promise<void>
  removingCategory: string | null
  commitRemoveCategory: () => Promise<void>
  bake: () => Promise<void>
  pending: readonly { path: string; category: string }[] | null
}

const file = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

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

/** 사진 없는 이미지 프로젝트에 범주 하나를 **화면으로** 만들어 띄운다. */
async function panelWith(category: string) {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
  await flushPromises()
  const panel = wrapper.vm as unknown as PanelInternals

  panel.naming = { mode: 'create', from: '', value: category }
  await panel.commitName()
  await settle()
  expect(imageCategories(project.file)).toEqual([category])
  return { project, panel }
}

/** 판에 선 묶음을 굽고, 범주 목록과 사진이 앉은 범주를 돌려준다. */
async function bakeAndRead(
  project: ReturnType<typeof useProjectStore>,
  panel: PanelInternals,
): Promise<{ categories: readonly string[]; landedIn: readonly string[] }> {
  await panel.bake()
  await settle()
  return {
    categories: imageCategories(project.file),
    landedIn: readImages(project.file).map((one) => one.category),
  }
}

describe('확인 판의 묶음이 범주 편집을 따라간다', () => {
  it('처음부터 새 이름 칸에 놓고 구우면 — 견줄 기준', async () => {
    const { project, panel } = await panelWith('cat')
    await panel.readPicked([file('a.jpg')], 'cat')
    await settle()

    expect(await bakeAndRead(project, panel)).toEqual({ categories: ['cat'], landedIn: ['cat'] })
  })

  /**
   * **이름을 바꾼 뒤 구워도 처음부터와 같다.** 고치기 전에는 `[cat, 고양이]`에 사진이
   * `고양이`로 앉았다 — 지운 이름이 되살아났다.
   */
  it('판에 선 뒤 이름을 바꾸면 사진이 새 이름으로 간다', async () => {
    const { project, panel } = await panelWith('고양이')
    await panel.readPicked([file('a.jpg')], '고양이')
    await settle()

    panel.naming = { mode: 'rename', from: '고양이', value: 'cat' }
    await panel.commitName()
    await settle()
    // **판이 말하는 것도 따라간다** — 없는 범주 이름을 들고 있으면 바의 요약이 거짓이 된다.
    expect(panel.pending?.map((one) => one.category)).toEqual(['cat'])

    expect(await bakeAndRead(project, panel)).toEqual({ categories: ['cat'], landedIn: ['cat'] })
  })

  /**
   * **범주를 지운 뒤 구우면 라벨 없는 사진이 된다.** 이미 앉은 사진에 `removeCategory`가
   * 하는 일과 같다. 고치기 전에는 지운 `고양이`가 되살아나 사진이 거기 앉았다.
   */
  it('판에 선 뒤 범주를 지우면 사진이 라벨 없음으로 간다', async () => {
    const { project, panel } = await panelWith('고양이')
    await panel.readPicked([file('a.jpg')], '고양이')
    await settle()

    panel.removingCategory = '고양이'
    await panel.commitRemoveCategory()
    await settle()
    expect(panel.pending?.map((one) => one.category)).toEqual([IMAGE_UNLABELED])

    const after = await bakeAndRead(project, panel)
    expect(after.categories).toEqual([])
    expect(after.landedIn).toEqual([IMAGE_UNLABELED])
  })
})
