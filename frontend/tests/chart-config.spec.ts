/**
 * 데이터 화면 그림의 Chart.js 설정 (`data/chart-config.ts`).
 *
 * **여기 있는 규칙은 전부 눈으로만 보이는 종류다** — 막대 사이가 붙었는가, 세로축이
 * 0에서 시작하는가, 애니메이션이 꺼져 있는가. 그래서 화면에 두면 아무도 못 잡고,
 * 실제로 군집 산점도에서 두 번 그렇게 깨졌다 (`ml/cluster-chart.ts`의 머리말).
 *
 * **상자그림의 수염은 캔버스를 흉내 내서 본다.** 그리는 코드가 우리 것이고
 * (플러그인을 안 받았다) 좌표 변환만 Chart.js가 주므로, 그 변환을 가짜로 주면 **무엇을
 * 어디에 그리는지**를 그대로 잴 수 있다.
 */

import { describe, expect, it } from 'vitest'

import {
  barData,
  barOptions,
  binLabels,
  boxData,
  boxOptions,
  boxWhiskers,
  histogramData,
  scatterData,
  scatterOptions,
  scatterSeries,
  leadColor,
  seriesColor,
  type BoxSeries,
  type ChartPaint,
} from '../src/data/chart-config'
import { boxSummary, type DataPoint } from '../src/data/stats'

import { CHART_COLORS } from '../src/palette'

/** 일곱 색. 값이 서로 달라야 색이 갈렸는지를 잴 수 있다. */
const PAINT: ChartPaint = {
  palette: Array.from({ length: CHART_COLORS }, (_value, index) => `#00000${index}`),
  softPalette: Array.from({ length: CHART_COLORS }, (_value, index) => `#ffff0${index}`),
  surface: '#ffffff',
  ink: '#475569',
  line: '#e2e8f0',
}

const TEXT = { x: '키', y: '개수', point: () => '' }

/**
 * 눈금 하나에서 `beginAtZero`를 읽는다.
 *
 * **캐스팅이 여기 있는 이유.** Chart.js의 눈금 타입은 여러 종류의 합집합이라, 그중
 * 선형 눈금에만 있는 이름을 바로 못 읽는다. 재려는 것은 **우리가 그 값을 실제로
 * 넣었는가**뿐이므로 읽는 자리에서 한 번 좁힌다.
 */
function beginAtZero(scale: unknown): boolean | undefined {
  return (scale as { beginAtZero?: boolean } | undefined)?.beginAtZero
}

describe('색', () => {
  it('일곱을 넘어가면 돌려 쓴다', () => {
    expect(seriesColor(PAINT, CHART_COLORS)).toBe(seriesColor(PAINT, 0))
  })

  /** **차례가 1,2,3…이 아니다** (#18). 그대로 주면 넷째가 첫째와 붙는다. */
  it('팔레트 순서를 그대로 쓰지 않는다', () => {
    const straight = PAINT.palette.slice(0, 4)
    const used = [0, 1, 2, 3].map((index) => seriesColor(PAINT, index))
    expect(used).not.toEqual(straight)
    expect(new Set(used).size).toBe(4)
  })

  it('팔레트를 못 읽으면 글자색으로 떨어진다', () => {
    expect(seriesColor({ ...PAINT, palette: [] }, 0)).toBe(PAINT.ink)
  })
})

describe('구간 이름', () => {
  it('경계보다 하나 적다 — 칸의 수와 같다', () => {
    expect(binLabels([0, 1, 2], String)).toEqual(['0 ~ 1', '1 ~ 2'])
  })

  it('경계가 없으면 이름도 없다', () => {
    expect(binLabels([], String)).toEqual([])
  })
})

describe('히스토그램과 막대그래프는 다른 그림이다', () => {
  const histogram = { edges: [0, 1, 2], counts: [3, 4], capped: false }

  /**
   * **히스토그램은 막대가 붙어 있다.** 가로축이 이어진 수라서다 — 사이가 벌어지면
   * 막대그래프로 읽히고, 학생이 그 차이를 그림의 모양에서 배운다 (`terms.md`).
   */
  it('히스토그램은 막대 사이가 없다', () => {
    const set = histogramData(histogram, ['0 ~ 1', '1 ~ 2'], PAINT, '개수').datasets[0]
    expect(set?.categoryPercentage).toBe(1)
    expect(set?.barPercentage).toBe(1)
  })

  /** **막대그래프는 벌어져 있다.** 붙여 놓으면 학생이 값 사이에 값이 있다고 읽는다. */
  it('막대그래프는 기본 간격을 그대로 둔다', () => {
    const tally = { bars: [{ value: '남', count: 2 }], missing: 0, distinct: 1, omitted: 0 }
    const set = barData(tally, PAINT, '개수').datasets[0]
    expect(set?.categoryPercentage).toBeUndefined()
    expect(set?.barPercentage).toBeUndefined()
  })

  /**
   * **막대마다 색을 바꾸지 않는다** (2026-09-22, 사용자가 실물에서 봤다). 한 열의 도수를
   * 그리는 그림에서 색은 아무것도 안 가른다 — 범주가 서른이면 일곱 색이 네 바퀴를 돌아
   * **뜻 없는 무지개**가 된다.
   */
  it('막대그래프는 한 색이다', () => {
    const tally = {
      bars: [
        { value: '남', count: 2 },
        { value: '여', count: 3 },
      ],
      missing: 0,
      distinct: 2,
      omitted: 0,
    }
    const colors = barData(tally, PAINT, '개수').datasets[0]?.backgroundColor
    expect(colors).toBe(leadColor(PAINT))
  })

  /**
   * **혼자 서는 그림은 팔레트의 첫 색이다.** 돌려 쓰는 차례의 첫 칸을 그냥 쓰면
   * 히스토그램 하나가 `chart-4`로 서는데, 그 색이 거기 온 이유가 "넷째로 먼 색이라서"다.
   */
  it('혼자 서는 그림은 대표색을 쓴다 — 거리순 차례의 첫 칸이 아니다', () => {
    expect(leadColor(PAINT)).toBe(PAINT.palette[0])
    expect(leadColor(PAINT)).not.toBe(seriesColor(PAINT, 0))
  })

  /**
   * **막대 사이를 가르는 것은 바탕색 테두리다.** 막대와 같은 색으로 그으면 **구분선이
   * 없는 것과 똑같고**, 실제로 히스토그램 전체가 한 덩어리로 보였다 (2026-09-22).
   */
  it('히스토그램의 테두리가 바탕색이다', () => {
    const set = histogramData(
      { edges: [0, 1, 2], counts: [3, 4], capped: false },
      ['0 ~ 1', '1 ~ 2'],
      PAINT,
      '개수',
    ).datasets[0]
    expect(set?.borderColor).toBe(PAINT.surface)
    expect(set?.borderColor).not.toBe(set?.backgroundColor)
  })

  /**
   * **도수 축이 0에서 안 시작하면 막대의 길이 비율이 거짓말을 한다** — 두 배인 막대가
   * 열 배로 보인다.
   */
  it('도수 축이 0에서 시작한다', () => {
    const scales = barOptions(PAINT, TEXT).scales
    expect(beginAtZero(scales?.['y'])).toBe(true)
  })

  /** **애니메이션은 꺼져 있다.** 상한의 근거가 된 실측이 그 상태에서 나왔다 (#28-5). */
  it('애니메이션이 꺼져 있다', () => {
    expect(barOptions(PAINT, TEXT).animation).toBe(false)
    expect(boxOptions([], PAINT, { x: '', y: '키', point: () => '' }).animation).toBe(false)
    expect(scatterOptions(PAINT, { x: 'a', y: 'b', point: () => '' }, false).animation).toBe(false)
  })

  /** **축 선과 격자에 색을 준다.** 안 주면 Chart.js 기본값이 배색을 안 따라간다. */
  it('축과 격자가 배색 토큰을 쓴다', () => {
    const scales = barOptions(PAINT, TEXT).scales
    expect(scales?.['x']?.grid?.color).toBe(PAINT.line)
    expect(scales?.['x']?.ticks?.color).toBe(PAINT.ink)
  })
})

describe('상자그림', () => {
  /** 첫 상자가 쓰는 옅은 색의 자리. `softColor`가 **돌려 쓰는 차례를 안 거친다.** */
  const INDEX_OF_FIRST = 0
  const summary = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])!
  const series: readonly BoxSeries[] = [{ name: '키', summary }]

  /** **상자는 `[Q1, Q3]`을 값으로 받는 떠 있는 막대다.** */
  it('상자가 사분위수 두 개를 값으로 받는다', () => {
    const data = boxData(series, PAINT).datasets[0]?.data
    expect(data).toEqual([[summary.q1, summary.q3]])
  })

  /**
   * **세로축이 0에서 시작하면 안 된다** (2026-09-22, 사용자가 실물에서 봤다).
   * 키 150~190짜리 상자가 0~200 축에 서면 화면의 5분의 1만 쓰고 **다섯 수를 눈으로 읽을
   * 수 없다.** `beginAtZero: false`로는 안 된다 — Chart.js의 막대 눈금은 기본이 0부터라
   * **범위를 직접 박아야** 0이 안 들어온다.
   */
  it('세로축이 값의 범위를 감싼다 — 0을 끌어들이지 않는다', () => {
    // 키처럼 **0에서 멀리 떨어진** 값이라야 이 규칙이 드러난다.
    const tall = boxSummary([150, 160, 165, 170, 175, 180, 190])!
    const scales = boxOptions([{ name: '키', summary: tall }], PAINT, {
      x: '',
      y: '키',
      point: () => '',
    }).scales
    const y = scales?.['y'] as { min?: number; max?: number } | undefined
    expect(y?.min).toBeGreaterThan(100)
    expect(y?.min).toBeLessThan(tall.min)
    expect(y?.max).toBeGreaterThan(tall.max)
  })

  /** 값이 하나뿐이면 범위가 0이라 여백도 0이 된다 — 그때 눈금이 한 점에 겹치면 안 된다. */
  it('값이 하나뿐이어도 눈금이 겹치지 않는다', () => {
    const flat = boxSummary([7, 7, 7])!
    const scales = boxOptions([{ name: '점수', summary: flat }], PAINT, {
      x: '',
      y: '점수',
      point: () => '',
    }).scales
    const y = scales?.['y'] as { min?: number; max?: number } | undefined
    expect(y?.max).toBeGreaterThan(y?.min ?? 0)
  })

  /**
   * **상자의 네 변을 다 그린다.** Chart.js는 바닥 쪽 변을 기본으로 건너뛰는데, 떠 있는
   * 막대에는 그 전제가 없다 — 제1사분위수 자리가 뚫린 상자가 된다 (2026-09-22).
   */
  it('상자의 아래 변을 건너뛰지 않는다', () => {
    expect(boxData(series, PAINT).datasets[0]?.borderSkipped).toBe(false)
  })

  /** **넓이는 옅게, 테두리는 진하게.** 진하게 채우면 그 안의 중앙값 선이 묻힌다. */
  it('상자를 옅은 색으로 채우고 테두리는 진하다', () => {
    const set = boxData(series, PAINT).datasets[0]
    const fill = Array.isArray(set?.backgroundColor) ? set.backgroundColor[0] : undefined
    const edge = Array.isArray(set?.borderColor) ? set.borderColor[0] : undefined
    expect(fill).toBe(PAINT.softPalette[INDEX_OF_FIRST])
    expect(edge).toBe(seriesColor(PAINT, 0))
    expect(fill).not.toBe(edge)
  })

  /**
   * 수염 플러그인이 실제로 무엇을 그리는지 잰다. 축 변환을 항등으로 주면 그린 좌표가
   * 그대로 값이라, **수염이 어디서 멈추는지**를 숫자로 볼 수 있다.
   */
  function draw(list: readonly BoxSeries[]): {
    lines: [number, number][]
    dots: number[]
  } {
    const lines: [number, number][] = []
    const dots: number[] = []
    let at: [number, number] = [0, 0]

    const ctx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      stroke: () => {},
      fill: () => {},
      moveTo: (x: number, y: number) => {
        at = [x, y]
      },
      lineTo: (_x: number, y: number) => {
        lines.push([at[1], y])
      },
      arc: (_x: number, y: number) => {
        dots.push(y)
      },
      lineWidth: 0,
      strokeStyle: '',
      fillStyle: '',
    }

    const bar = { x: 10, getProps: () => ({ width: 20 }) }
    const chart = {
      ctx,
      scales: { y: { getPixelForValue: (value: number) => value } },
      getDatasetMeta: () => ({ data: [bar] }),
    }

    // 플러그인의 계약은 Chart.js의 것이라 여기서만 캐스팅한다.
    const plugin = boxWhiskers(list, PAINT) as unknown as {
      afterDatasetsDraw: (chart: unknown) => void
    }
    plugin.afterDatasetsDraw(chart)
    return { lines, dots }
  }

  it('수염이 울타리가 아니라 그 안의 실제 값에서 멈춘다', () => {
    const { lines } = draw(series)
    // 세로 수염 둘: 상자 위에서 위 수염까지, 상자 아래에서 아래 수염까지.
    expect(lines).toContainEqual([summary.q3, summary.upperWhisker])
    expect(lines).toContainEqual([summary.q1, summary.lowerWhisker])
  })

  it('중앙값 선을 긋는다', () => {
    const { lines } = draw(series)
    expect(lines).toContainEqual([summary.median, summary.median])
  })

  it('이상치를 점으로 찍는다', () => {
    expect(draw(series).dots).toEqual([100])
  })

  /** 상자보다 상자가 많으면 **짝이 어긋나면 안 된다** — 요약과 막대가 같은 순서다. */
  it('요약이 없는 자리는 그리지 않는다', () => {
    expect(draw([]).lines).toEqual([])
  })
})

describe('산점도', () => {
  const points: readonly DataPoint[] = [
    { row: 0, x: 1, y: 1, group: '남' },
    { row: 1, x: 2, y: 2, group: '여' },
    { row: 2, x: 3, y: 3, group: '남' },
  ]

  it('색 열의 값마다 갈래를 만들고 첫 등장 순서를 지킨다', () => {
    const series = scatterSeries(points, '데이터')
    expect(series.map((one) => one.name)).toEqual(['남', '여'])
    expect(series[0]?.points.map((point) => point.row)).toEqual([0, 2])
  })

  it('색 열이 없으면 갈래가 하나다', () => {
    const plain = points.map(({ row, x, y }) => ({ row, x, y }))
    const series = scatterSeries(plain, '데이터')
    expect(series.length).toBe(1)
    expect(series[0]?.name).toBe('데이터')
  })

  it('갈래마다 다른 색이다', () => {
    const sets = scatterData(scatterSeries(points, '데이터'), PAINT).datasets
    expect(sets[0]?.backgroundColor).not.toBe(sets[1]?.backgroundColor)
  })

  /** **갈래가 하나면 범례가 없다.** 이름 하나짜리 범례는 아무것도 안 가른다. */
  it('갈래가 하나면 범례를 안 세운다', () => {
    const text = { x: 'a', y: 'b', point: () => '' }
    expect(scatterOptions(PAINT, text, false).plugins?.legend?.display).toBe(false)
    expect(scatterOptions(PAINT, text, true).plugins?.legend?.display).toBe(true)
  })
})
