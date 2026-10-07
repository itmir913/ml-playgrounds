// @vitest-environment jsdom
// 그리기 창의 단추·포인터·`<dialog>`을 띄워 재는 스펙이라 DOM이 필요하다.
/**
 * 그리기 창 (`views/data/SketchDialog.vue`, 판례 67의 10).
 *
 * **캔버스는 가짜다.** jsdom에는 2D 컨텍스트가 없어서 브라우저 접착(`views/data/sketch-canvas.ts`)을
 * 통째로 갈아끼운다 — 화면 캔버스와 내보내는 캔버스가 각자 부른 것을 적는 가짜 컨텍스트를 받는다.
 * 그래서 여기서 재는 것은 **창이 그림판 상태를 옳게 굴리는가**다. 획이 실제로 보이는가, 손가락이
 * 화면을 안 굴리는가, 창 모양은 사람 확인이다(`workflow.md` §12 마지막 줄).
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { stubDialogElement } from './fixtures/image-workers'

import { SKETCH_EXPORT_FORMAT } from '../src/data/image/formats'
import { createSketchNamer, EMPTY_SKETCH, type SketchContext } from '../src/data/image/sketch'
import { i18n, setLocale } from '../src/i18n'
import { SKETCH_CANVAS_SIZE, SKETCH_STROKE_WIDTHS } from '../src/limits'
import ko from '../src/locales/ko.json'
import { refusalFor } from '../src/locks'
import SketchDialog from '../src/views/data/SketchDialog.vue'

/* ------------------------------------------------------------------ 가짜 캔버스 */

/** 부른 것을 적는 가짜 컨텍스트. 긋기는 그때의 굵기와 함께 적는다. */
function recorder(): { context: SketchContext; calls: string[] } {
  const calls: string[] = []
  const state = {
    fillStyle: '' as SketchContext['fillStyle'],
    strokeStyle: '' as SketchContext['strokeStyle'],
    lineWidth: 0,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
  }
  const context: SketchContext = Object.assign(state, {
    fillRect: () => calls.push('fillRect'),
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
    stroke: () => calls.push(`stroke ${state.lineWidth}`),
    arc: (x: number, y: number) => calls.push(`arc ${x} ${y}`),
    fill: () => calls.push('fill'),
  })
  return { context, calls }
}

const fake = vi.hoisted(() => ({
  screen: null as { calls: string[] } | null,
  exported: [] as { calls: string[] }[],
  frames: [] as (() => void)[],
  snapshots: 0,
  /** 참이면 `toBlob`이 `release`를 부를 때까지 기다린다 — [추가]가 도는 사이를 잰다. */
  holdBlob: false,
  held: [] as (() => void)[],
}))

vi.mock('../src/views/data/sketch-canvas', () => ({
  contextOf: () => {
    const made = recorder()
    fake.screen = made
    return made.context
  },
  snapshotOf: () => {
    fake.snapshots += 1
    return `data:snapshot-${fake.snapshots}`
  },
  createSketchCanvas: () => {
    const made = recorder()
    fake.exported.push(made)
    return {
      context: made.context,
      toBlob: (type: string) =>
        fake.holdBlob
          ? new Promise<Blob>((resolve) => {
              fake.held.push(() => resolve(new Blob(['png'], { type })))
            })
          : Promise.resolve(new Blob(['png'], { type })),
    }
  },
  onNextFrame: (callback: () => void) => {
    fake.frames.push(callback)
    return () => {
      fake.frames = fake.frames.filter((one) => one !== callback)
    }
  },
}))

/** 미뤄 둔 다시 그리기를 지금 돌린다 — 브라우저의 다음 화면 갱신이다. */
function flushFrames(): void {
  const frames = fake.frames
  fake.frames = []
  for (const frame of frames) frame()
}

/**
 * `showModal`이 불린 `<dialog>`들, 부른 차례대로. **최상위 레이어는 부른 차례로 쌓인다** — 나중에
 * 부른 것이 위다. 확인 창이 그리기 창 위에 서는지를 이것으로 잰다.
 */
const shown: HTMLDialogElement[] = []

/** 화면에 보이는 캔버스의 자리와 크기. 픽셀은 448, 보이는 크기는 그 절반이다. */
const RECT = { left: 10, top: 20, width: 224, height: 224 }

beforeEach(async () => {
  stubDialogElement()
  fake.screen = null
  fake.exported = []
  fake.frames = []
  fake.snapshots = 0
  fake.holdBlob = false
  fake.held = []
  shown.length = 0
  const showModal = HTMLDialogElement.prototype.showModal
  HTMLDialogElement.prototype.showModal = function record(this: HTMLDialogElement): void {
    shown.push(this)
    showModal.call(this)
  }
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLCanvasElement.prototype.getBoundingClientRect = () =>
    ({
      ...RECT,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: 0,
      y: 0,
    }) as DOMRect
  await setLocale('ko')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ 띄우기와 누르기 */

function render(nameSketch: () => string = createSketchNamer()) {
  return mount(SketchDialog, {
    props: { open: true, nameSketch },
    global: { plugins: [i18n] },
  })
}

type Wrapper = ReturnType<typeof render>

const T = ko.data.image.sketch

/**
 * 글자로 단추를 찾는다. **꼭 하나여야 한다** — 둘이면 어느 것을 누르는지 모른다. 찾는 곳은 그리기
 * 창(`0`)이고, 버릴지 묻는 창은 `1`이다 — 둘 다 [취소]가 있다.
 */
function button(wrapper: Wrapper, text: string, dialog = 0) {
  const found = wrapper
    .findAll('dialog')
    [dialog]!.findAll('button')
    .filter((one) => one.text().trim() === text)
  expect(found, `button "${text}"`).toHaveLength(1)
  return found[0]!
}

/** 포인터를 받는 상자 — 캔버스를 감싼 것이다. */
function pad(wrapper: Wrapper) {
  return wrapper.find('canvas').element.parentElement!
}

/** 보이는 좌표(캔버스 왼쪽 위 기준)로 획 하나를 긋는다. */
async function stroke(
  wrapper: Wrapper,
  points: readonly (readonly [number, number])[],
  pointerId = 1,
): Promise<void> {
  const [first, ...rest] = points
  if (first === undefined) throw new Error('a stroke needs a point')
  const at = ([x, y]: readonly [number, number]) => ({
    clientX: RECT.left + x,
    clientY: RECT.top + y,
    pointerId,
    button: 0,
    bubbles: true,
  })
  pad(wrapper).dispatchEvent(new PointerEvent('pointerdown', at(first)))
  for (const point of rest) {
    pad(wrapper).dispatchEvent(new PointerEvent('pointermove', at(point)))
  }
  pad(wrapper).dispatchEvent(new PointerEvent('pointerup', at(rest.at(-1) ?? first)))
  await wrapper.vm.$nextTick()
}

/** 캔버스 안의 문장(안내 또는 거절). 없으면 `null`. */
function canvasNote(wrapper: Wrapper): string | null {
  const note = wrapper.find('canvas + p')
  return note.exists() ? note.text() : null
}

/** 오른쪽 칸의 모은 장 수. 마지막 "지금" 칸은 빼고 센다. */
function sheetCount(wrapper: Wrapper): number {
  return wrapper.findAll('ul > li').length - 1
}

function done(wrapper: Wrapper): (File[] | null)[] {
  return (wrapper.emitted('done') ?? []).map(([files]) => files as File[] | null)
}

/** 그 `<dialog>`이 지금 열려 있는가. 0은 그리기 창, 1은 버릴지 묻는 창이다. */
function opened(wrapper: Wrapper, index: number): boolean {
  return (wrapper.findAll('dialog')[index]?.element as HTMLDialogElement).open
}

/* ------------------------------------------------------------------ 검사 */

describe('빈 그림은 잠그지 않고 거절한다', () => {
  it('거절은 등록부의 `sketchEmpty` 칸에서 나온다', () => {
    expect(refusalFor('sketchEmpty', { sketches: [EMPTY_SKETCH] })).toEqual(['SKETCH_EMPTY'])
  })

  it('처음에는 캔버스 안에 흐린 안내가 선다', () => {
    expect(canvasNote(render())).toBe(T.hint)
  })

  it('[다음 장 추가]는 장을 안 모으고 캔버스 안의 그 문장이 거절로 바뀐다', async () => {
    const wrapper = render()
    await button(wrapper, T.next).trigger('click')
    expect(sheetCount(wrapper)).toBe(0)
    expect(canvasNote(wrapper)).toBe(T.refuseEmpty)
    // 새 줄이 생기지 않는다 — 캔버스 안의 문장은 여전히 하나다.
    expect(wrapper.findAll('canvas + p')).toHaveLength(1)
    // 단추는 잠기지 않았다 — 누를 수 있어야 거절을 듣는다.
    expect(button(wrapper, T.next).attributes('disabled')).toBeUndefined()
  })

  it('[추가]는 `done`을 안 내고 같은 거절을 세운다', async () => {
    const wrapper = render()
    await button(wrapper, T.add).trigger('click')
    await flushPromises()
    expect(done(wrapper)).toEqual([])
    expect(canvasNote(wrapper)).toBe(T.refuseEmpty)
  })

  it('긋기 시작하면 거절이 걷힌다', async () => {
    const wrapper = render()
    await button(wrapper, T.next).trigger('click')
    await stroke(wrapper, [[10, 10]])
    expect(canvasNote(wrapper)).toBeNull()
  })
})

describe('포인터로 획이 들어간다', () => {
  it('보이는 좌표를 픽셀 좌표로 바꿔 긋는다', async () => {
    const wrapper = render()
    await stroke(wrapper, [
      [56, 112],
      [112, 112],
    ])
    expect(canvasNote(wrapper)).toBeNull()
    // 보이는 크기가 픽셀의 절반이라 두 배로 선다.
    const scale = SKETCH_CANVAS_SIZE / RECT.width
    expect(fake.screen?.calls).toContain(`moveTo ${56 * scale} ${112 * scale}`)
    expect(fake.screen?.calls).toContain(`lineTo ${112 * scale} ${112 * scale}`)
  })

  it('긋는 동안의 다시 그리기는 화면 갱신 한 번으로 묶인다', async () => {
    const wrapper = render()
    await flushPromises()
    const at = (x: number) => ({
      clientX: RECT.left + x,
      clientY: RECT.top + 5,
      pointerId: 1,
      button: 0,
    })
    pad(wrapper).dispatchEvent(new PointerEvent('pointerdown', at(1)))
    for (let x = 2; x < 50; x += 1) {
      pad(wrapper).dispatchEvent(new PointerEvent('pointermove', at(x)))
    }
    expect(fake.frames).toHaveLength(1)
    flushFrames()
    // 한 번 그린 것에 점 마흔아홉이 다 들었다.
    expect(fake.screen?.calls.filter((call) => call.startsWith('lineTo'))).toHaveLength(48)
  })

  it('두 번째 손가락은 획을 열지 않는다', async () => {
    const wrapper = render()
    const at = (x: number, pointerId: number) => ({
      clientX: RECT.left + x,
      clientY: RECT.top + 5,
      pointerId,
      button: 0,
    })
    pad(wrapper).dispatchEvent(new PointerEvent('pointerdown', at(1, 1)))
    pad(wrapper).dispatchEvent(new PointerEvent('pointerdown', at(2, 2)))
    pad(wrapper).dispatchEvent(new PointerEvent('pointerup', at(2, 2)))
    // 둘째 손가락을 뗀 것으로는 획이 안 끝난다.
    await wrapper.vm.$nextTick()
    expect(canvasNote(wrapper)).toBeNull()
    pad(wrapper).dispatchEvent(new PointerEvent('pointerup', at(1, 1)))
    await button(wrapper, T.add).trigger('click')
    await flushPromises()
    expect(done(wrapper)[0]).toHaveLength(1)
  })
})

describe('[다음 장 추가]가 장을 모은다', () => {
  it('모은 장이 늘고 캔버스가 비고, 안내 한 줄은 모은 장이 없을 때만 선다', async () => {
    const wrapper = render()
    expect(wrapper.text()).toContain(T.trayNote)
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    expect(sheetCount(wrapper)).toBe(1)
    expect(canvasNote(wrapper)).toBe(T.hint)
    expect(wrapper.text()).not.toContain(T.trayNote)
  })

  it('[추가 (N장)]의 N은 모은 장과 지금 장이다', async () => {
    const wrapper = render()
    expect(button(wrapper, T.add).exists()).toBe(true)
    await stroke(wrapper, [[10, 10]])
    // 지금 장만 그렸다.
    expect(button(wrapper, T.addCount.replace('{count}', '1')).exists()).toBe(true)
    await button(wrapper, T.next).trigger('click')
    // 모은 장 하나, 지금 장은 비었다.
    expect(button(wrapper, T.addCount.replace('{count}', '1')).exists()).toBe(true)
    await stroke(wrapper, [[20, 20]])
    expect(button(wrapper, T.addCount.replace('{count}', '2')).exists()).toBe(true)
  })

  it('[×]가 그 장을 뺀다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    await stroke(wrapper, [[20, 20]])
    await button(wrapper, T.next).trigger('click')
    expect(sheetCount(wrapper)).toBe(2)

    const first = T.removeSheet.replace('{index}', '1')
    await wrapper.find(`button[aria-label="${first}"]`).trigger('click')
    expect(sheetCount(wrapper)).toBe(1)

    await button(wrapper, T.addCount.replace('{count}', '1')).trigger('click')
    await flushPromises()
    // 남은 것은 두 번째 장이다.
    expect(fake.exported).toHaveLength(1)
    expect(fake.exported[0]?.calls).toContain(`arc ${20 * 2} ${20 * 2}`)
  })
})

describe('[추가]가 `File[]`로 끝난다', () => {
  it('모은 장과 지금 장을 차례대로, 판이 준 발급기의 이름과 그리기 형식으로 낸다', async () => {
    // 판의 발급기는 이미 한 번 썼다 — 창이 제 발급기를 쓰면 `drawn-1`부터 다시 나온다.
    const namer = createSketchNamer()
    namer()
    const wrapper = render(namer)
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    await stroke(wrapper, [[30, 30]])
    await button(wrapper, T.addCount.replace('{count}', '2')).trigger('click')
    await flushPromises()

    const [files] = done(wrapper)
    expect(files?.map((file) => file.name)).toEqual([
      `drawn-2${SKETCH_EXPORT_FORMAT.extension}`,
      `drawn-3${SKETCH_EXPORT_FORMAT.extension}`,
    ])
    expect(files?.every((file) => file.type === SKETCH_EXPORT_FORMAT.mime)).toBe(true)
    // 차례가 그린 차례다 — 첫 파일이 첫 장이다.
    expect(fake.exported[0]?.calls).toContain('arc 20 20')
    expect(fake.exported[1]?.calls).toContain('arc 60 60')
  })

  it('모은 장만 있고 지금 장이 비어도 [추가]는 된다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    await button(wrapper, T.addCount.replace('{count}', '1')).trigger('click')
    await flushPromises()
    expect(done(wrapper)[0]).toHaveLength(1)
  })

  it('고른 굵기가 내보낸 획에 실린다', async () => {
    const wrapper = render()
    await button(wrapper, ko.data.image.sketch.widthThick).trigger('click')
    await stroke(wrapper, [
      [10, 10],
      [20, 20],
    ])
    await button(wrapper, T.addCount.replace('{count}', '1')).trigger('click')
    await flushPromises()
    expect(fake.exported[0]?.calls).toContain(
      `stroke ${SKETCH_STROKE_WIDTHS.thick * SKETCH_CANVAS_SIZE}`,
    )
  })
})

describe('되돌리기와 초기화', () => {
  it('되돌리기는 마지막 획 하나만 뺀다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await stroke(wrapper, [[20, 20]])
    await button(wrapper, T.undo).trigger('click')
    await button(wrapper, T.addCount.replace('{count}', '1')).trigger('click')
    await flushPromises()
    const calls = fake.exported[0]?.calls ?? []
    expect(calls).toContain('arc 20 20')
    expect(calls).not.toContain('arc 40 40')
  })

  it('초기화는 지금 장을 비운다 — 그 뒤 [다음 장 추가]는 거절이다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await stroke(wrapper, [[20, 20]])
    await button(wrapper, T.clear).trigger('click')
    expect(canvasNote(wrapper)).toBe(T.hint)
    await button(wrapper, T.next).trigger('click')
    expect(sheetCount(wrapper)).toBe(0)
    expect(canvasNote(wrapper)).toBe(T.refuseEmpty)
  })
})

describe('닫기', () => {
  it('그린 것이 없으면 [취소]가 바로 `null`이다', async () => {
    const wrapper = render()
    await button(wrapper, ko.common.cancel).trigger('click')
    expect(done(wrapper)).toEqual([null])
  })

  it('`Esc`(창이 스스로 닫힘)도 그린 것이 없으면 `null`이다', async () => {
    const wrapper = render()
    await wrapper.findAll('dialog')[0]!.trigger('close')
    expect(done(wrapper)).toEqual([null])
  })

  /**
   * **확인 창은 그리기 창 위에 쌓인다** (코드 소유자, open-decisions.md 67). 그리기 창을 내리고 확인
   * 창만 띄우면 학생은 무엇을 버리는지 못 본다.
   */
  it('그린 것이 있으면 [취소]가 그리기 창 위에 확인 창을 쌓고, 확인 창의 [취소]는 그것만 닫는다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    const [sketchDialog, confirmDialog] = wrapper.findAll('dialog').map((one) => one.element)
    await button(wrapper, ko.common.cancel).trigger('click')
    expect(done(wrapper)).toEqual([])
    expect(opened(wrapper, 0)).toBe(true)
    expect(opened(wrapper, 1)).toBe(true)
    // 확인 창이 나중에 열렸다 — 위다.
    expect(shown.at(-1)).toBe(confirmDialog)
    expect(shown.indexOf(sketchDialog as HTMLDialogElement)).toBeLessThan(shown.length - 1)

    await button(wrapper, ko.common.cancel, 1).trigger('click')
    expect(opened(wrapper, 0)).toBe(true)
    expect(opened(wrapper, 1)).toBe(false)
    expect(canvasNote(wrapper)).toBeNull()
    expect(done(wrapper)).toEqual([])
  })

  it('`Esc`는 그리기 창의 닫힘을 막고 확인 창을 쌓는다 — [추가하지 않고 닫기]가 `null`이다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    const escape = new Event('cancel', { cancelable: true })
    wrapper.findAll('dialog')[0]!.element.dispatchEvent(escape)
    await flushPromises()
    expect(escape.defaultPrevented).toBe(true)
    expect(done(wrapper)).toEqual([])
    expect(opened(wrapper, 0)).toBe(true)
    expect(opened(wrapper, 1)).toBe(true)
    expect(wrapper.text()).toContain(T.discardDescription.replace('{count}', '1'))

    await button(wrapper, T.discardConfirm, 1).trigger('click')
    expect(done(wrapper)).toEqual([null])
  })

  /**
   * **`Esc` 연타** (코드 소유자 보고 — 확인 창이 그리기 창 뒤에 뜬 것 같다). 무엇이 와도 지킬 것은
   * 셋이다: 확인 창이 떠 있으면 그것이 맨 위다(마지막 `showModal`이 확인 창이고 그 뒤로 그리기 창의
   * `showModal`이 없다), 확인 창의 `Esc`는 확인 창만 닫는다, 그린 것은 안 사라진다.
   *
   * 브라우저 흉내: 막지 않은 `cancel`은 창을 닫고 `close`를 올린다. 막을 수 없는 `cancel`(사용자 활성
   * 없음)도 있고, 크롬은 연타한 창 둘을 한 묶음으로 함께 닫기도 한다(위 창의 `close`가 먼저).
   */
  it('`Esc`를 연타해도 확인 창은 언제나 맨 위이고, 그린 것은 남는다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    const [sketchDialog, confirmDialog] = wrapper
      .findAll('dialog')
      .map((one) => one.element as HTMLDialogElement)

    function close(dialog: HTMLDialogElement): void {
      dialog.open = false
      dialog.dispatchEvent(new Event('close'))
    }
    function escape(dialog: HTMLDialogElement, cancelable = true): void {
      const event = new Event('cancel', { cancelable })
      dialog.dispatchEvent(event)
      if (!event.defaultPrevented) close(dialog)
    }
    /** 확인 창이 떠 있으면 맨 위인가 — 마지막 `showModal`이 확인 창이다. */
    function confirmOnTop(): void {
      if (!confirmDialog!.open) return
      const last = shown.lastIndexOf(confirmDialog!)
      expect(last, 'confirm dialog is on top').toBe(shown.length - 1)
      expect(sketchDialog!.open, 'sketch dialog stays under it').toBe(true)
    }
    const settleAll = async () => {
      await flushPromises()
      await wrapper.vm.$nextTick()
      await flushPromises()
    }

    // 그리기 창의 `Esc` — 막고 확인 창을 쌓는다.
    escape(sketchDialog!)
    await settleAll()
    expect(confirmDialog!.open).toBe(true)
    confirmOnTop()

    // 확인 창의 `Esc` — 확인 창만 닫힌다.
    escape(confirmDialog!)
    await settleAll()
    expect(confirmDialog!.open).toBe(false)
    expect(sketchDialog!.open).toBe(true)

    // 그리기 창의 `Esc`를 막을 수 없었다 — 닫혔다가 다시 뜨고 그 위에 확인 창.
    escape(sketchDialog!, false)
    await settleAll()
    expect(sketchDialog!.open).toBe(true)
    expect(confirmDialog!.open).toBe(true)
    confirmOnTop()

    // 연타가 둘을 한 묶음으로 닫았다(위에서부터) — 확인 창의 `Esc`였으니 확인 창은 다시 안 쌓는다.
    close(confirmDialog!)
    close(sketchDialog!)
    await settleAll()
    expect(sketchDialog!.open).toBe(true)
    expect(confirmDialog!.open).toBe(false)

    // 그리기 창의 `Esc`를 또 막을 수 없었다 — 다시 확인 창이 맨 위.
    escape(sketchDialog!, false)
    await settleAll()
    expect(confirmDialog!.open).toBe(true)
    confirmOnTop()

    // 그리기 창의 `Esc`가 또 와도(막았다) 확인 창은 맨 위 그대로다.
    escape(sketchDialog!)
    await settleAll()
    confirmOnTop()

    expect(done(wrapper)).toEqual([])
    expect(canvasNote(wrapper)).toBeNull()
  })

  /** 확인 창의 바깥 클릭은 [취소]와 같다 — 확인 창만 닫히고 그리기로 돌아간다. */
  it('확인 창의 바깥을 누르면 확인 창만 닫히고 그리기 창과 그림은 남는다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, ko.common.cancel).trigger('click')
    expect(opened(wrapper, 1)).toBe(true)

    // `<dialog>` 자신을 누른 것이 바깥이다(`AppDialog`의 `onBackdrop`).
    await wrapper.findAll('dialog')[1]!.trigger('click')
    await flushPromises()
    expect(opened(wrapper, 1)).toBe(false)
    expect(opened(wrapper, 0)).toBe(true)
    expect(canvasNote(wrapper)).toBeNull()
    expect(done(wrapper)).toEqual([])
  })

  /**
   * **확인 창을 `Esc`로 닫은 표지는 다음 입력에서 걷힌다.** 남아 있으면 한참 뒤 막지 못한 닫힘이 왔을 때
   * 확인 창을 안 쌓아 그린 것을 붙잡을 길이 없어진다.
   */
  it('확인 창을 `Esc`로 닫고 다시 그린 뒤 막지 못한 닫힘이 오면 확인 창이 다시 쌓인다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    const [sketchDialog, confirmDialog] = wrapper
      .findAll('dialog')
      .map((one) => one.element as HTMLDialogElement)
    await button(wrapper, ko.common.cancel).trigger('click')
    // 확인 창의 `Esc` — 브라우저가 닫았다.
    confirmDialog!.open = false
    confirmDialog!.dispatchEvent(new Event('close'))
    await flushPromises()
    expect(confirmDialog!.open).toBe(false)

    await stroke(wrapper, [[30, 30]])
    // `cancel` 없이 브라우저가 그리기 창을 닫았다.
    sketchDialog!.open = false
    sketchDialog!.dispatchEvent(new Event('close'))
    await flushPromises()
    await wrapper.vm.$nextTick()
    expect(sketchDialog!.open).toBe(true)
    expect(confirmDialog!.open).toBe(true)
    expect(shown.at(-1)).toBe(confirmDialog)
  })

  it('그린 것이 없으면 `Esc`를 막지 않는다', async () => {
    const wrapper = render()
    const escape = new Event('cancel', { cancelable: true })
    wrapper.findAll('dialog')[0]!.element.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(false)
  })

  /**
   * **브라우저가 막을 수 없는 닫기** — 크롬은 사용자 활성 없이 거듭 누른 `Esc`의 `cancel`을 막지 못하게
   * 하고 창을 닫는다(close watcher). 그때 그린 것이 사라지면 안 된다 — 창을 다시 띄우고 확인을 쌓는다.
   */
  it('막지 못하고 닫혀도 그린 것은 남고, 창을 다시 띄운 위에 확인 창을 쌓는다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    const [sketchDialog, confirmDialog] = wrapper.findAll('dialog').map((one) => one.element)
    // 브라우저가 스스로 닫았다.
    ;(sketchDialog as HTMLDialogElement).open = false
    sketchDialog!.dispatchEvent(new Event('close'))
    await flushPromises()

    expect(done(wrapper)).toEqual([])
    expect(opened(wrapper, 0)).toBe(true)
    expect(opened(wrapper, 1)).toBe(true)
    expect(shown.slice(-2)).toEqual([sketchDialog, confirmDialog])
    expect(sheetCount(wrapper)).toBe(1)
  })

  /**
   * **부모가 닫아도 `<dialog>`은 `close`를 올린다** (`AppDialog`가 `open`을 따라 닫을 때). 그것을
   * 학생의 닫기로 읽으면 [추가]로 `File[]`을 낸 뒤에 `null`이 한 번 더 나간다.
   */
  it('부모가 닫은 것은 학생의 닫기가 아니다', async () => {
    const wrapper = render()
    await wrapper.setProps({ open: false })
    await wrapper.findAll('dialog')[0]!.trigger('close')
    expect(done(wrapper)).toEqual([])
  })

  it('[추가] 뒤 부모가 닫아도 `done`은 한 번이다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.addCount.replace('{count}', '1')).trigger('click')
    await flushPromises()
    await wrapper.setProps({ open: false })
    await wrapper.findAll('dialog')[0]!.trigger('close')
    expect(done(wrapper)).toHaveLength(1)
    expect(opened(wrapper, 1)).toBe(false)
  })

  it('다시 열면 새 판이다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    await button(wrapper, T.next).trigger('click')
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(sheetCount(wrapper)).toBe(0)
    expect(canvasNote(wrapper)).toBe(T.hint)
  })
})

/**
 * **긋는 중에 단추를 누를 수 있다** — 한 손가락이 캔버스에 있는 동안 다른 손가락이 단추를 누른다.
 * 열린 획을 그대로 두면 그림판에는 그 획이 없어서 [다음 장 추가]가 거절하고, [추가]는 그 획을 빼고
 * 낸다. 네 동작이 첫머리에서 열린 획을 닫는다.
 */
describe('긋는 중에 누른 단추', () => {
  /** 손가락을 대고 움직이기만 한다 — 아직 안 뗐다. */
  function touchAndHold(wrapper: Wrapper): void {
    const at = (x: number) => ({
      clientX: RECT.left + x,
      clientY: RECT.top + 10,
      pointerId: 1,
      button: 0,
    })
    pad(wrapper).dispatchEvent(new PointerEvent('pointerdown', at(10)))
    pad(wrapper).dispatchEvent(new PointerEvent('pointermove', at(20)))
  }

  it('[다음 장 추가]가 그 획까지 한 장으로 모은다', async () => {
    const wrapper = render()
    touchAndHold(wrapper)
    await button(wrapper, T.next).trigger('click')
    expect(sheetCount(wrapper)).toBe(1)
    expect(canvasNote(wrapper)).toBe(T.hint)
  })

  it('[추가]가 그 획까지 낸다', async () => {
    const wrapper = render()
    touchAndHold(wrapper)
    await wrapper.vm.$nextTick()
    await button(wrapper, T.add).trigger('click')
    await flushPromises()
    expect(done(wrapper)[0]).toHaveLength(1)
    expect(fake.exported[0]?.calls).toContain('lineTo 40 20')
  })

  it('[되돌리기]는 그 획을 닫고 뺀다 — 손을 떼도 되살아나지 않는다', async () => {
    const wrapper = render()
    touchAndHold(wrapper)
    await button(wrapper, T.undo).trigger('click')
    pad(wrapper).dispatchEvent(
      new PointerEvent('pointerup', {
        clientX: RECT.left + 30,
        clientY: RECT.top + 10,
        pointerId: 1,
      }),
    )
    await wrapper.vm.$nextTick()
    expect(canvasNote(wrapper)).toBe(T.hint)
  })
})

/**
 * **[추가]가 파일을 만드는 사이의 닫기** (감사 C). 그사이 `Esc` → [추가하지 않고 닫기]로 `null`이 먼저
 * 나가면 뒤이은 `File[]`은 부모가 이미 닫은 뒤라 버려진다. 도는 동안의 닫기 요청은 받지 않는다 —
 * [추가]가 이긴다.
 */
describe('[추가]가 도는 동안', () => {
  it('`Esc`·[취소]·막지 못한 닫기가 확인 창을 띄우지 않고, `done`은 파일로 한 번이다', async () => {
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    fake.holdBlob = true
    await button(wrapper, T.addCount.replace('{count}', '1')).trigger('click')
    await flushPromises()
    expect(fake.held).toHaveLength(1)

    const escape = new Event('cancel', { cancelable: true })
    const sketchDialog = wrapper.findAll('dialog')[0]!.element as HTMLDialogElement
    sketchDialog.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    await flushPromises()
    expect(opened(wrapper, 1)).toBe(false)
    // 갈래마다 본다 — 끝에서만 보면 마지막 `close`가 [취소]의 확인 창을 거둬 가려진다 (R43-5 C-2).
    await button(wrapper, ko.common.cancel).trigger('click')
    await flushPromises()
    expect(opened(wrapper, 1)).toBe(false)
    sketchDialog.open = false
    sketchDialog.dispatchEvent(new Event('close'))
    await flushPromises()
    expect(opened(wrapper, 1)).toBe(false)
    expect(opened(wrapper, 0)).toBe(true)

    fake.held[0]!()
    await flushPromises()
    expect(done(wrapper)).toHaveLength(1)
    expect(done(wrapper)[0]).toHaveLength(1)
  })
})

describe('붓 굵기', () => {
  /** 승인된 목업에는 축 이름 줄이 없다 — 그 줄만큼 캔버스가 눌렸다(`utilities.css`의 `sketch-columns`). */
  it('이름 줄 없이 서고, 이름은 묶음이 든다', () => {
    const wrapper = render()
    const group = wrapper.find('[role="group"]')
    expect(group.attributes('aria-label')).toBe(T.width)
    expect(wrapper.findAll('h3').map((one) => one.text())).not.toContain(T.width)
  })
})

describe('포인터 캡처가 안 돼도', () => {
  /** 캡처는 밖에서 뗀 획을 끝내 주는 덤이다. 못 하는 브라우저에서도 긋기는 된다. */
  it('획은 그어진다', async () => {
    HTMLElement.prototype.setPointerCapture = () => {
      throw new DOMException('no active pointer', 'NotFoundError')
    }
    const wrapper = render()
    await stroke(wrapper, [[10, 10]])
    expect(canvasNote(wrapper)).toBeNull()
    await button(wrapper, T.next).trigger('click')
    expect(sheetCount(wrapper)).toBe(1)
  })
})
