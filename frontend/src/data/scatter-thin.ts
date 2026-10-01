/**
 * 산점도의 점 거르기와 진하기 단계 (`open-decisions.md` "94. 그림이 드문 것을 숨기는가").
 *
 * **드문 점은 반드시 그린다.** 전에는 점이 많으면 무작위 표본을 뽑았고, 10만 행에 섞인
 * 외딴 점 20개 가운데 평균 2개만 남았다. 상한을 풀면 전부 그렸고 교실 PC가 섰다. 여기는
 * 그 둘을 함께 대신한다 — 그림 영역을 점 반지름의 칸으로 나눠, **성긴 칸은 점을 전부
 * 그리고** 붐빈 칸은 점 하나에 그 칸의 행 수를 싣는다. 붐빈 칸의 다른 점은 어차피 그 점
 * 밑에 가려져 있었다.
 *
 * **두 산점도가 함께 쓴다** — 데이터 화면(`chart-config.ts`)과 군집(`ml/cluster-chart.ts`).
 * 범주 축은 흩뿌린 **뒤의** 좌표를 넘겨야 한다 — 범주 번호로 세면 칸 하나에 몰린 구름이
 * 점 하나로 무너진다.
 *
 * **chart.js를 모른다.** 무는 검사: `tests/scatter-thin.spec.ts`.
 */

import {
  SCATTER_CELL_GROWTH,
  SCATTER_DENSE_ROWS,
  SCATTER_DENSITY_INK_MAX,
  SCATTER_DENSITY_STEPS,
} from '@/limits'

/** 거를 점. `group`은 갈래(색)의 번호이고, 갈래마다 따로 센다. */
export interface ThinPoint {
  readonly x: number
  readonly y: number
  readonly group: number
}

/** 그림 영역의 크기(CSS 픽셀). */
export interface ThinSize {
  readonly width: number
  readonly height: number
}

/** 남은 점 하나와 **그 점이 대신하는 행 수.** 1이면 제 행 하나다. */
export interface ThinnedPoint<T> {
  readonly point: T
  readonly rows: number
}

export interface Thinned<T> {
  /** 남은 점. **넘겨받은 차례 그대로다.** */
  readonly points: readonly ThinnedPoint<T>[]
  /** 행을 여럿 대신하는 점이 있는가. 있으면 화면이 그 사실을 말한다. */
  readonly merged: boolean
  /** 묶음을 맞추려고 칸을 반지름보다 키웠는가. 잉크를 잃으므로 화면이 말한다. */
  readonly widened: boolean
}

/** 한 칸 크기에서 갈래 × 칸마다의 행 수. 열쇠는 `갈래 × 칸 수 + 칸 번호`다. */
interface Grid {
  readonly keys: Float64Array
  readonly counts: Map<number, number>
}

/**
 * 점을 거른다.
 *
 * **차례.** 칸 = 반지름, 문턱 = `SCATTER_DENSE_ROWS`에서 시작한다. 남는 점이 `budget`을
 * 넘으면 문턱을 1로 내리고(모든 칸이 점 하나), 그래도 넘으면 칸을 `SCATTER_CELL_GROWTH`배씩
 * 키운다. 고르게 퍼진 데이터는 칸마다 행이 문턱보다 적어서, 이 차례가 없으면 하나도 안
 * 걸러진다(94의 브라우저 실측 — 10만 행이 6.7만 점).
 *
 * **세는 축의 끝점은 늘 남긴다** — 가로·세로의 최솟값·최댓값을 가진 행이다. 붐빈 칸의
 * 대표점만 남기면 축의 범위가 칸 하나만큼 줄어 눈금이 움직일 수 있다.
 *
 * @param budget 그리는 점의 묶음. `limits.ts`의 `DATA_SCATTER_POINT_LIMIT` 같은 값이다.
 */
export function thinScatter<T extends ThinPoint>(
  points: readonly T[],
  size: ThinSize,
  radius: number,
  budget: number,
): Thinned<T> {
  if (points.length === 0) return { points: [], merged: false, widened: false }

  const ends = extremeIndices(points)
  const bounds = boundsOf(points)
  let cell = radius
  let threshold = SCATTER_DENSE_ROWS
  let grid = gridOf(points, size, cell, bounds, ends)

  while (keptCount(grid, threshold, ends.size) > budget) {
    if (threshold > 1) {
      threshold = 1
      continue
    }
    // 칸이 그림 전체가 되면 더 키울 것이 없다 — 남는 것은 갈래마다 점 하나와 끝점뿐이다.
    if (cell >= Math.max(size.width, size.height)) break
    cell *= SCATTER_CELL_GROWTH
    grid = gridOf(points, size, cell, bounds, ends)
  }

  const kept: ThinnedPoint<T>[] = []
  const placed = new Set<number>()
  let merged = false
  points.forEach((point, index) => {
    if (ends.has(index)) {
      kept.push({ point, rows: 1 })
      return
    }
    const key = grid.keys[index] ?? 0
    const rows = grid.counts.get(key) ?? 1
    if (rows < threshold) {
      kept.push({ point, rows: 1 })
      return
    }
    if (placed.has(key)) return
    placed.add(key)
    kept.push({ point, rows })
    if (rows > 1) merged = true
  })

  return { points: kept, merged, widened: cell > radius }
}

/**
 * 툴팁이 받은 점(Chart.js의 `raw`)이 대신하는 행 수. **우리가 넘긴 모양이 아니면 1이다** —
 * 중심점이나 학생이 넣은 점은 `rows`가 없다.
 */
export function rowsOfDot(raw: unknown): number {
  if (typeof raw !== 'object' || raw === null || !('rows' in raw)) return 1
  return typeof raw.rows === 'number' ? raw.rows : 1
}

/**
 * 행 수의 **진하기 단계.** 행 하나면 0이고, 묶은 점은 1부터 `SCATTER_DENSITY_STEPS`까지다.
 *
 * **√10배(반 자릿수)마다 한 단계다** — 2~3행이 1, 4~10행이 2, 11~31행이 3, 32~100행이 4,
 * 그보다 많으면 5. 한 칸에 10만 행이 몰려도 마지막 단계에 머문다.
 */
export function densityStep(rows: number): number {
  if (rows <= 1) return 0
  return Math.min(SCATTER_DENSITY_STEPS, Math.max(1, Math.ceil(2 * Math.log10(rows))))
}

/**
 * 그 단계의 색. **갈래 색을 글자색 쪽으로 섞는다** — 단계마다 같은 몫씩 늘어 마지막 단계에서
 * `SCATTER_DENSITY_INK_MAX`다. 0단계는 갈래 색 그대로다.
 *
 * **투명도를 안 쓴다** — 반투명 점은 라이트 배색에서 바탕 대비가 무너진다(94).
 *
 * **`#rgb`·`#rrggbb`만 읽는다.** 배색 토큰이 그 모양이다(`styles/theme.css`). 못 읽으면 갈래
 * 색을 그대로 돌려준다 — 단계가 안 보일 뿐 점은 그려진다.
 */
export function densityInk(base: string, ink: string, step: number): string {
  const from = rgbOf(base)
  const to = rgbOf(ink)
  if (from === null || to === null || step <= 0) return base
  const share =
    (SCATTER_DENSITY_INK_MAX * Math.min(step, SCATTER_DENSITY_STEPS)) / SCATTER_DENSITY_STEPS
  const mixed = from.map((value, index) =>
    Math.round(value + ((to[index] ?? value) - value) * share),
  )
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function rgbOf(color: string): number[] | null {
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color)
  if (short) return short.slice(1).map((digit) => parseInt(digit + digit, 16))
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (long) return long.slice(1).map((pair) => parseInt(pair, 16))
  return null
}

interface Bounds {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

function boundsOf(points: readonly ThinPoint[]): Bounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }
  return { minX, maxX, minY, maxY }
}

/** 가로·세로의 최솟값·최댓값을 가진 첫 행들. 많아야 넷이다. */
function extremeIndices(points: readonly ThinPoint[]): Set<number> {
  let minX = 0
  let maxX = 0
  let minY = 0
  let maxY = 0
  points.forEach((point, index) => {
    if (point.x < (points[minX]?.x ?? Infinity)) minX = index
    if (point.x > (points[maxX]?.x ?? -Infinity)) maxX = index
    if (point.y < (points[minY]?.y ?? Infinity)) minY = index
    if (point.y > (points[maxY]?.y ?? -Infinity)) maxY = index
  })
  return new Set([minX, maxX, minY, maxY])
}

function gridOf(
  points: readonly ThinPoint[],
  size: ThinSize,
  cell: number,
  bounds: Bounds,
  ends: ReadonlySet<number>,
): Grid {
  const columns = Math.max(1, Math.floor(size.width / cell))
  const rows = Math.max(1, Math.floor(size.height / cell))
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const scaleX = spanX > 0 ? columns / spanX : 0
  const scaleY = spanY > 0 ? rows / spanY : 0
  const cells = columns * rows
  const keys = new Float64Array(points.length)
  const counts = new Map<number, number>()
  points.forEach((point, index) => {
    const column = Math.min(columns - 1, Math.floor((point.x - bounds.minX) * scaleX))
    const row = Math.min(rows - 1, Math.floor((point.y - bounds.minY) * scaleY))
    const key = point.group * cells + row * columns + column
    keys[index] = key
    if (!ends.has(index)) counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  return { keys, counts }
}

/** 그 문턱에서 남는 점의 수. 끝점은 따로 센다. */
function keptCount(grid: Grid, threshold: number, ends: number): number {
  let kept = ends
  for (const rows of grid.counts.values()) kept += rows < threshold ? rows : 1
  return kept
}
