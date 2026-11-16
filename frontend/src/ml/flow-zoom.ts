/**
 * 프로젝트 흐름도 창의 **확대·이동 계산** — 판(캔버스) 하나를 화면 안에서 보는 눈금이다
 * (`architecture.md` §8.22). DOM도 Vue도 모른다. 컴포넌트는 이벤트에서 숫자를 뽑아 이 함수들에
 * 넘기고, 돌려받은 `View`를 변환으로 걸 뿐이다.
 *
 * **눈금은 `화면 = 판 × k + (x, y)`다.** 배율 범위와 단추의 걸음은 `limits.ts`가 갖는다. 창 안의
 * `toScreen`은 판의 점이 화면의 어디인가를 답한다.
 *
 * **노드를 끌어 옮기지 않는다.** 움직이는 것은 판 전체뿐이다. 무는 검사: `tests/flow-zoom.spec.ts`.
 */

import {
  FLOW_DRAG_THRESHOLD_PX,
  FLOW_ZOOM_MAX,
  FLOW_ZOOM_MIN,
  FLOW_ZOOM_STEP,
  FLOW_ZOOM_WHEEL_RATE,
} from '@/limits'
import { FLOW_GEOMETRY } from '@/ml/flow-layout'

export interface View {
  /** 배율. */
  readonly k: number
  /** 판의 원점이 화면에서 놓인 자리. */
  readonly x: number
  readonly y: number
}

export interface Size {
  readonly w: number
  readonly h: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** 배율을 범위 안으로. */
export function clampZoom(k: number): number {
  return Math.min(FLOW_ZOOM_MAX, Math.max(FLOW_ZOOM_MIN, k))
}

/** 판 전체가 화면에 담기는 배율. 가장자리 여백을 남긴다. */
function fitScale(viewport: Size, canvas: Size): number {
  const pad = FLOW_GEOMETRY.fitPadding * 2
  return clampZoom(Math.min((viewport.w - pad) / canvas.w, (viewport.h - pad) / canvas.h))
}

function centered(viewport: Size, canvas: Size, k: number): View {
  return { k, x: (viewport.w - canvas.w * k) / 2, y: (viewport.h - canvas.h * k) / 2 }
}

/**
 * **"전체 보기" 단추의 눈금.** 판 전체를 담고 가운데에 둔다. 단추를 누른 것은 학생이 고른 것이라
 * 1보다 작아져도 된다.
 */
export function fit(viewport: Size, canvas: Size): View {
  return centered(viewport, canvas, fitScale(viewport, canvas))
}

/**
 * **창이 처음 열릴 때의 눈금.** 담기는 배율이 1 이상이면 담아서 가운데에 두고, 1보다 작으면 줄이지 않고
 * 배율 1로 데이터 패널의 왼쪽 위에서 시작한다 — 줄이면 글자가 가장 작은 글자 규칙을 깬다.
 * `topInset`은 확대 막대가 위를 덮는 좁은 폭에서 판을 그만큼 내리는 길이다.
 */
export function initialView(viewport: Size, canvas: Size, topInset = 0): View {
  const k = fitScale(viewport, canvas)
  if (k >= 1) return centered(viewport, canvas, k)
  const margin = FLOW_GEOMETRY.startMargin
  return { k: 1, x: margin, y: margin + topInset }
}

/** 화면의 한 점을 붙든 채 배율을 바꾼다 — 그 점 밑의 판 자리는 움직이지 않는다. */
export function zoomAt(view: View, focus: Point, next: number): View {
  const k = clampZoom(next)
  return {
    k,
    x: focus.x - ((focus.x - view.x) * k) / view.k,
    y: focus.y - ((focus.y - view.y) * k) / view.k,
  }
}

/**
 * 확대·축소 단추 한 번. **100%에서 멈춘다** — 1을 건너뛰면 글자가 맞는 크기로 돌아올 길이 전체 보기
 * 단추뿐이다. 화면 가운데를 붙든다.
 */
export function stepZoom(view: View, viewport: Size, direction: 'in' | 'out'): View {
  let next = direction === 'in' ? view.k * FLOW_ZOOM_STEP : view.k / FLOW_ZOOM_STEP
  if ((view.k < 1 && next > 1) || (view.k > 1 && next < 1)) next = 1
  return zoomAt(view, { x: viewport.w / 2, y: viewport.h / 2 }, next)
}

/** 휠 한 번. 위로 굴리면 커지고(`deltaY < 0`) 같은 만큼 아래로 굴리면 되돌아온다. */
export function wheelZoom(view: View, focus: Point, deltaY: number): View {
  return zoomAt(view, focus, view.k * Math.exp(-deltaY * FLOW_ZOOM_WHEEL_RATE))
}

/** 판을 끈다. 배율은 그대로다. */
export function pan(view: View, dx: number, dy: number): View {
  return { k: view.k, x: view.x + dx, y: view.y + dy }
}

/** 두 손가락이 이어 간 눈금. `start`는 손가락이 둘이 된 순간의 눈금과 두 손가락의 가운데·간격이다. */
export interface Pinch {
  readonly view: View
  readonly center: Point
  readonly distance: number
}

/**
 * 두 손가락으로 벌리거나 오므린다. 처음 가운데 밑의 판 자리가 지금 가운데 밑에 오고, 간격의 비가 배율이다.
 * 처음 간격이 0이면(한 손가락) 눈금이 그대로다.
 */
export function pinchView(start: Pinch, now: { center: Point; distance: number }): View {
  if (start.distance === 0) return start.view
  const k = clampZoom((start.view.k * now.distance) / start.distance)
  return {
    k,
    x: now.center.x - ((start.center.x - start.view.x) * k) / start.view.k,
    y: now.center.y - ((start.center.y - start.view.y) * k) / start.view.k,
  }
}

/** 판의 한 점이 화면의 어디에 놓이는가. */
export function toScreen(view: View, point: Point): Point {
  return { x: view.x + point.x * view.k, y: view.y + point.y * view.k }
}

/** 화면의 한 점이 판의 어디인가. `toScreen`의 거꾸로다. */
export function toCanvas(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.k, y: (point.y - view.y) / view.k }
}

/** 누른 채 이만큼 움직였으면 누름이 아니라 끌기다. */
export function isDrag(distance: number): boolean {
  return distance > FLOW_DRAG_THRESHOLD_PX
}

/** 닫을 수 있는 것의 상태. 팝오버는 없고 고정한 강조만 있다. */
export interface EscapeState {
  readonly pinned: boolean
}

export interface EscapeResult {
  readonly state: EscapeState
  /** 창을 닫는가. 고정한 강조가 먼저 풀리면 거짓이다. */
  readonly closeDialog: boolean
}

/** **`Esc` 한 번은 하나만 닫는다.** 고정한 강조, 창의 차례다. */
export function escapeStep(state: EscapeState): EscapeResult {
  if (state.pinned) return { state: { pinned: false }, closeDialog: false }
  return { state, closeDialog: true }
}
