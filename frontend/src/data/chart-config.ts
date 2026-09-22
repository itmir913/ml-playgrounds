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

import { axisCellOf, categoryScale, placed, type AxisCell } from './category-axis'
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
  /**
   * 세는 축을 로그로 세우는가 (`open-decisions.md` "46. 히스토그램의 y축을 로그로 볼
   * 것인가"). 기본은 선형이다.
   *
   * **부르는 쪽이 준다.** 축의 종류는 계산이 아니라 **학생이 지금 무엇을 보고 싶은가**라,
   * 이 파일이 정할 수 있는 것이 아니다.
   */
  logarithmic = false,
): ChartOptions<'bar'> {
  return {
    ...base(),
    /**
     * 가리킨 막대 하나만 말한다. 기본값(`index`)은 같은 자리의 여러 갈래를 함께 세운다.
     *
     * **다만 막대 안에 들어갈 것까지 요구하지는 않는다** (2026-09-22, 코드 소유자가
     * 실물에서 잡았다). `intersect: true`는 커서가 막대의 사각형 안에 있어야 반응하는데,
     * **치우친 열에서는 대부분의 막대가 높이 0에 가까운 선**이라 사실상 짚을 수 없다 —
     * 정작 *"여기 몇 개나 있나"*가 궁금한 것이 그 막대들이다.
     *
     * `axis: 'x'`가 세로 위치를 안 보게 만들어, **그 막대가 선 세로 줄 어디에 커서가
     * 있어도** 그 구간을 말한다. `mode`가 `nearest`라 여전히 하나만 세운다.
     *
     * **박스 플롯과 산점도는 그대로 둔다.** 상자는 높이를 갖고, 점은 `intersect`를 풀면
     * 빈 자리에서도 먼 점을 집어 온다 — 같은 병이 아니다.
     */
    interaction: { mode: 'nearest', intersect: false, axis: 'x' },
    scales: {
      x: axis(paint, text.x),
      /**
       * **선형 쪽은 0부터 시작한다.** 도수를 그리는 축이 0에서 안 시작하면 막대의 길이
       * 비율이 거짓말을 한다 — 두 배인 막대가 열 배로 보인다. **그리고 눈금이 정수다**
       * (2026-09-22, 실물에서 봤다): 값이 작으면 Chart.js가 `0.1 · 0.2 …`를 세우는데,
       * 학번처럼 값마다 한 줄인 열에서 **모든 막대가 1인 그림의 눈금이 전부 소수**였다.
       * `0.5개`라는 것은 없다.
       *
       * **로그 축에는 `beginAtZero`도 `precision`도 없다.** 로그에 0은 없고(`log 0`이
       * 정의되지 않는다), 눈금은 `1 · 10 · 100`처럼 Chart.js가 거듭제곱으로 세운다 —
       * 정수 자릿수를 우리가 줄 자리가 아니다.
       *
       * **빈 구간(0개)은 막대가 안 선다.** 로그 축에서 0은 그릴 자리가 없기 때문이고,
       * 그것이 맞다 — **없는 것을 있는 것처럼 바닥에 붙여 그리면 거짓말이 된다.**
       * 대신 그 칸의 가로 눈금은 그대로 있어서 **어디가 비었는지는 보인다.**
       */
      y: logarithmic
        ? {
            ...axis(paint, text.y),
            type: 'logarithmic' as const,
            /**
             * **바닥이 1이다.** 로그 축의 기본 바닥은 데이터를 보고 잡히는데, 그러면
             * `0.1`처럼 **개수로는 있을 수 없는 눈금**이 선다 (2026-09-22, 실물에서 봤다).
             * 세는 축의 가장 작은 값은 1이다 — 0인 구간은 로그 축에 자리가 없고, 그것을
             * 바닥에 붙여 그리면 없는 것을 있는 것처럼 말하게 된다.
             */
            min: 1,
            ticks: {
              ...axis(paint, text.y).ticks,
              /**
               * **정수만 세운다.** Chart.js가 로그 눈금을 `50,000.0`처럼 소수로 적는다 —
               * `precision`은 선형 눈금의 것이라 여기서는 안 듣는다. 정수가 아닌 눈금은
               * 이름을 안 주어 지운다(`''`을 주면 그 줄만 이름 없이 남는다).
               */
              callback: (value: string | number) => {
                const count = Number(value)
                return Number.isInteger(count) ? count.toLocaleString() : ''
              },
            },
          }
        : {
            ...axis(paint, text.y),
            beginAtZero: true,
            ticks: { ...axis(paint, text.y).ticks, precision: 0 },
          },
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

  /**
   * **축이 0을 건너지 않는다** (2026-09-22, 실물에서 봤다).
   *
   * 몸무게 12~300짜리 열에서 눈금을 떨어지는 수까지 물리면 축이 **−50**에서 시작했다 —
   * 데이터에 음수가 하나도 없는데 **음수 구역이 그림의 6분의 1을 차지하고**, 학생은
   * 거기 값이 있을 수 있다고 읽는다. 값이 전부 양수면 0 아래로 안 내려가고, 전부 음수면
   * 0 위로 안 올라간다.
   *
   * **0에서 시작하지 않는다는 규칙과 안 부딪힌다.** 저쪽은 *0을 끌어들이지 마라*이고
   * 이쪽은 *0을 넘어가지 마라*다 — 키 150~190은 여전히 140쯤에서 시작한다.
   */
  const min = Math.floor((low - pad) / step) * step
  const max = Math.ceil((high + pad) / step) * step
  return {
    min: low >= 0 ? Math.max(0, min) : min,
    max: high <= 0 ? Math.min(0, max) : max,
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

/**
 * 수염과 중앙값 선의 굵기. **상자 테두리와 같은 2다.**
 *
 * 한때 이 줄이 *"상자 테두리(1)보다 굵어야"*라고 적혀 있었는데 테두리는 2였다
 * (2026-09-22 감사). 값은 그대로 두고 근거만 고친다 — 중앙값이 눈에 먼저 들어오는
 * 것은 굵기가 아니라 **상자를 가로지르는 길이**가 만든다.
 */
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

/**
 * 점의 반지름. **Chart.js의 기본값은 3이고 그게 너무 작았다** (2026-09-22, 사용자).
 *
 * **군집 산점도(`ml/cluster-chart.ts`)의 4보다 크고, 그게 맞다.** 저쪽에는 중심점(9)과
 * 학생이 넣은 점(10)이 함께 서서 **점 크기가 위계를 뜻한다** — 데이터 점을 키우면 그
 * 위계가 무너진다. 이 그림에는 그런 층이 없으므로 점은 읽히기만 하면 된다.
 *
 * **`pointRadius`이지 `radius`가 아니다.** 이름 없는 `radius`는 선 요소의 것이라
 * 산점도에서는 아무 일도 안 한다 (`cluster-chart.ts`의 같은 자리 머리말).
 */
const POINT_RADIUS = 5

/**
 * 축마다의 범주 목록. **있으면 그 축은 범주 축이다.**
 *
 * `ml/cluster-chart.ts`의 `ClusterAxisScales`와 같은 표시를 쓴다 — 두 화면이 범주를
 * 같은 방식으로 그린다 (`data/category-axis.ts`).
 */
/**
 * 그 갈래 수에서 **색이 서로 다른가** (`open-decisions.md` "47. 색 갈래가 팔레트보다
 * 많을 때").
 *
 * 팔레트가 `CHART_COLORS`개라 그보다 많으면 `seriesColor`가 돌려 쓴다 — 그때 범례는
 * **없는 대응을 있다고 주장한다.** 그래서 범례를 세울지가 이 판정에 달린다.
 *
 * **막는 판정이 아니다.** 갈래가 많아도 그림은 그대로 그리고(다른 도구도 그렇다),
 * 화면이 **겹친다는 사실과 점을 가리키면 이름이 나온다는 것**을 말한다.
 *
 * **컴포넌트 밖에 있는 이유는 그것이 검사할 수 있는 유일한 자리이기 때문이다**
 * (`CLAUDE.md` §4).
 */
export function colorsAreDistinct(groupCount: number): boolean {
  return groupCount <= CHART_COLORS
}

export interface ScatterAxisScales {
  readonly x?: readonly string[] | undefined
  readonly y?: readonly string[] | undefined
}

export function scatterData(
  series: readonly ScatterSeries[],
  paint: ChartPaint,
  scales: ScatterAxisScales = {},
): ChartData<'scatter'> {
  return {
    datasets: series.map((one, index) => ({
      label: one.name,
      /**
       * **범주 축이면 칸 안에서 흩뿌린다** (`data/category-axis.ts`). 안 흩뿌리면
       * 한 칸의 점 수천 개가 **한 점으로 겹쳐** 몇 개인지 알 수 없다.
       */
      data: one.points.map((point) => ({
        x: placed(point.x, point.row, scales.x),
        y: placed(point.y, point.row, scales.y),
      })),
      backgroundColor: seriesColor(paint, index),
      /**
       * **획을 안 긋는다** (2026-09-22에 재서 뺐다). 테두리 색이 **배경과 같은 색**이라
       * 보이지도 않는데, Chart.js는 점마다 채우기 말고 **획을 한 번 더** 긋고 있었다.
       *
       * **20만 점에서 다시 그리기가 436ms → 172ms였다**(3회 중앙값, 같은 판에서 번갈아
       * 재서 뜨거운 기계의 기울기를 걷어냈다). 그림은 점의 지름이 `borderWidth` 기본값의
       * 절반만큼 줄어드는 것이 전부다.
       *
       * **범례 표식은 그대로다** — `usePointStyle`이 채우기로 그린다.
       */
      borderWidth: 0,
      // **가리켜도 안 돌아온다.** hover 기본값이 1이라 안 맞추면 커서를 얹는 순간 없던
      // 획이 생긴다 (`ml/cluster-chart.ts`가 같은 규칙을 검사로 들고 있다).
      hoverBorderWidth: 0,
      borderColor: seriesColor(paint, index),
      pointRadius: POINT_RADIUS,
      // **커서를 얹어도 안 커진다.** 기본값(4)이 이 크기보다 작아 점이 오히려 줄어든다.
      pointHoverRadius: POINT_RADIUS,
    })),
  }
}

export function scatterOptions(
  paint: ChartPaint,
  text: {
    readonly x: string
    readonly y: string
    /**
     * **좌표는 이미 되돌린 것이 온다** (2026-09-22 R37 A-3). 범주 축의 점은 칸 안에서
     * 흩뿌려 그리므로 `parsed.x`는 `1.02` 같은 수인데, **되돌리는 일을 부르는 쪽에
     * 맡겼더니 새로 생긴 화면이 그것을 잊었다** — 툴팁이 `여` 대신 `1.02`를 말했다.
     * 이제 여기서 `axisCellOf`를 거쳐 넘기므로 **잊을 자리가 없다.**
     */
    readonly point: (name: string, x: AxisCell, y: AxisCell) => string
  },
  showLegend: boolean,
  scales: ScatterAxisScales = {},
): ChartOptions<'scatter'> {
  /**
   * 범주 축의 눈금은 **군집 산점도와 한 자리에서 온다** (`data/category-axis.ts`) —
   * 두 화면이 같은 범주를 다르게 그리면 안 된다.
   */
  const forAxis = (name: string, categories: readonly string[] | undefined) =>
    categories === undefined
      ? axis(paint, name)
      : { ...axis(paint, name), ...categoryScale(categories, paint.ink) }

  return {
    ...base(),
    /**
     * **우리가 주는 모양이 이미 Chart.js의 내부 모양이다** (2026-09-22에 재서 넣었다).
     * `{x, y}` 객체를 그대로 주므로 파싱할 것이 없는데, 안 끄면 점마다 한 번씩 돈다.
     *
     * **20만 점에서 다시 그리기가 1,790ms → 1,063ms였다**(개발 PC, 800×500). 상한을
     * 해제한 학생이 창을 흔들 때마다 무는 값이라 **40%가 그대로 체감으로 온다.**
     *
     * **`normalized: true`는 안 쓴다.** 그쪽은 *"x로 정렬돼 있고 값이 겹치지 않는다"*는
     * 약속인데 **우리 점은 행 순서라 거짓이다.** 200ms를 더 줄이지만 거짓말로 산 것이다.
     */
    parsing: false,
    // 겹친 점을 전부 세우지 않는다. 기본 모드(`point`)는 커서 아래의 모든 점을 모은다.
    interaction: { mode: 'nearest', intersect: true },
    scales: { x: forAxis(text.x, scales.x), y: forAxis(text.y, scales.y) },
    plugins: {
      // **갈래가 하나면 범례가 없다.** 이름 하나짜리 범례는 아무것도 안 가른다.
      legend: { display: showLegend, labels: { color: paint.ink, usePointStyle: true } },
      tooltip: {
        position: 'nearest',
        usePointStyle: true,
        callbacks: {
          label: (item) =>
            text.point(
              item.dataset.label ?? '',
              axisCellOf(scales.x, item.parsed.x),
              axisCellOf(scales.y, item.parsed.y),
            ),
        },
      },
    },
  }
}
