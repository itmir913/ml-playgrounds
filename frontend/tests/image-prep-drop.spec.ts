// @vitest-environment jsdom
/**
 * **전처리 화면에서 테스트 사진을 굽는 동안** 무슨 일이 나는가 (architecture.md §8.10.4).
 *
 * R21 감사가 이 화면을 안 읽었고, **그 뒤로 두 번 고쳐졌다** — 굽기 손잡이를 일에
 * 맡기게 했고(그러자 취소가 **처음으로 도착했다**), 그 거절을 삼키게 했다. 그 둘을
 * 지키는 것이 지금까지 `ui-rules`의 **글자 검사 하나**뿐이었다: 파일 어딘가에
 * `JOB_CANCELLED`가 있으면 통과라, `===`를 `!==`로 뒤집어도 2,797개가 초록이었다
 * (2026-09-02 R22 B-3).
 *
 * **진짜 입구로 간다.** 라디오 ②를 눌러 놓는 자리를 세우고 그 요소에 `drop`을 던진다 —
 * 안쪽 함수를 직접 부르면 **자리가 서지도 않은 채 통과하는** 검사가 된다.
 *
 * 굽기가 끝나는 시점은 검사가 정한다 (`tests/fixtures/image-workers.ts`).
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { addImages, readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePrepPanel from '../src/views/preprocess/ImagePrepPanel.vue'
import {
  dropEvent,
  HARNESS_BACKBONE,
  resetImageWorkers,
  settleSave,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

// 자리 판정은 이 검사의 주제가 아니다. 없으면 `navigator.storage`가 답을 못 한다.
vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

/** 매크로태스크 한 번. 파일을 읽고 저장하는 동안 비켜 준다. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * **두 바퀴 돈다.** 굽기가 끝난 뒤가 `저장 → 알림`이라 한 바퀴로는 알림까지 안 온다 —
 * 한 바퀴만 돌렸을 때 **사진은 앉았는데 알림이 안 뜬 것**으로 보였다.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 화면 안쪽. 굽는 창이 열려 있는지를 이것으로 확인한다. */
interface PanelInternals {
  busy: boolean
}

/**
 * 범주 폴더에서 끌어온 사진 하나. **폴더 이름이 곧 범주다**
 * (`data/image/upload.ts`의 `categoryOf`).
 */
function photo(category: string, name: string): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })
  Object.defineProperty(file, 'webkitRelativePath', { value: `${category}/${name}` })
  return file
}

/** 범주 둘에 사진이 든 이미지 프로젝트. 테스트 사진을 받으려면 범주가 있어야 한다. */
function imageDataProject(): ProjectFile {
  const backbone = HARNESS_BACKBONE
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image', taskType: 'classification' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
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
    ['개', '개', '고양이', '고양이'].map((category, index) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${category}:${index}`)
      return { hash: hashBytes(bytes), bytes, category }
    }),
    {
      canonicalSize: backbone.canonicalSize,
      now: '2026-09-02T09:00:00.000Z',
      format: 'webp',
    },
  ).project
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

/** 화면을 띄우고 ②("테스트 데이터를 직접 올리기")를 골라 놓는 자리를 세운다. */
async function panelWithDropzone() {
  const project = useProjectStore()
  await project.save(imageDataProject())
  const wrapper = mount(ImagePrepPanel, { global: { plugins: [i18n] } })
  await flushPromises()

  const provided = wrapper.findAll('input[name="image-test-data-choice"]')[1]
  expect(provided).toBeDefined()
  await provided?.trigger('change')
  await flushPromises()

  /** 놓는 자리. **다시 그려지므로 그때그때 찾는다.** */
  const zone = () => wrapper.find('[class*="border-dashed"]')
  expect(zone().exists()).toBe(true)

  const drop = async (files: readonly File[]): Promise<void> => {
    zone().element.dispatchEvent(dropEvent(files))
    await settle()
  }

  return { project, wrapper, zone, drop, panel: wrapper.vm as unknown as PanelInternals }
}

/** 놓는 자리가 굽기를 붙든 채 열려 있는 화면. */
async function panelBaking() {
  const context = await panelWithDropzone()
  workerState.holdBake = true
  await context.drop([photo('개', 'a.jpg'), photo('고양이', 'b.jpg')])

  expect(workerState.baked).toBe(1)
  expect(context.panel.busy).toBe(true)
  return context
}

describe('테스트 사진을 굽는 동안 더 놓으면', () => {
  /**
   * **거절하되 말한다** (architecture.md §8.10.4). 이 화면은 확인 판이 없어 받은 즉시
   * 굽는데, **버튼은 `testDisabled`로 잠기지만 끌어다 놓는 데는 잠글 버튼이 없다.**
   * 그래서 학생은 놓을 수 있고, 놓았는데 아무 일도 안 일어나면 고장으로 읽는다
   * (2026-09-02 R22 B-2).
   */
  it('거절하고 그렇다고 말한다', async () => {
    const { drop } = await panelBaking()
    const toasts = useToastStore()

    await drop([photo('개', 'c.jpg')])

    // 둘째 굽기는 안 열린다.
    expect(workerState.baked).toBe(1)
    expect(toasts.items.map((one) => one.key)).toContain('preprocess.testImagesWhileBusy')
  })

  /**
   * **받을 수 없으면 초대하지 않는다.** 색을 바꾸면 받겠다고 말해 놓고 거절하는 것이라,
   * 학생은 놓은 뒤에야 안 받았음을 안다.
   */
  it('받을 수 없는 동안에는 놓는 자리가 색을 안 바꾼다', async () => {
    const { zone } = await panelBaking()

    await zone().trigger('dragover')
    expect(zone().classes()).not.toContain('border-brand')
    expect(zone().classes()).toContain('border-line-strong')
  })
})

describe('아무것도 안 도는 동안에는', () => {
  it('놓는 자리가 색을 바꿔 받겠다고 말한다', async () => {
    const { zone } = await panelWithDropzone()

    await zone().trigger('dragover')
    expect(zone().classes()).toContain('border-brand')
  })
})

describe('테스트 사진을 굽는 중에 화면을 떠나면', () => {
  /**
   * **취소가 알림으로 남지 않는다.** 손잡이를 일에 맡기게 한 커밋이 거절을 **처음으로
   * 도착하게 만들었고**, 그 `catch`만 `JOB_CANCELLED`를 안 삼켜 다음 화면에
   * *"학습을 멈췄습니다."*라는 빨간 알림이 떴다 — 굽기는 학습이 아니고 여기는 학습
   * 화면도 아니다 (2026-09-02 R22 B-3).
   */
  it('워커가 끊기고 취소가 빨간 알림으로 남지 않는다', async () => {
    const { wrapper } = await panelBaking()
    const toasts = useToastStore()

    wrapper.unmount()
    await settle()

    expect(workerState.terminated.bake).toBe(1)
    expect(toasts.items).toEqual([])
  })

  it('끊긴 굽기는 테스트 사진을 안 앉힌다', async () => {
    const { wrapper, project } = await panelBaking()

    wrapper.unmount()
    await settle()

    expect(readImages(project.file, 'test')).toHaveLength(0)
  })
})

describe('굽기가 끝나면', () => {
  it('테스트 사진이 앉고 성공 알림이 뜬다', async () => {
    const { project } = await panelBaking()
    const toasts = useToastStore()

    workerState.bake[0]?.deliver()
    await settle()
    // **저장이 끝나야 알림이 온다** (R24 B-4). 틱 몇 번으로는 전체 실행에서 어긋난다.
    await settleSave(project, settle)

    expect(readImages(project.file, 'test')).toHaveLength(2)
    expect(toasts.items.map((one) => one.key)).toContain('preprocess.testImagesAdded')
    expect(toasts.items.filter((one) => one.tone === 'danger')).toEqual([])
  })
})
