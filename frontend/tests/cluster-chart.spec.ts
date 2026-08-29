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

import type { ChartOptions, LegendItem, TooltipItem } from 'chart.js'
import { describe, expect, it } from 'vitest'

import {
  DRAW_ORDER,
  FALLBACK_PALETTE,
  clusterChartData,
  clusterChartOptions,
  clusterColor,
  clusterShape,
  haloIndex,
  POINT_SHAPES,
  type ClusterAxisScales,
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

const TEXT = {
  clusterName: (cluster: number) => `${cluster}번 군집`,
  centroid: '중심점',
  highlight: '입력한 데이터',
}

function dataOf(
  count: number,
  highlight?: { values: number[]; cluster: number },
  scales?: ClusterAxisScales,
) {
  return clusterChartData(
    scatter(count),
    summaries(count),
    { x: 0, y: 1 },
    TOKENS,
    TEXT,
    highlight,
    scales,
  )
}

function optionsOf(count: number, scales?: ClusterAxisScales) {
  return clusterChartOptions(
    count,
    TOKENS,
    {
      axisX: '키',
      axisY: '몸무게',
      point: (name, x, y) => `${name} (${x}, ${y})`,
    },
    scales,
  )
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

  it('테두리가 군집 색 ✕보다 아래다', () => {
    expect(DRAW_ORDER.halo).toBeGreaterThan(DRAW_ORDER.centroid)
    expect(DRAW_ORDER.points).toBeGreaterThan(DRAW_ORDER.halo)
  })
})

describe('테두리의 자리', () => {
  it('범례와 툴팁이 빼는 것이 테두리다 - 군집이 아니다', () => {
    // **배열 순서가 바뀌면 군집 하나가 대신 지워진다.** 화면에는 아무 표시도 안 난다.
    const datasets = dataOf(4).datasets
    const halo = haloIndex(4)

    expect(halo).toBe(4)
    expect(datasets[halo]!.label).toBe('중심점')
    // **배경색이 아니라 글자색이다** (#28-1) - 배경색 테두리는 빈 자리에서 안 보인다.
    expect(datasets[halo]!.pointBorderColor).toBe(TOKENS.ink)
    // 그 앞은 전부 군집이다.
    expect(datasets.slice(0, halo).map((dataset) => dataset.label)).toEqual([
      '0번 군집',
      '1번 군집',
      '2번 군집',
      '3번 군집',
    ])
  })

  it('범례에서 테두리만 빠지고 중심점은 한 줄로 남는다', () => {
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

describe('가리켜도 표식이 안 변한다', () => {
  // **Chart.js의 hover 기본값은 반지름 4, 테두리 1이다.** 우리가 키운 표식만 가리키는
  // 순간 그 값으로 쪼그라들었다 돌아왔고, 중심점과 데이터 점이 겹친 자리에서는 커서가
  // 1px만 움직여도 어느 쪽이 잡혔는지가 바뀌어 계속 떨렸다 (2026-08-14).
  const highlight = { values: [7, 9], cluster: 1 }

  it('키운 표식은 hover 크기가 평소와 같다', () => {
    for (const dataset of dataOf(3, highlight).datasets) {
      if (dataset.pointRadius === undefined) continue
      expect(dataset.pointHoverRadius ?? 4).toBe(dataset.pointRadius)
    }
  })

  it('키운 테두리도 hover에서 안 얇아진다', () => {
    for (const dataset of dataOf(3, highlight).datasets) {
      if (dataset.pointBorderWidth === undefined) continue
      expect(dataset.pointHoverBorderWidth ?? 1).toBe(dataset.pointBorderWidth)
    }
  })

  it('툴팁이 가리킨 것에 붙는다 - 겹친 자리에서 상자가 헤엄치지 않게', () => {
    expect(optionsOf(3).plugins!.tooltip!.position).toBe('nearest')
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

describe('범주 축', () => {
  // **여기가 통째로 비어 있었다** (V7 감사). `placed()`·`categoryScale()`·`haloIndex(_, false)`에
  // 돌연변이를 심어도 이 파일이 안 울었다 - `scales`를 넘기는 검사가 하나도 없었기 때문이다.
  const CATEGORIES = ['서울', '부산', '대구']

  /** 같은 칸(서울)에 두 점, 다른 칸(대구)에 한 점. */
  function categorical(): ScatterData {
    const points = [
      { row: 0, cluster: 0, values: [0, 10] },
      { row: 1, cluster: 0, values: [0, 12] },
      { row: 2, cluster: 1, values: [2, 14] },
    ]
    return { points, drawn: points.length, total: points.length }
  }

  function categoricalData(scales: ClusterAxisScales) {
    return clusterChartData(
      categorical(),
      summaries(2),
      { x: 0, y: 1 },
      TOKENS,
      TEXT,
      undefined,
      scales,
    )
  }

  /** Chart.js의 축 타입은 합집합이라 그대로는 못 읽는다. */
  function scaleOf(options: ChartOptions<'scatter'>, axis: 'x' | 'y') {
    return options.scales?.[axis] as {
      min?: number
      max?: number
      ticks?: {
        stepSize?: number
        autoSkip?: boolean
        callback?: (value: string | number) => string
      }
    }
  }

  it('같은 칸의 점들이 흩뿌려진다 - 안 그러면 한 점처럼 보인다', () => {
    const [seoul] = categoricalData({ x: CATEGORIES }).datasets
    const [first, second] = seoul!.data as { x: number; y: number }[]

    expect(first!.x).not.toBe(second!.x)
    expect(Math.abs(first!.x)).toBeLessThanOrEqual(0.3)
    expect(Math.abs(second!.x)).toBeLessThanOrEqual(0.3)
  })

  it('반올림하면 원래 칸으로 돌아온다 - 툴팁이 참값을 말한다', () => {
    const datasets = categoricalData({ x: CATEGORIES }).datasets
    const drawn = datasets.flatMap((dataset) => dataset.data as { x: number; y: number }[])

    // `+ 0`은 `-0`을 `0`으로 만든다 - 왼쪽으로 흩뿌린 점의 반올림이 `-0`이고,
    // `toEqual`은 그 둘을 다르게 본다.
    expect(drawn.map((point) => Math.round(point.x) + 0)).toEqual([0, 0, 2])
  })

  it('범주가 아닌 축은 안 흩뿌린다', () => {
    const datasets = categoricalData({ x: CATEGORIES }).datasets
    const drawn = datasets.flatMap((dataset) => dataset.data as { x: number; y: number }[])

    expect(drawn.map((point) => point.y)).toEqual([10, 12, 14])
  })

  it('같은 파일이 같은 그림을 준다 - 흩뿌림은 행에 매여 있다', () => {
    // 난수를 쓰면 학생이 어제 본 그림을 오늘 못 본다.
    expect(categoricalData({ x: CATEGORIES })).toEqual(categoricalData({ x: CATEGORIES }))
  })

  it('범주 축에서는 중심점을 안 그린다 - 원핫 좌표를 칸에 올릴 수 없다', () => {
    // 한 축만 범주여도 안 그린다. 그 자리는 군집 요약표가 최빈 범주로 답한다.
    for (const scales of [{ x: CATEGORIES }, { y: CATEGORIES }, { x: CATEGORIES, y: CATEGORIES }]) {
      expect(categoricalData(scales).datasets.map((dataset) => dataset.label)).toEqual([
        '0번 군집',
        '1번 군집',
      ])
    }
  })

  it('뺄 테두리가 없으므로 범례에서 아무 줄도 안 빠진다', () => {
    // **`haloIndex`가 군집 수를 그대로 돌려주면 군집 하나가 대신 사라진다.**
    expect(haloIndex(3, false)).toBe(-1)

    const filter = optionsOf(3, { x: CATEGORIES }).plugins!.legend!.labels!.filter!
    const kept = [0, 1, 2]
      .map((datasetIndex) => ({ datasetIndex }) as LegendItem)
      .filter((item) => filter(item, { datasets: [], labels: [] }))

    expect(kept.map((item) => item.datasetIndex)).toEqual([0, 1, 2])
  })

  it('눈금이 칸마다 서고 이름을 붙인다', () => {
    const scale = scaleOf(optionsOf(2, { x: CATEGORIES }), 'x')

    // **반 칸씩 밖으로 나간다** - 양 끝 칸의 구름(±0.3)이 잘리지 않게.
    expect(scale.min).toBe(-0.5)
    expect(scale.max).toBe(CATEGORIES.length - 0.5)
    expect(scale.ticks?.stepSize).toBe(1)
    // 칸을 건너뛰면 이름 없는 칸에 점이 뜬다.
    expect(scale.ticks?.autoSkip).toBe(false)
    expect(scale.ticks?.callback?.(1)).toBe('부산')
    // 흩뿌린 자리에서도 이름은 그 칸의 것이다.
    expect(scale.ticks?.callback?.(1.3)).toBe('부산')
    // 칸 밖에는 이름이 없다.
    expect(scale.ticks?.callback?.(9)).toBe('')
  })

  it('범주가 아닌 축은 눈금 설정을 안 받는다 - 선형 축 그대로다', () => {
    const scale = scaleOf(optionsOf(2, { x: CATEGORIES }), 'y')

    expect(scale.min).toBeUndefined()
    expect(scale.max).toBeUndefined()
    expect(scale.ticks?.stepSize).toBeUndefined()
  })
})

describe('축 선의 색', () => {
  function lineOf(options: ReturnType<typeof optionsOf>, axis: 'x' | 'y') {
    return options.scales?.[axis] as {
      grid?: { color?: string }
      border?: { color?: string }
    }
  }

  /**
   * **안 주면 Chart.js의 기본값(`rgba(0,0,0,0.1)`)이 축 선을 그린다.** 그 색은 배색을
   * 안 따라가므로 어두운 배색에서는 안 보이고, 밝은 배색에서는 격자와 다른 회색이 된다.
   */
  it('축 선과 격자가 같은 토큰을 쓴다', () => {
    for (const axis of ['x', 'y'] as const) {
      const scale = lineOf(optionsOf(3), axis)
      expect(scale.grid?.color).toBe(TOKENS.line)
      expect(scale.border?.color).toBe(TOKENS.line)
    }
  })

  // 범주 설정은 축 설정 **뒤에** 펼쳐진다. 거기에 같은 열쇠가 생기면 조용히 덮인다.
  it('범주 축이 되어도 선 색이 안 지워진다', () => {
    expect(lineOf(optionsOf(2, { x: ['서울', '부산'] }), 'x').border?.color).toBe(TOKENS.line)
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
      const found = new RegExp(`--color-chart-${index + 1}:\\s*([^;]+);`).exec(css)
      return found?.[1]?.trim()
    })

    expect(declared).toEqual([...FALLBACK_PALETTE])
  })
})

describe('학생이 넣은 점', () => {
  const highlight = { values: [7, 9], cluster: 1 }

  it('없으면 데이터셋도 없다 - 결과 화면에는 새 점이 없다', () => {
    expect(dataOf(3).datasets).toHaveLength(5)
  })

  it('맨 위에 그려진다', () => {
    // 점에 묻히면 "내 데이터가 어디 있나"에 답하지 못한다 - 이 그림의 유일한 이유다.
    const datasets = dataOf(3, highlight).datasets
    const orders = datasets.map((dataset) => dataset.order!)
    const last = orders[orders.length - 1]!

    expect(Math.min(...orders)).toBe(last)
    expect(orders.filter((order) => order === last)).toHaveLength(1)
  })

  it('배열 끝이라 테두리의 자리가 안 밀린다', () => {
    // **`haloIndex`가 밀리면 범례와 툴팁이 군집 하나를 대신 지운다.**
    const datasets = dataOf(3, highlight).datasets
    expect(datasets[haloIndex(3)]!.pointBorderColor).toBe(TOKENS.ink)
    expect(datasets[datasets.length - 1]!.label).toBe('입력한 데이터')
  })

  it('색은 답으로 나온 군집의 것이고 모양은 군집과 겹치지 않는다', () => {
    // **빨강이 아니다** (#28-7). 색은 "너는 1번 군집이다"를 말하고, 모양이 "이건 네가
    // 방금 넣은 것"을 말한다.
    const point = dataOf(3, highlight).datasets.at(-1)!
    expect(point.pointBackgroundColor).toBe(clusterColor(TOKENS, 1))
    // 새 점의 테두리도 글자색이다 (#28-7).
    expect(point.pointBorderColor).toBe(TOKENS.ink)
    expect(point.pointStyle).toBe('rectRot')
    expect(POINT_SHAPES).not.toContain(point.pointStyle)
  })
})
