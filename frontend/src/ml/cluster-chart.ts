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

/** 화면이 번역해 넘기는 문구. 이 계층은 `t()`를 모른다. */
export interface ClusterChartText {
  readonly clusterName: (cluster: number) => string
  readonly centroid: string
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
export const DRAW_ORDER = { points: 2, halo: 1, centroid: 0 } as const

/**
 * 점의 크기와 획. **`radius`가 아니라 `pointRadius`다.**
 *
 * 산점도 데이터셋의 이름 없는 `radius`·`borderColor`·`borderWidth`는 **선 요소의 것**이고
 * (산점도는 선을 안 그린다) 점에 닿는 이름은 `point*`다. 타입이 그것을 알고 있어서,
 * 화면 밖으로 빼는 순간 컴파일러가 잡았다 — 화면에 있을 때는 통과했다.
 */
const POINT_RADIUS = 4
const CENTROID_RADIUS = 9
/** 흰 테두리가 군집 색보다 굵어야 테두리로 보인다. */
const CENTROID_HALO_WIDTH = 6
const CENTROID_WIDTH = 3

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
 */
export function haloIndex(clusterCount: number): number {
  return clusterCount
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
  text: Pick<ClusterChartText, 'clusterName' | 'centroid'>,
): ChartData<'scatter'> {
  const clusters = summaries.map((summary) => ({
    label: text.clusterName(summary.cluster),
    data: scatter.points
      .filter((point) => point.cluster === summary.cluster)
      .map((point) => ({ x: point.values[axis.x] ?? 0, y: point.values[axis.y] ?? 0 })),
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
      {
        label: text.centroid,
        data: centers,
        pointBorderColor: tokens.surface,
        pointStyle: 'crossRot' as const,
        pointBorderWidth: CENTROID_HALO_WIDTH,
        pointRadius: CENTROID_RADIUS,
        order: DRAW_ORDER.halo,
      },
      {
        label: text.centroid,
        data: centers,
        pointBorderColor: summaries.map((summary) => clusterColor(tokens, summary.cluster)),
        pointStyle: 'crossRot' as const,
        pointBorderWidth: CENTROID_WIDTH,
        pointRadius: CENTROID_RADIUS,
        order: DRAW_ORDER.centroid,
      },
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
 * - **범례는 그리는 차례를 따라가지 않는다.** Chart.js가 범례 항목도 `order`로
 *   정렬하므로, 그대로 두면 중심점이 맨 앞에 선다.
 */
export function clusterChartOptions(
  clusterCount: number,
  tokens: ClusterChartTokens,
  text: Omit<ClusterChartText, 'clusterName' | 'centroid'>,
): ChartOptions<'scatter'> {
  const halo = haloIndex(clusterCount)

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'nearest', intersect: true },
    scales: {
      x: {
        title: { display: true, text: text.axisX, color: tokens.ink },
        ticks: { color: tokens.ink },
        grid: { color: tokens.line },
      },
      y: {
        title: { display: true, text: text.axisY, color: tokens.ink },
        ticks: { color: tokens.ink },
        grid: { color: tokens.line },
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
        usePointStyle: true,
        filter: (item) => item.datasetIndex !== halo,
        callbacks: {
          label: (item) => text.point(item.dataset.label ?? '', item.parsed.x, item.parsed.y),
        },
      },
    },
  }
}
