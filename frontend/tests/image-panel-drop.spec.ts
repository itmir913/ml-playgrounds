// @vitest-environment jsdom
/**
 * **데이터 화면에서 굽는 동안 사진을 더 놓으면** 무슨 일이 나는가 (architecture.md §8.10.4).
 *
 * R21 감사가 실측한 A급이 여기 있었다 — 둘째 묶음이 확인 판에 섰다가 첫 굽기가 끝나며
 * **말없이 사라지고**, 그 사이 `busy`까지 풀려 굽는 중인데 [이 사진 사용]과 삭제·이동이
 * 전부 열렸다. 학생은 판에 선 것을 보고 있다가 잃는다.
 *
 * **띄워서 본다.** 굽기가 끝나는 시점을 검사가 정해야 겹치는 창이 생긴다
 * (`tests/fixtures/image-workers.ts`).
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { zipSync } from 'fflate'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { readImages } from '../src/project/images'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import {
  dropEvent,
  imagePredictProject,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

/**
 * 자리 판정은 이 검사의 주제가 아니다 — 언제나 자리가 있다. 다만 **답하는 시점은 검사가
 * 정한다**: `hold`가 참이면 `bake()`가 자리를 묻는 `await`에 멈춰 서고, 그 사이가
 * `busy`를 보고 나서 일을 잡기까지의 창이다 (2026-09-02 R22 재감사 B-1′).
 */
const room = vi.hoisted(() => ({ hold: false, fails: false, waiting: [] as (() => void)[] }))

vi.mock('../src/data/image/room', () => ({
  imageRoomShortfall: async () => {
    if (room.hold) await new Promise<void>((resolve) => room.waiting.push(resolve))
    // **묻다가 던지는 길이 있다.** `detectCanonicalFormat`은 2d 컨텍스트가 없거나
    // 구울 수 있는 형식이 하나도 없으면 던진다 (`data/image/bake.ts`).
    if (room.fails) throw new Error('room check unavailable')
    return null
  },
}))

function releaseRoom(): void {
  const waiting = [...room.waiting]
  room.waiting.length = 0
  for (const one of waiting) one()
}

/**
 * 사진 상한. **검사가 그때그때 정한다** — 기본값으로는 상한에 닿는 데 수천 장이 든다.
 * `beforeEach`가 무한대로 되돌리므로 **다른 검사는 상한을 안 만난다.**
 */
const limits = vi.hoisted(() => ({ images: Number.POSITIVE_INFINITY }))

vi.mock('../src/limits-switch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/limits-switch')>()
  return { ...actual, maxImageCount: () => limits.images }
})

/** 매크로태스크 한 번. `readImageFiles`가 파일을 읽는 동안 비켜 준다. */
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

/** 화면 안쪽. **띄운 판에 직접 묻는다** — 드롭과 굽기의 순서를 검사가 정해야 해서다. */
interface PanelInternals {
  bake: () => Promise<void>
  onDrop: (event: Event) => void
  cancelBaking: () => void
  busy: boolean
  pending: readonly { path: string }[] | null
  waiting: readonly { path: string }[] | null
  baking: readonly { path: string }[] | null
}

const file = (name: string): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

const renamed =
  (name: string) =>
  (current: ProjectFile): ProjectFile => ({
    ...current,
    document: {
      ...current.document,
      manifest: { ...current.document.manifest, name },
    },
  })

beforeEach(async () => {
  setActivePinia(createPinia())
  limits.images = Number.POSITIVE_INFINITY
  room.hold = false
  room.fails = false
  room.waiting.length = 0
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

/** 사진 없는 이미지 프로젝트를 띄우고, `a.jpg`를 확인 판에 세운 뒤 굽기를 열어 둔다. */
async function panelBaking() {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
  await flushPromises()
  const panel = wrapper.vm as unknown as PanelInternals

  panel.onDrop(dropEvent([file('a.jpg')]))
  await settle()
  expect(panel.pending?.map((one) => one.path)).toEqual(['a.jpg'])

  workerState.holdBake = true
  const baking = panel.bake()
  await flushPromises()
  expect(workerState.baked).toBe(1)
  expect(panel.busy).toBe(true)

  return { project, wrapper, panel, baking }
}

describe('굽는 동안 사진을 더 놓으면', () => {
  it('굽는 중인 자물쇠가 안 풀린다', async () => {
    const { panel, wrapper, baking } = await panelBaking()

    panel.onDrop(dropEvent([file('b.jpg')]))
    await settle()

    // **읽기가 끝나도 굽기는 돈다.** `busy`가 칸 하나였을 때 여기서 풀렸다.
    expect(panel.busy).toBe(true)
    const use = wrapper.findAll('button').find((one) => one.text() === '이 사진 사용')
    expect(use?.attributes('disabled')).toBeDefined()

    workerState.bake[0]?.deliver()
    await baking
    await settle()
    expect(panel.busy).toBe(false)
  })

  it('둘째 묶음이 확인 판에 남는다', async () => {
    const { project, panel, baking } = await panelBaking()

    panel.onDrop(dropEvent([file('b.jpg')]))
    await settle()
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg'])

    workerState.bake[0]?.deliver()
    await baking
    await settle()

    // 구운 것은 들어가고, **놓은 것은 판에 그대로 서 있다.**
    expect(readImages(project.file)).toHaveLength(1)
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg'])
    expect(useToastStore().items.map((one) => one.key)).toContain('data.image.added')
  })

  it('굽기를 취소해도 새로 놓은 묶음은 남는다', async () => {
    const { project, panel, baking } = await panelBaking()

    panel.onDrop(dropEvent([file('b.jpg')]))
    await settle()

    panel.cancelBaking()
    await baking
    await settle()

    // 취소는 학생이 누른 것이라 실패로 말하지 않는다. 지워지는 것은 **굽던 묶음뿐이다.**
    expect(readImages(project.file)).toHaveLength(0)
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg'])
    expect(useToastStore().items.filter((one) => one.tone === 'danger')).toEqual([])
  })
})

describe('굽기가 끝나 사진을 앉힐 때', () => {
  it('붙든 파일이 아니라 지금 파일에 얹는다', async () => {
    const { project, panel, baking } = await panelBaking()

    // 굽는 동안 프로젝트가 달라진다 — 다른 화면의 편집이나 자동 저장이 이 자리다.
    await project.save(renamed('학생이 굽는 동안 바꾼 이름'))

    workerState.bake[0]?.deliver()
    await baking
    await settle()

    expect(readImages(project.file)).toHaveLength(1)
    // 스냅샷을 통째로 쓰면 이 이름이 되돌아간다 (architecture.md §8.10.3).
    expect(project.name).toBe('학생이 굽는 동안 바꾼 이름')
    expect(panel.busy).toBe(false)
  })
})

/**
 * **상한은 받을 때와 굽기 직전 두 번 묻는다** (architecture.md §8.10.4).
 *
 * 받을 때의 판정은 **지금 파일**의 장수를 세는데, 굽는 중에 놓은 묶음은 **앞 묶음이
 * 아직 파일에 안 앉은 수**로 통과한다. 둘 다 앉고 나면 상한을 넘어 있다.
 *
 * **R21이 살리기 전까지는 아무도 이 자리에 닿지 못했다** — 그전에는 둘째 묶음이 첫
 * 굽기가 끝나며 말없이 사라졌다 (2026-09-02 R22 B-1).
 */
describe('상한 가까이에서 굽는 중에 더 놓으면', () => {
  it('한꺼번에 놓으면 상한에서 막힌다 - 우회할 것이 있다는 뜻이다', async () => {
    limits.images = 2
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([file('a.jpg'), file('b.jpg'), file('c.jpg')]))
    await settle()

    expect(panel.pending).toBeNull()
    expect(useToastStore().items.map((one) => one.key)).toContain('client.IMAGE_TOO_MANY_PHOTOS')
  })

  it('굽는 중에 놓아 나눠 넣어도 상한을 못 넘는다', async () => {
    limits.images = 2
    const { project, panel, baking } = await panelBaking()

    // 둘째 묶음은 **첫 묶음이 아직 안 앉은 수**로 통과해 확인 판에 선다.
    panel.onDrop(dropEvent([file('b.jpg'), file('c.jpg')]))
    await settle()
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg', 'c.jpg'])

    workerState.bake[0]?.deliver()
    await baking
    await settle()
    expect(readImages(project.file)).toHaveLength(1)

    // 이제 학생이 [이 사진 사용]을 누른다. **여기서 다시 물어야 막힌다.**
    // 굽기를 더는 붙들지 않는다 — 붙든 채면 재확인을 빼도 단언이 아니라 **시간 초과로
    // 운다** (R22 재감사 C-2). 우는 이유는 정직해야 한다.
    workerState.holdBake = false
    await panel.bake()
    await settle()

    expect(readImages(project.file)).toHaveLength(1)
    expect(useToastStore().items.map((one) => one.key)).toContain('client.IMAGE_TOO_MANY_PHOTOS')
    // 거절해도 학생이 놓은 것은 판에 남는다 — 지우고 다시 놓게 하지 않는다.
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg', 'c.jpg'])
    // 워커를 돌리기 전에 막았다 — 기다린 시간을 버리지 않는다.
    expect(workerState.baked).toBe(1)
  })
})

/**
 * **판이 세는 것과 버튼이 하는 일이 어긋나면 안 된다** (architecture.md §8.10.4).
 *
 * 굽는 동안 둘째 묶음이 확인 판에 서면, 판은 **둘째**의 파일 수를 보이는데 같은 줄의
 * 진행 표시와 [취소]는 **첫 굽기**의 것이었다. 학생은 [취소]가 방금 놓은 것을 물릴
 * 줄 안다 (2026-09-02 R22 C-1).
 */
describe('굽는 동안 둘째 묶음이 판에 서면', () => {
  it('바는 도는 묶음을 세고 기다리는 묶음은 따로 말한다', async () => {
    const { panel, wrapper, baking } = await panelBaking()

    panel.onDrop(dropEvent([file('b.jpg'), file('c.jpg')]))
    await settle()

    // 판에 선 것은 둘째 묶음이지만, 바가 세는 것은 도는 묶음이다.
    expect(panel.pending?.map((one) => one.path)).toEqual(['b.jpg', 'c.jpg'])
    expect(wrapper.text()).toContain('파일 1개를 읽었습니다')
    expect(wrapper.text()).toContain('파일 2개는 다음 차례로 기다리는 중입니다')

    workerState.bake[0]?.deliver()
    await baking
    await settle()

    // 굽기가 끝나면 기다리던 묶음이 그대로 판의 주인이 된다.
    expect(panel.waiting).toBeNull()
    expect(wrapper.text()).toContain('파일 2개를 읽었습니다')
  })

  /**
   * **단추 이름은 상태에 따라 안 바뀐다** (2026-09-02, 코드 소유자 판단).
   *
   * 한때 굽는 중에만 「준비 취소」로 바뀌었다 — 무엇을 끊는지 이름으로 말하려던 것인데,
   * **같은 자리의 글자가 상태마다 달라지면 학생이 그 자리를 다시 배워야 한다.** 무엇이
   * 도는지와 무엇이 기다리는지는 바 왼쪽 두 줄이 이미 말한다.
   */
  it('[취소]의 이름은 굽는 중에도 그대로다', async () => {
    const { wrapper, panel, baking } = await panelBaking()

    const labels = () => wrapper.findAll('button').map((one) => one.text())
    expect(labels()).toContain('취소')

    panel.cancelBaking()
    await baking
    await settle()

    expect(labels()).toContain('취소')
  })

  /**
   * **안 구울 때의 [취소]는 판을 접는다.** 이 갈래를 아무도 안 봐서, `cancelBaking`이
   * 언제나 `cancelAll()`을 부르게 바꿔도 전체가 초록이었다 — 그러면 학생이 [취소]를
   * 눌러도 **확인 판이 영영 안 닫힌다** (2026-09-02 R22, 감사자 돌연변이 V6).
   */
  it('굽지 않을 때 [취소]는 확인 판을 접는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([file('a.jpg')]))
    await settle()
    expect(panel.pending).not.toBeNull()

    panel.cancelBaking()
    await settle()
    expect(panel.pending).toBeNull()
  })
})

/**
 * **읽는 것도 도는 일이다.** 압축 파일을 읽는 동안 화면이 안 바쁜 것으로 남으면 삭제·이동과
 * [이 사진 사용]이 열려 있다. 읽기를 `blocks: false`로 바꿔도 2,839개가 초록이었다
 * (2026-09-02 R22 재감사 C-3) — 진짜 파일은 한 마이크로태스크에 읽혀 창이 안 생긴다.
 * **바이트를 붙들어야 보인다** (`tabular-panel-overlap.spec.ts`의 `heldCsv`와 같은 모양).
 */
describe('압축 파일을 읽는 동안', () => {
  /** 바이트를 검사가 줄 때까지 안 내놓는 zip. 안에는 범주 폴더 하나와 사진 하나다. */
  function heldZip(): { file: File; release: () => void } {
    const bytes = zipSync({ '개/a.jpg': new Uint8Array([1, 2, 3]) })
    const real = new File([bytes], 'photos.zip', { type: 'application/zip' })
    let open!: () => void
    const waiting = new Promise<void>((resolve) => {
      open = resolve
    })
    Object.defineProperty(real, 'arrayBuffer', {
      value: async () => {
        await waiting
        return bytes.buffer
      },
    })
    return { file: real, release: open }
  }

  it('화면이 바쁜 것으로 남는다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    expect(panel.busy).toBe(false)

    const held = heldZip()
    panel.onDrop(dropEvent([held.file]))
    await flushPromises()
    expect(panel.busy).toBe(true)

    held.release()
    await settle()
    expect(panel.busy).toBe(false)
    expect(panel.pending?.map((one) => one.path)).toEqual(['개/a.jpg'])
  })
})

/**
 * **굽기는 일을 먼저 잡고 나서 묻는다** (architecture.md §8.10.4).
 *
 * 상한을 다시 묻는 자리(R22 B-1)가 `busy` 검사와 `start()` 사이에 `await`를 끼워 넣었고,
 * 그 사이는 **`busy`가 거짓인 창**이었다 — 굽기를 한 번 더 부르면 워커가 둘 떴고, [취소]를
 * 누르면 판은 닫히는데 굽기는 그대로 시작해 사진이 앉았다 (2026-09-02 R22 재감사 B-1′).
 * 화면에서 두 번 누르기를 막던 것은 `busy`가 아니라 `AppButton`의 `running`뿐이었다.
 *
 * `imageRoomShortfall`을 붙들어 그 창을 열어 둔 채 잰다.
 */
describe('굽기가 자리를 묻는 동안', () => {
  /** `a.jpg`를 판에 세우고 굽기를 자리 묻기에서 멈춰 세운다. */
  async function panelAskingRoom() {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([file('a.jpg')]))
    await settle()
    expect(panel.pending?.map((one) => one.path)).toEqual(['a.jpg'])

    room.hold = true
    const baking = panel.bake()
    await flushPromises()
    expect(workerState.baked).toBe(0)
    return { project, wrapper, panel, baking }
  }

  it('이미 바쁘고, 한 번 더 불러도 굽기는 하나만 뜬다', async () => {
    const { panel, baking } = await panelAskingRoom()
    expect(panel.busy).toBe(true)

    const again = panel.bake()
    await flushPromises()

    releaseRoom()
    await baking
    await again
    await settle()
    expect(workerState.baked).toBe(1)
    expect(panel.busy).toBe(false)
  })

  it('[취소]를 누르면 굽기가 시작되지 않고 묶음은 판에 남는다', async () => {
    const { project, wrapper, panel, baking } = await panelAskingRoom()
    // **아직 진행 표시는 없지만 굽는 중이다.** 그래서 [취소]가 판을 접는 것이 아니라
    // 굽기를 막아야 한다 — 단추 이름은 이 둘을 구별하지 않는다(코드 소유자 판단).
    expect(wrapper.findAll('button').map((one) => one.text())).toContain('취소')

    panel.cancelBaking()
    releaseRoom()
    await baking
    await settle()

    expect(workerState.baked).toBe(0)
    expect(readImages(project.file)).toHaveLength(0)
    expect(panel.pending?.map((one) => one.path)).toEqual(['a.jpg'])
    expect(panel.busy).toBe(false)
    expect(useToastStore().items.filter((one) => one.tone === 'danger')).toEqual([])
  })
})

/**
 * **자리를 묻다가 던지면 어떻게 되는가** (2026-09-02 R22 재감사 뒤).
 *
 * 재감사가 `start()`를 `await` 앞으로 옮기면서 **그 `await`가 일을 잡은 채로 `try` 밖에
 * 남았다.** `imageRoomShortfall`은 던질 수 있다 — `detectCanonicalFormat`이 2d 컨텍스트를
 * 못 잡거나 구울 수 있는 형식이 하나도 없으면 던지고, 그 길은 낡은 학교 PC가 기준
 * 기기라는 전제에서 죽은 가지가 아니다.
 *
 * 그러면 `job.done()`이 영영 안 돌아 **`busy`가 참인 채로 굳는다** — [이 사진 사용]이
 * 꺼진 채로 남고 학생은 그 화면에서 아무것도 못 한다.
 */
describe('자리를 묻다가 실패하면', () => {
  it('자물쇠가 풀리고 학생이 다시 누를 수 있다', async () => {
    const project = useProjectStore()
    await project.save(imagePredictProject([]))
    const wrapper = mount(ImagePanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals

    panel.onDrop(dropEvent([file('a.jpg')]))
    await settle()
    expect(panel.pending).not.toBeNull()

    room.fails = true
    await panel.bake()
    await settle()

    // **자물쇠가 풀린다.** 안 풀리면 이 화면은 되돌릴 길이 없다.
    expect(panel.busy).toBe(false)
    expect(panel.baking).toBeNull()
    // 묶음은 판에 남는다 — 학생이 다시 누를 수 있어야 한다.
    expect(panel.pending).not.toBeNull()
    // **말없이 삼키지 않는다.** 눌렀는데 아무 일도 안 나면 학생은 고장으로 읽는다.
    expect(useToastStore().items.filter((one) => one.tone === 'danger')).not.toEqual([])
  })
})
