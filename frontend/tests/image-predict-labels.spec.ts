// @vitest-environment jsdom
/**
 * **예측 화면은 폴더 이름을 읽지 않는다** (#38 코드 소유자 결정 7).
 *
 * 예측 사진에는 라벨이 없다 — 읽기 함수가 화면을 가리지 않고 최상위 폴더를 범주로 읽어
 * 이름을 검사해서, **쓰지도 않는 폴더 이름 때문에 예측 zip·폴더가 통째로 거절됐다.**
 * 여기서는 진짜 입구(판에 놓기)로 재고, 데이터 화면이 같은 입력을 지금처럼 거절하는지도 본다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { zipSync } from 'fflate'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import ko from '../src/locales/ko.json'
import { readImages } from '../src/project/images'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import {
  dropEvent,
  imagePredictProject,
  resetImageWorkers,
  stubDialogElement,
} from './fixtures/image-workers'
import { resetDatabase } from './fixtures/database'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

interface Internals {
  onDrop: (event: Event) => void
  pending: readonly { path: string; category: string }[] | null
}

/** 범주 규칙에 안 맞는 폴더 이름 둘 — 밑줄로 시작하고, 마침표로 끝난다. */
const BAD_FOLDERS = ['_x/1.png', 'a./2.png'] as const

function zipFile(paths: readonly string[]): File {
  const entries: Record<string, Uint8Array> = {}
  paths.forEach((path, index) => {
    entries[path] = new Uint8Array([1, 2, 3, index])
  })
  return new File([zipSync(entries)], 'photos.zip', { type: 'application/zip' })
}

/** 폴더를 통째로 고른 것 — 브라우저가 `webkitRelativePath`에 구조를 싣는다. */
function folderPick(paths: readonly string[]): File[] {
  return paths.map((path, index) => {
    const file = new File([new Uint8Array([4, 5, index])], path.slice(path.lastIndexOf('/') + 1), {
      type: 'image/png',
    })
    Object.defineProperty(file, 'webkitRelativePath', { value: `picked/${path}` })
    return file
  })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  closeStorage()
  await resetDatabase()
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
  await resetDatabase()
})

async function predictPanel() {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  return { project, wrapper, panel: wrapper.vm as unknown as Internals }
}

async function dataPanel() {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePanel, {
    props: { accept: 'image/*' },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return { project, wrapper, panel: wrapper.vm as unknown as Internals }
}

const toastKeys = (): readonly string[] => useToastStore().items.map((one) => one.key)

describe('예측 화면에 놓은 zip·폴더는', () => {
  /** 사진이 아닌 파일은 세기 전에 빠지고 몇 개인지 말한다 (open-decisions.md 108). */
  it('사진이 아닌 파일은 앉지 않고 뺀 수를 말한다', async () => {
    const { project, wrapper, panel } = await predictPanel()

    panel.onDrop(dropEvent([zipFile(['a/1.jpg', 'a/1.txt', 'notes.csv'])]))
    await settle()

    expect(readImages(project.file, 'predict')).toHaveLength(1)
    const toast = useToastStore().items.find((one) => one.key === 'data.image.notImages')
    expect(toast?.params).toEqual({ count: 2 })
    wrapper.unmount()
  })

  it('범주 규칙에 안 맞는 폴더 이름이 있어도 받고 사진이 전부 앉는다 - zip', async () => {
    const { project, wrapper, panel } = await predictPanel()

    panel.onDrop(dropEvent([zipFile(BAD_FOLDERS)]))
    await settle()

    expect(toastKeys()).not.toContain('client.IMAGE_CATEGORY_NAME_INVALID')
    expect(readImages(project.file, 'predict')).toHaveLength(BAD_FOLDERS.length)
    wrapper.unmount()
  })

  it('범주 규칙에 안 맞는 폴더 이름이 있어도 받고 사진이 전부 앉는다 - 폴더를 놓기', async () => {
    const { project, wrapper, panel } = await predictPanel()

    panel.onDrop(dropEvent(folderPick(BAD_FOLDERS)))
    await settle()

    expect(toastKeys()).not.toContain('client.IMAGE_CATEGORY_NAME_INVALID')
    expect(readImages(project.file, 'predict')).toHaveLength(BAD_FOLDERS.length)
    wrapper.unmount()
  })

  /**
   * **진짜 입구 — [사진 추가] 메뉴의 [폴더 선택]** (#38). 메뉴가 판의 폴더 input을 열고, 학생이 고른
   * 폴더가 그 input의 `change`로 온다. 놓기와 같은 문(`readPicked`)이지만 길이 다르니 따로 잰다.
   */
  it('범주 규칙에 안 맞는 폴더 이름이 있어도 받고 사진이 전부 앉는다 - 메뉴의 폴더 선택', async () => {
    const { project, wrapper } = await predictPanel()

    const trigger = wrapper.findAll('button').filter((one) => one.text() === ko.predict.image.add)
    expect(trigger).toHaveLength(1)
    await trigger[0]!.trigger('click')
    await settle()
    const row = [
      ...(document.body.querySelector('.popover-panel')?.querySelectorAll('button') ?? []),
    ].find((one) => one.textContent?.trim() === ko.data.image.source.folder)
    expect(row).toBeDefined()
    const folder = wrapper.find<HTMLInputElement>('input[type="file"][webkitdirectory]').element
    const opened = vi.spyOn(folder, 'click')
    row!.click()
    await flushPromises()
    expect(opened).toHaveBeenCalledTimes(1)

    Object.defineProperty(folder, 'files', {
      configurable: true,
      value: folderPick(BAD_FOLDERS),
    })
    folder.dispatchEvent(new Event('change'))
    await settle()

    expect(toastKeys()).not.toContain('client.IMAGE_CATEGORY_NAME_INVALID')
    expect(readImages(project.file, 'predict')).toHaveLength(BAD_FOLDERS.length)
    wrapper.unmount()
  })

  /** **경로가 유일한 열쇠로 남는다** — 파일 이름만 보면 둘이 한 칸으로 접힌다. */
  it('같은 이름이 다른 폴더에 있으면 둘 다 앉는다', async () => {
    const { project, wrapper, panel } = await predictPanel()

    panel.onDrop(dropEvent([zipFile(['a/1.png', 'b/1.png'])]))
    await settle()

    expect(readImages(project.file, 'predict')).toHaveLength(2)
    wrapper.unmount()
  })
})

describe('데이터 화면에 놓은 같은 zip은', () => {
  /** **데이터 화면은 폴더가 라벨이다** — 다듬어 받으면 라벨이 조용히 바뀐다. 지금처럼 거절한다. */
  it('지금처럼 이름을 대며 거절한다', async () => {
    const { project, wrapper, panel } = await dataPanel()

    panel.onDrop(dropEvent([zipFile(BAD_FOLDERS)]))
    await settle()

    expect(toastKeys()).toContain('client.IMAGE_CATEGORY_NAME_INVALID')
    expect(panel.pending).toBeNull()
    expect(readImages(project.file)).toHaveLength(0)
    wrapper.unmount()
  })
})
