// @vitest-environment jsdom
/**
 * **사진을 붙일 때 빠진 장을 말하는가** (2026-09-02 R24 B-9).
 *
 * 조건을 **뒤집어도** 관문이 초록이었다. 사진 폴더를 통째로 끌어다 놓으면 `.txt`가
 * 섞여 오는 것이 흔한 일이고, **되는 데까지 붙이는 것**이 이 화면의 결정이다 — 첫
 * 장에서 멈추면 나머지가 왜 없는지 모르고, 통째로 거절하면 한 장 때문에 아홉 장을
 * 다시 고른다. 그러니 **몇 장이 빠졌는지는 반드시 말해야 한다.**
 *
 * **굽기는 jsdom에 없다** — 캔버스가 없어 `bakeAttachments`가 언제나 빈 배열이다.
 * 그래서 여기서는 굽기를 갈아 끼우고 **판정만** 잰다. 굽는 것 자체는
 * `attachments.spec.ts`의 몫이다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { withSectionRemoved } from '../src/project/portfolio'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import PortfolioView from '../src/views/PortfolioView.vue'
import SectionCard from '../src/views/portfolio/SectionCard.vue'
import { stubDialogElement, stubObjectUrls } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

/**
 * 몇 장이 구워지는가. **검사가 정한다.** `gate`가 서 있으면 그것이 풀릴 때까지 굽기가
 * 안 끝난다 — 굽는 동안 프로젝트나 문항이 바뀌는 창을 여는 손잡이다.
 */
const oven = vi.hoisted(() => ({ bakes: 0, gate: null as Promise<void> | null }))

vi.mock('../src/project/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/attachments')>()
  return {
    ...actual,
    bakeAttachments: async (files: readonly File[]) => {
      if (oven.gate !== null) await oven.gate
      return files.slice(0, oven.bakes).map(() => ({
        bytes: new Uint8Array([1, 2, 3]),
        extension: '.webp',
        mime: 'image/webp',
      }))
    },
  }
})

function photo(name: string): File {
  return new File([new Uint8Array([1])], name, { type: 'image/png' })
}

async function drop(files: readonly File[]) {
  useProjectStore().file = projectFile()
  const view = mount(PortfolioView, { global: { plugins: [i18n] } })
  const card = view.findComponent(SectionCard)
  expect(card.exists(), 'the fixture has one section').toBe(true)
  card.vm.$emit('attach', files)
  await view.vm.$nextTick()
  await Promise.resolve()
  await view.vm.$nextTick()
  return view
}

const cautions = () => useToastStore().items.filter((one) => one.tone === 'caution')

beforeEach(async () => {
  setActivePinia(createPinia())
  oven.bakes = 0
  oven.gate = null
  // 붙인 사진을 화면이 객체 URL로 그린다. **jsdom에는 쓸 수 있는 것이 없다.**
  stubObjectUrls()
  // 확인 대화상자를 열고, 떠날 때 닫는다.
  stubDialogElement()
  await setLocale('ko')
})

describe('R24 B-9: photos that could not be read', () => {
  it('one of two is skipped: it attaches one and says one was left out', async () => {
    oven.bakes = 1
    await drop([photo('a.png'), photo('b.txt')])

    const attachments = useProjectStore().file?.attachments ?? new Map()
    expect(attachments.size).toBe(1)
    expect(cautions()).toEqual([
      expect.objectContaining({ key: 'portfolio.photoSkipped', params: { count: 1 } }),
    ])
  })

  it('all of them bake: it says nothing', async () => {
    oven.bakes = 2
    await drop([photo('a.png'), photo('b.png')])

    expect(useProjectStore().file?.attachments.size).toBe(2)
    expect(cautions()).toEqual([])
  })
})

/** 굽기를 세워 두는 손잡이. 돌려준 함수가 풀어 준다. */
function holdOven(): () => void {
  let release = (): void => {}
  oven.gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return release
}

/**
 * **굽는 동안 프로젝트나 문항이 바뀌면 사진을 앉히지 않는다** (`PortfolioView.vue`의
 * `attach`, `stores/project.ts`의 `claim`).
 *
 * 화면이 살아 있는 채로 옮긴다 — 같은 라우트 레코드 사이의 이동은 이 화면을 다시 쓴다.
 * 옮긴 프로젝트도 같은 문항 id(`motivation`)를 갖는다: 프리셋 양식이 같으면 그렇다.
 */
describe('굽는 동안 주인이 바뀌면', () => {
  it('다른 프로젝트로 옮기면 구운 사진이 그쪽에 안 붙는다', async () => {
    oven.bakes = 1
    const release = holdOven()
    const view = await drop([photo('a.png')])

    const store = useProjectStore()
    const other = projectFile()
    store.file = {
      ...other,
      document: {
        ...other.document,
        manifest: {
          ...other.document.manifest,
          projectId: '66666666-6666-4666-8666-666666666666',
        },
      },
    }

    release()
    await flushPromises()

    expect(store.file?.attachments.size).toBe(0)
    expect(store.file?.document.portfolio.attachments).toEqual({})
    view.unmount()
  })

  it('그 문항을 지우면 안 보이는 사진이 남지 않는다', async () => {
    oven.bakes = 1
    const release = holdOven()
    const view = await drop([photo('a.png')])

    const store = useProjectStore()
    const live = store.file
    if (live === undefined || live === null) throw new Error('the fixture is open')
    store.file = {
      ...live,
      document: {
        ...live.document,
        portfolio: withSectionRemoved(live.document.portfolio, 'motivation'),
      },
    }

    release()
    await flushPromises()

    expect(store.file?.attachments.size).toBe(0)
    expect(store.file?.document.portfolio.attachments).toEqual({})
    view.unmount()
  })
})

/**
 * **화면 입구를 실제 DOM 사건으로 지난다.** `card.vm.$emit('attach')`는 카드 안의 가드와
 * 고른 파일을 읽는 줄을 건너뛴다 — 그 줄이 망가져도 위 검사들은 초록이다.
 */
describe('입구는 DOM 사건으로 연다', () => {
  function mountOpen(file = projectFile()) {
    useProjectStore().file = file
    return mount(PortfolioView, { global: { plugins: [i18n] } })
  }

  it('글자를 붙여넣으면 가로채지 않는다', async () => {
    const view = mountOpen()
    const box = view.find('textarea').element
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [] } })
    box.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented, 'the browser must paste the text itself').toBe(false)
    expect(useProjectStore().file?.attachments.size).toBe(0)
  })

  it('사진을 붙여넣으면 그 문항에 붙는다', async () => {
    oven.bakes = 1
    const view = mountOpen()
    const box = view.find('textarea').element
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { files: [photo('a.png')] } })
    box.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(useProjectStore().file?.document.portfolio.attachments).toEqual({
      motivation: [expect.stringMatching(/^portfolio\/attachments\//)],
    })
  })

  it('[사진 추가]로 고른 사진이 붙는다', async () => {
    oven.bakes = 1
    const view = mountOpen()
    const input = view.find('input[type="file"][accept="image/*"]')
    Object.defineProperty(input.element, 'files', { value: [photo('a.png')] })
    await input.trigger('change')
    await flushPromises()

    expect(useProjectStore().file?.attachments.size).toBe(1)
  })

  it('[사진 삭제]를 누르고 확인하면 사진과 바이트가 함께 사라진다', async () => {
    const path = 'portfolio/attachments/1.webp'
    const base = projectFile()
    const view = mountOpen({
      ...base,
      attachments: new Map([[path, new Uint8Array([1, 2, 3])]]),
      document: {
        ...base.document,
        portfolio: { ...base.document.portfolio, attachments: { motivation: [path] } },
      },
    })
    await flushPromises()

    const removePhoto = view.find('button[aria-label="사진 삭제"]')
    expect(removePhoto.exists(), 'the photo card is drawn').toBe(true)
    await removePhoto.trigger('click')
    const dialog = view.findAll('dialog').find((one) => one.element.open)
    const confirm = dialog?.findAll('button').find((one) => one.text() === '삭제하기')
    expect(confirm?.exists(), 'the confirm dialog opened').toBe(true)
    await confirm?.trigger('click')

    expect(useProjectStore().file?.attachments.size).toBe(0)
    expect(useProjectStore().file?.document.portfolio.attachments).toEqual({})
    view.unmount()
  })

  /**
   * **문항을 지운 뒤 붙인 사진이 지운 문항의 사진으로 보이지 않는다.** 문항을 지우면 참조는
   * 사라지지만 바이트는 `.mlpx`로 내보낼 때까지 남고, 화면의 사진 주소는 이름으로 묶여 있다
   * (`useObjectUrls`). 새 사진이 그 이름을 다시 받으면 옛 주소가 그대로 선다.
   */
  it('문항을 지운 뒤 다른 문항에 붙인 사진이 지운 사진으로 안 보인다', async () => {
    oven.bakes = 1
    const path = 'portfolio/attachments/1.webp'
    const base = projectFile()
    const view = mountOpen({
      ...base,
      attachments: new Map([[path, new Uint8Array([9, 9, 9])]]),
      document: {
        ...base.document,
        portfolio: {
          template: {
            sections: [
              { id: 'gone', title: '지울 문항' },
              { id: 'kept', title: '남을 문항' },
            ],
          },
          answerFormat: 'plain-v1',
          answers: {},
          attachments: { gone: [path] },
        },
      },
    })
    await flushPromises()
    const deleted = view.find('img').attributes('src')

    await view.find('button[aria-label="문항 삭제"]').trigger('click')
    const dialog = view.findAll('dialog').find((one) => one.element.open)
    await dialog
      ?.findAll('button')
      .find((one) => one.text() === '삭제하기')
      ?.trigger('click')
    await flushPromises()
    expect(view.find('img').exists(), 'the removed section took its photo along').toBe(false)

    const input = view.find('input[type="file"][accept="image/*"]')
    Object.defineProperty(input.element, 'files', { value: [photo('b.png')] })
    await input.trigger('change')
    await flushPromises()

    const shown = view.find('img')
    expect(shown.exists()).toBe(true)
    expect(shown.attributes('src'), 'the new photo must not show the deleted one').not.toBe(deleted)
    view.unmount()
  })
})
