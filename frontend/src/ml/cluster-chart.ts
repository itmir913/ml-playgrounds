/**
 * 산점도의 Chart.js 설정 (`architecture.md` §8.13.2).
 *
 * **화면 밖에 있는 이유는 §8.13.2의 4번이다** — 그림을 만드는 계산은 순수 함수여야
 * 하고, `chartData`/`chartOptions`가 화면에 남은 마지막 계산이었다. **그리고 지금까지
 * 이 파일이 담을 규칙 두 개가 화면에서 조용히 깨졌다** (2026-08-11):
 *
 * 1. 데이터셋을 배열 끝에 넣는다고 위에 그려지지 않는다. Chart.js는 `order`(같으면 배열
 *    순서)로 정렬한 뒤 **뒤에서부터** 그려서, 중심점이 점 수천 개에 묻혔다.
 * 2. 애니메이션 기본값이 켬이라 축을 한 번 바꾸면 71프레임을 다시 그렸다.
 *
 * 둘 다 눈으로만 보이는 종류이고 사용자가 화면에서 잡았다. 여기로 빼면 캔버스 없이
 * 검사가 붙는다 (`tests/cluster-chart.spec.ts`).
 *
 * **chart.js에서 타입만 가져온다.** 값을 가져오면 이 계층을 쓰는 모든 코드가 차트
 * 라이브러리를 함께 받게 된다 — 등록(`Chart.register`)은 지연 로딩되는 패널의 몫이다.
 */

import type { ChartData, ChartOptions, PointStyle } from 'chart.js'

import type { ClusterSummary, ScatterData } from './clusters'

/**
 * 배색 토큰의 실제 값. **캔버스는 CSS 클래스를 못 쓴다.**
 *
 * 화면이 `getComputedStyle`로 읽어 넘긴다 — 이 계층은 DOM을 모른다.
 */
export interface ClusterChartTokens {
  /** `--color-chart-1`~`-7`. 일곱 개다 (#28-3). */
  readonly palette: readonly string[]
  readonly surface: string
  readonly ink: string
  readonly line: string
}

/**
 * 학생이 방금 넣은 한 줄 (#28-7). **결과 화면에는 없고 예측 화면에만 있다.**
 *
 * `values`는 `axes` 순서의 되돌린 좌표다 — `axisValues`가 만든 것을 그대로 받는다.
 */
export interface ClusterHighlight {
  readonly values: readonly number[]
  /** 답으로 나온 군집. **색이 여기서 온다** - "너는 2번 군집이다"가 색으로 읽힌다. */
  readonly cluster: number
}

/** 화면이 번역해 넘기는 문구. 이 계층은 `t()`를 모른다. */
export interface ClusterChartText {
  readonly clusterName: (cluster: number) => string
  readonly centroid: string
  /** 새 점의 범례 이름. 예측 화면에서만 쓰인다. */
  readonly highlight?: string
  /** 축 이름은 학생의 열 이름이라 번역하지 않는다. */
  readonly axisX: string
  readonly axisY: string
  /** 툴팁 한 문장. 조각을 이어 붙이지 않는다 (docs/i18n.md 규칙 3). */
  readonly point: (name: string, x: number | null, y: number | null) => string
}

/**
 * 그리는 차례. **작을수록 위에 그려진다.**
 *
 * Chart.js가 정렬한 뒤 뒤에서부터 그리기 때문이다(`_drawDatasets`). 배열 순서에
 * 기대면 중심점이 맨 아래로 간다.
 */
export const DRAW_ORDER = { points: 3, halo: 2, centroid: 1, highlight: 0 } as const

/**
 * 한 축이 범주 축인가. **`categories`가 있으면 그렇다** — `ml/clusters.ts`의
 * `ClusterAxis`와 같은 표시를 쓴다.
 */
export interface ClusterAxisScales {
  readonly x?: readonly string[] | undefined
  readonly y?: readonly string[] | undefined
}

/**
 * 범주 칸 안에서 점을 흩뿌리는 폭 (`open-decisions.md` "군집 산점도의 축").
 *
 * **한 칸이 1이다.** ±0.3이면 이웃 칸의 구름과 0.4가 벌어져서 **눈이 여전히 칸으로
 * 묶어 읽는다** — 그보다 넓히면 어느 범주인지가 흐려지고, 좁히면 흩뿌리는 뜻이 없다.
 * 반올림하면 원래 칸으로 정확히 돌아오므로 툴팁은 참값을 말한다.
 */
const JITTER_SPREAD = 0.3

/**
 * 그 행의 흩뿌림. **행 번호에서 나오므로 언제나 같다.**
 *
 * 같은 파일이 같은 그림을 줘야 학생이 어제 본 것을 오늘도 본다 (#28-5가 표본에 시드를
 * 준 것과 같은 이유). **축을 바꿔도 점이 안 튀는 것**도 여기서 온다 — 흩뿌림이 축이
 * 아니라 행에 매여 있다.
 *
 * 난수원을 새로 들이지 않는다. 필요한 것은 "행마다 다르고 언제나 같은 수" 하나뿐이고,
 * 정수 해시로 충분하다.
 */
function jitterOf(row: number): number {
  const mixed = Math.sin(row * 12.9898) * 43758.5453
  return ((mixed - Math.floor(mixed)) * 2 - 1) * JITTER_SPREAD
}

/** 범주 축이면 흩뿌리고, 아니면 그대로. */
function placed(value: number, row: number, categories: readonly string[] | undefined): number {
  return categories === undefined ? value : value + jitterOf(row)
}

/**
 * 점의 크기와 획. **`radius`가 아니라 `pointRadius`다.**
 *
 * 산점도 데이터셋의 이름 없는 `radius`·`borderColor`·`borderWidth`는 **선 요소의 것**이고
 * (산점도는 선을 안 그린다) 점에 닿는 이름은 `point*`다. 타입이 그것을 알고 있어서,
 * 화면 밖으로 빼는 순간 컴파일러가 잡았다 — 화면에 있을 때는 통과했다.
 */
const POINT_RADIUS = 4
const CENTROID_RADIUS = 9
/**
 * 테두리가 군집 색보다 굵어야 테두리로 보인다.
 *
 * **색은 `surface`가 아니라 `ink`다** (#28-1에서 2026-08-12에 뒤집었다). 배경색 테두리는
 * 점이 몰린 자리에서만 뜻이 있고 **빈 배경에서는 아예 안 보인다.**
 */
const CENTROID_HALO_WIDTH = 6
const CENTROID_WIDTH = 3
/** 학생이 넣은 점은 데이터보다 크고 중심점만큼 눈에 띈다. */
const HIGHLIGHT_RADIUS = 10
const HIGHLIGHT_BORDER_WIDTH = 3

/**
 * 토큰을 못 읽었을 때 쓰는 색. **`styles/theme.css`의 값을 그대로 옮긴 것이다.**
 *
 * **대체값이 전부 같으면 안 된다.** 처음에는 일곱 개를 모두 `#000000`으로 두었는데,
 * 그러면 토큰을 못 읽는 순간 **모든 군집이 같은 검정으로 그려지고 아무도 실패를
 * 모른다** (2026-08-11 감사). 그림은 멀쩡해 보이는데 군집이 안 갈린다.
 *
 * **밝은 배색의 값이다** — 못 읽는 상황은 스타일시트가 아예 없는 상황이고, 그때 기본은
 * `FALLBACK_THEME`(밝게)이다. 넷째 값이 Okabe-Ito 원본(#f0e442)이 아닌 것도 CSS 그대로다 —
 * 흰 바탕에서 노랑이 안 보여 어둡게 조정된 값이고, 여기서 원본으로 되돌리면 두 벌이 갈린다.
 *
 * **값이 두 벌이 된 자리이므로 검사가 지킨다** — `tests/cluster-chart.spec.ts`가
 * `theme.css`를 읽어 대조한다. 배색 값의 출처는 여전히 CSS 하나다 (§8.4).
 */
export const FALLBACK_PALETTE: readonly string[] = [
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#9a8200',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
]

/** 색은 일곱을 돌려 쓰고 여덟 번째 군집부터 모양을 바꾼다 (#28-3). */
export const POINT_SHAPES: readonly PointStyle[] = ['circle', 'triangle', 'rect']

export function clusterColor(tokens: ClusterChartTokens, cluster: number): string {
  const palette = tokens.palette
  return palette.length === 0 ? tokens.ink : (palette[cluster % palette.length] ?? tokens.ink)
}

export function clusterShape(tokens: ClusterChartTokens, cluster: number): PointStyle {
  const count = tokens.palette.length || 1
  return POINT_SHAPES[Math.floor(cluster / count) % POINT_SHAPES.length] ?? 'circle'
}

/**
 * 흰 테두리 데이터셋의 자리. **범례와 툴팁이 이 색인으로 그 줄을 뺀다.**
 *
 * 배열 순서가 바뀌면 **군집 하나가 대신 지워진다** — 화면에는 아무 표시도 안 난다.
 * 그래서 색인을 손으로 쓰지 않고 여기서 구한다.
 *
 * **중심점을 안 그리는 그림에는 그 줄이 없다** (범주 축). 그때 `clusterCount`를 그대로
 * 돌려주면 **군집 하나가 범례에서 사라진다** — 없는 줄을 빼려다 있는 줄을 뺀다.
 * 그래서 `-1`이고, 어느 데이터셋과도 안 같은 값이다.
 */
export function haloIndex(clusterCount: number, drawsCentroid = true): number {
  return drawsCentroid ? clusterCount : -1
}

/**
 * 중심점 두 겹. **`crossRot`은 선으로만 그려지므로** 흰 굵은 선을 먼저 깔고 그 위에
 * 군집 색을 얹는다 — 점이 몰린 자리에서 중심점이 묻히지 않게 하는 것이 그 일이다.
 *
 * 두 겹이 한 함수인 이유는 **함께 있거나 함께 없어야 하기 때문이다.** 범주 축에서 위만
 * 빼면 흰 테두리가 홀로 남는다.
 */
function centroidLayers(
  centers: readonly { x: number; y: number }[],
  summaries: readonly ClusterSummary[],
  tokens: ClusterChartTokens,
  label: string,
): ChartData<'scatter'>['datasets'] {
  return [
    {
      label,
      data: [...centers],
      pointBorderColor: tokens.ink,
      pointStyle: 'crossRot' as const,
      pointBorderWidth: CENTROID_HALO_WIDTH,
      pointRadius: CENTROID_RADIUS,
      // 가리켜도 그대로다 — 아래 "표식은 hover에서 안 변한다" 참고.
      pointHoverBorderWidth: CENTROID_HALO_WIDTH,
      pointHoverRadius: CENTROID_RADIUS,
      order: DRAW_ORDER.halo,
    },
    {
      label,
      data: [...centers],
      pointBorderColor: summaries.map((summary) => clusterColor(tokens, summary.cluster)),
      pointStyle: 'crossRot' as const,
      pointBorderWidth: CENTROID_WIDTH,
      pointRadius: CENTROID_RADIUS,
      pointHoverBorderWidth: CENTROID_WIDTH,
      pointHoverRadius: CENTROID_RADIUS,
      order: DRAW_ORDER.centroid,
    },
  ]
}

/**
 * 군집마다 데이터셋 하나, 그 위에 중심점 둘.
 *
 * **중심점을 두 겹으로 그린다** (#28-1의 "✕에 흰 테두리"). `crossRot`은 선으로만
 * 그려지므로 흰 굵은 선을 먼저 깔고 그 위에 군집 색을 얹는다 — 점이 몰린 자리에서
 * 중심점이 묻히지 않게 하는 것이 흰 테두리의 일이다.
 *
 * **✕는 중심점이지 평균이 아니다** (#28-6). 수렴하지 못한 학습에서 둘이 갈리는데,
 * 그림이 말해야 하는 것은 "가장 가까운 중심점으로 배정된다"는 모델의 규칙이다.
 */
export function clusterChartData(
  scatter: ScatterData,
  summaries: readonly ClusterSummary[],
  axis: { readonly x: number; readonly y: number },
  tokens: ClusterChartTokens,
  text: Pick<ClusterChartText, 'clusterName' | 'centroid' | 'highlight'>,
  highlight?: ClusterHighlight | undefined,
  scales: ClusterAxisScales = {},
): ChartData<'scatter'> {
  /**
   * **범주 축에서는 ✕를 안 그린다** (`open-decisions.md` "군집 산점도의 축").
   * 원핫 공간의 중심점은 그 열에서 좌표가 `0.3/0.7`이라 칸 하나에 올릴 정직한 방법이
   * 없다 — 가장 무거운 범주에 놓으면 "이 군집의 중심은 그 범주다"라고 말하게 된다.
   * 그 자리는 군집 요약표가 최빈 범주로 답한다.
   */
  const drawsCentroid = scales.x === undefined && scales.y === undefined

  const clusters = summaries.map((summary) => ({
    label: text.clusterName(summary.cluster),
    data: scatter.points
      .filter((point) => point.cluster === summary.cluster)
      .map((point) => ({
        x: placed(point.values[axis.x] ?? 0, point.row, scales.x),
        y: placed(point.values[axis.y] ?? 0, point.row, scales.y),
      })),
    pointBackgroundColor: clusterColor(tokens, summary.cluster),
    pointBorderColor: clusterColor(tokens, summary.cluster),
    pointStyle: clusterShape(tokens, summary.cluster),
    pointRadius: POINT_RADIUS,
    order: DRAW_ORDER.points,
  }))

  const centers = summaries.map((summary) => ({
    x: summary.centroid[axis.x] ?? 0,
    y: summary.centroid[axis.y] ?? 0,
  }))

  return {
    datasets: [
      ...clusters,
      ...(drawsCentroid ? centroidLayers(centers, summaries, tokens, text.centroid) : []),
      // **맨 위이고, 맨 뒤다** (#28-7). 위에 그려져야 점에 안 묻히고, 배열 끝이어야
      // 흰 테두리의 자리(`haloIndex`)가 안 밀린다.
      ...(highlight
        ? [
            {
              label: text.highlight ?? '',
              data: [{ x: highlight.values[axis.x] ?? 0, y: highlight.values[axis.y] ?? 0 }],
              // **채워진 도형이다.** ✕처럼 선으로만 그려지는 모양은 점이 몰린 자리에서
              // 묻힌다. 마름모는 군집이 쓰는 세 모양과 겹치지 않는다 (#28-3).
              pointBackgroundColor: clusterColor(tokens, highlight.cluster),
              // 중심점과 같은 이유로 배경색이 아니라 글자색이다 (#28-7).
              pointBorderColor: tokens.ink,
              pointStyle: 'rectRot' as const,
              pointBorderWidth: HIGHLIGHT_BORDER_WIDTH,
              pointRadius: HIGHLIGHT_RADIUS,
              pointHoverBorderWidth: HIGHLIGHT_BORDER_WIDTH,
              pointHoverRadius: HIGHLIGHT_RADIUS,
              order: DRAW_ORDER.highlight,
            },
          ]
        : []),
    ],
  }
}

/**
 * 그림의 나머지 규칙.
 *
 * - **애니메이션을 끈다.** `limits.ts`의 `CLUSTER_SCATTER_POINT_LIMIT`이 이 줄에 매여
 *   있다 — 상한의 근거가 된 실측이 `animation: false`에서 나왔다 (#28-5).
 * - **가리킨 것 하나만 말한다.** 산점도의 기본 모드는 `point`라 커서 아래에 겹친 점을
 *   전부 세운다.
 * - **표식은 hover에서 안 변한다.** Chart.js의 `pointHoverRadius` 기본값이 4이고
 *   `pointHoverBorderWidth`가 1이라, 우리가 키운 중심점(9·6)과 입력한 값(10·3)만
 *   가리키는 순간 기본값으로 **쪼그라들었다 돌아온다.** 중심점과 데이터 점이 같은 자리에
 *   겹치면 커서가 1px만 움직여도 어느 쪽이 잡혔는지가 바뀌어 **표식이 계속 떨렸다**
 *   (2026-08-14). 데이터 점은 반지름이 4라 기본값과 같아 처음부터 안 떨렸다.
 * - **툴팁을 가리킨 것에 붙인다.** 기본값(`average`)은 잡힌 것들의 한가운데에 상자를
 *   놓는데, 겹친 자리에서는 그 집합이 바뀔 때마다 상자가 헤엄친다.
 * - **범례는 그리는 차례를 따라가지 않는다.** Chart.js가 범례 항목도 `order`로
 *   정렬하므로, 그대로 두면 중심점이 맨 앞에 선다.
 */
export function clusterChartOptions(
  clusterCount: number,
  tokens: ClusterChartTokens,
  text: Omit<ClusterChartText, 'clusterName' | 'centroid'>,
  scales: ClusterAxisScales = {},
): ChartOptions<'scatter'> {
  const halo = haloIndex(clusterCount, scales.x === undefined && scales.y === undefined)

  /**
   * 범주 축의 눈금. **선형 축에 정수 눈금을 세우고 이름을 붙인다** — Chart.js의
   * `category` 축은 칸 사이(흩뿌린 자리)에 점을 놓을 수 없다.
   *
   * `min`·`max`가 반 칸씩 밖으로 나가는 이유는 **양 끝 칸의 구름이 잘리지 않게** 하려는
   * 것이다. 흩뿌림이 ±0.3이라 그 안에 들어온다.
   */
  const categoryScale = (categories: readonly string[]) => ({
    min: -0.5,
    max: categories.length - 0.5,
    ticks: {
      color: tokens.ink,
      stepSize: 1,
      autoSkip: false,
      callback: (value: string | number) => categories[Math.round(Number(value))] ?? '',
    },
  })

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: true },
    /**
     * **축 선도 격자와 같은 색을 쓴다.** 안 주면 Chart.js가 자기 기본값
     * (`rgba(0,0,0,0.1)`)으로 그리는데, 그 색은 배색을 안 따라간다 — 어두운 배색에서는
     * 안 보이고 밝은 배색에서는 격자와 다른 회색이 된다. 우리 선 색은 토큰 하나뿐이다.
     */
    scales: {
      x: {
        title: { display: true, text: text.axisX, color: tokens.ink },
        ticks: { color: tokens.ink },
        grid: { color: tokens.line },
        border: { color: tokens.line },
        ...(scales.x ? categoryScale(scales.x) : {}),
      },
      y: {
        title: { display: true, text: text.axisY, color: tokens.ink },
        ticks: { color: tokens.ink },
        grid: { color: tokens.line },
        border: { color: tokens.line },
        ...(scales.y ? categoryScale(scales.y) : {}),
      },
    },
    plugins: {
      legend: {
        labels: {
          color: tokens.ink,
          usePointStyle: true,
          filter: (item) => item.datasetIndex !== halo,
          sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
        },
      },
      tooltip: {
        position: 'nearest',
        usePointStyle: true,
        filter: (item) => item.datasetIndex !== halo,
        callbacks: {
          label: (item) => text.point(item.dataset.label ?? '', item.parsed.x, item.parsed.y),
        },
      },
    },
  }
}
