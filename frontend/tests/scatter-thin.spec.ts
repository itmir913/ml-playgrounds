/**
 * 산점도의 점 거르기 (`data/scatter-thin.ts`, `open-decisions.md` "94. 그림이 드문 것을
 * 숨기는가").
 *
 * **이 기능이 지키는 것은 하나다 — 드문 점은 반드시 그린다.** 전의 무작위 표본은 10만 행의
 * 외딴 점 20개 가운데 평균 2개만 남겼고, 그 그림은 그럴듯하게 그려지면서 틀렸다. 그래서
 * 외딴 점 보존과 **행 수가 새지 않는다**(남은 점이 대신하는 행의 합 = 넘겨받은 행)를 먼저 문다.
 */

import { describe, expect, it } from 'vitest'

import {
  densityInk,
  densityStep,
  thinScatter,
  toggleLayers,
  type LayeredChart,
  type ThinPoint,
} from '../src/data/scatter-thin'
import { SCATTER_DENSE_ROWS, SCATTER_DENSITY_STEPS } from '../src/limits'

const SIZE = { width: 800, height: 500 }
const RADIUS = 5

/** 씨앗이 있는 난수. 검사가 돌 때마다 같은 데이터다. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}

function gaussian(next: () => number): number {
  let u = 0
  while (u === 0) u = next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next())
}

interface Row extends ThinPoint {
  readonly row: number
  readonly outlier: boolean
}

/** 정규분포 구름 + 반지름 8~12에 놓은 외딴 점 `outliers`개. */
function cloud(count: number, outliers: number, groups = 1, seed = 7): Row[] {
  const next = random(seed)
  const far = new Set<number>()
  while (far.size < outliers) far.add(Math.floor(next() * count))
  return Array.from({ length: count }, (_value, row) => {
    const group = row % groups
    if (far.has(row)) {
      const angle = next() * 2 * Math.PI
      const distance = 8 + 4 * next()
      return {
        row,
        group,
        outlier: true,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
      }
    }
    return { row, group, outlier: false, x: gaussian(next), y: gaussian(next) }
  })
}

/** 고르게 퍼진 점. 섞음이 안 걸러지는 경우다. */
function uniform(count: number, groups: number, seed = 11): Row[] {
  const next = random(seed)
  return Array.from({ length: count }, (_value, row) => ({
    row,
    group: row % groups,
    outlier: false,
    x: next() * 24 - 12,
    y: next() * 24 - 12,
  }))
}

const rowsOf = (kept: readonly { rows: number }[]) => kept.reduce((sum, one) => sum + one.rows, 0)

describe('드문 점', () => {
  /** **이 결정이 선 이유다.** 무작위 표본은 같은 데이터에서 평균 2개를 남겼다. */
  it('10만 행에 섞인 외딴 점이 전부 남는다', () => {
    const points = cloud(100_000, 20)
    const thinned = thinScatter(points, SIZE, RADIUS, 10_000)
    expect(thinned.points.filter((one) => one.point.outlier).length).toBe(20)
    expect(thinned.points.length).toBeLessThan(10_000)
  })

  /** 묶음 때문에 칸을 키워도 외딴 점은 제 칸을 혼자 쓴다. */
  it('칸을 키워도 외딴 점이 남는다', () => {
    const points = cloud(100_000, 20)
    const thinned = thinScatter(points, SIZE, RADIUS, 300)
    expect(thinned.widened).toBe(true)
    expect(thinned.points.filter((one) => one.point.outlier).length).toBe(20)
  })

  it('성긴 점은 하나도 안 묶는다', () => {
    const points = Array.from({ length: 50 }, (_value, row) => ({
      row,
      group: 0,
      outlier: false,
      x: row,
      y: row,
    }))
    const thinned = thinScatter(points, SIZE, RADIUS, 10_000)
    expect(thinned.points.map((one) => one.point.row)).toEqual(points.map((one) => one.row))
    expect(thinned.points.every((one) => one.rows === 1)).toBe(true)
    expect(thinned.merged).toBe(false)
  })
})

describe('행 수가 새지 않는다', () => {
  /**
   * **남은 점이 대신하는 행의 합이 넘겨받은 행 수다.** 이것이 깨지면 툴팁의 "N행"이 거짓이
   * 되거나 어떤 행은 그림 어디에도 없다.
   */
  it.each([
    ['정규분포', () => cloud(30_000, 20)],
    ['고른 분포 7갈래', () => uniform(30_000, 7)],
    ['고른 분포 30갈래', () => uniform(30_000, 30)],
  ])('%s', (_name, make) => {
    const points = make()
    for (const budget of [10_000, 2_000, 200]) {
      expect(rowsOf(thinScatter(points, SIZE, RADIUS, budget).points)).toBe(points.length)
    }
  })

  it('한 자리에 몰린 행은 점 하나가 그 수를 대신한다', () => {
    const points = Array.from({ length: 40 }, (_value, row) => ({ row, group: 0, x: 1, y: 1 }))
    // 끝점이 따로 남지 않게 멀리 둘을 둔다.
    const ends = [
      { row: 40, group: 0, x: 0, y: 0 },
      { row: 41, group: 0, x: 100, y: 100 },
    ]
    const thinned = thinScatter([...points, ...ends], SIZE, RADIUS, 10_000)
    const crowd = thinned.points.filter((one) => one.point.x === 1)
    expect(crowd).toHaveLength(1)
    expect(crowd[0]?.rows).toBe(40)
    expect(thinned.merged).toBe(true)
  })
})

describe('갈래와 끝점', () => {
  /** 같은 자리의 두 갈래는 둘 다 보여야 한다 — 한쪽이 다른 쪽을 대신하면 색이 사라진다. */
  it('갈래마다 따로 센다', () => {
    const crowd = (group: number) =>
      Array.from({ length: SCATTER_DENSE_ROWS }, (_value, index) => ({
        row: group * 100 + index,
        group,
        x: 5,
        y: 5,
      }))
    const ends = [
      { row: 900, group: 0, x: 0, y: 0 },
      { row: 901, group: 0, x: 10, y: 10 },
    ]
    const thinned = thinScatter([...crowd(0), ...crowd(1), ...ends], SIZE, RADIUS, 10_000)
    const groups = thinned.points.filter((one) => one.point.x === 5).map((one) => one.point.group)
    expect(groups.sort()).toEqual([0, 1])
  })

  /** 축의 범위가 칸 하나만큼 줄면 눈금이 움직인다. */
  it('가로·세로의 끝점은 붐빈 칸에 있어도 남는다', () => {
    const points = uniform(50_000, 1)
    const xs = points.map((one) => one.x)
    const ys = points.map((one) => one.y)
    const thinned = thinScatter(points, SIZE, RADIUS, 2_000)
    const keptX = thinned.points.map((one) => one.point.x)
    const keptY = thinned.points.map((one) => one.point.y)
    expect(Math.min(...keptX)).toBe(Math.min(...xs))
    expect(Math.max(...keptX)).toBe(Math.max(...xs))
    expect(Math.min(...keptY)).toBe(Math.min(...ys))
    expect(Math.max(...keptY)).toBe(Math.max(...ys))
  })
})

describe('묶음', () => {
  /** 고르게 퍼진 데이터는 칸마다 행이 문턱보다 적어 차례가 없으면 하나도 안 걸러진다. */
  it.each([1, 7, 30])('고른 분포 %i갈래도 묶음 아래로 내려온다', (groups) => {
    const thinned = thinScatter(uniform(60_000, groups), SIZE, RADIUS, 10_000)
    expect(thinned.points.length).toBeLessThanOrEqual(10_000)
  })

  it('묶음 안이면 칸을 안 키운다', () => {
    expect(thinScatter(cloud(100_000, 20), SIZE, RADIUS, 10_000).widened).toBe(false)
  })

  it('남은 점은 넘겨받은 차례 그대로다', () => {
    const rows = thinScatter(cloud(20_000, 20), SIZE, RADIUS, 1_000).points.map(
      (one) => one.point.row,
    )
    expect(rows).toEqual([...rows].sort((a, b) => a - b))
  })

  it('빈 입력은 빈 그림이다', () => {
    expect(thinScatter([], SIZE, RADIUS, 10)).toEqual({ points: [], merged: false, widened: false })
  })
})

/**
 * **범례를 누르면 그 갈래의 점이 전부 사라진다** — 단계 데이터셋 하나만 끄면 외딴 점만 사라지고
 * 묶인 점은 남았다(Chart.js 기본 동작).
 */
describe('범례 누르기', () => {
  function chartOf(labels: string[]): LayeredChart & { hidden: Set<number> } {
    const hidden = new Set<number>()
    return {
      hidden,
      data: { datasets: labels.map((label) => ({ label })) },
      isDatasetVisible: (index) => !hidden.has(index),
      setDatasetVisibility: (index, visible) => {
        if (visible) hidden.delete(index)
        else hidden.add(index)
      },
      update: () => {},
    }
  }

  it('같은 이름의 데이터셋을 전부 끄고, 다시 누르면 전부 켠다', () => {
    const chart = chartOf(['가', '가', '나', '가', '나'])
    toggleLayers(null, { text: '가', datasetIndex: 0 }, { chart })
    expect([...chart.hidden].sort()).toEqual([0, 1, 3])
    toggleLayers(null, { text: '가', datasetIndex: 0 }, { chart })
    expect(chart.hidden.size).toBe(0)
  })
})

describe('진하기 단계', () => {
  it('√10배마다 한 단계이고 마지막 단계에 머문다', () => {
    expect([1, 2, 3, 4, 10, 11, 31, 32, 100, 101, 100_000].map(densityStep)).toEqual([
      0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
    ])
    expect(densityStep(10 ** 9)).toBe(SCATTER_DENSITY_STEPS)
  })

  it('0단계는 갈래 색 그대로다', () => {
    expect(densityInk('#e69f00', '#1e293b', 0)).toBe('#e69f00')
  })

  it('못 읽는 색이면 갈래 색을 그대로 돌려준다', () => {
    expect(densityInk('rgb(1, 2, 3)', '#1e293b', 3)).toBe('rgb(1, 2, 3)')
  })

  /**
   * **단계가 오를수록 바탕과의 대비가 커진다** — 진하게 그린 점이 오히려 바탕에 묻히면 단계가
   * 거꾸로 읽힌다. 두 배색의 대표 값으로 잰다(라이트 흰 바탕·글자 `#1e293b`, 다크
   * `#1e293b` 바탕·글자 `#e2e8f0`).
   */
  it.each([
    [
      '라이트',
      '#ffffff',
      '#1e293b',
      ['#e69f00', '#56b4e9', '#009e73', '#9a8200', '#0072b2', '#d55e00', '#cc79a7'],
    ],
    [
      '다크',
      '#1e293b',
      '#e2e8f0',
      ['#ecbc51', '#7fcbef', '#4fe3be', '#e8d24b', '#4fa8e0', '#e89354', '#d488b3'],
    ],
  ])('%s 배색에서 단계가 오를수록 바탕 대비가 커진다', (_name, surface, ink, palette) => {
    for (const base of palette) {
      const contrasts = Array.from({ length: SCATTER_DENSITY_STEPS + 1 }, (_value, step) =>
        contrast(densityInk(base, ink, step), surface),
      )
      contrasts.slice(1).forEach((value, index) => {
        expect(value).toBeGreaterThan(contrasts[index] ?? Infinity)
      })
    }
  })
})

/** WCAG 상대 휘도 대비. */
function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)]
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  )
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
