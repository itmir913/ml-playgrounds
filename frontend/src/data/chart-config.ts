/**
 * 데이터 화면 그림 넷의 **Chart.js 설정** (`architecture.md` §8.9.1).
 *
 * **화면 밖에 있는 이유는 `ml/cluster-chart.ts`와 같다.** 그림을 만드는 계산이
 * 컴포넌트의 `computed`에 있으면 **캔버스 없이는 검사가 못 붙고**, 그 자리에서 이
 * 저장소는 이미 두 번 조용히 깨졌다 — 그릴 차례가 뒤집혀 중심점이 묻혔고, 애니메이션
 * 기본값이 켜져 축 한 번 바꾸기가 71프레임을 다시 그렸다.
 *
 * **`chart.js`에서 타입만 가져온다.** 값을 가져오면 이 계층을 쓰는 모든 코드가 차트
 * 라이브러리를 함께 받는다 — 등록(`Chart.register`)은 지연 로딩되는 부품의 몫이다.
 */

import type { ChartData, ChartOptions, Plugin } from 'chart.js'

import { CHART_COLORS, INK_ORDER } from '@/palette'

import type { BoxSummary, DataPoint, Frequencies, Histogram } from './stats'

/** 캔버스가 쓰는 색 한 벌. `composables/useChartTokens.ts`가 읽어 넘긴다. */
export interface ChartPaint {
  readonly palette: readonly string[]
  readonly softPalette: readonly string[]
  readonly surface: string
  readonly ink: string
  readonly line: string
}

/**
 * 갈래 하나의 색. **돌려 쓰는 차례가 1,2,3…이 아니다** (#18, `palette.ts`).
 *
 * `ml/cluster-chart.ts`의 `clusterColor`와 같은 규칙이고, 같은 이유로 **무작위를 안
 * 쓴다** — 같은 프로젝트를 다시 열었을 때 같은 범주가 다른 색이면 학생이 어제 본
 * 그림과 못 맞춘다.
 */
export function seriesColor(paint: ChartPaint, index: number): string {
  const palette = paint.palette
  if (palette.length === 0) return paint.ink
  const slot = index % palette.length
  const ordered = palette.length === CHART_COLORS ? (INK_ORDER[slot] ?? slot) : slot
  return palette[ordered] ?? paint.ink
}

/**
 * **혼자 서는 그림의 색.** 팔레트의 첫 색이다.
 *
 * `seriesColor`와 갈리는 이유는 **색이 뜻을 갖느냐**다. 갈래가 여럿일 때 색은 *"이것과
 * 저것은 다르다"*를 말하므로 서로 먼 색을 골라야 하지만(`INK_ORDER`), 갈래가 하나면
 * 색은 아무 말도 안 한다 — 그때는 **거리가 아니라 대표색**이 맞다. 돌려 쓰는 차례의
 * 첫 칸을 그냥 쓰면 히스토그램 하나가 `chart-4`(겨자색)로 서는데, 그 색이 거기 온 이유가
 * "넷째로 먼 색이라서"다 (2026-09-22, 사용자가 실물에서 봤다).
 */
export function leadColor(paint: ChartPaint): string {
  return paint.palette[0] ?? paint.ink
}

/** 넓이를 채우는 자리의 옅은 색. 못 읽으면 진한 쪽으로 떨어진다. */
export function softColor(paint: ChartPaint, index: number): string {
  const slot = index % Math.max(paint.softPalette.length, 1)
  return paint.softPalette[slot] ?? seriesColor(paint, index)
}

/** 캔버스 글자 크기. **교실 모니터에서 읽혀야 한다** — Chart.js 기본값 12는 작다. */
const FONT_SIZE = 14

/**
 * 축 하나의 꾸밈. **축 선도 격자와 같은 색을 쓴다** — 안 주면 Chart.js가 자기 기본값
 * (`rgba(0,0,0,0.1)`)으로 그리는데 그 색은 배색을 안 따라간다.
 */
function axis(paint: ChartPaint, title: string) {
  return {
    title: { display: title !== '', text: title, color: paint.ink, font: { size: FONT_SIZE } },
    ticks: { color: paint.ink, font: { size: FONT_SIZE } },
    grid: { color: paint.line },
    border: { color: paint.line },
  }
}

/**
 * 그림 넷이 함께 쓰는 바탕.
 *
 * **애니메이션을 끈다.** 10만 행에서 축이나 열을 바꿀 때마다 수십 프레임을 다시 그릴
 * 이유가 없고, 상한의 근거가 된 실측도 `animation: false`에서 나왔다 (#28-5).
 */
function base(): { responsive: true; maintainAspectRatio: false; animation: false } {
  return { responsive: true, maintainAspectRatio: false, animation: false }
}

/** 구간의 이름. `12.5 ~ 15.0`처럼 양끝을 적는다. 수를 다듬는 것은 부르는 쪽이다. */
export function binLabels(
  edges: readonly number[],
  format: (value: number) => string,
): readonly string[] {
  const labels: string[] = []
  for (let i = 0; i + 1 < edges.length; i += 1) {
    labels.push(`${format(edges[i] as number)} ~ ${format(edges[i + 1] as number)}`)
  }
  return labels
}

/**
 * 히스토그램.
 *
 * **막대 사이를 붙인다** (`categoryPercentage`·`barPercentage`가 1이다). 히스토그램의
 * 가로축은 이어진 수이고, 사이가 벌어지면 **막대그래프로 읽힌다** — 둘은 다른 그림이고
 * 학생이 그 차이를 그림의 모양에서 배운다 (`terms.md`).
 */
export function histogramData(
  histogram: Histogram,
  labels: readonly string[],
  paint: ChartPaint,
  seriesName: string,
): ChartData<'bar'> {
  return {
    labels: [...labels],
    datasets: [
      {
        label: seriesName,
        data: [...histogram.counts],
        backgroundColor: leadColor(paint),
        /**
         * **테두리는 바탕색이다. 막대와 같은 색이 아니다** (2026-09-22, 사용자가 실물에서
         * 봤다). 막대가 붙어 있으므로 경계를 긋는 것이 유일한 구분인데, 같은 색으로 그으면
         * **구분선이 없는 것과 똑같다** — 히스토그램 전체가 한 덩어리로 보였다.
         *
         * 이 자리의 주석은 그때도 *"바탕색 실선이 그 일을 한다"*고 적혀 있었다. **글은
         * 맞고 코드가 달랐다** (`CLAUDE.md` §4의 "유창하게 틀린 주석").
         */
        borderColor: paint.surface,
        categoryPercentage: 1,
        barPercentage: 1,
        borderWidth: { top: 0, right: 2, bottom: 0, left: 2 },
      },
    ],
  }
}

/** 막대 그림 둘(히스토그램·막대그래프)이 함께 쓰는 설정. */
export function barOptions(
  paint: ChartPaint,
  text: {
    readonly x: string
    readonly y: string
    readonly point: (label: string, count: number) => string
  },
): ChartOptions<'bar'> {
  return {
    ...base(),
    // 가리킨 막대 하나만 말한다. 기본값(`index`)은 같은 자리의 여러 갈래를 함께 세운다.
    interaction: { mode: 'nearest', intersect: true },
    scales: {
      x: axis(paint, text.x),
      // **0부터 시작한다.** 도수를 그리는 축이 0에서 안 시작하면 막대의 길이 비율이
      // 거짓말을 한다 — 두 배인 막대가 열 배로 보인다.
      y: { ...axis(paint, text.y), beginAtZero: true },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (item) => text.point(String(item.label), Number(item.parsed.y)),
        },
      },
    },
  }
}

/**
 * 막대그래프(범주 도수).
 *
 * **막대 사이를 띄운다.** 히스토그램과 반대다 — 가로축이 이어진 수가 아니라 서로 다른
 * 값들이고, 붙여 놓으면 학생이 그 사이에 값이 있다고 읽는다.
 */
export function barData(
  tally: Frequencies,
  paint: ChartPaint,
  seriesName: string,
): ChartData<'bar'> {
  return {
    labels: tally.bars.map((bar) => bar.value),
    datasets: [
      {
        label: seriesName,
        /**
         * **막대마다 색을 바꾸지 않는다** (2026-09-22). 한 열의 도수를 그리는 그림에서
         * 색은 아무것도 안 가른다 — 범주가 서른이면 일곱 색이 네 바퀴를 돌아 **뜻 없는
         * 무지개**가 된다. 색이 뜻을 갖는 것은 갈래가 둘 이상일 때뿐이다(산점도의 색 구분).
         */
        data: tally.bars.map((bar) => bar.count),
        backgroundColor: leadColor(paint),
        borderWidth: 0,
      },
    ],
  }
}

/** 상자 하나의 최대 폭(px). 여럿이면 자리에 맞춰 더 좁아진다. */
const BOX_MAX_THICKNESS = 72

/** 상자 하나. 이름과 요약이 짝이다. */
export interface BoxSeries {
  readonly name: string
  readonly summary: BoxSummary
}

/**
 * 수염 플러그인이 그릴 때 보는 것. **데이터셋에 실어 보낸다.**
 *
 * **플러그인이 닫힘(closure)으로 들고 있으면 낡는다** (2026-09-22, 사용자가 실물에서
 * 봤다). `vue-chartjs`는 `plugins` 프롭이 바뀌어도 차트를 다시 만들지 않으므로, 상자
 * 하나짜리 그림을 범주로 가르면 **두 번째 상자에는 수염도 중앙값도 안 그려졌다** —
 * 첫 상자는 옛 요약으로 그려져서 그림이 멀쩡해 보이기까지 했다.
 *
 * `data` 프롭은 반응형이라 언제나 지금 것이다. 그래서 **그릴 재료를 전부 거기 싣는다.**
 */
interface BoxExtras {
  readonly boxes: readonly BoxSeries[]
  /** 수염·중앙값·이상치의 색. 배색이 바뀌면 이 값도 함께 바뀐다. */
  readonly ink: string
}

/**
 * 박스 플롯의 **상자**. 수염·중앙값·이상치는 아래 플러그인이 그린다.
 *
 * **`[Q1, Q3]`을 값으로 주는 떠 있는 막대다.** Chart.js 코어에는 박스 플롯이 없지만
 * 막대는 `[아래, 위]`를 받고, 상자는 그 모양 그대로다 — 플러그인 하나를 더 받는 것보다
 * 싸다 (`open-decisions.md` "44. 데이터 화면의 시각화"의 의존성 절).
 */
export function boxData(series: readonly BoxSeries[], paint: ChartPaint): ChartData<'bar'> {
  return {
    labels: series.map((one) => one.name),
    datasets: [
      {
        label: '',
        data: series.map((one) => [one.summary.q1, one.summary.q3] as [number, number]),
        /**
         * **넓이는 옅게, 테두리는 진하게** (카드가 `border + bg-soft`로 서는 것과 같다).
         * 진한 색으로 채우면 그림의 절반이 한 색 덩어리가 되어 **그 안의 중앙값 선이
         * 묻힌다** (2026-09-22, 사용자가 실물에서 봤다).
         */
        backgroundColor: series.map((_one, index) => softColor(paint, index)),
        borderColor: series.map((_one, index) => seriesColor(paint, index)),
        borderWidth: 2,
        /**
         * **네 변을 다 그린다** (2026-09-22, 사용자가 실물에서 봤다). Chart.js는 막대의
         * **바닥 쪽 테두리를 기본으로 건너뛴다**(`borderSkipped: 'start'`) — 축에서 자라는
         * 막대에는 그 변이 축선과 겹치기 때문이다. **떠 있는 막대에는 그 전제가 없다** —
         * 상자의 아래 변은 제1사분위수이고, 안 그리면 상자가 아래로 새어 나간 것처럼 보인다.
         */
        borderSkipped: false,
        // 상자가 너무 넓으면 수염이 상자 안에 갇힌 것처럼 보인다.
        barPercentage: 0.6,
        categoryPercentage: 0.8,
        /**
         * **상자 하나짜리 그림에 천장이 필요하다** (2026-09-22, 사용자가 실물에서 봤다).
         * 비율만 주면 칸이 하나일 때 그 칸이 캔버스 전체라, 상자가 그림의 절반을 차지한다 —
         * 박스 플롯은 **세로로 읽는 그림**인데 가로가 그만큼 넓으면 눈이 넓이를 먼저 읽는다.
         */
        maxBarThickness: BOX_MAX_THICKNESS,
        // **그릴 재료를 데이터셋에 싣는다** (위 `BoxExtras`). Chart.js는 모르는 필드를
        // 건드리지 않고 그대로 들고 있으므로, 플러그인이 언제나 지금 것을 본다.
        ...({ boxes: series, ink: paint.ink } satisfies BoxExtras),
      },
    ],
  }
}

/**
 * 상자가 차지할 세로 범위. **양끝에 숨 쉴 자리를 둔다.**
 *
 * `0.08`은 위아래로 남기는 비율이다. 안 두면 최댓값의 수염이 그림의 맨 윗줄에 딱 붙어
 * **잘린 것처럼 보인다.**
 */
const BOX_PADDING_RATIO = 0.08

/**
 * 눈금이 떨어지기 좋은 단위. 범위의 자릿수에서 낸다.
 *
 * **여백을 준 값을 그대로 축의 끝으로 쓰면 눈금에 `148.3`·`194.2`가 뜬다** — 학생이
 * 읽을 수가 없고, 그 수는 데이터에도 없는 수다 (2026-09-22, 사용자가 실물에서 봤다).
 * 그래서 여백을 준 뒤 **그 바깥의 떨어지는 수까지** 물러난다.
 */
function niceStep(range: number): number {
  if (range <= 0) return 1
  // 자릿수의 절반 눈금(…, 0.5, 5, 50, …)이면 눈금 다섯~열 개가 나온다.
  return 10 ** Math.floor(Math.log10(range)) / 2
}

function boxRange(series: readonly BoxSeries[]): { min: number; max: number } | null {
  if (series.length === 0) return null
  /**
   * **펼쳐서 넘기지 않는다** (`spread-rules.spec.ts`). 상자는 서른 개를 안 넘지만
   * (`CATEGORY_BAR_LIMIT`) **그물은 길이를 모르고**, 이 자리가 예외 목록에 들어갈 이유도
   * 없다 — 접어서 세는 것이 같은 값을 더 싸게 준다.
   */
  const low = series.reduce((least, one) => Math.min(least, one.summary.min), Infinity)
  const high = series.reduce((most, one) => Math.max(most, one.summary.max), -Infinity)
  // 값이 하나뿐이면 범위가 0이라 여백도 0이 된다 — 그때는 눈금이 한 점에 겹친다.
  const pad = (high - low) * BOX_PADDING_RATIO || 1
  const step = niceStep(high - low || 1)
  return {
    min: Math.floor((low - pad) / step) * step,
    max: Math.ceil((high + pad) / step) * step,
  }
}

/**
 * 박스 플롯의 눈금.
 *
 * **세로축이 0에서 시작하면 안 된다** — 값의 범위를 보는 그림인데 0을 끌어들이면
 * 상자가 위쪽에 납작하게 눌린다. 키 150~190짜리 상자가 0~200 축에서 화면의 5분의 1만
 * 쓰고, **다섯 수를 눈으로 읽을 수 없다** (2026-09-22, 사용자가 실물에서 봤다).
 *
 * **`beginAtZero: false`로는 안 된다.** Chart.js의 막대 눈금은 기본이 0부터라,
 * **범위를 직접 박아야** 0이 안 들어온다. 그래서 이 함수가 재료를 받는다.
 */
export function boxOptions(
  series: readonly BoxSeries[],
  paint: ChartPaint,
  text: { readonly x: string; readonly y: string; readonly point: (name: string) => string },
): ChartOptions<'bar'> {
  const range = boxRange(series)
  return {
    ...base(),
    interaction: { mode: 'nearest', intersect: true },
    scales: { x: axis(paint, text.x), y: { ...axis(paint, text.y), ...(range ?? {}) } },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (item) => text.point(String(item.label)) } },
    },
  }
}

/** 수염과 중앙값 선의 굵기. 상자 테두리(1)보다 굵어야 눈에 먼저 들어온다. */
const WHISKER_WIDTH = 2

/** 수염 끝의 가로선이 상자 폭에서 차지하는 비율. */
const CAP_RATIO = 0.5

/** 이상치 점의 반지름. 데이터 점의 기본(4)보다 작다 — 개수가 많을 수 있다. */
const OUTLIER_RADIUS = 2.5

/**
 * 박스 플롯의 **나머지 전부** — 수염, 수염 끝의 가로선, 중앙값, 이상치.
 *
 * **플러그인 하나를 새로 받지 않고 직접 그리는 자리다.** 그리는 데 필요한 것은 축의
 * 좌표 변환뿐이고, Chart.js가 그것을 이미 준다.
 *
 * **`afterDatasetsDraw`다.** 상자 위에 그려야 중앙값 선이 안 묻힌다.
 *
 * **인자를 안 받는다.** 그릴 재료는 데이터셋에 실려 온다(`BoxExtras`) — 닫힘으로 들면
 * 낡고, 낡은 것을 그린 그림은 **멀쩡해 보인다.**
 */
export function boxWhiskers(): Plugin<'bar'> {
  return {
    id: 'box-whiskers',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0)
      const scale = chart.scales['y']
      const extras = chart.data.datasets[0] as unknown as Partial<BoxExtras> | undefined
      const boxes = extras?.boxes ?? []
      if (!scale || boxes.length === 0) return

      const ctx = chart.ctx
      ctx.save()
      ctx.lineWidth = WHISKER_WIDTH
      ctx.strokeStyle = extras?.ink ?? ''
      ctx.fillStyle = extras?.ink ?? ''

      meta.data.forEach((bar, index) => {
        const summary = boxes[index]?.summary
        if (!summary) return

        const x = bar.x
        // **막대의 실제 폭을 읽는다.** `barPercentage`를 여기서 다시 계산하면 저쪽을
        // 고쳤을 때 수염만 옛 폭에 남는다.
        const width = (bar.getProps(['width'], true) as { width?: number }).width ?? 0
        const cap = (width * CAP_RATIO) / 2

        const line = (from: number, to: number): void => {
          ctx.beginPath()
          ctx.moveTo(x, scale.getPixelForValue(from))
          ctx.lineTo(x, scale.getPixelForValue(to))
          ctx.stroke()
        }
        const horizontal = (at: number, half: number): void => {
          ctx.beginPath()
          ctx.moveTo(x - half, scale.getPixelForValue(at))
          ctx.lineTo(x + half, scale.getPixelForValue(at))
          ctx.stroke()
        }

        line(summary.q3, summary.upperWhisker)
        line(summary.q1, summary.lowerWhisker)
        horizontal(summary.upperWhisker, cap)
        horizontal(summary.lowerWhisker, cap)
        // 중앙값은 상자를 가로지른다. **상자 테두리보다 굵다** — 다섯 수 중 학생이 가장
        // 먼저 읽어야 하는 값이다.
        horizontal(summary.median, width / 2)

        for (const value of summary.outliers) {
          ctx.beginPath()
          ctx.arc(x, scale.getPixelForValue(value), OUTLIER_RADIUS, 0, Math.PI * 2)
          ctx.fill()
        }
      })

      ctx.restore()
    },
  }
}

/** 산점도의 한 갈래. 색 열을 안 골랐으면 갈래가 하나다. */
export interface ScatterSeries {
  readonly name: string
  readonly points: readonly DataPoint[]
}

/**
 * 색 열의 값마다 점을 나눈다. **값의 첫 등장 순서를 지킨다** (`frequencies`와 같은 규칙).
 *
 * 색 열이 없으면 갈래 하나이고, 그 이름은 부르는 쪽이 준다.
 */
export function scatterSeries(
  points: readonly DataPoint[],
  fallbackName: string,
): readonly ScatterSeries[] {
  const groups = new Map<string, DataPoint[]>()
  for (const point of points) {
    const key = point.group ?? fallbackName
    const found = groups.get(key)
    if (found) found.push(point)
    else groups.set(key, [point])
  }
  return [...groups.entries()].map(([name, grouped]) => ({ name, points: grouped }))
}

export function scatterData(
  series: readonly ScatterSeries[],
  paint: ChartPaint,
): ChartData<'scatter'> {
  return {
    datasets: series.map((one, index) => ({
      label: one.name,
      data: one.points.map((point) => ({ x: point.x, y: point.y })),
      backgroundColor: seriesColor(paint, index),
      borderColor: seriesColor(paint, index),
    })),
  }
}

export function scatterOptions(
  paint: ChartPaint,
  text: {
    readonly x: string
    readonly y: string
    readonly point: (name: string, x: number | null, y: number | null) => string
  },
  showLegend: boolean,
): ChartOptions<'scatter'> {
  return {
    ...base(),
    // 겹친 점을 전부 세우지 않는다. 기본 모드(`point`)는 커서 아래의 모든 점을 모은다.
    interaction: { mode: 'nearest', intersect: true },
    scales: { x: axis(paint, text.x), y: axis(paint, text.y) },
    plugins: {
      // **갈래가 하나면 범례가 없다.** 이름 하나짜리 범례는 아무것도 안 가른다.
      legend: { display: showLegend, labels: { color: paint.ink, usePointStyle: true } },
      tooltip: {
        position: 'nearest',
        usePointStyle: true,
        callbacks: {
          label: (item) => text.point(item.dataset.label ?? '', item.parsed.x, item.parsed.y),
        },
      },
    },
  }
}
