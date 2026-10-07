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
 * **학생의 손으로 몬다** (2026-09-23 R38-V V-C1) — 카드에 **놓기 사건** → 카드의 [이름 변경]·
 * [범주 삭제] **단추** → 대화상자의 **칸과 확인 단추** → 바의 [이 사진 사용] **단추**. 처음에는
 * `panel.readPicked(files, '고양이')`처럼 함수를 직접 부르고 이름 창에 값을 넣었는데, 그러면
 * 카드의 `@drop`이 범주를 잃어도(V14 — **A-1의 입구 그 자체**), 카드의 `@rename`·`@remove`를
 * 끊어도(V12·V13), 카드의 단추가 사건을 안 올려도(V19) 초록이었다. 판의 안쪽은 **읽기만** 하고,
 * 고르기(`toggle`)만 함수로 부른다 — 그 이음매는 이 파일의 주제가 아니다.
 *
 * 굽기는 저장소의 가짜 워커(`fixtures/image-workers`)다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppDialog from '../src/components/AppDialog.vue'
import { i18n, setLocale } from '../src/i18n'
import { IMAGE_UNLABELED } from '../src/project/format'
import * as images from '../src/project/images'
import { imageCategories, readImages, removeImages } from '../src/project/images'
import { dataSettings } from '../src/project/schema'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import ImageGrid from '../src/views/data/ImageGrid.vue'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import { imagePredictProject, resetImageWorkers, stubDialogElement } from './fixtures/image-workers'
import { resetDatabase } from './fixtures/database'

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return { spawnCanonicalizeWorker: fakeCanonicalizeWorker }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

/** 켜면 저장이 쿼터로 거절된다 — `image-panel-fail.spec.ts`와 같은 방식. */
const storageGate = vi.hoisted(() => ({ failSave: false }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  const { ClientError } = await import('../src/errors')
  return {
    ...actual,
    saveProject: async (file: Parameters<typeof actual.saveProject>[0]) => {
      if (storageGate.failSave) {
        throw new ClientError('STORAGE_QUOTA_EXCEEDED', { requiredMb: 9, availableMb: 1 })
      }
      return actual.saveProject(file)
    },
  }
})

/** 화면 안쪽. **읽기만** 한다 — 고르기(`toggle`) 하나만 부른다. */
interface PanelInternals {
  selected: ReadonlySet<string>
  anchor: { category: string; hash: string } | null
  toggle: (category: string, hash: string, extend: boolean) => void
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

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  closeStorage()
  await resetDatabase()
  stubDialogElement()
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  await setLocale('ko')
})

afterEach(async () => {
  storageGate.failSave = false
  vi.restoreAllMocks()
  closeStorage()
  await resetDatabase()
})

const t = (key: string): string => i18n.global.t(key)

/** 글자가 정확히 `key`의 문구인 단추. `scope` 안에서만 찾는다. */
function buttonIn(scope: Pick<VueWrapper, 'findAll'>, key: string) {
  const found = scope.findAll('button').find((one) => one.text() === t(key))
  expect(found, key).toBeDefined()
  return found!
}

/** 이름이 `label`인 범주 카드. */
function cardOf(wrapper: VueWrapper, label: string) {
  const card = wrapper.findAllComponents(ImageGrid).find((one) => one.props('label') === label)
  expect(card, label).toBeDefined()
  return card!
}

/** 열려 있는 대화상자 — 제목으로 고른다. */
function dialogTitled(wrapper: VueWrapper, key: string) {
  const dialog = wrapper
    .findAllComponents(AppDialog)
    .find((one) => one.props('open') === true && one.props('title') === t(key))
  expect(dialog, key).toBeDefined()
  return dialog!
}

/**
 * 카드에 사진을 **끌어다 놓는다.** `trigger('drop', { dataTransfer })`는 jsdom에서 조용히
 * 안 심긴다 — `inspect-drop.spec.ts`와 같은 관용구로 직접 심는다.
 */
async function dropOn(wrapper: VueWrapper, label: string, files: File[]): Promise<void> {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files }, configurable: true })
  // **`card.element`가 아니다** — 카드는 머리 주석을 앞에 둔 조각이라 루트가 주석 노드이고,
  // 거기 쏜 사건은 **판의 놓기**로 올라가 라벨 없음으로 들어간다. 떨어뜨리는 자리는 `section`이다.
  cardOf(wrapper, label).find('section').element.dispatchEvent(event)
  await settle()
}

/** 이름 창에 이름을 치고 확인을 누른다. */
async function typeName(wrapper: VueWrapper, titleKey: string, confirmKey: string, value: string) {
  const dialog = dialogTitled(wrapper, titleKey)
  await dialog.find('input[type="text"]').setValue(value)
  const confirm = buttonIn(dialog, confirmKey)
  // 잠긴 단추의 클릭은 **조용히 안 먹는다** — 기다리다 시간 초과로 서지 말고 여기서 운다.
  expect(confirm.attributes('disabled'), `${confirmKey} is disabled`).toBeUndefined()
  await confirm.trigger('click')
  await closed(wrapper, titleKey)
}

/**
 * 창이 닫힐 때까지 기다린다. **`settle()` 한 번으로는 모자란다** — 사진이 앉은 뒤에는
 * 저장이 몇 턴 더 걸려, 확인을 누른 직후에 읽으면 옛 이름이 보인다.
 */
async function closed(wrapper: VueWrapper, titleKey: string): Promise<void> {
  await vi.waitFor(() => {
    const open = wrapper
      .findAllComponents(AppDialog)
      .some((one) => one.props('open') === true && one.props('title') === t(titleKey))
    if (open) throw new Error(`${titleKey} still open`)
  }, 10_000)
  await settle()
}

async function rename(wrapper: VueWrapper, from: string, to: string): Promise<void> {
  await buttonIn(cardOf(wrapper, from), 'data.image.rename').trigger('click')
  await typeName(wrapper, 'data.image.renameTitle', 'data.image.renameConfirm', to)
}

async function removeCategory(wrapper: VueWrapper, name: string): Promise<void> {
  await buttonIn(cardOf(wrapper, name), 'data.image.removeCategory').trigger('click')
  const dialog = dialogTitled(wrapper, 'data.image.removeCategoryTitle')
  await buttonIn(dialog, 'data.image.removeCategory').trigger('click')
  await closed(wrapper, 'data.image.removeCategoryTitle')
}

/** 사진 없는 이미지 프로젝트에 범주 하나를 **화면으로** 만들어 띄운다. */
async function panelWith(category: string) {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePanel, { props: { accept: 'image/*' }, global: { plugins: [i18n] } })
  await flushPromises()

  await buttonIn(wrapper, 'data.image.newCategory').trigger('click')
  await typeName(wrapper, 'data.image.createTitle', 'data.image.createConfirm', category)
  expect(imageCategories(project.file)).toEqual([category])
  return { project, wrapper, panel: wrapper.vm as unknown as PanelInternals }
}

/** 바의 [이 사진 사용]을 누르고, 범주 목록과 사진이 앉은 범주를 돌려준다. */
async function bakeAndRead(
  project: ReturnType<typeof useProjectStore>,
  wrapper: VueWrapper,
): Promise<{ categories: readonly string[]; landedIn: readonly string[] }> {
  await buttonIn(wrapper, 'data.image.use').trigger('click')
  // **굽기가 끝날 때까지 기다린다.** 사진이 저장소에 앉은 뒤에도 일이 몇 턴 더 돌고 그동안
  // `busy`라, 바로 [이름 변경]을 누르면 확인 단추가 잠겨 클릭이 조용히 안 먹힌다(간헐 빨강).
  await vi.waitFor(() => {
    const state = wrapper.vm as unknown as PanelInternals & { busy: boolean }
    if (state.pending !== null || state.busy) throw new Error('still baking')
  }, 10_000)
  await settle()
  return {
    categories: imageCategories(project.file),
    landedIn: readImages(project.file).map((one) => one.category),
  }
}

describe('확인 판의 묶음이 범주 편집을 따라간다', () => {
  it('처음부터 새 이름 칸에 놓고 구우면 — 견줄 기준', async () => {
    const { project, wrapper } = await panelWith('cat')
    await dropOn(wrapper, 'cat', [file('a.jpg')])

    expect(await bakeAndRead(project, wrapper)).toEqual({ categories: ['cat'], landedIn: ['cat'] })
  })

  /**
   * **이름을 바꾼 뒤 구워도 처음부터와 같다.** 고치기 전에는 `[cat, 고양이]`에 사진이
   * `고양이`로 앉았다 — 지운 이름이 되살아났다.
   */
  it('판에 선 뒤 이름을 바꾸면 사진이 새 이름으로 간다', async () => {
    const { project, wrapper, panel } = await panelWith('고양이')
    await dropOn(wrapper, '고양이', [file('a.jpg')])
    // 전제: 놓은 칸의 범주를 들고 판에 섰다.
    expect(panel.pending?.map((one) => one.category)).toEqual(['고양이'])

    await rename(wrapper, '고양이', 'cat')
    // **판이 말하는 것도 따라간다** — 없는 범주 이름을 들고 있으면 바의 요약이 거짓이 된다.
    expect(panel.pending?.map((one) => one.category)).toEqual(['cat'])

    expect(await bakeAndRead(project, wrapper)).toEqual({ categories: ['cat'], landedIn: ['cat'] })
  })

  /**
   * **저장이 쿼터로 거절돼도 판의 묶음은 새 이름을 따른다** (R43-1 후속 계획 5차 ②). 스토어는 쓰기 전에 새 값을 들고 있으므로
   * 이름 바꾸기는 이미 적용됐다 — 판을 옛 이름에 두면 구울 때 `addImages`가 옛 이름을 되살린다(R38 A-1 재발). 뒤처리를 "저장
   * 성공"으로 가르면 운다.
   */
  it('쿼터 거절 뒤에도 판의 묶음이 새 이름을 따른다', async () => {
    const { project, wrapper, panel } = await panelWith('고양이')
    await dropOn(wrapper, '고양이', [file('a.jpg')])

    storageGate.failSave = true
    await rename(wrapper, '고양이', 'cat')

    expect(imageCategories(project.file)).toEqual(['cat'])
    expect(panel.pending?.map((one) => one.category)).toEqual(['cat'])
  })

  /**
   * **`renameCategory`가 던지면 파일도 판도 그대로다** (계획 5차 ③). gate가 먼저 막으므로 진짜 입구로는 안 닿는다 — 함수를 던지게
   * 한다. 뒤처리를 표지 없이 늘 하면 판만 `cat`으로 가고, 구우면 `addImages`가 `cat`을 세워 합치기가 이 길로 일어난다.
   */
  it('이름 바꾸기 함수가 던지면 판의 묶음은 옛 이름에 남는다', async () => {
    const { project, wrapper, panel } = await panelWith('고양이')
    await dropOn(wrapper, '고양이', [file('a.jpg')])

    vi.spyOn(images, 'renameCategory').mockImplementation(() => {
      throw new Error('renameCategory: forced')
    })
    await rename(wrapper, '고양이', 'cat')

    expect(imageCategories(project.file)).toEqual(['고양이'])
    expect(panel.pending?.map((one) => one.category)).toEqual(['고양이'])
  })

  /**
   * **범주를 지운 뒤 구우면 라벨 없는 사진이 된다.** 이미 앉은 사진에 `removeCategory`가
   * 하는 일과 같다. 고치기 전에는 지운 `고양이`가 되살아나 사진이 거기 앉았다.
   */
  it('판에 선 뒤 범주를 지우면 사진이 라벨 없음으로 간다', async () => {
    const { project, wrapper, panel } = await panelWith('고양이')
    await dropOn(wrapper, '고양이', [file('a.jpg')])

    await removeCategory(wrapper, '고양이')
    expect(panel.pending?.map((one) => one.category)).toEqual([IMAGE_UNLABELED])

    const after = await bakeAndRead(project, wrapper)
    expect(after.categories).toEqual([])
    expect(after.landedIn).toEqual([IMAGE_UNLABELED])
  })
})

/**
 * **테스트 자리에만 남은 이름으로 바꾸면 이름 창이 거절한다** (106 개정 2, 0.35 감사 C-1). 화면이 gate에 넘기는 `mode`와
 * `testCategories`를 진짜 입구로 문다 — 둘 중 하나가 빠지면 gate가 통과시키고 `renameCategory`가 던져 창 안 문장 대신 오류 알림이 선다.
 */
describe('고아 테스트 이름으로 바꾸기', () => {
  it('창 안에 nameTakenByTest가 서고 함수는 안 불린다', async () => {
    const { project, wrapper } = await panelWith('A')
    await project.save((live) => {
      const applied = images.applyTestImages(
        live,
        [{ hash: 'tc', category: 'C', bytes: new Uint8Array([1]) }],
        { canonicalSize: 224, now: '2026-10-07T00:00:00Z', format: 'webp' },
      ).project
      // 테스트 사진을 앉히면 그 범주가 목록에 서므로 손으로 되돌린다 — 옛 파일의 고아 테스트 폴더다.
      const { document } = applied
      const data = { ...dataSettings('image', document.settings), categories: ['A'] }
      return {
        ...applied,
        document: {
          ...document,
          settings: { ...document.settings, data: data as typeof document.settings.data },
        },
      }
    })
    await settle()
    expect(imageCategories(project.file)).toEqual(['A'])
    const spy = vi.spyOn(images, 'renameCategory')

    await buttonIn(cardOf(wrapper, 'A'), 'data.image.rename').trigger('click')
    const dialog = dialogTitled(wrapper, 'data.image.renameTitle')
    await dialog.find('input[type="text"]').setValue('C')
    await buttonIn(dialog, 'data.image.renameConfirm').trigger('click')
    await settle()

    expect(spy).not.toHaveBeenCalled()
    expect(dialogTitled(wrapper, 'data.image.renameTitle').find('[role="alert"]').text()).toBe(
      t('data.image.nameTakenByTest'),
    )
    expect(imageCategories(project.file)).toEqual(['A'])
  })
})

/**
 * **범주 지우기의 확인 창은 그 범주의 테스트용 사진이 지워진다고 장수와 함께 말한다** (open-decisions.md 106 개정 2). 훈련 사진과
 * 달리 되돌릴 수 없다. 테스트 사진이 없는 범주는 지금 문장 그대로다.
 */
describe('범주 지우기 확인 창이 테스트용 사진 장수를 말한다', () => {
  it('그 범주에 테스트용 사진이 있을 때만', async () => {
    const { project, wrapper } = await panelWith('고양이')
    await dropOn(wrapper, '고양이', [file('a.jpg')])
    await bakeAndRead(project, wrapper)
    await buttonIn(wrapper, 'data.image.newCategory').trigger('click')
    await typeName(wrapper, 'data.image.createTitle', 'data.image.createConfirm', '개')
    await buttonIn(wrapper, 'data.image.newCategory').trigger('click')
    await typeName(wrapper, 'data.image.createTitle', 'data.image.createConfirm', '새')
    await project.save(
      (live) =>
        images.applyTestImages(
          live,
          [
            { hash: 't1', category: '고양이', bytes: new Uint8Array([1]) },
            { hash: 't2', category: '고양이', bytes: new Uint8Array([2]) },
            // 경계 1장 — `count > 0`이 `> 1`이 되어도 조용했다 (R43-5 C-1).
            { hash: 't3', category: '새', bytes: new Uint8Array([3]) },
          ],
          { canonicalSize: 224, now: '2026-10-07T00:00:00Z', format: 'webp' },
        ).project,
    )
    await settle()

    const description = async (name: string): Promise<unknown> => {
      await buttonIn(cardOf(wrapper, name), 'data.image.removeCategory').trigger('click')
      const shown = dialogTitled(wrapper, 'data.image.removeCategoryTitle').props('description')
      await buttonIn(
        dialogTitled(wrapper, 'data.image.removeCategoryTitle'),
        'common.cancel',
      ).trigger('click')
      await closed(wrapper, 'data.image.removeCategoryTitle')
      return shown
    }

    expect(await description('고양이')).toBe(
      i18n.global.t(
        'data.image.removeCategoryWithTestDescription',
        { count: 2, name: '고양이' },
        2,
      ),
    )
    expect(await description('새')).toBe(
      i18n.global.t('data.image.removeCategoryWithTestDescription', { count: 1, name: '새' }, 1),
    )
    expect(await description('개')).toBe(
      i18n.global.t('data.image.removeCategoryDescription', { name: '개' }),
    )
  })
})

/**
 * **고른 사진과 shift+클릭 기준점이 바탕을 따라가는가** (2026-09-23, R38 C-7).
 *
 * 사진이 사라지면 고른 집합에서도 빠져야 한다 — 남으면 *"3장 옮기기"*가 거짓말이 된다. 그
 * 정리 줄(`ImagePanel.vue`의 `watch(entries)`)을 지워도 **조용했다**(IP1·IP2).
 */
describe('고른 사진이 바탕을 따라간다', () => {
  /**
   * **사진은 학생처럼 누른다** (R38-V2 B-2). 처음에는 판의 `toggle`을 직접 불러서, 사진 칸의
   * `@click`을 통째로 끊어도(VS2) shift를 버려도(VS1) 25개가 초록이었다. 이제 그 범주 칸의
   * 사진 단추를 `trigger('click')`으로 누르고 판의 안쪽은 **읽기만** 한다.
   */
  async function click(
    wrapper: Awaited<ReturnType<typeof panelWith>>['wrapper'],
    category: string,
    hash: string,
    shiftKey = false,
  ): Promise<void> {
    const grid = wrapper.findAllComponents(ImageGrid).find((one) => one.props('label') === category)
    expect(grid, category).toBeDefined()
    const index = (grid!.props('entries') as readonly { hash: string }[]).findIndex(
      (entry) => entry.hash === hash,
    )
    expect(index, hash).toBeGreaterThanOrEqual(0)
    await grid!.findAll('li > button')[index]!.trigger('click', { shiftKey })
    await settle()
  }

  /** `cat`에 사진 셋을 굽고 해시를 순서대로 준다. */
  async function threePhotos() {
    const { project, wrapper, panel } = await panelWith('cat')
    await dropOn(wrapper, 'cat', [file('a.jpg'), file('b.jpg'), file('c.jpg')])
    await bakeAndRead(project, wrapper)
    const hashes = readImages(project.file).map((one) => one.hash)
    expect(hashes).toHaveLength(3)
    return { project, wrapper, panel, hashes }
  }

  it('사라진 사진은 고른 집합에서 빠지고, 기준점이면 기준점도 풀린다', async () => {
    const { project, wrapper, panel, hashes } = await threePhotos()
    const [first, second] = hashes as [string, string, string]
    await click(wrapper, 'cat', second)
    await click(wrapper, 'cat', first)
    expect(panel.selected.size).toBe(2)
    expect(panel.anchor?.hash).toBe(first)

    // 판 밖에서 사진 하나가 사라진다(되돌리기·다른 경로). 판은 그것을 알아차려야 한다.
    await project.save((live) => removeImages(live, [first], '2026-09-23T00:00:00Z'))
    await settle()

    expect([...panel.selected]).toEqual([second])
    expect(panel.anchor).toBeNull()
  })

  /**
   * **이름을 바꿔도 shift+클릭 범위가 이어진다** (A-1의 이웃). 기준점이 옛 이름을 들고 있으면
   * 범위 선택이 보통 클릭으로 떨어진다 — 해는 없지만 조용했다.
   */
  it('범주 이름을 바꾼 뒤에도 기준점에서 범위를 고른다', async () => {
    const { project, wrapper, panel, hashes } = await threePhotos()
    const [first, , third] = hashes as [string, string, string]
    await click(wrapper, 'cat', first)

    await rename(wrapper, 'cat', 'dog')
    expect(imageCategories(project.file)).toEqual(['dog'])
    expect(panel.anchor?.category).toBe('dog')

    await click(wrapper, 'dog', third, true)
    expect(panel.selected.size).toBe(3)
  })
})
