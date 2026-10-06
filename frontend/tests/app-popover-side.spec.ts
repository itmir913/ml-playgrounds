// @vitest-environment jsdom
// 패널이 `body`로 옮겨 떠서(Teleport) DOM을 직접 뒤지고, 자리를 재는 값을 가짜로 세운다.
/**
 * 팝오버가 **어느 쪽으로 열리는가** (`components/AppPopover.vue`의 `place`, `screen.ts`의 `prefersTop`).
 *
 * 화면 아래쪽 범주 칸의 [여기에 사진 추가]가 아래로 열려 상태 표시줄 위에서 잘리고, 패널 안에
 * 스크롤바가 서서 첫 줄만 보였다(#38, 코드 소유자). 위가 넉넉했는데도 그랬다. 원인 둘이다.
 *
 * 1. **판정을 눌린 높이로 했다.** 줄이 나중에 들어오는 패널은 처음 잴 때 비어 있어 아래에 들어가고,
 *    그 자리가 `--popover-room`으로 천장이 된다. 자란 뒤 다시 잴 때 `getBoundingClientRect`는 이미
 *    천장에 눌린 높이라 "아래에 들어간다"로 굳었다.
 * 2. **아래 자리에 상태 표시줄을 셌다.** 화면 아래를 덮는 막대(`--overlay-bottom`) 뒤는 자리가 아니다.
 *
 * jsdom에는 배치가 없어서 **재는 값을 가짜로 세운다** — 트리거·패널·덮는 막대의 상자와 화면 높이.
 * 패널의 상자 높이는 브라우저처럼 `--popover-room`에 눌린다.
 */

import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import AppPopover from '../src/components/AppPopover.vue'

const PANEL = '.popover-panel'
const VIEWPORT = 800

/** 지금 세운 값들. 검사마다 고친다. */
const fake = {
  trigger: { top: 0, bottom: 0 },
  /** 패널 내용의 자연 높이. */
  content: 0,
  /** 화면 아래를 덮는 막대의 높이. */
  cover: 0,
}

const mounted: VueWrapper[] = []
let roots: Element[] = []
let grow: (() => void) | null = null

const originals = {
  rect: HTMLElement.prototype.getBoundingClientRect,
  scrollHeight: Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight'),
  resizeObserver: globalThis.ResizeObserver,
  innerHeight: Object.getOwnPropertyDescriptor(window, 'innerHeight'),
}

function box(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 10,
    right: 110,
    width: 100,
    height,
    x: 10,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** 브라우저처럼 패널 상자는 천장(`--popover-room`)에 눌린다. */
function panelHeight(element: HTMLElement): number {
  const room = Number.parseFloat(element.style.getPropertyValue('--popover-room'))
  return Number.isFinite(room) ? Math.min(fake.content, room) : fake.content
}

beforeEach(() => {
  fake.trigger = { top: 0, bottom: 0 }
  fake.content = 0
  fake.cover = 0
  grow = null
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement): DOMRect {
    if (roots.includes(this)) return box(fake.trigger.top, fake.trigger.bottom - fake.trigger.top)
    if (this.matches(PANEL)) return box(0, panelHeight(this))
    if (this.matches('.popover-overlay-probe')) return box(VIEWPORT - fake.cover, fake.cover)
    return box(0, 0)
  }
  Object.defineProperty(Element.prototype, 'scrollHeight', {
    configurable: true,
    get(this: Element) {
      return this.matches(PANEL) ? fake.content : 0
    },
  })
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      grow = callback
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  roots = []
  HTMLElement.prototype.getBoundingClientRect = originals.rect
  if (originals.scrollHeight) {
    Object.defineProperty(Element.prototype, 'scrollHeight', originals.scrollHeight)
  }
  globalThis.ResizeObserver = originals.resizeObserver
  if (originals.innerHeight) Object.defineProperty(window, 'innerHeight', originals.innerHeight)
})

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) await nextTick()
}

async function open(side: 'top' | 'bottom' = 'bottom'): Promise<HTMLElement> {
  const wrapper = mount(AppPopover, {
    attachTo: document.body,
    props: { side },
    slots: {
      trigger: '<button type="button">열기</button>',
      default: '<div class="content">안에 든 것</div>',
    },
  })
  mounted.push(wrapper)
  roots.push(wrapper.element)
  await wrapper.find('button').trigger('click')
  await settle()
  const panel = document.querySelector<HTMLElement>(PANEL)
  expect(panel, 'the panel should be open').not.toBeNull()
  return panel!
}

/** 위로 열렸는가. 위로 열면 트리거 위쪽 끝에 붙인다(`bottom`), 아래로 열면 `top`이다. */
function opensUp(panel: HTMLElement): boolean {
  return panel.style.bottom !== '' && panel.style.top === ''
}

describe('아래가 기본이고, 자리가 없으면 위로 연다', () => {
  it('아래 자리가 넉넉하면 아래로 연다', async () => {
    fake.trigger = { top: 100, bottom: 140 }
    fake.content = 150
    expect(opensUp(await open())).toBe(false)
  })

  it('아래 자리가 내용 높이보다 작고 위가 넉넉하면 위로 연다', async () => {
    fake.trigger = { top: 700, bottom: 740 }
    fake.content = 150
    expect(opensUp(await open())).toBe(true)
  })

  /** `prefersTop`의 규칙 — 둘 다 모자라면 요청한 쪽이다. */
  it('둘 다 모자라면 요청한 아래로 연다', async () => {
    fake.trigger = { top: 380, bottom: 420 }
    fake.content = 2000
    expect(opensUp(await open())).toBe(false)
  })

  it('위로 요청한 것은 위에 자리가 있으면 그대로 위다', async () => {
    fake.trigger = { top: 700, bottom: 740 }
    fake.content = 150
    expect(opensUp(await open('top'))).toBe(true)
  })
})

describe('첫 배치 뒤 자란 패널도 다시 판정한다', () => {
  /**
   * 줄이 나중에 들어오는 패널([사진 추가] 메뉴는 줄을 받아 와서 그린다). 처음에는 빈 패널이라 아래에
   * 들어가고, 그 자리가 천장이 된다. 자란 뒤에는 **눌리기 전의 높이**로 다시 판정해야 한다.
   */
  it('비어서 아래로 열렸다가 자라서 아래가 모자라면 위로 옮긴다', async () => {
    fake.trigger = { top: 700, bottom: 740 }
    fake.content = 30
    const panel = await open()
    expect(opensUp(panel)).toBe(false)

    fake.content = 150
    grow?.()
    await settle()

    expect(opensUp(panel)).toBe(true)
    // 옮긴 쪽에 남은 자리가 천장이다 — 위쪽 자리(트리거 위 - 틈 - 가장자리).
    expect(panel.style.getPropertyValue('--popover-room')).toBe(`${700 - 8 - 12}px`)
  })
})

describe('하단 막대에 가려지는 자리는 아래 자리로 치지 않는다', () => {
  it('막대를 빼면 모자라므로 위로 연다', async () => {
    // 막대가 없다면 아래 자리는 800 - 620 - 8 - 12 = 160으로 150이 들어간다.
    fake.trigger = { top: 580, bottom: 620 }
    fake.content = 150
    fake.cover = 120
    expect(opensUp(await open())).toBe(true)
  })

  it('아래로 열면 천장도 막대 위까지다', async () => {
    fake.trigger = { top: 100, bottom: 140 }
    fake.content = 150
    fake.cover = 40
    const panel = await open()
    expect(opensUp(panel)).toBe(false)
    expect(panel.style.getPropertyValue('--popover-room')).toBe(`${VIEWPORT - 40 - 140 - 8 - 12}px`)
  })
})
