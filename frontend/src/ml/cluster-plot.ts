/**
 * 군집 산점도의 축 고르기와 그릴 점 (`open-decisions.md` "115. 군집 산점도의 축을 학습에
 * 쓰지 않은 열로도 세우는가").
 *
 * **그림 하나에 규칙 하나다.** 고른 두 축이 모두 특성이면 지금까지처럼 훈련 행렬을 되돌린
 * 점이고(결측을 채운 행은 채운 자리에 있다), 하나라도 특성이 아니면 **두 축 모두 원본 칸**이고
 * 빈 행은 빼며 중심점을 안 그린다. 축마다 규칙을 다르게 하면 `깊이`가 빈 행은 채운 자리에
 * 있고 `위도`가 빈 행은 사라지는, 어떤 문장으로도 설명할 수 없는 그림이 된다.
 *
 * **기존 축 목록(`ClusterMaterial.axes`)은 건드리지 않는다.** 요약표·중심점·예측 화면이 그
 * 목록의 **자리**로 값을 찾는다 — 거기에 특성이 아닌 열을 섞으면 요약표에 끼고 한 칸씩 밀린다.
 * 넓은 목록은 이 파일이 따로 만든다.
 *
 * **원본 칸은 데이터 화면의 산점도와 같은 길로 읽는다** (`data/stats.ts`). 같은 두 열이면 두
 * 화면이 같은 점을 찍어야 한다 — 무는 검사: `tests/cluster-plot.spec.ts`.
 */

import { categoriesOf, columnCells, scatterRows } from '@/data/stats'
import { ClientError } from '../errors'
import { detectKind, isMissing, type Dataset } from './preprocess'
import type { ClusterAxis, ClusterMaterial, ClusterSummary, ScatterData } from './clusters'

/**
 * 고를 수 있는 축 하나. **어디서 값을 읽는지를 축이 스스로 말한다.**
 *
 * - `feature` — 학습에 쓴 열. `position`은 `ClusterMaterial.axes` 안의 자리다.
 * - `raw` — 학습에 쓰지 않은 열. 원본 칸에서만 읽는다. 전처리에서 뺀 열과 처음부터 안 고른
 *   열을 가르지 않는다 — 둘 다 모델이 안 본 열이다 (#115).
 */
export type PlotAxis =
  | { readonly source: 'feature'; readonly name: string; readonly position: number }
  | { readonly source: 'raw'; readonly name: string }

/**
 * 넓은 그림의 재료. **결과 화면만 만든다** — 예측 화면의 새 점은 특성 값뿐이라 특성이 아닌
 * 축에는 자리가 없다 (#115).
 */
export interface WidePlotSource {
  readonly dataset: Dataset
  readonly material: ClusterMaterial
}

/**
 * 축 후보. **특성이 앞이다** — 첫 화면(처음 두 축)이 지금까지와 같아야 한다.
 *
 * **새 점이 있으면 특성뿐이다.** 그 점은 학생이 넣은 특성 값이라 다른 축에 놓을 좌표가 없다.
 * 부품이 이 판정을 따로 하지 않도록 여기 둔다 — 무는 검사: `tests/cluster-plot.spec.ts`
 * "새 점이 있으면 특성 축만 준다".
 *
 * 특성이 아닌 열 가운데 **값이 하나도 없는 열은 뺀다** — 눈금이 설 자리가 없다
 * (`clusterAxes`가 범주가 없는 열을 빼는 것과 같은 이유다).
 */
export function plotAxes(
  axes: readonly ClusterAxis[],
  wide: WidePlotSource | undefined,
  hasHighlight: boolean,
): PlotAxis[] {
  const features: PlotAxis[] = axes.map((axis, position) => ({
    source: 'feature',
    name: axis.name,
    position,
  }))
  if (!wide || hasHighlight) return features

  const trained = new Set(wide.material.columns.map((entry) => entry.column.name))
  const raw: PlotAxis[] = wide.dataset.columns
    .filter((name) => !trained.has(name))
    .filter((name) => columnCells(wide.dataset, name).some((cell) => !isMissing(cell)))
    .map((name) => ({ source: 'raw', name }))
  return [...features, ...raw]
}

/**
 * 축 목록의 이름표. **고른 축을 처음으로 되돌릴지는 이것으로 판정한다.**
 *
 * 목록 배열은 새 점이 바뀔 때마다 새로 만들어진다 — 배열을 그대로 감시하면 예측 화면에서
 * 값을 하나 고칠 때마다 학생이 고른 축이 처음 둘로 돌아갔다 (115 diff 감사 A). 무는 검사:
 * `tests/cluster-plot.spec.ts` "새 점이 바뀌어도 이름표는 같다".
 */
export function plotAxesKey(axes: readonly PlotAxis[]): string {
  return JSON.stringify(axes.map((axis) => [axis.source, axis.name]))
}

/** 원본 열 하나를 축으로 읽을 준비. 범주 열이면 범주 목록이 있다. */
interface RawColumn {
  readonly cells: readonly string[]
  readonly categories?: readonly string[] | undefined
}

/**
 * 원본 열을 **열마다 한 번만** 읽는다. 축을 바꿀 때마다 칸을 다시 파싱하면
 * `CLUSTER_SCATTER_POINT_LIMIT`의 근거가 된 다시 그리기 시간에 그 몫이 얹힌다 (#115).
 *
 * **자료형은 데이터 화면과 같은 판정이다** — `detectKind`(열 요약이 쓰는 것)와 `categoriesOf`.
 */
export function rawColumnReader(dataset: Dataset): (name: string) => RawColumn {
  const cache = new Map<string, RawColumn>()
  return (name) => {
    const found = cache.get(name)
    if (found) return found
    const cells = columnCells(dataset, name)
    const column: RawColumn =
      detectKind(cells) === 'categorical' ? { cells, categories: categoriesOf(cells) } : { cells }
    cache.set(name, column)
    return column
  }
}

/** 그릴 그림 한 벌. `clusterChartData`가 그대로 받는다. */
export interface ClusterPlot {
  readonly scatter: ScatterData
  readonly summaries: readonly ClusterSummary[]
  /** `scatter`의 `values`와 `summaries`의 `centroid` 안의 자리. */
  readonly axis: { readonly x: number; readonly y: number }
  readonly scales: {
    readonly x?: readonly string[] | undefined
    readonly y?: readonly string[] | undefined
  }
  /** 원본 칸으로 그린 그림인가. **그때는 중심점이 없다.** */
  readonly raw: boolean
  /** 원본 칸 그림에서 두 열 중 하나라도 비어 뺀 행 수. 특성 그림에서는 0이다. */
  readonly dropped: number
  /**
   * 특성 그림에서 **결측을 채운 자리에 찍힌** 행 수 — 고른 두 열 중 하나라도 원본 칸이 빈 행이다.
   * 원본을 볼 수 없는 화면(예측)에서는 0이다.
   */
  readonly filled: number
}

/**
 * 고른 두 축으로 그릴 그림을 만든다.
 *
 * **두 축이 다 특성이면 받은 재료를 그대로 넘긴다** — 지금까지의 그림과 한 점도 다르지 않아야
 * 한다. 하나라도 특성이 아니면 원본 칸으로 다시 읽는다.
 *
 * **행 번호를 대조한다.** 배정의 행이 표 밖을 가리키면 데이터가 바뀐 파일이다 — 조용히 다른
 * 행을 그리지 않고 던진다(재료 함수는 실패를 감추지 않는다, `clusterMaterial`).
 */
export function clusterPlot(
  axes: readonly ClusterAxis[],
  scatter: ScatterData,
  summaries: readonly ClusterSummary[],
  x: PlotAxis,
  y: PlotAxis,
  wide: WidePlotSource | undefined,
  read: ((name: string) => RawColumn) | undefined,
): ClusterPlot {
  if (x.source === 'feature' && y.source === 'feature') {
    return {
      scatter,
      summaries,
      axis: { x: x.position, y: y.position },
      scales: { x: axes[x.position]?.categories, y: axes[y.position]?.categories },
      raw: false,
      dropped: 0,
      filled: wide && read ? filledRows(wide, read, [x.name, y.name]) : 0,
    }
  }

  // 특성이 아닌 축은 넓은 재료에서만 나온다(`plotAxes`). 없으면 부르는 쪽의 잘못이다.
  if (!wide || !read) throw new ClientError('MODEL_FILE_INVALID', { field: 'trainIndices' })

  const rows = trainRows(wide)
  const xColumn = read(x.name)
  const yColumn = read(y.name)
  const picked = scatterRows(
    rows.map((row) => xColumn.cells[row] ?? ''),
    rows.map((row) => yColumn.cells[row] ?? ''),
    undefined,
    { x: xColumn.categories, y: yColumn.categories },
  )
  const { assignment } = wide.material

  return {
    scatter: {
      points: picked.points.map((point) => ({
        row: rows[point.row]!,
        cluster: assignment.clusters[point.row] ?? 0,
        values: [point.x, point.y],
      })),
    },
    summaries,
    axis: { x: 0, y: 1 },
    scales: { x: xColumn.categories, y: yColumn.categories },
    raw: true,
    dropped: picked.skipped,
    filled: 0,
  }
}

/** 배정의 행 번호. **표 밖을 가리키면 던진다.** */
function trainRows(wide: WidePlotSource): readonly number[] {
  const rows = wide.material.assignment.rows
  const count = wide.dataset.rows.length
  for (const row of rows) {
    if (!Number.isInteger(row) || row < 0 || row >= count) {
      throw new ClientError('MODEL_FILE_INVALID', { field: 'trainIndices' })
    }
  }
  return rows
}

/** 고른 열들 중 하나라도 원본 칸이 빈 훈련 행의 수. */
function filledRows(
  wide: WidePlotSource,
  read: (name: string) => RawColumn,
  names: readonly string[],
): number {
  const rows = trainRows(wide)
  const columns = names.map((name) => read(name).cells)
  let count = 0
  for (const row of rows) {
    if (columns.some((cells) => isMissing(cells[row]))) count += 1
  }
  return count
}
