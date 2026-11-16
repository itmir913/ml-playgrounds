/**
 * **흐름도 창의 확대·이동 계산** (`ml/flow-zoom.ts`, `architecture.md` §8.22).
 *
 * 눈금은 `화면 = 판 × k + (x, y)`다. 아래 검사는 눈금이 **무엇을 붙든 채 움직이는가**를 숫자로 잰다 —
 * 확대가 커서 밑의 점을 놓치면 학생이 보던 노드가 화면 밖으로 달아난다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLOW_DRAG_THRESHOLD_PX,
  FLOW_ZOOM_MAX,
  FLOW_ZOOM_MIN,
  FLOW_ZOOM_STEP,
  FLOW_ZOOM_WHEEL_RATE,
} from '../src/limits'
import { FLOW_GEOMETRY } from '../src/ml/flow-layout'
import {
  clampZoom,
  escapeStep,
  fit,
  initialView,
  isDrag,
  pan,
  pinchView,
  stepZoom,
  toCanvas,
  toScreen,
  wheelZoom,
  zoomAt,
  type View,
} from '../src/ml/flow-zoom'

const CANVAS = { w: 1100, h: 580 }
const BIG = { w: 1400, h: 900 }
const SMALL = { w: 700, h: 500 }

function near(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('배율의 범위', () => {
  it('범위 안의 값은 그대로이고 밖은 끝으로 간다', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(FLOW_ZOOM_MIN / 10)).toBe(FLOW_ZOOM_MIN)
    expect(clampZoom(FLOW_ZOOM_MAX * 10)).toBe(FLOW_ZOOM_MAX)
    expect(clampZoom(FLOW_ZOOM_MIN)).toBe(FLOW_ZOOM_MIN)
    expect(clampZoom(FLOW_ZOOM_MAX)).toBe(FLOW_ZOOM_MAX)
  })

  it('범위는 1을 가운데 두고 단추 걸음은 1보다 크다', () => {
    expect(FLOW_ZOOM_MIN).toBeLessThan(1)
    expect(FLOW_ZOOM_MAX).toBeGreaterThan(1)
    expect(FLOW_ZOOM_STEP).toBeGreaterThan(1)
  })
})

describe('전체 보기', () => {
  it('판 전체가 담기고 가운데에 놓인다', () => {
    const view = fit(BIG, CANVAS)
    const pad = FLOW_GEOMETRY.fitPadding * 2
    expect(view.k).toBeCloseTo(Math.min((BIG.w - pad) / CANVAS.w, (BIG.h - pad) / CANVAS.h), 9)
    // 판의 가운데가 화면의 가운데에 온다.
    near(toScreen(view, { x: CANVAS.w / 2, y: CANVAS.h / 2 }), { x: BIG.w / 2, y: BIG.h / 2 })
    // 판의 네 모서리가 여백 안쪽이다.
    const corner = toScreen(view, { x: CANVAS.w, y: CANVAS.h })
    expect(corner.x).toBeLessThanOrEqual(BIG.w - FLOW_GEOMETRY.fitPadding + 1e-9)
    expect(corner.y).toBeLessThanOrEqual(BIG.h - FLOW_GEOMETRY.fitPadding + 1e-9)
  })

  it('작은 화면에서는 줄어든다 — 단추를 눌렀으니 1보다 작아도 된다', () => {
    const view = fit(SMALL, CANVAS)
    expect(view.k).toBeLessThan(1)
    near(toScreen(view, { x: CANVAS.w / 2, y: CANVAS.h / 2 }), { x: SMALL.w / 2, y: SMALL.h / 2 })
  })

  it('배율은 범위를 넘지 않는다', () => {
    expect(fit({ w: 100, h: 100 }, CANVAS).k).toBe(FLOW_ZOOM_MIN)
    expect(fit({ w: 90000, h: 90000 }, CANVAS).k).toBe(FLOW_ZOOM_MAX)
  })
})

describe('첫 화면', () => {
  it('담기고도 남으면 담아서 가운데에 둔다', () => {
    expect(initialView(BIG, CANVAS)).toEqual(fit(BIG, CANVAS))
  })

  it('담기지 않으면 줄이지 않고 배율 1로 판의 왼쪽 위에서 시작한다', () => {
    const view = initialView(SMALL, CANVAS)
    expect(view).toEqual({ k: 1, x: FLOW_GEOMETRY.startMargin, y: FLOW_GEOMETRY.startMargin })
  })

  it('확대 막대가 위를 덮는 좁은 폭에서는 그만큼 내려서 시작한다', () => {
    const view = initialView(SMALL, CANVAS, 52)
    expect(view.y).toBe(FLOW_GEOMETRY.startMargin + 52)
    expect(view.k).toBe(1)
    // 담기는 화면에서는 내리지 않는다 — 가운데가 이미 막대 밑이다.
    expect(initialView(BIG, CANVAS, 52)).toEqual(fit(BIG, CANVAS))
  })

  it('담기는 배율이 정확히 1이면 담는 쪽이다', () => {
    const pad = FLOW_GEOMETRY.fitPadding * 2
    const exact = { w: CANVAS.w + pad, h: CANVAS.h + pad }
    expect(initialView(exact, CANVAS).k).toBeCloseTo(1, 9)
    expect(initialView(exact, CANVAS)).toEqual(fit(exact, CANVAS))
  })
})

describe('붙든 점을 놓치지 않는 확대', () => {
  const VIEWS: View[] = [
    { k: 1, x: 0, y: 0 },
    { k: 0.5, x: 120, y: -40 },
    { k: 2, x: -300, y: 77 },
    { k: 1.3, x: 12.5, y: 12.5 },
  ]
  const FOCI = [
    { x: 0, y: 0 },
    { x: 400, y: 300 },
    { x: 1299, y: 899 },
  ]

  it.each(VIEWS)('배율 %j: 붙든 화면 점 밑의 판 자리가 그대로다', (view) => {
    for (const focus of FOCI) {
      for (const next of [0.3, 0.8, 1, 1.7, 2.9]) {
        const after = zoomAt(view, focus, next)
        near(toCanvas(after, focus), toCanvas(view, focus))
        expect(after.k).toBeCloseTo(clampZoom(next), 9)
      }
    }
  })

  it('범위 밖 배율을 요청하면 끝에서 멈추고 그때도 점을 붙든다', () => {
    const view = { k: 1, x: 10, y: 20 }
    const focus = { x: 640, y: 360 }
    const high = zoomAt(view, focus, 99)
    expect(high.k).toBe(FLOW_ZOOM_MAX)
    near(toCanvas(high, focus), toCanvas(view, focus))
    const low = zoomAt(view, focus, 0.0001)
    expect(low.k).toBe(FLOW_ZOOM_MIN)
    near(toCanvas(low, focus), toCanvas(view, focus))
  })

  it('같은 배율로 확대하면 눈금이 그대로다', () => {
    const view = { k: 1.2, x: 33, y: -8 }
    const same = zoomAt(view, { x: 500, y: 200 }, 1.2)
    near(same, view)
    expect(same.k).toBe(view.k)
  })
})

describe('확대·축소 단추', () => {
  const VIEWPORT = { w: 1000, h: 600 }

  it('걸음만큼 곱하고 화면 가운데를 붙든다', () => {
    const view = { k: 1, x: 40, y: 10 }
    const next = stepZoom(view, VIEWPORT, 'in')
    expect(next.k).toBeCloseTo(FLOW_ZOOM_STEP, 9)
    near(toCanvas(next, { x: 500, y: 300 }), toCanvas(view, { x: 500, y: 300 }))
    expect(stepZoom(view, VIEWPORT, 'out').k).toBeCloseTo(1 / FLOW_ZOOM_STEP, 9)
  })

  it('100%에서 멈춘다 — 키울 때도 줄일 때도 1을 건너뛰지 않는다', () => {
    expect(stepZoom({ k: 0.9, x: 0, y: 0 }, VIEWPORT, 'in').k).toBe(1)
    expect(stepZoom({ k: 1.1, x: 0, y: 0 }, VIEWPORT, 'out').k).toBe(1)
    // 1에서 출발하면 걸음만큼 간다.
    expect(stepZoom({ k: 1, x: 0, y: 0 }, VIEWPORT, 'in').k).toBeGreaterThan(1)
    expect(stepZoom({ k: 1, x: 0, y: 0 }, VIEWPORT, 'out').k).toBeLessThan(1)
  })

  it('양 끝에서는 더 못 간다', () => {
    expect(stepZoom({ k: FLOW_ZOOM_MAX, x: 0, y: 0 }, VIEWPORT, 'in').k).toBe(FLOW_ZOOM_MAX)
    expect(stepZoom({ k: FLOW_ZOOM_MIN, x: 0, y: 0 }, VIEWPORT, 'out').k).toBe(FLOW_ZOOM_MIN)
  })

  it('단추를 눌러 한 걸음씩 가면 모든 걸음이 범위 안이고 100%를 지난다', () => {
    let view: View = fit({ w: 400, h: 300 }, CANVAS)
    const seen = new Set<number>()
    for (let step = 0; step < 40; step += 1) {
      view = stepZoom(view, VIEWPORT, 'in')
      expect(view.k).toBeLessThanOrEqual(FLOW_ZOOM_MAX)
      seen.add(view.k)
    }
    expect(seen.has(1)).toBe(true)
    expect(view.k).toBe(FLOW_ZOOM_MAX)
  })
})

describe('휠', () => {
  const FOCUS = { x: 300, y: 200 }

  it('위로 굴리면 커지고 아래로 굴리면 줄어든다', () => {
    const view = { k: 1, x: 0, y: 0 }
    expect(wheelZoom(view, FOCUS, -100).k).toBeGreaterThan(1)
    expect(wheelZoom(view, FOCUS, 100).k).toBeLessThan(1)
    expect(wheelZoom(view, FOCUS, 0)).toEqual(view)
  })

  it('같은 만큼 앞뒤로 굴리면 되돌아온다', () => {
    const view = { k: 1.4, x: 12, y: 80 }
    const back = wheelZoom(wheelZoom(view, FOCUS, -240), FOCUS, 240)
    expect(back.k).toBeCloseTo(view.k, 9)
    near(back, view)
  })

  it('굴린 만큼이 지수다', () => {
    expect(wheelZoom({ k: 1, x: 0, y: 0 }, FOCUS, -100).k).toBeCloseTo(
      Math.exp(100 * FLOW_ZOOM_WHEEL_RATE),
      9,
    )
  })

  it('커서 밑의 판 자리를 붙든다', () => {
    const view = { k: 1.1, x: -60, y: 15 }
    near(toCanvas(wheelZoom(view, FOCUS, -80), FOCUS), toCanvas(view, FOCUS))
  })
})

describe('끌기와 눈금 변환', () => {
  it('끌면 위치만 움직이고 배율은 그대로다', () => {
    expect(pan({ k: 1.5, x: 10, y: 20 }, 7, -3)).toEqual({ k: 1.5, x: 17, y: 17 })
  })

  it('toScreen과 toCanvas는 서로의 거꾸로다', () => {
    for (const view of [
      { k: 1, x: 0, y: 0 },
      { k: 0.25, x: 500, y: -120 },
      { k: 3, x: -2000, y: 90.5 },
    ]) {
      for (const point of [
        { x: 0, y: 0 },
        { x: 1100, y: 580 },
        { x: 333.3, y: -42 },
      ]) {
        near(toCanvas(view, toScreen(view, point)), point)
        near(toScreen(view, toCanvas(view, point)), point)
      }
    }
  })

  it('판의 점: 배율 1이면 판의 점이 이동량만큼만 옮겨 간다', () => {
    near(toScreen({ k: 1, x: 100, y: 50 }, { x: 10, y: 20 }), { x: 110, y: 70 })
    near(toScreen({ k: 2, x: 100, y: 50 }, { x: 10, y: 20 }), { x: 120, y: 90 })
  })
})

describe('두 손가락', () => {
  const START = {
    view: { k: 1, x: 20, y: 30 },
    center: { x: 400, y: 300 },
    distance: 100,
  }

  it('간격이 두 배가 되면 배율이 두 배이고 처음 가운데 밑의 판 자리가 지금 가운데 밑에 온다', () => {
    const now = { center: { x: 430, y: 310 }, distance: 200 }
    const view = pinchView(START, now)
    expect(view.k).toBeCloseTo(2, 9)
    near(toCanvas(view, now.center), toCanvas(START.view, START.center))
  })

  it('손가락이 그대로면 눈금이 그대로다', () => {
    const view = pinchView(START, { center: START.center, distance: START.distance })
    near(view, START.view)
    expect(view.k).toBe(START.view.k)
  })

  it('범위를 넘겨 벌려도 끝에서 멈춘다', () => {
    expect(pinchView(START, { center: START.center, distance: 100000 }).k).toBe(FLOW_ZOOM_MAX)
    expect(pinchView(START, { center: START.center, distance: 0.001 }).k).toBe(FLOW_ZOOM_MIN)
  })

  it('처음 간격이 0이면(한 손가락) 눈금을 건드리지 않는다', () => {
    expect(pinchView({ ...START, distance: 0 }, { center: { x: 1, y: 1 }, distance: 50 })).toEqual(
      START.view,
    )
  })
})

describe('끌기와 누름', () => {
  it('문턱을 넘어야 끌기다', () => {
    expect(isDrag(0)).toBe(false)
    expect(isDrag(FLOW_DRAG_THRESHOLD_PX)).toBe(false)
    expect(isDrag(FLOW_DRAG_THRESHOLD_PX + 0.1)).toBe(true)
  })
})

describe('Esc는 하나씩 닫는다', () => {
  it('고정한 강조 → 창의 차례다', () => {
    const first = escapeStep({ pinned: true })
    expect(first).toEqual({ state: { pinned: false }, closeDialog: false })
    expect(escapeStep(first.state)).toEqual({ state: { pinned: false }, closeDialog: true })
  })

  it('고정한 강조가 있으면 그것만 풀고 창은 남는다', () => {
    expect(escapeStep({ pinned: true }).closeDialog).toBe(false)
  })

  it('고정한 것이 없으면 창을 닫는다', () => {
    expect(escapeStep({ pinned: false }).closeDialog).toBe(true)
  })

  it('한 번에 창과 강조를 함께 닫지 않는다', () => {
    for (const pinned of [false, true]) {
      const result = escapeStep({ pinned })
      expect(result.closeDialog && result.state.pinned !== pinned, String(pinned)).toBe(false)
    }
  })
})

describe('이 모듈은 상수를 limits.ts에서 읽는다', () => {
  it('배율 범위·걸음·휠·끌기 문턱을 다시 적지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ml', 'flow-zoom.ts'), 'utf-8')
    for (const name of [
      'FLOW_ZOOM_MIN',
      'FLOW_ZOOM_MAX',
      'FLOW_ZOOM_STEP',
      'FLOW_ZOOM_WHEEL_RATE',
      'FLOW_DRAG_THRESHOLD_PX',
    ]) {
      expect(source, name).toMatch(
        new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '@/limits'`, 's'),
      )
    }
  })
})
