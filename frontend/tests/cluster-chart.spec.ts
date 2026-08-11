/**
 * 산점도의 Chart.js 설정 (`ml/cluster-chart.ts`).
 *
 * **여기 있는 것은 전부 눈으로만 보이던 규칙이다.** 실제로 둘이 사용자 화면에서 잡혔다 —
 * 중심점이 점 아래에 깔린 것, 애니메이션이 켜져 축 한 번 바꾸기가 799ms가 된 것. 캔버스
 * 없이도 확인할 수 있는 사실들이라 검사가 있어야 한다 (2026-08-11 감사).
 *
 * **차트를 마운트하지 않는다.** 이 검사가 보는 것은 우리가 Chart.js에 **무엇을
 * 넘기는가**이지 Chart.js가 그것을 어떻게 그리는가가 아니다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LegendItem, TooltipItem } from 'chart.js'
import { describe, expect, it } from 'vitest'

import {
  DRAW_ORDER,
  FALLBACK_PALETTE,
  clusterChartData,
  clusterChartOptions,
  clusterColor,
  clusterShape,
  haloIndex,
  type ClusterChartTokens,
} from '../src/ml/cluster-chart'
import type { ClusterSummary, ScatterData } from '../src/ml/clusters'

const TOKENS: ClusterChartTokens = {
  palette: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'],
  surface: '#ffffff',
  ink: '#475569',
  line: '#e2e8f0',
}

function summaries(count: number): ClusterSummary[] {
  return Array.from({ length: count }, (_value, cluster) => ({
    cluster,
    size: 2,
    means: [cluster, cluster],
    centroid: [cluster + 0.5, cluster + 0.5],
  }))
}

function scatter(count: number): ScatterData {
  const points = Array.from({ length: count * 2 }, (_value, index) => ({
    row: index,
    cluster: index % count,
    values: [index, index],
  }))
  return { points, drawn: points.length, total: points.length }
}

const TEXT = { clusterName: (cluster: number) => `${cluster}번 군집`, centroid: '중심점' }

function dataOf(count: number) {
  return clusterChartData(scatter(count), summaries(count), { x: 0, y: 1 }, TOKENS, TEXT)
}

function optionsOf(count: number) {
  return clusterChartOptions(count, TOKENS, {
    axisX: '키',
    axisY: '몸무게',
    point: (name, x, y) => `${name} (${x}, ${y})`,
  })
}

describe('그리는 차례', () => {
  it('중심점이 모든 군집보다 위에 그려진다', () => {
    // **Chart.js는 정렬한 뒤 뒤에서부터 그린다.** 배열 순서에 기대면 중심점이 맨
    // 아래로 가고, 점 수천 개에 묻힌다 - 실제로 그렇게 났다.
    const datasets = dataOf(3).datasets
    const points = datasets.slice(0, 3).map((dataset) => dataset.order)
    const centroids = datasets.slice(3).map((dataset) => dataset.order)

    for (const centroid of centroids) {
      for (const point of points) {
        expect(centroid!).toBeLessThan(point!)
      }
    }
  })

  it('흰 테두리가 군집 색 ✕보다 아래다', () => {
    expect(DRAW_ORDER.halo).toBeGreaterThan(DRAW_ORDER.centroid)
    expect(DRAW_ORDER.points).toBeGreaterThan(DRAW_ORDER.halo)
  })
})

describe('흰 테두리의 자리', () => {
  it('범례와 툴팁이 빼는 것이 흰 테두리다 - 군집이 아니다', () => {
    // **배열 순서가 바뀌면 군집 하나가 대신 지워진다.** 화면에는 아무 표시도 안 난다.
    const datasets = dataOf(4).datasets
    const halo = haloIndex(4)

    expect(halo).toBe(4)
    expect(datasets[halo]!.label).toBe('중심점')
    expect(datasets[halo]!.pointBorderColor).toBe(TOKENS.surface)
    // 그 앞은 전부 군집이다.
    expect(datasets.slice(0, halo).map((dataset) => dataset.label)).toEqual([
      '0번 군집',
      '1번 군집',
      '2번 군집',
      '3번 군집',
    ])
  })

  it('범례에서 흰 테두리만 빠지고 중심점은 한 줄로 남는다', () => {
    const filter = optionsOf(3).plugins!.legend!.labels!.filter!
    const kept = [0, 1, 2, 3, 4]
      .map((datasetIndex) => ({ datasetIndex }) as LegendItem)
      .filter((item) => filter(item, { datasets: [], labels: [] }))

    expect(kept.map((item) => item.datasetIndex)).toEqual([0, 1, 2, 4])
  })

  it('툴팁도 같은 줄을 뺀다 - 안 빼면 중심점이 두 번 뜬다', () => {
    const filter = optionsOf(3).plugins!.tooltip!.filter!
    const kept = [0, 1, 2, 3, 4].filter((datasetIndex) =>
      filter({ datasetIndex } as TooltipItem<'scatter'>, 0, [], { datasets: [], labels: [] }),
    )

    expect(kept).toEqual([0, 1, 2, 4])
  })
})

describe('범례 차례', () => {
  it('그리는 차례를 따라가지 않는다 - 중심점이 맨 뒤다', () => {
    // Chart.js가 범례 항목도 `order`로 정렬하므로, 그냥 두면 위에 그리려고 준 order가
    // 범례에서 "중심점이 맨 앞"이 된다.
    const sort = optionsOf(3).plugins!.legend!.labels!.sort!
    const items = [4, 0, 2, 1].map((datasetIndex) => ({ datasetIndex }) as LegendItem)

    const sorted = [...items].sort((a, b) => sort(a, b, { datasets: [], labels: [] }))
    expect(sorted.map((item) => item.datasetIndex)).toEqual([0, 1, 2, 4])
  })
})

describe('그리기 비용에 매인 옵션', () => {
  it('애니메이션이 꺼져 있다', () => {
    // **`limits.ts`의 상한이 이 줄에 매여 있다** (#28-5). 켜면 축 한 번 바꾸기가
    // 1만 점에서 46ms가 아니라 799ms다.
    expect(optionsOf(3).animation).toBe(false)
  })

  it('가리킨 것 하나만 말한다', () => {
    // 기본 모드(`point`)는 커서 아래에 겹친 점을 전부 세운다.
    expect(optionsOf(3).interaction).toEqual({ mode: 'nearest', intersect: true })
  })
})

describe('색과 모양', () => {
  it('일곱을 돌려 쓰고 여덟 번째부터 모양을 바꾼다', () => {
    // 색을 스무 개로 늘리지 않는다 - 늘리는 순간 색맹 안전이라는 근거가 깨진다 (#28-3).
    expect(clusterColor(TOKENS, 0)).toBe('c1')
    expect(clusterColor(TOKENS, 7)).toBe('c1')
    expect(clusterShape(TOKENS, 0)).toBe('circle')
    expect(clusterShape(TOKENS, 7)).toBe('triangle')
    expect(clusterShape(TOKENS, 14)).toBe('rect')
  })

  it('7 × 3이 군집 수 상한 20을 덮는다', () => {
    const seen = new Set(
      Array.from(
        { length: 20 },
        (_value, cluster) =>
          `${clusterColor(TOKENS, cluster)}|${String(clusterShape(TOKENS, cluster))}`,
      ),
    )
    expect(seen.size).toBe(20)
  })
})

describe('토큰을 못 읽었을 때', () => {
  it('대체 색이 서로 다르다 - 한 색이면 군집이 안 갈린다', () => {
    // **그림은 멀쩡해 보이는데 군집이 안 갈리는 것**이 이 검사가 막는 상태다.
    expect(new Set(FALLBACK_PALETTE).size).toBe(FALLBACK_PALETTE.length)
  })

  it('대체 색이 theme.css의 값과 같다', () => {
    // 값이 두 벌인 자리다. 갈리면 스타일시트가 없는 화면만 다른 색으로 그려지고,
    // 그건 아무도 안 본다.
    const css = readFileSync(join(process.cwd(), 'src', 'styles', 'theme.css'), 'utf-8')
    const declared = FALLBACK_PALETTE.map((_value, index) => {
      const found = new RegExp(`--color-chart-${index + 1}:\s*([^;]+);`).exec(css)
      return found?.[1]?.trim()
    })

    expect(declared).toEqual([...FALLBACK_PALETTE])
  })
})
