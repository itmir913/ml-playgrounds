// @vitest-environment jsdom
// 판을 띄워 [사진 추가] 메뉴를 누르고, 팝오버·숨은 input·그리기 창을 지나가는 스펙이라 DOM이 필요하다.
/**
 * [사진 추가] 메뉴와 판의 배선 (`views/data/ImageSourceMenu.vue`, `composables/useImageSources.ts`,
 * open-decisions.md 67, 계획 2.2·2.6).
 *
 * **진짜 입구로 잰다** — 판을 띄우고 메뉴 트리거를 눌러 팝오버를 열고, 줄을 누르고, 숨은 input에
 * 파일을 넣거나 그리기 창이 `done`을 올리게 한다. 판의 안쪽(`pending`)은 읽기만 한다.
 *
 * **그리기 창의 캔버스는 여기서 안 본다** — 창이 무엇을 내는지는 `sketch-dialog.spec.ts`가 재고, 여기서는
 * 창의 출구(`done`)에 가짜 파일을 올려 그 뒤의 길만 본다. 캔버스 접착은 jsdom에 없어서 갈아끼운다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppEmpty from '../src/components/AppEmpty.vue'
import { useImageSources, type ImageSourceHands } from '../src/composables/useImageSources'
import { i18n, setLocale } from '../src/i18n'
import ko from '../src/locales/ko.json'
import { addCategory } from '../src/project/images'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImageGrid from '../src/views/data/ImageGrid.vue'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import ImageSourceMenu from '../src/views/data/ImageSourceMenu.vue'
import SketchDialog from '../src/views/data/SketchDialog.vue'
import ImagePredictPanel from '../src/views/predict/ImagePredictPanel.vue'
import { resetDatabase } from './fixtures/database'
import {
  imagePredictProject,
  pasteEvent,
  pastedPhoto,
  resetImageWorkers,
  stubDialogElement,
  workerState,
} from './fixtures/image-workers'

/** 굽는 워커가 받은 파일들. 요청 하나가 한 줄이다. */
const seen = vi.hoisted(() => ({ requests: [] as File[][] }))

vi.mock('../src/data/image/spawn', async () => {
  const { fakeCanonicalizeWorker } = await import('./fixtures/image-workers')
  return {
    spawnCanonicalizeWorker: () => {
      const worker = fakeCanonicalizeWorker()
      const post = worker.postMessage.bind(worker)
      worker.postMessage = (request) => {
        seen.requests.push([...request.files])
        post(request)
      }
      return worker
    },
  }
})

vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

vi.mock('../src/views/data/sketch-canvas', () => ({
  contextOf: () => null,
  snapshotOf: () => 'data:snapshot',
  createSketchCanvas: () => {
    throw new Error('not used here')
  },
  onNextFrame: () => () => {},
}))

const LABELS = {
  files: ko.data.image.source.files,
  folder: ko.data.image.source.folder,
  sketch: ko.data.image.source.sketch,
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

interface DataInternals {
  busy: boolean
  pending: readonly { path: string; category: string }[] | null
  bake: () => Promise<void>
}

beforeEach(async () => {
  setActivePinia(createPinia())
  resetImageWorkers()
  seen.requests.length = 0
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
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await resetDatabase()
})

/** 사진 없는 이미지 프로젝트로 데이터 화면을 띄운다. `categories`가 있으면 범주 칸이 선다. */
async function dataPanel(categories: readonly string[] = []) {
  const project = useProjectStore()
  let file = imagePredictProject([])
  for (const name of categories) file = addCategory(file, name, '2026-10-06T00:00:00.000Z')
  await project.save(file)
  const wrapper = mount(ImagePanel, {
    props: { accept: 'image/*' },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return { project, wrapper, panel: wrapper.vm as unknown as DataInternals }
}

async function predictPanel() {
  const project = useProjectStore()
  await project.save(imagePredictProject([]))
  const wrapper = mount(ImagePredictPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  return { project, wrapper }
}

/** 이름이 `label`인 메뉴 트리거. `within`을 주면 그 부품 안에서 찾는다. */
function trigger(within: Pick<VueWrapper, 'findAll'>, label: string) {
  const found = within.findAll('button').filter((one) => one.text() === label)
  expect(found, label).toHaveLength(1)
  return found[0]!
}

/** 열린 팝오버. 패널은 `body`로 옮겨 뜬다(`AppPopover`). */
function openPanel(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('.popover-panel')
}

/** 메뉴를 열고 그 줄을 누른다. */
async function choose(
  within: Pick<VueWrapper, 'findAll'>,
  label: string,
  row: string,
): Promise<void> {
  await trigger(within, label).trigger('click')
  await settle()
  const button = [...(openPanel()?.querySelectorAll('button') ?? [])].find(
    (one) => one.textContent?.trim() === row,
  )
  expect(button, row).toBeDefined()
  button!.click()
  await flushPromises()
}

/** 떠 있는 그리기 창. 지연 부품이라 처음 열 때 붙는다. */
async function sketchDialog(wrapper: VueWrapper) {
  await vi.waitFor(() => {
    expect(wrapper.findComponent(SketchDialog).exists()).toBe(true)
  })
  return wrapper.findComponent(SketchDialog)
}

/** 그리기 창이 [추가]를 누른 것처럼 끝난다. 이름은 판이 준 발급기에서 받는다(창이 하는 그대로). */
async function finishSketch(wrapper: VueWrapper, bytes: readonly number[]): Promise<File> {
  const dialog = await sketchDialog(wrapper)
  const name = (dialog.props('nameSketch') as () => string)()
  const file = new File([new Uint8Array(bytes)], name, { type: 'image/png' })
  dialog.vm.$emit('done', [file])
  await settle()
  return file
}

/** 숨은 input에 파일을 고른 것처럼 넣는다. */
async function pickInto(input: HTMLInputElement, files: readonly File[]): Promise<void> {
  Object.defineProperty(input, 'files', { configurable: true, value: files })
  input.dispatchEvent(new Event('change'))
  await settle()
}

function fileInputOf(wrapper: VueWrapper): HTMLInputElement {
  return wrapper.find<HTMLInputElement>('input[type="file"][multiple]').element
}

function folderInputOf(wrapper: VueWrapper): HTMLInputElement {
  return wrapper.find<HTMLInputElement>('input[type="file"][webkitdirectory]').element
}

/** 워커 요청 하나를 비교할 수 있는 값으로. */
async function requestShape(files: readonly File[]) {
  return Promise.all(
    files.map(async (one) => ({
      name: one.name,
      size: one.size,
      type: one.type,
      bytes: [...new Uint8Array(await one.arrayBuffer())],
    })),
  )
}

describe('메뉴의 줄', () => {
  it('사진 선택·폴더 선택·그리기 셋이고, 웹캠도 안내 문장도 없다', async () => {
    const { wrapper } = await dataPanel()

    await trigger(wrapper, ko.data.image.add).trigger('click')
    await settle()

    const panel = openPanel()
    expect(panel).not.toBeNull()
    const rows = [...panel!.querySelectorAll('button')].map((one) => one.textContent?.trim())
    expect(rows).toEqual([LABELS.files, LABELS.folder, LABELS.sketch])
    // **어디로 들어가는지 말하지 않는다** (코드 소유자 지시) — 패널의 글자는 줄의 이름뿐이다.
    expect(panel!.textContent?.replace(/\s+/g, '')).toBe(rows.join('').replace(/\s+/g, ''))

    wrapper.unmount()
  })

  it('데이터 화면에 [폴더에서 추가] 단추가 따로 없다', async () => {
    const { wrapper } = await dataPanel(['고양이'])
    const texts = wrapper.findAll('button').map((one) => one.text())
    expect(texts).not.toContain('폴더에서 추가')
    expect(texts.filter((one) => one === ko.data.image.add)).toHaveLength(1)
    wrapper.unmount()
  })

  /**
   * **빈 상태의 안내가 부르는 단추는 이 화면에 있다.** `locales.spec.ts`의 "문구가 부르는 버튼 이름"은
   * 로케일 어디엔가 그 글자가 있는지만 본다 — [폴더에서 추가]는 전처리 화면(`preprocess.testImagesAddFolder`)
   * 에 남아 있어서 데이터 화면에서 사라진 뒤에도 거기가 조용했다.
   */
  it('빈 상태의 안내가 부르는 단추가 화면이나 그 메뉴에 있다', async () => {
    const { wrapper } = await dataPanel()
    const quoted = [
      ...wrapper
        .findComponent(AppEmpty)
        .text()
        .matchAll(/\[([^\]]+)\]/g),
    ].map((found) => found[1])
    expect(quoted.length).toBeGreaterThan(0)
    const reachable = [
      ...wrapper.findAll('button').map((one) => one.text()),
      ...Object.values(LABELS),
    ]
    expect(quoted.filter((name) => !reachable.includes(name ?? ''))).toEqual([])
    wrapper.unmount()
  })
})

describe('팝오버가 닫혀도 그린 것이 닿는다 (감사 A-1)', () => {
  /**
   * 그리기 창을 누르는 순간 `AppPopover`가 바깥 `pointerdown`으로 닫히며 목록을 떼어 낸다. 목록이
   * 받아 오기를 기다리고 있었다면 그 뒤의 `emit`은 버려진다 — 그린 사진이 말없이 사라진다.
   */
  it('데이터 화면 - 확인 판에 선다', async () => {
    const { wrapper, panel } = await dataPanel()

    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    await sketchDialog(wrapper)
    document.dispatchEvent(new Event('pointerdown'))
    await settle()
    expect(openPanel()).toBeNull()
    await finishSketch(wrapper, [1, 2, 3])

    expect(panel.pending?.map((one) => [one.path, one.category])).toEqual([
      ['drawn-1.png', '_unlabeled'],
    ])
    wrapper.unmount()
  })

  it('예측 화면 - 예측 자리에 앉는다', async () => {
    const { wrapper } = await predictPanel()

    await choose(wrapper, ko.predict.image.add, LABELS.sketch)
    await sketchDialog(wrapper)
    document.dispatchEvent(new Event('pointerdown'))
    await settle()
    await finishSketch(wrapper, [1, 2, 3])

    expect(seen.requests.map((files) => files.map((one) => one.name))).toEqual([['drawn-1.png']])
    wrapper.unmount()
  })

  /**
   * **메뉴도 내려갈 수 있다.** 기다리는 사이 판의 모양이 바뀌면(데이터 화면은 확인 판이 서면 툴바가
   * 요약으로 바뀐다) 툴바의 메뉴가 내려간다. 받은 것을 `emit`으로 올리면 그때 버려진다 — 그래서 판이
   * 준 함수(`pick`)로 넘긴다. 판에서 그 길을 여는 붙여넣기는 이제 그리는 동안 막혀 있어(아래), 메뉴
   * 하나를 띄워 기다리는 사이에 내린다.
   */
  it('기다리는 사이 메뉴가 내려가도 받은 것이 닿는다', async () => {
    let finish: (files: readonly File[]) => void = () => {}
    const picked: string[] = []
    const context = {
      translate: (key: string) => key,
      pickFiles: () => Promise.resolve(null),
      pickFolder: () => Promise.resolve(null),
      openSketch: () =>
        new Promise<readonly File[] | null>((resolve) => {
          finish = resolve
        }),
    }
    const menu = mount(ImageSourceMenu, {
      props: {
        label: '사진 추가',
        context,
        pick: (files: readonly File[]) => picked.push(...files.map((one) => one.name)),
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await menu.find('button').trigger('click')
    await settle()
    const row = [...(openPanel()?.querySelectorAll('button') ?? [])].find(
      (one) => one.textContent?.trim() === 'data.image.source.sketch',
    )
    row!.click()
    await flushPromises()
    menu.unmount()

    finish([new File([new Uint8Array([1])], 'drawn-1.png')])
    await flushPromises()
    expect(picked).toEqual(['drawn-1.png'])
  })
})

/**
 * **그리기 창이 떠 있는 동안 판은 붙여넣기를 받지 않는다** (지휘자 결정, open-decisions.md 67). 창 안에서
 * 누른 Ctrl+V가 뒤의 판으로 새는 것이 맞지 않고, 예측 화면에서는 그 붙여넣기가 굽기를 시작해 [추가]의
 * 그림이 굽는 중 거절(`addWhileBusy`)과 함께 사라졌다.
 */
describe('그리기 창이 떠 있는 동안 붙여넣기', () => {
  it('데이터 화면 - 받지 않고, 창을 닫으면 다시 받는다', async () => {
    const { wrapper, panel } = await dataPanel(['고양이'])

    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    await sketchDialog(wrapper)
    window.dispatchEvent(pasteEvent([pastedPhoto([9])]))
    await settle()
    expect(panel.pending).toBeNull()

    await finishSketch(wrapper, [1, 2, 3])
    expect(panel.pending?.map((one) => one.path)).toEqual(['drawn-1.png'])

    window.dispatchEvent(pasteEvent([pastedPhoto([9])]))
    await settle()
    expect(panel.pending?.map((one) => one.path)).toEqual(['drawn-1.png', 'pasted-1.png'])
    wrapper.unmount()
  })

  it('예측 화면 - 받지 않아 [추가]의 그림이 굽는 중 거절에 안 걸린다', async () => {
    const { wrapper } = await predictPanel()
    workerState.holdBake = true

    await choose(wrapper, ko.predict.image.add, LABELS.sketch)
    await sketchDialog(wrapper)
    window.dispatchEvent(pasteEvent([pastedPhoto([9])]))
    await settle()
    expect(seen.requests).toEqual([])

    workerState.holdBake = false
    await finishSketch(wrapper, [1, 2, 3])
    expect(seen.requests.map((files) => files.map((one) => one.name))).toEqual([['drawn-1.png']])
    expect(useToastStore().items.map((one) => one.key)).not.toContain('predict.image.addWhileBusy')
    wrapper.unmount()
  })
})

describe('그린 사진은 파일로 고른 사진과 같은 길로 간다', () => {
  const BYTES = [137, 80, 78, 71, 1, 2, 3]

  it('데이터 화면 - 같은 워커 요청이 나간다', async () => {
    const drawn = await dataPanel()
    await choose(drawn.wrapper, ko.data.image.add, LABELS.sketch)
    const file = await finishSketch(drawn.wrapper, BYTES)
    await drawn.panel.bake()
    await settle()
    const fromSketch = seen.requests.splice(0)
    drawn.wrapper.unmount()
    document.body.innerHTML = ''
    closeStorage()
    await resetDatabase()
    setActivePinia(createPinia())

    const picked = await dataPanel()
    await choose(picked.wrapper, ko.data.image.add, LABELS.files)
    await pickInto(fileInputOf(picked.wrapper), [
      new File([new Uint8Array(BYTES)], file.name, { type: 'image/png' }),
    ])
    await picked.panel.bake()
    await settle()
    const fromFiles = seen.requests.splice(0)

    expect(fromSketch).toHaveLength(1)
    expect(await requestShape(fromSketch[0]!)).toEqual(await requestShape(fromFiles[0]!))
    expect(fromSketch[0]![0]!.size).toBe(file.size)
    picked.wrapper.unmount()
  })

  it('예측 화면 - 같은 워커 요청이 나간다', async () => {
    const drawn = await predictPanel()
    await choose(drawn.wrapper, ko.predict.image.add, LABELS.sketch)
    const file = await finishSketch(drawn.wrapper, BYTES)
    const fromSketch = seen.requests.splice(0)
    drawn.wrapper.unmount()
    document.body.innerHTML = ''
    closeStorage()
    await resetDatabase()
    setActivePinia(createPinia())

    const picked = await predictPanel()
    await choose(picked.wrapper, ko.predict.image.add, LABELS.files)
    await pickInto(fileInputOf(picked.wrapper), [
      new File([new Uint8Array(BYTES)], file.name, { type: 'image/png' }),
    ])
    const fromFiles = seen.requests.splice(0)

    expect(fromSketch).toHaveLength(1)
    expect(await requestShape(fromSketch[0]!)).toEqual(await requestShape(fromFiles[0]!))
    expect(fromSketch[0]![0]!.size).toBe(file.size)
    picked.wrapper.unmount()
  })
})

describe('데이터 화면의 확인 판', () => {
  /** 그린 그림은 디스크에 없다 — 갈아끼우면 되살릴 길이 없다(`sources.ts`의 `appends`). */
  it('그리기는 덧붙고, 파일 선택은 갈아끼운다', async () => {
    const { wrapper, panel } = await dataPanel()

    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    await finishSketch(wrapper, [1])
    expect(panel.pending).toHaveLength(1)

    // 판이 서면 툴바가 요약으로 바뀌므로 다음 메뉴는 빈 상태의 것이다.
    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    await finishSketch(wrapper, [2])
    expect(panel.pending?.map((one) => one.path)).toEqual(['drawn-1.png', 'drawn-2.png'])

    await choose(wrapper, ko.data.image.add, LABELS.files)
    await pickInto(fileInputOf(wrapper), [new File([new Uint8Array([3])], 'a.png')])
    expect(panel.pending?.map((one) => one.path)).toEqual(['a.png'])

    wrapper.unmount()
  })

  it('폴더 선택은 폴더 input을 열고 갈아끼운다', async () => {
    const { wrapper, panel } = await dataPanel()
    const folder = folderInputOf(wrapper)
    const opened = vi.spyOn(folder, 'click')

    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    await finishSketch(wrapper, [1])
    await choose(wrapper, ko.data.image.add, LABELS.folder)
    expect(opened).toHaveBeenCalledTimes(1)

    const inFolder = new File([new Uint8Array([4])], 'b.png')
    Object.defineProperty(inFolder, 'webkitRelativePath', { value: '개/b.png' })
    await pickInto(folder, [inFolder])

    expect(panel.pending?.map((one) => one.category)).toEqual(['개'])
    wrapper.unmount()
  })

  /** 라벨 파일이 든 데이터셋 폴더 — 사진만 확인 판에 서고, 뺀 수를 말한다 (open-decisions.md 108). */
  it('폴더의 사진이 아닌 파일은 확인 판에 안 서고 몇 개 뺐는지 말한다', async () => {
    const { wrapper, panel } = await dataPanel()
    const folder = folderInputOf(wrapper)
    const inFolder = (path: string): File => {
      const one = new File([new Uint8Array([4])], path.split('/').at(-1) ?? path)
      Object.defineProperty(one, 'webkitRelativePath', { value: path })
      return one
    }
    await choose(wrapper, ko.data.image.add, LABELS.folder)
    await pickInto(folder, [
      inFolder('set/개/a.jpg'),
      inFolder('set/개/a.txt'),
      inFolder('set/labels.csv'),
    ])
    expect(panel.pending?.map((one) => one.category)).toEqual(['개'])
    const toast = useToastStore().items.find((one) => one.key === 'data.image.notImages')
    expect(toast?.params).toEqual({ count: 2 })
    wrapper.unmount()
  })

  /** 이미 있는 범주와 대소문자만 다른 폴더는 확인 판에 안 선다 — 같은 철자면 선다 (R43-5 B-1 재판단). */
  it('이미 있는 범주와 대소문자만 다른 폴더는 받지 않는다', async () => {
    const { wrapper, panel } = await dataPanel(['cat'])
    const folder = folderInputOf(wrapper)
    const inFolder = (path: string): File => {
      const one = new File([new Uint8Array([4])], path.split('/').at(-1) ?? path)
      Object.defineProperty(one, 'webkitRelativePath', { value: path })
      return one
    }

    await choose(wrapper, ko.data.image.add, LABELS.folder)
    await pickInto(folder, [inFolder('set/Cat/b.png'), inFolder('set/dog/c.png')])
    expect(panel.pending ?? []).toEqual([])

    await choose(wrapper, ko.data.image.add, LABELS.folder)
    await pickInto(folder, [inFolder('set/cat/b.png'), inFolder('set/dog/c.png')])
    expect(panel.pending?.map((one) => one.category)).toEqual(['cat', 'dog'])
    wrapper.unmount()
  })

  /** 범주 칸의 [여기에 사진 추가]도 같은 메뉴다(결정 6). 그린 것은 그 칸으로 간다. */
  it('범주 칸의 메뉴로 그리면 그 범주로, 두 번 그려도 이름이 안 겹친다', async () => {
    const { wrapper, panel } = await dataPanel(['고양이', '개'])
    const card = (label: string) =>
      wrapper.findAllComponents(ImageGrid).find((one) => one.props('label') === label)!

    await choose(card('고양이'), ko.data.image.addHere, LABELS.sketch)
    await finishSketch(wrapper, [1])
    await choose(card('고양이'), ko.data.image.addHere, LABELS.sketch)
    await finishSketch(wrapper, [2])
    await choose(card('개'), ko.data.image.addHere, LABELS.sketch)
    await finishSketch(wrapper, [3])

    expect(panel.pending?.map((one) => [one.path, one.category])).toEqual([
      ['drawn-1.png', '고양이'],
      ['drawn-2.png', '고양이'],
      ['drawn-3.png', '개'],
    ])

    // 구워도 세 장이 각자 범주에 앉는다 — 이름이 겹치면 굽기 결과를 범주로 되돌리는 맵이 접힌다.
    await panel.bake()
    await settle()
    expect(seen.requests.at(-1)?.map((one) => one.name)).toEqual([
      'drawn-1.png',
      'drawn-2.png',
      'drawn-3.png',
    ])
    wrapper.unmount()
  })

  it('범주 칸의 파일 선택도 그 범주로 간다', async () => {
    const { wrapper, panel } = await dataPanel(['고양이'])
    const card = wrapper
      .findAllComponents(ImageGrid)
      .find((one) => one.props('label') === '고양이')!

    await choose(card, ko.data.image.addHere, LABELS.files)
    await pickInto(fileInputOf(wrapper), [new File([new Uint8Array([1])], 'a.png')])

    expect(panel.pending?.map((one) => one.category)).toEqual(['고양이'])
    wrapper.unmount()
  })
})

describe('파일 창을 닫으면', () => {
  it('아무 일도 없고, 다음 고르기는 정상이다', async () => {
    const { wrapper, panel } = await dataPanel()

    await choose(wrapper, ko.data.image.add, LABELS.files)
    fileInputOf(wrapper).dispatchEvent(new Event('cancel'))
    await settle()
    expect(panel.pending).toBeNull()
    expect(useToastStore().items).toEqual([])

    await choose(wrapper, ko.data.image.add, LABELS.files)
    await pickInto(fileInputOf(wrapper), [new File([new Uint8Array([1])], 'a.png')])
    expect(panel.pending?.map((one) => one.path)).toEqual(['a.png'])

    wrapper.unmount()
  })

  it('그리기 창을 닫아도 아무 일도 없다', async () => {
    const { wrapper, panel } = await dataPanel()

    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    ;(await sketchDialog(wrapper)).vm.$emit('done', null)
    await settle()

    expect(panel.pending).toBeNull()
    expect(useToastStore().items).toEqual([])
    wrapper.unmount()
  })
})

describe('판의 손 (`useImageSources`)', () => {
  function host(): { hands: () => ImageSourceHands; input: HTMLInputElement; wrapper: VueWrapper } {
    let hands: ImageSourceHands | null = null
    const input = document.createElement('input')
    input.type = 'file'
    input.click = () => {}
    const wrapper = mount(
      defineComponent({
        setup() {
          hands = useImageSources({ fileInput: ref(input), folderInput: ref(input) })
          return () => h('div')
        },
      }),
      { global: { plugins: [i18n] } },
    )
    return { hands: () => hands!, input, wrapper }
  }

  /**
   * `cancel`이 안 오는 브라우저에서 앞 창을 닫고 다시 고르면, 덮어쓴 앞 약속이 영영 안 풀린다 —
   * 그 메뉴의 `await`가 판이 사는 동안 매달린다(`PortfolioView.vue`의 `pickFile`과 같은 병).
   */
  it('다시 고르면 앞의 고르기는 고르지 않은 것으로 끝난다', async () => {
    const { hands, input, wrapper } = host()

    const first = hands().context.pickFiles()
    const second = hands().context.pickFiles()
    // 매달린 약속을 시간 초과로 기다리지 않는다 — 한 바퀴 안에 안 풀렸으면 그것이 답이다.
    expect(await Promise.race([first, flushPromises().then(() => 'still waiting')])).toBeNull()

    const file = new File([new Uint8Array([1])], 'a.png')
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    hands().onPicked({ target: input } as unknown as Event)
    await expect(second).resolves.toEqual([file])
    wrapper.unmount()
  })

  it('떠나면 기다리던 고르기와 그리기가 풀린다', async () => {
    const { hands, wrapper } = host()

    const picking = hands().context.pickFiles()
    const sketching = hands().context.openSketch()
    wrapper.unmount()

    const waited = flushPromises().then(() => 'still waiting')
    expect(await Promise.race([picking, waited])).toBeNull()
    expect(await Promise.race([sketching, waited])).toBeNull()
  })
})

describe('메뉴 트리거는 지금 버튼의 잠금을 받는다', () => {
  it('데이터 화면 - 굽는 동안 잠긴다', async () => {
    const { wrapper, panel } = await dataPanel()

    await choose(wrapper, ko.data.image.add, LABELS.sketch)
    await finishSketch(wrapper, [1])
    workerState.holdBake = true
    const baking = panel.bake()
    await settle()
    expect(panel.busy).toBe(true)

    expect(trigger(wrapper, ko.data.image.add).attributes('disabled')).toBeDefined()

    workerState.bake[0]?.deliver()
    await baking
    await settle()
    expect(trigger(wrapper, ko.data.image.add).attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('예측 화면 - 굽는 동안 잠긴다', async () => {
    const { wrapper } = await predictPanel()
    expect(trigger(wrapper, ko.predict.image.add).attributes('disabled')).toBeUndefined()

    workerState.holdBake = true
    await choose(wrapper, ko.predict.image.add, LABELS.sketch)
    await finishSketch(wrapper, [1])

    expect(trigger(wrapper, ko.predict.image.add).attributes('disabled')).toBeDefined()

    workerState.bake[0]?.deliver()
    await settle()
    wrapper.unmount()
  })
})
