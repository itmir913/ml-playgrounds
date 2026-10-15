/**
 * 군집 산점도의 넓은 축 (`ml/cluster-plot.ts`, `open-decisions.md` 115).
 *
 * 지키는 것 — 그림 하나에 규칙 하나(특성 둘이면 받은 재료 그대로, 하나라도 아니면 두 축 모두
 * 원본 칸), 특성이 앞, 새 점이 있으면 특성뿐, 행 번호 대조, 데이터 화면과 같은 점.
 */

import { describe, expect, it } from 'vitest'

import { scatterRows } from '../src/data/stats'
import { drawsCentroid } from '../src/ml/cluster-chart'
import { clusterPlot, plotAxes, plotAxesKey, rawColumnReader } from '../src/ml/cluster-plot'
import type { ClusterMaterial, ClusterSummary, ScatterData } from '../src/ml/clusters'
import type { Dataset } from '../src/ml/preprocess'

/** 깊이·규모로 묶고 위도·지역은 안 쓴 표. 4번 행은 학습에서 빠졌다. */
const DATASET: Dataset = {
  columns: ['깊이', '규모', '위도', '지역', '빈열'],
  rows: [
    ['10', '5', '35.1', '남', ''],
    ['', '6', '', '북', ''],
    ['', '4', '36.0', '', ''],
    ['40', '', '37.5', '남', ''],
    ['50', '7', '38.0', '북', ''],
  ],
}

const TRAIN_ROWS = [0, 1, 2, 3]

function material(rows: readonly number[] = TRAIN_ROWS): ClusterMaterial {
  return {
    columns: [
      { name: '깊이', column: { name: '깊이', kind: 'numeric', fill: 25 } },
      { name: '규모', column: { name: '규모', kind: 'numeric', fill: 5 } },
    ],
    axes: [
      { name: '깊이', index: 0, width: 1 },
      { name: '규모', index: 1, width: 1 },
    ],
    matrix: [
      [10, 5],
      [25, 6],
      [25, 4],
      [40, 5],
    ],
    assignment: {
      rows,
      clusters: Int32Array.from([0, 1, 0, 1]),
      distances: new Float64Array(4),
      counts: Int32Array.from([2, 2]),
      centroids: [
        [20, 4.5],
        [32.5, 5.5],
      ],
    },
  }
}

const SUMMARIES: ClusterSummary[] = [
  { cluster: 0, size: 2, means: [20, 4.5], centroid: [20, 4.5] },
  { cluster: 1, size: 2, means: [32.5, 5.5], centroid: [32.5, 5.5] },
]

const SCATTER: ScatterData = {
  points: [
    { row: 0, cluster: 0, values: [10, 5] },
    { row: 1, cluster: 1, values: [25, 6] },
    { row: 2, cluster: 0, values: [25, 4] },
    { row: 3, cluster: 1, values: [40, 5] },
  ],
}

function wide(rows?: readonly number[]) {
  return { dataset: DATASET, material: material(rows) }
}

describe('축 후보', () => {
  it('특성이 앞이고 학습에 쓰지 않은 열이 뒤다 - 값이 없는 열은 빠진다', () => {
    const axes = plotAxes(material().axes, wide(), false)
    expect(axes.map((axis) => `${axis.source}:${axis.name}`)).toEqual([
      'feature:깊이',
      'feature:규모',
      'raw:위도',
      'raw:지역',
    ])
  })

  it('새 점이 있으면 특성 축만 준다', () => {
    const axes = plotAxes(material().axes, wide(), true)
    expect(axes.every((axis) => axis.source === 'feature')).toBe(true)
    expect(axes).toHaveLength(2)
  })

  it('새 점이 바뀌어도 이름표는 같다 - 고른 축이 안 돌아간다', () => {
    const first = plotAxes(material().axes, undefined, true)
    const second = plotAxes(material().axes, undefined, true)
    expect(first).not.toBe(second)
    expect(plotAxesKey(first)).toBe(plotAxesKey(second))
    expect(plotAxesKey(first)).not.toBe(plotAxesKey(plotAxes(material().axes, wide(), false)))
  })

  it('넓은 재료가 없으면 특성 축만 준다 - 예측 화면', () => {
    expect(plotAxes(material().axes, undefined, false)).toHaveLength(2)
  })
})

describe('그림 하나에 규칙 하나', () => {
  const source = wide()
  const read = rawColumnReader(DATASET)
  const [depth, size, latitude, region] = plotAxes(material().axes, source, false)

  it('두 축이 특성이면 받은 재료를 그대로 넘기고 채운 행 수를 센다', () => {
    const plot = clusterPlot(material().axes, SCATTER, SUMMARIES, depth!, size!, source, read)
    expect(plot.raw).toBe(false)
    expect(plot.scatter).toBe(SCATTER)
    expect(plot.axis).toEqual({ x: 0, y: 1 })
    // 1·2번 행은 깊이가, 3번 행은 규모가 비어 채운 자리에 있다.
    expect(plot.filled).toBe(3)
    expect(drawsCentroid(plot.scales)).toBe(true)
  })

  it('하나라도 특성이 아니면 두 축 모두 원본 칸이고 빈 행은 뺀다', () => {
    const plot = clusterPlot(material().axes, SCATTER, SUMMARIES, depth!, latitude!, source, read)
    expect(plot.raw).toBe(true)
    // 2번 행은 위도가 있지만 깊이의 원본이 빈 칸이라 빠진다 - 채운 25로 찍지 않는다.
    expect(plot.scatter.points).toEqual([
      { row: 0, cluster: 0, values: [10, 35.1] },
      { row: 3, cluster: 1, values: [40, 37.5] },
    ])
    expect(plot.dropped).toBe(2)
    expect(plot.filled).toBe(0)
    expect(drawsCentroid({ ...plot.scales, raw: plot.raw })).toBe(false)
  })

  it('학습에서 빠진 행은 그리지 않는다', () => {
    const plot = clusterPlot(material().axes, SCATTER, SUMMARIES, latitude!, region!, source, read)
    expect(plot.scatter.points.map((point) => point.row)).not.toContain(4)
    expect(plot.scales.y).toEqual(['남', '북'])
  })

  it('같은 두 열이면 데이터 화면과 같은 점을 찍는다', () => {
    const plot = clusterPlot(material().axes, SCATTER, SUMMARIES, latitude!, region!, source, read)
    const xCells = TRAIN_ROWS.map((row) => DATASET.rows[row]![2]!)
    const yCells = TRAIN_ROWS.map((row) => DATASET.rows[row]![3]!)
    const data = scatterRows(xCells, yCells, undefined, { y: ['남', '북'] })
    expect(plot.scatter.points.map((point) => point.values)).toEqual(
      data.points.map((point) => [point.x, point.y]),
    )
    expect(plot.dropped).toBe(data.skipped)
  })

  it('배정의 행이 표 밖을 가리키면 던진다 - 다른 행을 조용히 그리지 않는다', () => {
    const broken = wide([0, 1, 2, 9])
    expect(() =>
      clusterPlot(material().axes, SCATTER, SUMMARIES, depth!, latitude!, broken, read),
    ).toThrow()
  })
})

describe('원본 열 읽기', () => {
  it('열마다 한 번만 읽는다', () => {
    const read = rawColumnReader(DATASET)
    expect(read('위도')).toBe(read('위도'))
  })
})
