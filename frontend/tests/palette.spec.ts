/**
 * 값을 구분하는 색을 고르는 차례 (`src/palette.ts`, `architecture.md` §8.13.1
 * "그 대응은 셔플이 아니라 거리순이다").
 *
 * **이 검사가 막는 것은 조용한 되돌림이다.** 순서표는 숫자 일곱 줄이라 아무 뜻 없이
 * 생긴 것처럼 보이고, 실제로 한 번은 셔플 한 줄이었다 — 그때 두 갈래 분류의 카드 둘이
 * ΔE2000으로 2.4까지 붙었고 학생이 못 갈랐다(#18).
 *
 * **그래서 색을 여기 복사해 두지 않는다.** `theme.css`·`dark.css`를 직접 읽어 ΔE를
 * 다시 재고, 순서표가 아래 바닥값을 지키는지 본다. 배색 토큰을 손대면 이 검사가 먼저
 * 운다 - 그것이 이 파일의 목적이다.
 *
 * **ΔE2000 구현이 여기 있는 이유.** 앱은 이 계산을 안 쓴다(순서표가 결과물이다).
 * 본 코드에 두면 아무도 안 부르는 수식이 되고, 여기 두면 순서표를 검증하는 도구로
 * 산다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CARD_ORDERS,
  CHART_COLORS,
  INK_ORDER,
  INK_ORDERS,
  pickOrder,
  reorder,
} from '../src/palette'

// ── 배색 토큰을 읽는다 ────────────────────────────────────────────────────

function cssOf(name: string): string {
  return readFileSync(join(process.cwd(), 'src', 'styles', name), 'utf-8')
}

/** `--color-chart-N` 또는 `--color-chart-N-soft` 일곱. 하나라도 없으면 던진다. */
function paletteOf(css: string, suffix: '' | '-soft'): string[] {
  return Array.from({ length: CHART_COLORS }, (_value, index) => {
    const found = new RegExp(`--color-chart-${index + 1}${suffix}:\\s*([^;]+);`).exec(css)
    const value = found?.[1]?.trim()
    if (value === undefined) throw new Error(`--color-chart-${index + 1}${suffix} is missing`)
    return value
  })
}

const LIGHT = cssOf('theme.css')
const DARK = cssOf('dark.css')

const VIVID = [paletteOf(LIGHT, ''), paletteOf(DARK, '')]
/** 카드는 진한 테두리와 옅은 채움을 함께 쓴다 — 둘 다 걸린다. */
const CARD = [...VIVID, paletteOf(LIGHT, '-soft'), paletteOf(DARK, '-soft')]

// ── ΔE2000 ───────────────────────────────────────────────────────────────

function rgbOf(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** sRGB → CIELAB (D65). */
function labOf(hex: string): [number, number, number] {
  const linear = (channel: number): number => {
    const unit = channel / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = rgbOf(hex).map(linear) as [number, number, number]
  const bend = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const x = bend((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047)
  const y = bend(r * 0.2126 + g * 0.7152 + b * 0.0722)
  const z = bend((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}

/** CIEDE2000. 두 색이 사람 눈에 얼마나 다른가. */
function deltaE(first: string, second: string): number {
  const [L1, a1, b1] = labOf(first)
  const [L2, a2, b2] = labOf(second)
  const rad = Math.PI / 180
  const c1 = Math.hypot(a1, b1)
  const c2 = Math.hypot(a2, b2)
  const cMean = (c1 + c2) / 2
  const g = 0.5 * (1 - Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7)))
  const A1 = (1 + g) * a1
  const A2 = (1 + g) * a2
  const C1 = Math.hypot(A1, b1)
  const C2 = Math.hypot(A2, b2)
  const angle = (x: number, y: number): number => {
    if (x === 0 && y === 0) return 0
    const degrees = Math.atan2(y, x) / rad
    return degrees >= 0 ? degrees : degrees + 360
  }
  const h1 = angle(A1, b1)
  const h2 = angle(A2, b2)
  const dL = L2 - L1
  const dC = C2 - C1
  let dh = 0
  if (C1 * C2 !== 0) {
    dh = h2 - h1
    if (dh > 180) dh -= 360
    else if (dh < -180) dh += 360
  }
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad)
  const lMean = (L1 + L2) / 2
  const cBar = (C1 + C2) / 2
  let hMean: number
  if (C1 * C2 === 0) hMean = h1 + h2
  else if (Math.abs(h1 - h2) <= 180) hMean = (h1 + h2) / 2
  else hMean = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  const t =
    1 -
    0.17 * Math.cos((hMean - 30) * rad) +
    0.24 * Math.cos(2 * hMean * rad) +
    0.32 * Math.cos((3 * hMean + 6) * rad) -
    0.2 * Math.cos((4 * hMean - 63) * rad)
  const theta = 30 * Math.exp(-(((hMean - 275) / 25) ** 2))
  const rc = 2 * Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7))
  const sL = 1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2)
  const sC = 1 + 0.045 * cBar
  const sH = 1 + 0.015 * cBar * t
  const rt = -Math.sin(2 * theta * rad) * rc
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rt * (dC / sC) * (dH / sH))
}

/**
 * 이 차례로 k개를 꺼냈을 때 **가장 가까운 두 색**의 거리. 배색 여럿에 걸리면 가장
 * 나쁜 쪽을 쓴다 — 학생이 어느 배색을 쓸지 우리가 못 정한다.
 */
function closestWithin(palettes: readonly string[][], order: readonly number[], k: number): number {
  let worst = Number.POSITIVE_INFINITY
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      for (const palette of palettes) {
        const first = palette[order[i]!]!
        const second = palette[order[j]!]!
        worst = Math.min(worst, deltaE(first, second))
      }
    }
  }
  return worst
}

/**
 * 답이 k갈래일 때 보장하는 최소 거리. **`palette.ts`의 주석과 같은 숫자다** —
 * 그쪽은 설명이고 무는 것은 여기다.
 *
 * 카드가 다섯째부터 무너지는 것은 순서 탓이 아니다. 라이트의 `-soft` 일곱이 전부
 * 흰색 근처라 어떤 순서로도 못 벌린다 (`open-decisions.md` "카드 채움색은 다섯
 * 갈래까지다").
 */
const CARD_FLOORS = [11.9, 9.8, 5.2, 2.9, 2.8, 2.4]
const INK_FLOORS = [47.8, 34.3, 26.7, 17.4, 10.7, 9.3]

/** 바닥값은 소수 한 자리로 적었으므로 그만큼 여유를 준다. */
const ROUNDING = 0.05

describe('순서표의 모양', () => {
  it.each([
    ['카드', CARD_ORDERS],
    ['글자·점', INK_ORDERS],
  ])('%s: 일곱 줄이고 줄마다 일곱 색이 한 번씩이다', (_name, orders) => {
    expect(orders).toHaveLength(CHART_COLORS)
    for (const order of orders) {
      expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
    }
  })

  it.each([
    ['카드', CARD_ORDERS],
    ['글자·점', INK_ORDERS],
  ])('%s: 일곱 색이 저마다 첫 자리에 한 번씩 온다', (_name, orders) => {
    // **이것이 "색이 골고루 쓰인다"의 전부다.** 1등이 늘 chart-1이면 나머지 다섯은
    // 죽은 색이 된다 (architecture.md §8.13.1).
    expect(orders.map((order) => order[0]).sort((a, b) => a! - b!)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('군집이 쓰는 고정 차례는 글자용 표 안에 있다', () => {
    // 무작위를 안 쓰는 자리라 한 줄을 골라 뒀다. 표 밖의 값이면 바닥값이 안 걸린다.
    expect(INK_ORDERS.map((order) => order.join(','))).toContain(INK_ORDER.join(','))
  })
})

describe('거리 바닥값', () => {
  it.each(CARD_ORDERS.map((order, index) => [index + 1, order] as const))(
    '카드 %i번째 차례가 갈래 수마다 바닥값을 지킨다',
    (_index, order) => {
      CARD_FLOORS.forEach((floor, position) => {
        const k = position + 2
        expect(closestWithin(CARD, order, k), `k=${k}`).toBeGreaterThanOrEqual(floor - ROUNDING)
      })
    },
  )

  it.each(INK_ORDERS.map((order, index) => [index + 1, order] as const))(
    '글자·점 %i번째 차례가 갈래 수마다 바닥값을 지킨다',
    (_index, order) => {
      INK_FLOORS.forEach((floor, position) => {
        const k = position + 2
        expect(closestWithin(VIVID, order, k), `k=${k}`).toBeGreaterThanOrEqual(floor - ROUNDING)
      })
    },
  )

  /**
   * **바닥값이 실제로 무는지 재는 자리다.** 위 검사들만 있으면 바닥값이 0이어도 전부
   * 초록이다. 되돌아갈 곳(1,2,3…)이 그 바닥을 못 넘는 것을 못 박아 둔다.
   */
  it('1,2,3… 순서였다면 바닥값을 못 넘는다', () => {
    const sequential = [0, 1, 2, 3, 4, 5, 6]

    // 카드는 세 갈래에서 이미 진다 (5.2 대 9.8).
    expect(closestWithin(CARD, sequential, 3)).toBeLessThan(CARD_FLOORS[1]!)
    // 글자·점은 넷에서 진다 (9.3 대 26.7).
    expect(closestWithin(VIVID, sequential, 4)).toBeLessThan(INK_FLOORS[2]!)
  })

  /**
   * #18을 낸 화면 그대로. 두 갈래 분류의 카드 둘이다 — 어느 차례를 뽑아도 그때의
   * 5.2보다 멀다.
   */
  it('두 갈래에서는 어느 차례를 뽑아도 그때보다 멀다', () => {
    const reported = 5.2
    for (const order of CARD_ORDERS) {
      expect(closestWithin(CARD, order, 2)).toBeGreaterThan(reported)
    }
  })
})

describe('차례를 뽑고 늘어놓기', () => {
  it('뽑은 것은 표 안의 한 줄이다', () => {
    const lines = new Set(CARD_ORDERS.map((order) => order.join(',')))
    // 무작위라 여러 번 부른다. 표 밖의 값이 나오면 그 화면만 바닥값을 안 지킨다.
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(lines).toContain(pickOrder(CARD_ORDERS).join(','))
    }
  })

  it('일곱 색이 다 첫 자리에 올 수 있다', () => {
    // 늘 같은 줄만 나오면 셔플을 없앤 대가로 "골고루 쓰인다"를 잃은 것이다.
    const seen = new Set<number>()
    for (let attempt = 0; attempt < 500; attempt += 1) seen.add(pickOrder(CARD_ORDERS)[0]!)
    expect(seen.size).toBe(CHART_COLORS)
  })

  it('제자리에서 안 바꾸고 같은 원소를 돌려준다', () => {
    // 원본을 공유하는 곳이 있으면 그쪽이 놀란다 (`shuffled`가 있던 시절의 규칙).
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const before = [...items]

    const placed = reorder(items, [6, 5, 4, 3, 2, 1, 0])

    expect(items, 'the original was mutated in place').toEqual(before)
    expect(placed).toEqual(['g', 'f', 'e', 'd', 'c', 'b', 'a'])
  })

  it('길이가 안 맞으면 원본을 그대로 준다', () => {
    // 조용히 색을 잃는 것보다 순서만 못 지키는 쪽이 낫다.
    const items = ['a', 'b']
    expect(reorder(items, [0, 1, 2, 3, 4, 5, 6])).toEqual(items)
  })
})
