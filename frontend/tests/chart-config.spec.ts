/**
 * 데이터 화면 그림의 Chart.js 설정 (`data/chart-config.ts`).
 *
 * **여기 있는 규칙은 전부 눈으로만 보이는 종류다** — 막대 사이가 붙었는가, 세로축이
 * 0에서 시작하는가, 애니메이션이 꺼져 있는가. 그래서 화면에 두면 아무도 못 잡고,
 * 실제로 군집 산점도에서 두 번 그렇게 깨졌다 (`ml/cluster-chart.ts`의 머리말).
 *
 * **박스 플롯의 수염은 캔버스를 흉내 내서 본다.** 그리는 코드가 우리 것이고
 * (플러그인을 안 받았다) 좌표 변환만 Chart.js가 주므로, 그 변환을 가짜로 주면 **무엇을
 * 어디에 그리는지**를 그대로 잴 수 있다.
 */

import { describe, expect, it } from 'vitest'

import {
  barData,
  barOptions,
  binLabels,
  boxData,
  colorsAreDistinct,
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

  /**
   * **세는 축의 눈금은 정수다** (2026-09-22, 실물에서 봤다). 값이 작으면 Chart.js가
   * `0.1 · 0.2 …`를 세운다 — 학번처럼 값마다 한 줄인 열에서 모든 막대가 1인 그림의
   * 눈금이 전부 소수였다. `0.5개`라는 것은 없다.
   */
  it('도수 축의 눈금이 정수다', () => {
    const scales = barOptions(PAINT, TEXT).scales
    const ticks = scales?.['y']?.ticks as { precision?: number } | undefined
    expect(ticks?.precision).toBe(0)
    // 글자 색은 그대로 물려받는다 — 눈금 설정을 덮어쓰면서 배색을 잃지 않는다.
    expect(scales?.['y']?.ticks?.color).toBe(PAINT.ink)
  })

  /**
   * **로그 축은 기본이 아니다** (결정문 46). 학생이 켜야 선다.
   *
   * **그리고 로그일 때는 `beginAtZero`도 `precision`도 없어야 한다** — 로그에 0은 없고,
   * 눈금은 Chart.js가 거듭제곱으로 세운다. 선형 쪽 설정을 그대로 얹으면 **둘이 싸우는
   * 축**이 되고, 그 싸움은 캔버스 뒤라 검사가 아니면 아무도 못 본다.
   */
  it('세는 축은 켜야 로그가 되고, 그때 선형 쪽 설정을 안 데려간다', () => {
    const linear = barOptions(PAINT, TEXT).scales?.['y']
    expect(linear?.type).toBeUndefined()
    expect(beginAtZero(linear)).toBe(true)

    const log = barOptions(PAINT, TEXT, true).scales?.['y']
    expect(log?.type).toBe('logarithmic')
    expect(beginAtZero(log)).toBeUndefined()
    expect((log?.ticks as { precision?: number } | undefined)?.precision).toBeUndefined()
    // 배색은 두 갈래가 똑같이 물려받는다.
    expect(log?.ticks?.color).toBe(PAINT.ink)
    expect(log?.grid?.color).toBe(PAINT.line)
  })

  /**
   * **세는 축에 0.1은 없다** (2026-09-22, 실물에서 봤다). 로그 축의 바닥을 안 박으면
   * Chart.js가 데이터를 보고 잡는데, 그때 `0.1`·`50,000.0`처럼 **개수로는 있을 수 없는
   * 눈금**이 선다 — `precision`은 선형 눈금의 것이라 여기서는 안 듣는다.
   */
  it('로그 축의 바닥이 1이고 눈금이 정수다', () => {
    const log = barOptions(PAINT, TEXT, true).scales?.['y']
    expect((log as { min?: number } | undefined)?.min).toBe(1)

    const label = log?.ticks?.callback as ((value: number) => string) | undefined
    expect(label).toBeTypeOf('function')
    expect(label?.(1)).toBe('1')
    expect(label?.(50_000)).toBe((50_000).toLocaleString())
    // 정수가 아닌 눈금은 이름을 안 준다 — 그 줄만 이름 없이 남는다.
    expect(label?.(0.1)).toBe('')
  })

  /**
   * **높이 0에 가까운 막대도 짚을 수 있다** (2026-09-22, 코드 소유자가 실물에서 잡았다).
   *
   * `intersect: true`면 커서가 막대의 사각형 안에 있어야 반응하는데, 치우친 열에서는
   * 대부분의 막대가 **선**이라 사실상 못 짚는다. `axis: 'x'`가 세로 위치를 안 보게 만들어
   * 그 세로 줄 어디서나 그 구간을 말하게 한다.
   *
   * **박스 플롯과 산점도는 반대다** — 상자는 높이를 갖고, 점은 `intersect`를 풀면 빈
   * 자리에서도 먼 점을 집어 온다. 그래서 셋을 한 줄에 놓고 갈라 못 박는다.
   */
  it('막대는 세로 줄 어디서나 짚히고, 점은 점 위에서만 짚힌다', () => {
    expect(barOptions(PAINT, TEXT).interaction).toEqual({
      mode: 'nearest',
      intersect: false,
      axis: 'x',
    })
    expect(boxOptions([], PAINT, { x: '', y: '키', point: () => '' }).interaction).toEqual({
      mode: 'nearest',
      intersect: true,
    })
    expect(scatterOptions(PAINT, { x: 'a', y: 'b', point: () => '' }, false).interaction).toEqual({
      mode: 'nearest',
      intersect: true,
    })
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

describe('박스 플롯', () => {
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

  /**
   * **축이 0을 건너지 않는다** (2026-09-22, 실물에서 봤다). 몸무게 12~300에서 눈금을
   * 떨어지는 수까지 물리면 축이 −50에서 시작했다 — 데이터에 음수가 없는데 음수 구역이
   * 그림의 6분의 1을 차지하고, 학생은 거기 값이 있을 수 있다고 읽는다.
   */
  it('값이 전부 양수면 축이 음수로 안 내려간다', () => {
    const wide = boxSummary([12, 40, 50, 55, 60, 70, 300])!
    const scales = boxOptions([{ name: '몸무게', summary: wide }], PAINT, {
      x: '',
      y: '몸무게',
      point: () => '',
    }).scales
    const y = scales?.['y'] as { min?: number; max?: number } | undefined
    expect(y?.min).toBeGreaterThanOrEqual(0)
    expect(y?.max).toBeGreaterThan(wide.max)
  })

  /** 반대쪽도 같다 — 값이 전부 음수면 축이 0 위로 안 올라간다. */
  it('값이 전부 음수면 축이 0 위로 안 올라간다', () => {
    const below = boxSummary([-90, -70, -60, -55, -40, -12])!
    const scales = boxOptions([{ name: '기온', summary: below }], PAINT, {
      x: '',
      y: '기온',
      point: () => '',
    }).scales
    const y = scales?.['y'] as { min?: number; max?: number } | undefined
    expect(y?.max).toBeLessThanOrEqual(0)
    expect(y?.min).toBeLessThan(below.min)
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

    /**
     * **재료를 데이터셋에서 읽는다.** 플러그인에 넘기지 않는 것이 계약이고, 그 계약이
     * 깨지면 가르기를 바꾼 뒤에도 옛 상자를 그린다 (2026-09-22, 실물에서 잡았다).
     */
    const bars = list.map((_one, index) => ({
      x: 10 + index * 40,
      getProps: () => ({ width: 20 }),
    }))
    const chart = {
      ctx,
      scales: { y: { getPixelForValue: (value: number) => value } },
      data: { datasets: [boxData(list, PAINT).datasets[0]] },
      getDatasetMeta: () => ({ data: bars }),
    }

    // 플러그인의 계약은 Chart.js의 것이라 여기서만 캐스팅한다.
    const plugin = boxWhiskers() as unknown as {
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

  /**
   * **상자가 여럿이면 전부 그린다** (2026-09-22, 사용자가 실물에서 봤다). 재료를 닫힘으로
   * 들던 때는 **두 번째 상자에 수염도 중앙값도 안 그려졌고**, 첫 상자는 옛 요약으로
   * 그려져서 그림이 멀쩡해 보이기까지 했다.
   */
  it('상자가 둘이면 둘 다 수염을 갖는다', () => {
    const other = boxSummary([20, 30, 40, 50, 60])!
    const two: readonly BoxSeries[] = [
      { name: '여', summary },
      { name: '남', summary: other },
    ]
    const { lines } = draw(two)
    expect(lines).toContainEqual([summary.q3, summary.upperWhisker])
    expect(lines).toContainEqual([other.q3, other.upperWhisker])
    expect(lines).toContainEqual([other.median, other.median])
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

  it('색 열의 값마다 갈래를 만들고 인코딩 순서로 세운다', () => {
    const series = scatterSeries(points, '데이터')
    expect(series.map((one) => one.name)).toEqual(['남', '여'])
    expect(series[0]?.points.map((point) => point.row)).toEqual([0, 2])
  })

  /** 첫 등장 순서가 아니다 — 막대(`frequencies`)와 같은 `categoryOrder`다. */
  it('먼저 나온 값이 뒤에 서도 인코딩 순서다 - 값이 없는 갈래는 맨 뒤다', () => {
    const mixed: readonly DataPoint[] = [
      { row: 0, x: 1, y: 1, group: '여' },
      { row: 1, x: 2, y: 2 },
      { row: 2, x: 3, y: 3, group: '남' },
    ]
    expect(scatterSeries(mixed, '없음').map((one) => one.name)).toEqual(['남', '여', '없음'])
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

/**
 * 범주 축을 그리는 방식 (`data/category-axis.ts`).
 *
 * **군집 산점도와 한 자리에서 온다** — 복사해 두면 한쪽의 흩뿌림 폭을 고칠 때 다른
 * 쪽이 안 따라오고, 그때 같은 데이터가 두 화면에서 다르게 보인다.
 */
describe('산점도의 범주 축', () => {
  const points = [
    { row: 0, x: 0, y: 1 },
    { row: 1, x: 1, y: 2 },
  ]
  const series = [{ name: '데이터', points }]

  /** 수치 축이면 값을 그대로 쓴다 — 흩뿌리면 **없는 오차가 생긴다.** */
  it('수치 축은 값을 그대로 쓴다', () => {
    const drawn = scatterData(series, PAINT).datasets[0]?.data
    expect(drawn).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 2 },
    ])
  })

  /**
   * **범주 축이면 칸 안에서 흩뿌린다.** 안 흩뿌리면 한 칸의 점 수천 개가 한 점으로
   * 겹친다. 반올림하면 원래 칸으로 정확히 돌아온다.
   */
  it('범주 축은 칸 안에서 흩뿌리고, 반올림하면 제자리다', () => {
    const drawn = scatterData(series, PAINT, { x: ['남', '여'] }).datasets[0]?.data as {
      x: number
      y: number
    }[]
    // `+ 0`은 `-0`을 0으로 모으려는 것이다. 흩뿌림이 음수면 `Math.round`가 `-0`을 주고,
    // `toEqual`은 그 둘을 다른 값으로 본다 — 재려는 것은 **어느 칸인가**이지 부호가 아니다.
    expect(drawn.map((point) => Math.round(point.x) + 0)).toEqual([0, 1])
    expect(drawn.some((point) => !Number.isInteger(point.x))).toBe(true)
    // 세로축은 범주가 아니므로 그대로다.
    expect(drawn.map((point) => point.y)).toEqual([1, 2])
  })

  /** **행에 매여 있다.** 같은 파일이 같은 그림을 줘야 학생이 어제 본 것을 오늘도 본다. */
  it('같은 행은 언제나 같은 자리에 흩뿌려진다', () => {
    const once = scatterData(series, PAINT, { x: ['남', '여'] }).datasets[0]?.data
    const again = scatterData(series, PAINT, { x: ['남', '여'] }).datasets[0]?.data
    expect(once).toEqual(again)
  })

  /**
   * **눈금은 정수 자리에 범주 이름을 세운다.** `min`·`max`가 반 칸씩 밖으로 나가는 것은
   * 양 끝 칸의 구름이 잘리지 않게 하려는 것이다.
   */
  it('범주 축의 눈금이 이름을 세우고 양 끝을 반 칸씩 넓힌다', () => {
    const text = { x: '성별', y: '키', point: () => '' }
    const scales = scatterOptions(PAINT, text, false, { x: ['남', '여'] }).scales
    const x = scales?.['x'] as {
      min?: number
      max?: number
      ticks?: { stepSize?: number; callback?: (value: number) => string }
    }
    expect(x.min).toBe(-0.5)
    expect(x.max).toBe(1.5)
    expect(x.ticks?.stepSize).toBe(1)
    expect(x.ticks?.callback?.(0)).toBe('남')
    expect(x.ticks?.callback?.(1)).toBe('여')
    // 목록 밖은 이름이 없다 — 빈 이름이 그 줄만 비운다.
    expect(x.ticks?.callback?.(2)).toBe('')
    // 수치 축은 건드리지 않는다.
    expect((scales?.['y'] as { min?: number }).min).toBeUndefined()
  })
})

/**
 * 갈래가 팔레트보다 많을 때 (`open-decisions.md` "47. 색 갈래가 팔레트보다 많을 때").
 *
 * **막지 않는다.** 여기가 무는 것은 **범례를 세우는 손잡이가 부르는 쪽에 있는가** 하나다 —
 * 겹치는 범례를 안 세우는 판단은 화면의 것이고, 그 판단이 설정에 닿는 길이 이 인자다.
 */
describe('산점도의 범례', () => {
  const text = { x: 'a', y: 'b', point: () => '' }

  it('세우라면 세우고 말라면 안 세운다', () => {
    expect(scatterOptions(PAINT, text, true).plugins?.legend?.display).toBe(true)
    expect(scatterOptions(PAINT, text, false).plugins?.legend?.display).toBe(false)
  })

  /** 색 구분을 해도 **갈래가 하나면 범례가 아무것도 안 가른다** — 그 판단은 화면의 몫이다. */
  /**
   * **경계는 팔레트가 정한다.** 일곱까지는 서로 다른 색이고 여덟부터 돌려 쓴다 —
   * `seriesColor`가 그렇게 도는 것을 위 '색' 검사가 이미 못 박았다.
   */
  it.each([
    [1, true],
    [CHART_COLORS, true],
    [CHART_COLORS + 1, false],
    [100, false],
  ])('갈래 %i이면 색이 서로 다른가: %s', (groups, distinct) => {
    expect(colorsAreDistinct(groups)).toBe(distinct)
  })

  /** **막는 판정이 아니다.** 갈래가 많아도 점은 전부 그린다 — 범례만 안 선다. */
  it('갈래가 많아도 점은 전부 그린다', () => {
    const many = Array.from({ length: 20 }, (_value, index) => ({
      name: `갈래 ${index}`,
      points: [{ row: index, x: index, y: index }],
    }))
    expect(scatterData(many, PAINT).datasets).toHaveLength(20)
  })

  it('범례를 안 세워도 점은 그대로 그린다', () => {
    const series = [{ name: '가', points: [{ row: 0, x: 1, y: 2 }] }]
    expect(scatterData(series, PAINT).datasets).toHaveLength(1)
  })
})

/**
 * 점이 많을 때의 비용 (2026-09-22에 재서 넣었다).
 *
 * **`parsing: false`는 꾸밈이 아니라 잰 값이다** — 20만 점에서 다시 그리기가
 * 1,790ms에서 1,063ms가 됐다. 이 줄을 지우면 상한을 해제한 학생이 창을 흔들 때마다
 * 그 차이를 그대로 문다. **캔버스 뒤라 눈으로는 안 보이고 검사만 볼 수 있다.**
 */
describe('산점도는 파싱을 건너뛴다', () => {
  const text = { x: 'a', y: 'b', point: () => '' }

  it('우리가 주는 모양이 이미 내부 모양이므로 파싱을 끈다', () => {
    expect(scatterOptions(PAINT, text, false).parsing).toBe(false)
  })

  /**
   * **`normalized`는 안 쓴다.** *"x로 정렬돼 있고 값이 겹치지 않는다"*는 약속인데
   * 우리 점은 행 순서라 거짓이다 — 200ms를 더 줄이지만 거짓말로 산 것이다.
   */
  it('정렬돼 있다고 말하지 않는다', () => {
    expect(scatterOptions(PAINT, text, false).normalized).toBeUndefined()
  })

  /** 데이터가 정말 `{x, y}`인가 — 파싱을 끈 전제 그 자체다. */
  it('점이 x와 y만 든 객체다', () => {
    const drawn = scatterData([{ name: 'g', points: [{ row: 0, x: 1, y: 2 }] }], PAINT).datasets[0]
      ?.data
    expect(drawn).toEqual([{ x: 1, y: 2 }])
  })
})
