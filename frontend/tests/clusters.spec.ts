/**
 * 군집 결과의 재료 (`ml/clusters.ts`).
 *
 * **눈으로 확인할 수 없는 규칙만 모여 있는 자리다.** 산점도는 그럴듯하게 그려지면서
 * 틀릴 수 있다 — 축이 한 칸 밀려도, 되돌리기가 빠져도, 표본이 매번 달라져도 그림은
 * 나온다. 그래서 여기가 vitest가 덮어야 하는 쪽이다 (CLAUDE.md §4).
 *
 * **진짜 입구로 재현한다.** 행렬을 손으로 조립하지 않고 `fitPreprocessor` →
 * `transform` → `fitKMeans`를 실제로 지나간다 — 전처리기와 모델이 실물로 맞물리는
 * 자리가 이 파일이 지키려는 것이기 때문이다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import {
  assignClusters,
  clusterAxes,
  clusterMembers,
  clusterSummaries,
  matrixColumns,
  scatterPoints,
  unscale,
} from '../src/ml/clusters'
import { fitKMeans } from '../src/ml/engines/mljs-kmeans'
import { KMEANS_FORMAT, kmeansPredict, type KMeansModel } from '../src/ml/models'
import {
  fitPreprocessor,
  transform,
  usableRows,
  type Dataset,
  type Preprocessor,
} from '../src/ml/preprocess'
import type { Preprocessing } from '../src/project/schema'

/**
 * 두 덩어리로 갈리는 교실풍 표. **학습에 안 쓰는 열(`이름`)과 범주 열과 빈 칸이 하나씩
 * 있다** — 셋 다 이 파일이 확인해야 하는 자리를 만든다.
 */
const DATASET: Dataset = {
  columns: ['이름', '키', '몸무게', '성별'],
  rows: [
    ['가', '150', '40', '남'],
    ['나', '151', '41', '여'],
    ['다', '152', '42', '남'],
    ['라', '153', '', '여'],
    ['마', '180', '80', '남'],
    ['바', '181', '81', '여'],
    ['사', '182', '82', '남'],
    ['아', '183', '83', '여'],
  ],
}

/**
 * **범주 열이 앞에 온다.** 원핫이 두 칸으로 늘어나므로 수치 축의 행렬 열 번호가
 * 0·1이 아니게 된다 — 수치 열을 앞에 두면 축 색인이 밀려도 검사가 못 잡는다.
 */
const FEATURES = ['성별', '키', '몸무게']
const RANDOM_STATE = 42

function preprocessing(overrides: Partial<Preprocessing> = {}): Preprocessing {
  return { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot', ...overrides }
}

/** 전처리기 · 학습 행렬 · 학습된 모델까지 실제 경로로 만든다. */
function fixture(options: Preprocessing = preprocessing(), k = 2) {
  const rows = usableRows(DATASET, FEATURES, undefined, options.missing)
  const preprocessor = fitPreprocessor(DATASET, rows, FEATURES, options)
  const matrix = transform(preprocessor, DATASET, rows, options.categoricalEncoding)
  const fitted = fitKMeans(matrix, k, RANDOM_STATE)
  const model: KMeansModel = {
    format: KMEANS_FORMAT,
    featureCount: preprocessor.featureNames.length,
    k,
    centroids: fitted.centroids,
  }
  return { rows, preprocessor, matrix, model, options }
}

/** 원본 표의 수치 값. 빈 칸은 `null`이다. */
function rawValue(row: number, column: string): number | null {
  const cell = DATASET.rows[row]?.[DATASET.columns.indexOf(column)] ?? ''
  return cell === '' ? null : Number(cell)
}

describe('축 후보', () => {
  it('수치 칸만 남고 행렬 열 번호가 맞는다', () => {
    const { preprocessor } = fixture()

    // 원핫이라 성별이 두 칸으로 늘어난다. 그 둘은 값이 0/1뿐이라 축이 아니다.
    expect(preprocessor.featureNames).toEqual(['성별=남', '성별=여', '키', '몸무게'])
    expect(clusterAxes(preprocessor, 'onehot')).toEqual([
      { name: '키', index: 2 },
      { name: '몸무게', index: 3 },
    ])
  })

  it('ordinal이면 범주 열이 한 칸이지만 여전히 축이 아니다', () => {
    const options = preprocessing({ categoricalEncoding: 'ordinal' })
    const { preprocessor } = fixture(options)

    expect(preprocessor.featureNames).toEqual(['성별', '키', '몸무게'])
    expect(clusterAxes(preprocessor, 'ordinal').map((axis) => axis.name)).toEqual(['키', '몸무게'])
  })

  it('fit 때와 다른 인코딩으로 부르면 시끄럽게 실패한다', () => {
    // **어긋나는 유일한 경로다.** featureNames는 fit 시점의 인코딩으로 늘어난 이름이고
    // 행렬은 인자로 받은 인코딩으로 늘어난 값이라, 조용히 지나가면 축이 한 칸 밀린다.
    const { preprocessor } = fixture()

    try {
      matrixColumns(preprocessor, 'ordinal')
      expect.unreachable('던졌어야 한다')
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('MODEL_FILE_INVALID')
      expect(isClientError(error) && error.params['field']).toBe('featureNames')
    }
  })
})

describe('스케일 되돌리기', () => {
  it('되돌린 좌표가 원본 표의 값이다', () => {
    const { preprocessor, matrix, rows, options } = fixture()
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)

    rows.forEach((row, index) => {
      const raw = rawValue(row, '키')
      expect(unscale(columns[2]!.column, matrix[index]![2]!)).toBeCloseTo(raw!, 9)
    })
  })

  it('결측을 채운 칸은 원본에 없는 값이 된다 — 그림과 표가 갈리는 자리다', () => {
    const { preprocessor, matrix, rows, options } = fixture()
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)
    const position = rows.indexOf(3)

    // 원본 표에서는 빈 칸이다. 모델이 본 것은 채워진 값이고, 그림에는 자리가 있다.
    expect(rawValue(3, '몸무게')).toBeNull()
    const filled = unscale(columns[3]!.column, matrix[position]![3]!)
    const present = [40, 41, 42, 80, 81, 82, 83]
    expect(filled).toBeCloseTo(present.reduce((sum, one) => sum + one, 0) / present.length, 9)
  })

  it('스케일링을 껐으면 항등이다', () => {
    const options = preprocessing({ scaling: 'none' })
    const { preprocessor, matrix, rows } = fixture(options)
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)

    expect(columns[2]!.column.scale).toBeUndefined()
    expect(unscale(columns[2]!.column, matrix[0]![2]!)).toBe(rawValue(rows[0]!, '키'))
  })
})

describe('배정 되계산', () => {
  it('해석기가 준 것과 같고 모든 행이 한 군집에 든다', () => {
    const { matrix, rows, model } = fixture()
    const assignment = assignClusters(matrix, rows, model)

    const expected = kmeansPredict(model)(matrix).map(Number)
    expect([...assignment.clusters]).toEqual(expected)
    expect([...assignment.counts].reduce((sum, one) => sum + one, 0)).toBe(rows.length)
    // 두 덩어리가 멀찍이 떨어져 있으므로 앞 넷과 뒤 넷이 갈린다.
    expect(new Set(expected.slice(0, 4)).size).toBe(1)
    expect(new Set(expected.slice(4)).size).toBe(1)
    expect(expected[0]).not.toBe(expected[4])
  })

  it('거리는 자기 중심점까지의 것이다', () => {
    const { matrix, rows, model } = fixture()
    const assignment = assignClusters(matrix, rows, model)

    assignment.rows.forEach((_row, index) => {
      const centroid = model.centroids[assignment.clusters[index]!]!
      const own = matrix[index]!.reduce(
        (sum, value, j) => sum + (value - (centroid[j] ?? 0)) ** 2,
        0,
      )
      expect(assignment.distances[index]).toBeCloseTo(own, 9)
    })
  })

  it('행렬과 행 번호의 길이가 다르면 던진다', () => {
    const { matrix, rows, model } = fixture()
    try {
      assignClusters(matrix, rows.slice(1), model)
      expect.unreachable('던졌어야 한다')
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('MODEL_FILE_INVALID')
    }
  })
})

describe('군집 요약', () => {
  it('평균은 그 군집 구성원의 되돌린 값 평균이다', () => {
    // **이 검사가 #28-6의 근거 문장을 지킨다** — "중심점이 곧 그 군집의 평균"이 깨지면
    // 요약표가 조용히 다른 것을 말한다.
    const { preprocessor, matrix, rows, model, options } = fixture()
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)
    const axes = clusterAxes(preprocessor, options.categoricalEncoding)
    const assignment = assignClusters(matrix, rows, model)
    const summaries = clusterSummaries(assignment, axes, columns)

    for (const summary of summaries) {
      axes.forEach((axis, position) => {
        const own = matrix.filter((_row, index) => assignment.clusters[index] === summary.cluster)
        const mean =
          own.reduce(
            (sum, row) => sum + unscale(columns[axis.index]!.column, row[axis.index]!),
            0,
          ) / own.length
        expect(summary.means[position]).toBeCloseTo(mean, 9)
      })
      expect(summary.size).toBe(assignment.counts[summary.cluster])
    }
  })

  it('빈 군집도 줄을 갖는다', () => {
    // 남이 편집한 파일이나 데이터가 바뀐 경우에 실제로 온다. 감추면 군집 번호가
    // 중간에서 건너뛰고, 학생은 3번 군집이 어디 갔는지 묻는다.
    const { preprocessor, matrix, rows, options } = fixture()
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)
    const axes = clusterAxes(preprocessor, options.categoricalEncoding)
    const width = preprocessor.featureNames.length
    const model: KMeansModel = {
      format: KMEANS_FORMAT,
      featureCount: width,
      k: 3,
      centroids: [matrix[0]!, matrix[7]!, new Array<number>(width).fill(1e6)],
    }

    const summaries = clusterSummaries(assignClusters(matrix, rows, model), axes, columns)
    expect(summaries).toHaveLength(3)
    expect(summaries[2]!.size).toBe(0)
  })
})

describe('구성원', () => {
  it('중심점에 가까운 순으로 원본 행 번호를 준다', () => {
    const { matrix, rows, model } = fixture()
    const assignment = assignClusters(matrix, rows, model)
    const cluster = assignment.clusters[0]!
    const members = clusterMembers(assignment, cluster, 10)

    expect(members).toHaveLength(4)
    // 전부 그 군집이고, 거리가 오름차순이다.
    const distanceOf = (row: number): number => assignment.distances[assignment.rows.indexOf(row)]!
    members.forEach((row) =>
      expect(assignment.clusters[assignment.rows.indexOf(row)]).toBe(cluster),
    )
    for (let i = 1; i < members.length; i += 1) {
      expect(distanceOf(members[i]!)).toBeGreaterThanOrEqual(distanceOf(members[i - 1]!))
    }
  })

  it('상한만큼만 준다', () => {
    const { matrix, rows, model } = fixture()
    const assignment = assignClusters(matrix, rows, model)
    expect(clusterMembers(assignment, assignment.clusters[0]!, 2)).toHaveLength(2)
  })

  it('거리가 같으면 행 번호가 앞선 것이 앞이다', () => {
    // 같은 값이 여러 번 들어 있는 표는 교실에서 흔하다. 순서가 안 정해지면 같은
    // 파일을 두 번 열어 다른 표를 본다.
    const rows = [0, 1, 2]
    const model: KMeansModel = {
      format: KMEANS_FORMAT,
      featureCount: 1,
      k: 1,
      centroids: [[0]],
    }
    const assignment = assignClusters([[1], [-1], [0]], rows, model)
    expect(clusterMembers(assignment, 0, 3)).toEqual([2, 0, 1])
  })
})

describe('표본 뽑기', () => {
  function scatterOf(preprocessor: Preprocessor, limit: number, seed = RANDOM_STATE) {
    const { matrix, rows, model } = fixture()
    const columns = matrixColumns(preprocessor, 'onehot')
    const axes = clusterAxes(preprocessor, 'onehot')
    const assignment = assignClusters(matrix, rows, model)
    return scatterPoints(assignment, axes, columns, matrix, limit, seed)
  }

  it('상한 이하면 전부 그린다', () => {
    const { preprocessor } = fixture()
    const scatter = scatterOf(preprocessor, 100)

    expect(scatter.drawn).toBe(8)
    expect(scatter.total).toBe(8)
    expect(scatter.points.map((point) => point.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('넘으면 상한만큼 뽑고 그 사실이 남는다', () => {
    const { preprocessor } = fixture()
    const scatter = scatterOf(preprocessor, 3)

    expect(scatter.drawn).toBe(3)
    expect(scatter.total).toBe(8)
    // 원래 순서대로 돌려준다 - 그리는 순서가 표본 뽑기의 부산물로 흔들리지 않는다.
    const drawn = scatter.points.map((point) => point.row)
    expect([...drawn].sort((a, b) => a - b)).toEqual(drawn)
  })

  it('같은 시드면 같은 표본이고 다른 시드면 갈린다', () => {
    const { preprocessor } = fixture()
    const rowsOf = (seed: number): number[] =>
      scatterOf(preprocessor, 3, seed).points.map((point) => point.row)

    expect(rowsOf(RANDOM_STATE)).toEqual(rowsOf(RANDOM_STATE))
    // 8개 중 3개를 뽑는 조합이 56가지라, 시드를 바꿔 같은 표본이 나오는 것은 사고가
    // 아니다. 여러 시드 중 하나라도 갈리면 시드가 실제로 쓰이고 있다는 뜻이다.
    const others = [1, 2, 3, 7, 11].map((seed) => rowsOf(seed))
    expect(others.some((rows) => rows.join() !== rowsOf(RANDOM_STATE).join())).toBe(true)
  })

  it('점의 좌표는 축 순서를 따르고 되돌린 값이다', () => {
    const { preprocessor } = fixture()
    const scatter = scatterOf(preprocessor, 100)
    const first = scatter.points[0]!

    expect(first.values).toHaveLength(2)
    expect(first.values[0]).toBeCloseTo(rawValue(0, '키')!, 9)
    expect(first.values[1]).toBeCloseTo(rawValue(0, '몸무게')!, 9)
  })
})
