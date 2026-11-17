// @vitest-environment jsdom
/**
 * **프로젝트 흐름도의 판과 창을 마운트해서 본다** (`FlowCanvas.vue`, `FlowDialog.vue`, `FlowCard.vue`).
 *
 * jsdom이 못 재는 것은 여기 없다 — `showModal`의 첫 초점, 취소 불가가 된 `cancel`, 호버의 속도는 사람 확인이다
 * (`docs/rule-coverage.md`). 여기서는 그 판단이 기대는 **DOM의 규칙**을 본다: 빈 곳을 누르면 풀리는 범위,
 * `Esc`가 두 단계로 가는 길(keydown), 창이 열린 채로는 강조가 켜져 있지 않은 것, 군집화의 기준 이름.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FlowCanvas from '../src/components/flow/FlowCanvas.vue'
import FlowCard from '../src/components/flow/FlowCard.vue'
import FlowDialog from '../src/components/flow/FlowDialog.vue'
import { useFlowDialog } from '../src/composables/useFlowDialog'
import { i18n, setLocale } from '../src/i18n'
import { FLOW_DRAG_THRESHOLD_PX } from '../src/limits'
import { FLOW_GEOMETRY } from '../src/ml/flow-layout'
import { withTask } from './fixtures/flow-cases'
import { projectFile } from './fixtures/project'

vi.mock('@/ml/flow-counts', () => ({
  flowCountsOf: vi.fn(async () => null),
  flowCountsLite: vi.fn(() => null),
  barValuesOf: vi.fn(() => null),
}))

const PREP = {
  total: 150,
  usable: 150,
  sampled: 150,
  train: 150,
  test: 0,
  unusable: 0,
  notDrawn: 0,
  featureCount: 4,
  prep: 'preprocess',
  testFile: null,
} as const

beforeEach(async () => {
  // jsdom의 `<dialog>`는 열림을 모른다 — 열림만 세우는 대역이다(초점 규칙은 사람 확인).
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
  await setLocale('ko')
  useFlowDialog().close()
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  document.body.innerHTML = ''
})

const learnOf = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!

function mountCanvas(file = projectFile(), counts: typeof PREP | null = null) {
  const wrapper = mount(FlowCanvas, {
    props: {
      file,
      counts,
      bars: null,
      pinned: null,
      'onUpdate:pinned': (value: string | null) => wrapper.setProps({ pinned: value }),
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return wrapper
}

describe('판의 빈 곳을 누르면 고정이 풀린다', () => {
  it('그림 밖 여백(판 바탕)을 눌러도 풀린다', async () => {
    const wrapper = mountCanvas()
    await learnOf(wrapper).trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })

  it('노드를 누른 것은 풀지 않고 확대 막대를 누른 것도 풀지 않는다', async () => {
    const wrapper = mountCanvas()
    await learnOf(wrapper).trigger('click')
    const bar = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === '확대')!
    await bar.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    wrapper.unmount()
  })
})

describe('창은 열릴 때 강조가 켜져 있지 않고 Esc는 두 단계다', () => {
  function mountDialog() {
    const wrapper = mount(FlowDialog, {
      props: { file: projectFile(), lite: true, open: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    return wrapper
  }

  it('열린 직후에는 흐려진 것이 없다', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.findAll('.flow-dim')).toEqual([])
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])
    wrapper.unmount()
  })

  it('keydown Escape: 고정이 있으면 막고 풀고, 없으면 그대로 두어 닫히게 한다', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    const dialog = wrapper.find('dialog')

    await learnOf(wrapper).trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)

    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.element.dispatchEvent(first)
    await flushPromises()
    expect(first.defaultPrevented).toBe(true)
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])

    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.element.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('닫기는 제목줄 오른쪽 위의 아이콘 단추이고 아래 동작 줄은 없다', async () => {
    const wrapper = mountDialog()
    const close = wrapper.find('dialog button[aria-label="닫기"]')
    expect(close.exists()).toBe(true)
    expect(wrapper.find('dialog .mt-6.shrink-0').exists()).toBe(false)
    await close.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('바깥(바탕)을 눌러도 닫히지 않는다 — 판을 끌다 밖에서 놓아도 창을 지킨다', async () => {
    // 무는 대상: `FlowDialog.vue`가 `AppDialog`에 주는 `persistent`. 빠지면 끌다 커서가 밖으로 나가 놓을 때 창이 닫힌다.
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.find('dialog').trigger('click')
    expect(wrapper.emitted('close'), 'backdrop click must not close').toBeUndefined()
    wrapper.unmount()
  })

  it('창은 초점을 창 자신에 두고 연다 — 첫 단추가 강조를 켜지 않는다', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('dialog').attributes('autofocus')).toBeDefined()
    wrapper.unmount()
  })
})

describe('대시보드 카드의 Esc와 빈 곳', () => {
  function mountCard() {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => FLOW_GEOMETRY.width,
    })
    return mount(FlowCard, {
      props: { file: projectFile() },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
  }

  it('가라앉은 바탕의 빈 곳을 누르면 풀린다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)
    await wrapper.find('.bg-surface-sunken').trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])
    wrapper.unmount()
  })

  it('Esc는 카드 밖(문서)에서도 받아 고정만 푼다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])
    wrapper.unmount()
  })

  it('다른 대화상자가 열려 있어도 카드는 Esc를 안 받는다', async () => {
    // 무는 대상: `FlowCard.vue`의 `dialog[open]` 가드. 없으면 다른 창을 닫으려는 Esc가 카드의 고정까지 푼다.
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    const other = document.createElement('dialog')
    other.setAttribute('open', '')
    document.body.append(other)
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)
    other.remove()
    // 짝: 열린 대화상자가 없으면 푼다.
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('창이 열려 있으면 창이 우선이다 — 카드는 Esc를 안 받는다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    useFlowDialog().open(projectFile())
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)
    wrapper.unmount()
  })
})

describe('군집화의 기준 이름', () => {
  it('나누지 않는 유형은 학습에 사용하는 데이터 기준이라 부른다', () => {
    const cluster = mountCanvas(withTask(projectFile(), 'clustering'), PREP)
    expect(cluster.text()).toContain('학습에 사용하는 데이터 기준')
    cluster.unmount()
    const split = mountCanvas(projectFile(), PREP)
    expect(split.text()).toContain('훈련 데이터 기준')
    expect(split.text()).not.toContain('학습에 사용하는 데이터 기준')
    split.unmount()
  })
})

/**
 * **끌고 놓은 자리의 단추는 눌리지 않는다** (`FlowCanvas.vue`의 `swallowClick`). 판을 끌다 노드 위에서 놓으면
 * 브라우저가 그 노드에 `click`을 보낸다 — 삼키지 않으면 끌 때마다 강조가 고정된다. 끌지 않고 누르면 고정한다.
 * 손가락 둘의 핀치와 실제 끌림의 느낌은 jsdom이 못 잰다 — 사람 확인이다.
 */
describe('끌고 놓은 click은 고정하지 않는다', () => {
  /** 마우스 포인터 사건. jsdom에는 `PointerEvent`가 없어 `MouseEvent`에 id와 종류를 얹는다. */
  function pointer(type: string, x: number, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, ...init })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    return event
  }

  it('끌었으면 놓은 뒤의 click을 삼키고, 다음 프레임부터는 다시 누른다', async () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const wrapper = mountCanvas()
    const learn = learnOf(wrapper).element
    learn.dispatchEvent(pointer('pointerdown', 0, { button: 0 }))
    window.dispatchEvent(pointer('pointermove', FLOW_DRAG_THRESHOLD_PX * 4, { buttons: 1 }))
    window.dispatchEvent(pointer('pointerup', FLOW_DRAG_THRESHOLD_PX * 4))
    learn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:pinned') ?? []).not.toContainEqual(['learn'])

    for (const frame of frames.splice(0)) frame(0)
    await learnOf(wrapper).trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    wrapper.unmount()
  })

  it('문턱 안에서 놓으면 끈 것이 아니다 — 누른 노드를 고정한다', async () => {
    const wrapper = mountCanvas()
    const learn = learnOf(wrapper).element
    learn.dispatchEvent(pointer('pointerdown', 0, { button: 0 }))
    window.dispatchEvent(pointer('pointermove', 1, { buttons: 1 }))
    window.dispatchEvent(pointer('pointerup', 1))
    learn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    wrapper.unmount()
  })
})

/**
 * **Esc의 뒷길** (`FlowDialog.vue`의 `onCancel`). keydown을 못 막고 `cancel`이 와도 고정이 남아 있으면 그것만
 * 풀고 창을 지킨다. 고정이 없으면 막지 않아 창이 닫힌다.
 */
describe('cancel이 와도 Esc의 순서를 따른다', () => {
  it('고정이 있으면 막고 풀고, 없으면 그대로 둔다', async () => {
    const wrapper = mount(FlowDialog, {
      props: { file: projectFile(), lite: true, open: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    await flushPromises()
    const dialog = wrapper.find('dialog').element
    await learnOf(wrapper).trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)

    const first = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(first)
    await flushPromises()
    expect(first.defaultPrevented).toBe(true)
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])

    const second = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    wrapper.unmount()
  })
})

/**
 * **판이 확대 모듈에 이어져 있다** (`FlowCanvas.vue`). 계산은 `flow-zoom.spec.ts`가 보고, 여기서는 그 함수가 판에
 * 걸렸는지 본다: 첫 화면은 100%를 넘지도 밑돌지도 않고(§8.22, 줄이면 `text-base`가 깨진다), 단추와 휠이 배율을
 * 그 방향으로 바꾸고, [전체 보기]는 맞춤 배율이다. jsdom은 레이아웃을 안 하므로 판(`role=group`)·그림 판·확대
 * 막대의 크기를 정해 준다. 핀치와 키보드 초점을 따라 판을 옮기는 것(`reveal`)은 사람 확인이다.
 */
describe('판의 확대와 첫 화면', () => {
  /** 판이 그림보다 좁다 — 그림이 담기지 않는다. */
  const VIEWPORT = { w: 400, h: 600 }
  /** 크기를 바꾼 검사가 다음 검사를 오염시키지 않게 되돌리는 값. */
  const VIEWPORT_START = { ...VIEWPORT }
  /** 가짜 `ResizeObserver`가 받아 둔 콜백. 크기를 바꾼 뒤 `resize()`가 부른다. */
  let observers: (() => void)[] = []
  const PLANE = { w: FLOW_GEOMETRY.width, h: 900 }
  const BAR = { w: 200, h: 40 }

  function sizeOf(element: HTMLElement): { w: number; h: number } {
    if (element.getAttribute('role') === 'group') return VIEWPORT
    if (element.classList.contains('origin-top-left')) return PLANE
    if (element.classList.contains('z-20')) return BAR
    return { w: 0, h: 0 }
  }

  beforeEach(() => {
    Object.assign(VIEWPORT, VIEWPORT_START)
    observers = []
    // jsdom에는 `ResizeObserver`가 없다 — 판의 크기가 바뀌는 길(`useElementSize`)을 흉내 낸다.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          observers.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return sizeOf(this).w
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return sizeOf(this).h
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /** 판의 크기를 바꾸고 관찰자에게 알린다. */
  async function resize(size: Partial<typeof VIEWPORT>): Promise<void> {
    Object.assign(VIEWPORT, size)
    for (const notify of observers) notify()
    await flushPromises()
  }

  /** 판의 `translate(x, y)`. */
  function offsetOf(wrapper: ReturnType<typeof mountCanvas>): { x: number; y: number } {
    const style = wrapper.find('.origin-top-left').attributes('style') ?? ''
    const found = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(style)
    return { x: Number(found?.[1] ?? Number.NaN), y: Number(found?.[2] ?? Number.NaN) }
  }

  /** 지금 배율. 판의 `transform`에서 읽는다. */
  function scaleOf(wrapper: ReturnType<typeof mountCanvas>): number {
    const style = wrapper.find('.origin-top-left').attributes('style') ?? ''
    const found = /scale\(([\d.]+)\)/.exec(style)
    return Number(found?.[1] ?? Number.NaN)
  }

  async function zoomButton(wrapper: ReturnType<typeof mountCanvas>, key: string): Promise<void> {
    await wrapper.find(`button[aria-label="${i18n.global.t(key)}"]`).trigger('click')
  }

  it('그림이 안 담기는 폭에서도 첫 화면은 100%다', async () => {
    const wrapper = mountCanvas()
    await flushPromises()
    expect(scaleOf(wrapper)).toBe(1)
    expect(wrapper.find('output').text()).toContain('100')
    wrapper.unmount()
  })

  it('[축소]는 줄이고 [확대]는 키운다', async () => {
    const wrapper = mountCanvas()
    await flushPromises()
    await zoomButton(wrapper, 'flow.zoomOut')
    const smaller = scaleOf(wrapper)
    expect(smaller).toBeLessThan(1)
    await zoomButton(wrapper, 'flow.zoomIn')
    expect(scaleOf(wrapper)).toBeGreaterThan(smaller)
    wrapper.unmount()
  })

  it('[전체 보기]는 그림을 다 담는 맞춤 배율이다', async () => {
    const wrapper = mountCanvas()
    await flushPromises()
    await zoomButton(wrapper, 'flow.fit')
    const scale = scaleOf(wrapper)
    expect(scale).toBeLessThan(1)
    expect(PLANE.w * scale).toBeLessThanOrEqual(VIEWPORT.w)
    wrapper.unmount()
  })

  it('휠 한 번에 배율이 바뀐다', async () => {
    const wrapper = mountCanvas()
    await flushPromises()
    wrapper
      .find('[role="group"]')
      .element.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }),
      )
    await flushPromises()
    expect(scaleOf(wrapper)).toBeLessThan(1)
    wrapper.unmount()
  })

  it('휠은 판 위에서 화면이 스크롤되지 않게 막는다', async () => {
    const wrapper = mountCanvas()
    await flushPromises()
    const event = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
    wrapper.find('[role="group"]').element.dispatchEvent(event)
    expect(event.defaultPrevented, 'wheel on the plane must not scroll the page').toBe(true)
    wrapper.unmount()
  })

  // 아래 넷은 `FlowCanvas.vue`의 `settle`과 첫 화면의 배선이다. 무는 대상은 각 검사에 적었다.

  it('만진 뒤에 판의 크기가 바뀌어도 첫 화면으로 덮지 않는다', async () => {
    // 무는 대상: `settle`의 `moved` 가드. 없으면 [축소]로 맞춘 배율이 창 크기가 바뀔 때 100%로 되돌아간다.
    const wrapper = mountCanvas()
    await flushPromises()
    await zoomButton(wrapper, 'flow.zoomOut')
    const touched = scaleOf(wrapper)
    expect(touched).toBeLessThan(1)
    await resize({ w: 500 })
    expect(scaleOf(wrapper), 'a touched view must survive a resize').toBe(touched)
    wrapper.unmount()
  })

  it('[전체 보기] 뒤에 크기가 바뀌면 맞춤을 다시 건다 — 첫 화면(100%)으로 덮지 않는다', async () => {
    // 무는 대상: `settle`의 `fitted` 분기.
    const wrapper = mountCanvas()
    await flushPromises()
    await zoomButton(wrapper, 'flow.fit')
    const before = scaleOf(wrapper)
    await resize({ w: 300 })
    const after = scaleOf(wrapper)
    expect(after, 'refit to the smaller viewport').toBeLessThan(before)
    expect(PLANE.w * after).toBeLessThanOrEqual(300)
    wrapper.unmount()
  })

  it('좁은 폭에서는 확대 막대가 덮는 만큼 판을 내려 시작하고, 넓으면 내리지 않는다', async () => {
    // 무는 대상: `topInset`의 계산과 `initialView`로의 배선. 막대가 데이터 카드의 위를 덮은 채 열리게 된다.
    const narrow = mountCanvas()
    await flushPromises()
    expect(offsetOf(narrow).y).toBe(FLOW_GEOMETRY.startMargin * 2 + BAR.h)
    narrow.unmount()
    // 막대가 카드와 겹치지 않는 폭(그래도 그림 전체는 안 담기는 높이).
    Object.assign(VIEWPORT, {
      w: FLOW_GEOMETRY.cardX + FLOW_GEOMETRY.cardW + BAR.w + FLOW_GEOMETRY.startMargin * 2 + 1,
      h: 300,
    })
    const wide = mountCanvas()
    await flushPromises()
    expect(offsetOf(wide).y).toBe(FLOW_GEOMETRY.startMargin)
    wide.unmount()
  })

  /** 마우스 포인터 사건. jsdom에는 `PointerEvent`가 없어 `MouseEvent`에 id와 종류를 얹는다. */
  function mouse(type: string, x: number, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: 0, ...init })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    Object.defineProperty(event, 'pointerType', { value: 'mouse' })
    return event
  }

  it('왼쪽 단추로만 끈다 — 오른쪽 단추로 누르면 판이 안 움직인다', async () => {
    // 무는 대상: `onPointerDown`의 `button !== 0` 거름. 없으면 메뉴를 열었다 놓은 소식이 안 와 판이 붙어 다닌다.
    const wrapper = mountCanvas()
    await flushPromises()
    const start = offsetOf(wrapper)
    const group = wrapper.find('[role="group"]').element
    group.dispatchEvent(mouse('pointerdown', 0, { button: 2, buttons: 2 }))
    window.dispatchEvent(mouse('pointermove', FLOW_DRAG_THRESHOLD_PX * 8, { buttons: 2 }))
    await flushPromises()
    expect(offsetOf(wrapper)).toEqual(start)
    // 짝: 왼쪽 단추로는 움직인다 — 위 검사가 늘 안 움직이는 판에서 초록이 아니다.
    group.dispatchEvent(mouse('pointerdown', 0, { button: 0, buttons: 1 }))
    window.dispatchEvent(mouse('pointermove', FLOW_DRAG_THRESHOLD_PX * 8, { buttons: 1 }))
    window.dispatchEvent(mouse('pointerup', FLOW_DRAG_THRESHOLD_PX * 8))
    await flushPromises()
    expect(offsetOf(wrapper).x).not.toBe(start.x)
    wrapper.unmount()
  })

  it('창 밖에서 놓아 단추가 이미 떼어졌으면(buttons 0) 끌기를 끝낸다', async () => {
    // 무는 대상: `onPointerMove`의 `buttons === 0` 거름. 없으면 놓은 뒤에도 판이 마우스를 따라다닌다.
    const wrapper = mountCanvas()
    await flushPromises()
    const start = offsetOf(wrapper)
    wrapper
      .find('[role="group"]')
      .element.dispatchEvent(mouse('pointerdown', 0, { button: 0, buttons: 1 }))
    window.dispatchEvent(mouse('pointermove', FLOW_DRAG_THRESHOLD_PX * 8, { buttons: 0 }))
    await flushPromises()
    expect(offsetOf(wrapper)).toEqual(start)
    wrapper.unmount()
  })
})
