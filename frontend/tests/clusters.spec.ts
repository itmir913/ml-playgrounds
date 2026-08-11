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
  clusterMaterial,
  clusterMaterialFor,
  clusterMembers,
  clusterSummaries,
  matrixColumns,
  nearestMembers,
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
import type { Experiment, Preprocessing } from '../src/project/schema'

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

/** 중심점 하나짜리 모델. 동점 규칙을 볼 때 쓴다 - 모든 행이 한 군집에 든다. */
const ONE_CENTROID: KMeansModel = {
  format: KMEANS_FORMAT,
  featureCount: 1,
  k: 1,
  centroids: [[0]],
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
  /** 그 군집에 실제로 담긴 행들의, 되돌린 값 평균. 검사가 손으로 다시 구한다. */
  function memberMean(
    matrix: readonly (readonly number[])[],
    assignment: { clusters: Int32Array },
    columns: ReturnType<typeof matrixColumns>,
    cluster: number,
    axisIndex: number,
  ): number {
    const own = matrix.filter((_row, index) => assignment.clusters[index] === cluster)
    return (
      own.reduce((sum, row) => sum + unscale(columns[axisIndex]!.column, row[axisIndex]!), 0) /
      own.length
    )
  }

  it('평균은 그 군집 구성원의 되돌린 값 평균이다', () => {
    const { preprocessor, matrix, rows, model, options } = fixture()
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)
    const axes = clusterAxes(preprocessor, options.categoricalEncoding)
    const assignment = assignClusters(matrix, rows, model)
    const summaries = clusterSummaries(assignment, axes, columns, matrix)

    for (const summary of summaries) {
      axes.forEach((axis, position) => {
        const mean = memberMean(matrix, assignment, columns, summary.cluster, axis.index)
        expect(summary.means[position]).toBeCloseTo(mean, 9)
      })
      expect(summary.size).toBe(assignment.counts[summary.cluster])
    }
  })

  it('수렴하면 평균과 중심점이 같다', () => {
    const { preprocessor, matrix, rows, model, options } = fixture()
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)
    const axes = clusterAxes(preprocessor, options.categoricalEncoding)
    const summaries = clusterSummaries(assignClusters(matrix, rows, model), axes, columns, matrix)

    for (const summary of summaries) {
      summary.means.forEach((mean, position) => {
        expect(mean).toBeCloseTo(summary.centroid[position]!, 9)
      })
    }
  })

  it('수렴하지 못하면 갈리고, 표가 보이는 것은 평균이다', () => {
    // **감사가 연 자리다 (2026-08-11).** `fitKMeans`는 루프를 나온 뒤 최종 중심점으로 한
    // 번 더 배정하는데 그 중심점은 **직전 배정의 평균**이다. 반복 예산이 모자라면 둘이
    // 갈린다. **위의 두 검사는 수렴한 픽스처만 돌아서 이 경우에 구조적으로 실패할 수
    // 없었다** - 그래서 갈리는 픽스처를 따로 세운다.
    //
    // 한 줄 위에 늘어선 12개 · k=2 · 반복 1회. 초기 중심점으로 한 번 가른 평균이
    // 새 경계를 만들고, 그 경계로 다시 가른 무리의 평균은 그 중심점이 아니다.
    const line: Dataset = {
      columns: ['이름', '값'],
      rows: Array.from({ length: 12 }, (_value, index) => [`행-${index}`, String(index)]),
    }
    const features = ['값']
    const options = preprocessing({ scaling: 'none' })
    const rows = usableRows(line, features, undefined, options.missing)
    const preprocessor = fitPreprocessor(line, rows, features, options)
    const matrix = transform(preprocessor, line, rows, options.categoricalEncoding)
    const columns = matrixColumns(preprocessor, options.categoricalEncoding)
    const axes = clusterAxes(preprocessor, options.categoricalEncoding)

    const fitted = fitKMeans(matrix, 2, RANDOM_STATE, 1)
    expect(fitted.converged).toBe(false)

    const model: KMeansModel = {
      format: KMEANS_FORMAT,
      featureCount: preprocessor.featureNames.length,
      k: 2,
      centroids: fitted.centroids,
    }
    const assignment = assignClusters(matrix, rows, model)
    const summaries = clusterSummaries(assignment, axes, columns, matrix)

    // **평균은 언제나 구성원의 평균이다** - 수렴 여부와 무관하다.
    for (const summary of summaries) {
      if (summary.size === 0) continue
      axes.forEach((axis, position) => {
        const mean = memberMean(matrix, assignment, columns, summary.cluster, axis.index)
        expect(summary.means[position]).toBeCloseTo(mean, 9)
      })
    }

    // **그리고 실제로 갈린다.** 갈리지 않으면 위 확인이 아무것도 안 지키므로, 이
    // 픽스처가 여전히 그 경우를 만들고 있는지를 함께 못 박는다.
    const gaps = summaries.flatMap((summary) =>
      summary.means.map((mean, position) => Math.abs(mean - (summary.centroid[position] ?? 0))),
    )
    expect(Math.max(...gaps)).toBeCloseTo(0.5, 9)
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

    const summaries = clusterSummaries(assignClusters(matrix, rows, model), axes, columns, matrix)
    expect(summaries).toHaveLength(3)
    expect(summaries[2]!.size).toBe(0)
    // 나눌 것이 없는 군집은 중심점을 그대로 쓴다 - NaN을 표에 내보내지 않는다.
    expect(summaries[2]!.means).toEqual(summaries[2]!.centroid)
    expect(summaries[2]!.means.every((value) => Number.isFinite(value))).toBe(true)
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
    //
    // **행 번호를 자리 순서와 어긋나게 둔다.** 처음에는 `[0, 1, 2]`로 두었는데, 그러면
    // 동점을 되돌리는 규칙을 통째로 지워도 통과한다 — `sort`가 stable이라 자리 순서가
    // 곧 행 번호 순서였다 (2026-08-11 감사가 잡았다).
    const rows = [5, 3, 9]
    const assignment = assignClusters([[1], [-1], [0]], rows, ONE_CENTROID)
    expect(clusterMembers(assignment, 0, 3)).toEqual([9, 3, 5])
  })
})

describe('재료를 꺼내는 문', () => {
  const settings = (rows: readonly number[], options: Preprocessing) =>
    ({ preprocessing: options, trainIndices: rows }) as Experiment['settings']

  function bytesOf(model: KMeansModel): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(model))
  }

  it('무리로 설명할 수 있는 형식만 재료를 준다', () => {
    // **이 목록이 화면 대신 아는 사실이다** (§9.1). 비면 군집 결과가 통째로 사라지는데,
    // 화면에는 아무 표시도 안 난다.
    const { preprocessor, rows, model, options } = fixture()
    const built = clusterMaterialFor(
      'mlpx-tree-v1',
      bytesOf(model),
      DATASET,
      preprocessor,
      settings(rows, options),
    )
    expect(built).toBeNull()
  })

  it('제대로 주면 손으로 조립한 것과 같다', () => {
    const { preprocessor, rows, model, options } = fixture()
    const built = clusterMaterialFor(
      KMEANS_FORMAT,
      bytesOf(model),
      DATASET,
      preprocessor,
      settings(rows, options),
    )
    expect(built).not.toBeNull()
    expect([...built!.assignment.clusters]).toEqual([
      ...clusterMaterial(DATASET, preprocessor, model, settings(rows, options)).assignment.clusters,
    ])
  })

  it('재료가 하나라도 없으면 null이다', () => {
    const { preprocessor, rows, model, options } = fixture()
    const bytes = bytesOf(model)
    expect(
      clusterMaterialFor(KMEANS_FORMAT, undefined, DATASET, preprocessor, settings(rows, options)),
    ).toBeNull()
    expect(
      clusterMaterialFor(KMEANS_FORMAT, bytes, null, preprocessor, settings(rows, options)),
    ).toBeNull()
    expect(
      clusterMaterialFor(KMEANS_FORMAT, bytes, DATASET, null, settings(rows, options)),
    ).toBeNull()
    expect(
      clusterMaterialFor(undefined, bytes, DATASET, preprocessor, settings(rows, options)),
    ).toBeNull()
  })

  it('못 읽는 바이트는 던지지 않고 null이다', () => {
    // 남이 편집한 파일이다. 여기서 던지면 예측 화면의 답 카드까지 함께 무너진다.
    const { preprocessor, rows, options } = fixture()
    const broken = new TextEncoder().encode('{ 이건 JSON이 아니다')
    expect(
      clusterMaterialFor(KMEANS_FORMAT, broken, DATASET, preprocessor, settings(rows, options)),
    ).toBeNull()
  })
})

describe('재료 조립', () => {
  /** 실험 설정 중 재료가 보는 것만. 스키마 전체를 만들 이유가 없다. */
  function settingsOf(rows: readonly number[], options: Preprocessing) {
    return { preprocessing: options, trainIndices: rows } as Experiment['settings']
  }

  it('손으로 조립한 것과 같다', () => {
    // **두 화면이 각자 조립하면 같은 파일을 놓고 다른 배정을 볼 수 있다.**
    const { preprocessor, matrix, rows, model, options } = fixture()
    const material = clusterMaterial(DATASET, preprocessor, model, settingsOf(rows, options))

    expect(material.matrix).toEqual(matrix)
    expect(material.axes).toEqual(clusterAxes(preprocessor, options.categoricalEncoding))
    expect([...material.assignment.clusters]).toEqual([
      ...assignClusters(matrix, rows, model).clusters,
    ])
  })

  it('그 실험의 인코딩을 쓴다 - 다른 것을 넣으면 던진다', () => {
    const { preprocessor, rows, model, options } = fixture()
    const wrong = { ...options, categoricalEncoding: 'ordinal' as const }
    expect(() => clusterMaterial(DATASET, preprocessor, model, settingsOf(rows, wrong))).toThrow()
  })
})

describe('예측 화면의 이웃', () => {
  function materialOf() {
    const { preprocessor, rows, model, options, matrix } = fixture()
    const settings = { preprocessing: options, trainIndices: rows } as Experiment['settings']
    return { material: clusterMaterial(DATASET, preprocessor, model, settings), matrix }
  }

  it('입력에 가까운 순이다 - 중심점 기준이 아니다', () => {
    const { material, matrix } = materialOf()
    // 6번 행('사')을 그대로 입력으로 넣으면 자기 자신이 가장 가깝다.
    const input = matrix[6]!
    const cluster = material.assignment.clusters[6]!

    expect(nearestMembers(material, cluster, input, 3)[0]).toBe(6)
  })

  it('그 군집 안에서만 고른다', () => {
    // **답이 2번 군집인데 표에 3번 군집 행이 뜨면 답과 표가 서로를 부정한다.**
    const { material, matrix } = materialOf()
    const far = material.assignment.clusters[0]!
    const input = matrix[7]!

    const found = nearestMembers(material, far, input, 10)
    expect(found).toHaveLength(4)
    found.forEach((row) => {
      expect(material.assignment.clusters[material.assignment.rows.indexOf(row)]).toBe(far)
    })
  })

  it('거리가 같으면 행 번호가 앞선 것이 앞이다', () => {
    // `clusterMembers`와 같은 규칙, 같은 함정이다.
    const assignment = assignClusters([[1], [-1], [0]], [5, 3, 9], ONE_CENTROID)
    const material = { columns: [], axes: [], matrix: [[1], [-1], [0]], assignment }
    expect(nearestMembers(material, 0, [0], 3)).toEqual([9, 3, 5])
  })

  it('중심점 기준과 다른 답을 낸다', () => {
    // 둘이 같은 순서만 낸다면 이 함수가 있을 이유가 없다. 군집 안에서 가장 먼 행을
    // 입력으로 주면 그 행이 이웃 목록의 맨 앞이고, 전형적인 것 목록에서는 맨 뒤다.
    const { material, matrix } = materialOf()
    const cluster = material.assignment.clusters[0]!
    const typical = clusterMembers(material.assignment, cluster, 10)
    const last = typical[typical.length - 1]!
    const input = matrix[material.assignment.rows.indexOf(last)]!

    expect(nearestMembers(material, cluster, input, 10)[0]).toBe(last)
    expect(typical[0]).not.toBe(last)
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
