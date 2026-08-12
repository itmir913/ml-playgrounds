/**
 * 군집 결과를 화면이 읽을 수 있는 모양으로 만든다 (`open-decisions.md` #28,
 * `architecture.md` §8.13.2).
 *
 * **여기가 이 기능의 전부다. 화면은 받은 것을 그리기만 한다** (§8.3).
 *
 * 이 파일이 서 있는 사실 하나 — **재료는 하나다.** 산점도·군집 요약표·구성원 표가
 * 전부 `assignClusters` 하나에서 나온다. 셋이 각자 계산하면 **서로 다른 배정을 들고
 * 있을 자리**가 생기고, 그때 화면은 "2번 군집 12명"이라고 써 놓고 11줄을 보여준다.
 *
 * **군집 배정은 파일에 안 담긴다** (#28-4). 행마다 하나라 데이터가 클수록 커지는 값을
 * 요약 파일에 넣지 않는다. 대신 그릴 때 되계산하는데, **되계산이라고 해도 재학습이
 * 아니라 예측이다** — 예측 화면이 이미 같은 길을 쓴다.
 *
 * **배정은 전체 행에 하고, 표본은 그리는 점에만 건다** (#28-6). 구성원 표는 "그 군집의
 * 구성원"이라고 말하므로 표본 안에서 고르면 거짓말이 된다.
 */

import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'

import { ClientError } from '../errors'
import { dataSnapshot, type Experiment, type Preprocessing } from '../project/schema'
import { KMEANS_FORMAT, kmeansPredict, parseKMeansModel, type KMeansModel } from './models'
import { transform, type Dataset, type FittedColumn, type Preprocessor } from './preprocess'

/**
 * 학습 행렬의 열 하나. **전처리기의 열과 행렬의 열은 1:1이 아니다** — 원핫이면 열
 * 하나가 범주 수만큼 늘어난다 (`ml/preprocess.ts`의 `featureNames`).
 */
export interface MatrixColumn {
  /** `preprocessor.featureNames`의 그 이름. 원핫이면 `열=범주`다. */
  readonly name: string
  /** 이 칸을 만든 원본 열. 스케일 되돌리기가 여기서 나온다. */
  readonly column: FittedColumn
}

/**
 * 산점도의 축이 될 수 있는 칸.
 *
 * **수치 열뿐이다** (#28-2). 원핫으로 늘어난 범주 칸은 값이 0/1 둘뿐이라 산점도에서
 * 읽을 것이 없다. 목록에서 빼되 그 사실을 말하지는 않는다 — 학생에게는 고를 수 있는
 * 것만 보인다.
 */
export interface ClusterAxis {
  readonly name: string
  /** 학습 행렬의 열 번호. */
  readonly index: number
}

/**
 * 전처리기가 만드는 행렬의 열 순서를 되짚는다.
 *
 * **`fitPreprocessor`가 `featureNames`를 만드는 규칙과 같아야 한다.** 두 벌이 되면
 * 반드시 어긋나므로, 만든 이름을 `featureNames`와 **대조해서 시끄럽게 실패한다** —
 * 어긋나는 유일한 경로가 인코딩이다(fit 시점과 다른 `categoricalEncoding`으로 부르면
 * 폭이 달라진다). 조용히 지나가면 **한 칸 밀린 축**으로 그림을 그린다.
 */
export function matrixColumns(
  preprocessor: Preprocessor,
  encoding: Preprocessing['categoricalEncoding'],
): MatrixColumn[] {
  const columns: MatrixColumn[] = []

  for (const column of preprocessor.columns) {
    if (column.kind === 'numeric' || encoding !== 'onehot') {
      columns.push({ name: column.name, column })
      continue
    }
    for (const category of column.categories ?? []) {
      columns.push({ name: `${column.name}=${category}`, column })
    }
  }

  const same =
    columns.length === preprocessor.featureNames.length &&
    columns.every((entry, index) => entry.name === preprocessor.featureNames[index])
  if (!same) throw new ClientError('MODEL_FILE_INVALID', { field: 'featureNames' })

  return columns
}

/** 축 후보. 수치 칸만 남긴다. */
export function clusterAxes(
  preprocessor: Preprocessor,
  encoding: Preprocessing['categoricalEncoding'],
): ClusterAxis[] {
  return matrixColumns(preprocessor, encoding)
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.column.kind === 'numeric')
    .map(({ entry, index }) => ({ name: entry.name, index }))
}

/**
 * 전처리된 값을 원래 단위로 되돌린다. **스케일링이 꺼져 있으면 항등이다.**
 *
 * 되돌리기가 열마다 1차식(`값 × spread + center`)이라는 것이 #28-6의 두 문장을 함께
 * 떠받친다 — 되돌린 중심점이 곧 원래 단위의 평균이라는 것, 그리고 되돌리든 안 되돌리든
 * 산점도의 배치가 같다는 것.
 */
export function unscale(column: FittedColumn, value: number): number {
  return column.scale ? value * column.scale.spread + column.scale.center : value
}

/** 전체 행의 군집 배정. **산점도·요약·구성원이 전부 이 하나에서 나온다.** */
export interface ClusterAssignment {
  /** 원본 표(`dataset.rows`)의 행 번호. `experiment.settings.trainIndices` 그대로다. */
  readonly rows: readonly number[]
  /** `rows`와 같은 순서·같은 길이. 그 행의 군집 번호. */
  readonly clusters: Int32Array
  /**
   * 자기 중심점까지의 거리². **구성원 표의 순서가 여기서 나온다** — 가까운 것이
   * 그 군집에서 가장 전형적인 행이다 (#28-6).
   */
  readonly distances: Float64Array
  /** 군집마다 몇 행인가. */
  readonly counts: Int32Array
  /** 되돌린 중심점. `centroids[c][j]`의 j는 행렬 열 번호다. */
  readonly centroids: readonly (readonly number[])[]
}

/**
 * 학습 행렬에 모델을 돌려 배정을 되계산한다.
 *
 * **예측 루프를 다시 짜지 않는다.** 배정은 `kmeansPredict`가 준 것을 그대로 쓰고,
 * 여기서 따로 구하는 것은 **이미 정해진 자기 중심점까지의 거리** 하나뿐이다 — 가장
 * 가까운 중심점을 다시 고르는 것이 아니다. 두 벌의 argmin이 생기면 그 둘이 갈리는 날
 * 화면은 A 군집 색으로 칠한 점을 B 군집 표에 넣는다.
 */
export function assignClusters(
  matrix: readonly (readonly number[])[],
  rows: readonly number[],
  model: KMeansModel,
): ClusterAssignment {
  if (matrix.length !== rows.length) {
    throw new ClientError('MODEL_FILE_INVALID', { field: 'trainIndices' })
  }

  const predicted = kmeansPredict(model)(matrix)
  const clusters = new Int32Array(matrix.length)
  const distances = new Float64Array(matrix.length)
  const counts = new Int32Array(model.k)

  for (let i = 0; i < matrix.length; i += 1) {
    const cluster = Number(predicted[i])
    // 해석기가 준 번호다. 범위를 벗어날 경로가 없지만, 벗어나면 아래 색인이 조용히
    // undefined가 되므로 여기서 막는다.
    if (!Number.isInteger(cluster) || cluster < 0 || cluster >= model.k) {
      throw new ClientError('MODEL_FILE_INVALID', { field: 'centroids' })
    }
    clusters[i] = cluster
    counts[cluster]! += 1

    const centroid = model.centroids[cluster]!
    const row = matrix[i]!
    let distance = 0
    for (let j = 0; j < model.featureCount; j += 1) {
      const gap = (row[j] ?? 0) - (centroid[j] ?? 0)
      distance += gap * gap
    }
    distances[i] = distance
  }

  return {
    rows,
    clusters,
    distances,
    counts,
    centroids: model.centroids,
  }
}

/** 군집 한 줄의 요약. **크기와 특성별 평균, 그리고 중심점이다** (#28-6). */
export interface ClusterSummary {
  readonly cluster: number
  readonly size: number
  /**
   * `axes`와 같은 순서. **그 군집에 실제로 담긴 행들의 평균**이다 (되돌린 값 기준).
   *
   * 빈 군집이면 전부 `NaN`이 아니라 중심점 값을 준다 — 아래 참고.
   */
  readonly means: readonly number[]
  /**
   * `axes`와 같은 순서. **모델의 중심점**을 되돌린 값이고, 그림의 ✕가 이것이다.
   *
   * `means`와 다를 수 있다 — 아래 머리말.
   */
  readonly centroid: readonly number[]
}

/**
 * 군집마다 한 줄.
 *
 * **평균을 중심점으로 대신하지 않는다** (#28-6, 2026-08-11 감사에서 뒤집혔다).
 * "K-Means의 중심점은 곧 그 군집의 평균"은 **수렴했을 때만 참이다** — `fitKMeans`는
 * 루프를 나온 뒤 **최종 중심점으로 한 번 더 배정하는데**(배정과 중심점의 한 스텝
 * 어긋남을 없애려고 넣은 것이다) 그 중심점은 **직전 배정의 평균**이라, `maxIter`에
 * 닿으면 최종 배정의 평균과 갈린다.
 *
 * 표가 `평균`이라고 쓰고 그 자리에 평균이 아닌 값을 보이는 것이 이 저장소가 규정한
 * 최악(조용히 틀린 결과)에 가장 가까운 자리다. 그래서 **배정에서 한 번 훑는다** —
 * 이미 들고 있는 행렬로 O(n·d)다.
 *
 * **중심점도 함께 돌려준다.** 그림의 ✕는 여전히 모델이 쓴 점이어야 한다(#28-1이
 * 이너셔를 설명하는 근거로 삼은 것이 그것이다). 둘이 갈리는 경우는 수렴하지 못한
 * 학습뿐이고, 화면은 이미 `KMEANS_NOT_CONVERGED`로 그 사실을 말하고 있다.
 *
 * **빈 군집도 줄을 갖는다.** 크기 0이 사실이고, 감추면 군집 번호가 중간에 건너뛴다.
 * 그때 평균은 나눌 것이 없으므로 **중심점을 그대로 쓴다** — 0으로 나눈 `NaN`을 표에
 * 내보내는 것보다 낫고, 빈 군집의 중심점은 그 자리에 있는 유일한 사실이다.
 */
export function clusterSummaries(
  assignment: ClusterAssignment,
  axes: readonly ClusterAxis[],
  columns: readonly MatrixColumn[],
  matrix: readonly (readonly number[])[],
): ClusterSummary[] {
  // 군집 × 축의 합계를 한 번에 모은다. 행을 군집마다 다시 훑으면 k배가 된다.
  const sums = assignment.centroids.map(() => new Float64Array(axes.length))
  for (let i = 0; i < assignment.rows.length; i += 1) {
    const row = matrix[i]
    const target = sums[assignment.clusters[i] ?? 0]
    if (!row || !target) continue
    axes.forEach((axis, position) => {
      target[position]! += row[axis.index] ?? 0
    })
  }

  return assignment.centroids.map((centroid, cluster) => {
    const size = assignment.counts[cluster] ?? 0
    const total = sums[cluster]
    const centroidValues = axes.map((axis) =>
      unscale(columns[axis.index]!.column, centroid[axis.index] ?? 0),
    )

    return {
      cluster,
      size,
      means:
        size === 0
          ? centroidValues
          : axes.map((axis, position) =>
              unscale(columns[axis.index]!.column, (total?.[position] ?? 0) / size),
            ),
      centroid: centroidValues,
    }
  })
}

/**
 * 행 하나를 **축 순서의 되돌린 좌표**로 바꾼다.
 *
 * **그림에 찍히는 모든 점이 이 함수를 지난다** — 산점도의 점도, 예측 화면이 얹는 새 점도.
 * 두 벌이 되면 학생이 넣은 점만 다른 좌표계에 찍히고, 그림은 멀쩡해 보인다.
 */
export function axisValues(
  row: readonly number[],
  axes: readonly ClusterAxis[],
  columns: readonly MatrixColumn[],
): number[] {
  return axes.map((axis) => unscale(columns[axis.index]!.column, row[axis.index] ?? 0))
}

/** 축 하나를 전체 데이터에서 본 모습. 요약표 머리글의 설명이 이것을 쓴다 (#28-6). */
export interface AxisOverview {
  readonly name: string
  /** 전체 행의 평균. 군집별 평균이 높은 값인지 낮은 값인지 견줄 자리다. */
  readonly mean: number
  readonly min: number
  readonly max: number
}

/**
 * 축마다 전체 데이터의 평균과 범위. **되돌린 값 기준**이라 표에 뜬 숫자와 같은 단위다.
 *
 * **"이 군집의 평균 45"만으로는 그것이 높은지 낮은지 알 수 없다.** 그 판단이 요약표를
 * 보는 이유이고, 견줄 것이 없으면 표가 숫자만 늘어놓은 것이 된다.
 *
 * 행이 없으면 빈 배열이 아니라 축마다 0을 준다 — 화면이 축 목록을 그대로 도는데 길이가
 * 달라지면 자리가 어긋난다.
 */
export function axisOverviews(
  matrix: readonly (readonly number[])[],
  axes: readonly ClusterAxis[],
  columns: readonly MatrixColumn[],
): AxisOverview[] {
  return axes.map((axis) => {
    const column = columns[axis.index]!.column
    let sum = 0
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY

    for (const row of matrix) {
      const value = unscale(column, row[axis.index] ?? 0)
      sum += value
      if (value < min) min = value
      if (value > max) max = value
    }

    return {
      name: axis.name,
      mean: matrix.length === 0 ? 0 : sum / matrix.length,
      min: matrix.length === 0 ? 0 : min,
      max: matrix.length === 0 ? 0 : max,
    }
  })
}

/**
 * 그 군집의 구성원 한 페이지. **중심점에 가까운 순으로 `offset`부터 `limit`개** (#28-6).
 *
 * 가까운 순인 이유는 **가장 전형적인 것부터**이기 때문이다. 돌려주는 것은 원본 표의
 * 행 번호라, 화면은 그 줄을 원본 값 그대로 보인다 — 그림의 좌표(되돌린 값)와 다를 수
 * 있고 그것이 맞다.
 *
 * **동점이면 행 번호가 앞선 것이 앞이다.** 정렬이 결정적이어야 같은 파일을 두 번 열어
 * 같은 표를 보고, **페이지를 넘겼다 돌아와도 같은 줄이 같은 자리에 있다.**
 *
 * **자르는 일을 화면에 넘기지 않는다.** 전부 돌려주면 그 배열이 그대로 DOM 가까이
 * 가고, 십만 행짜리 군집에서 그것은 교실 PC가 멈추는 자리다 (#28-5가 점의 상한을
 * 세운 것과 같은 이유).
 */
export function clusterMembers(
  assignment: ClusterAssignment,
  cluster: number,
  limit: number,
  offset = 0,
): number[] {
  const picked: number[] = []
  for (let i = 0; i < assignment.rows.length; i += 1) {
    if (assignment.clusters[i] === cluster) picked.push(i)
  }

  picked.sort((a, b) => {
    const gap = (assignment.distances[a] ?? 0) - (assignment.distances[b] ?? 0)
    return gap !== 0 ? gap : (assignment.rows[a] ?? 0) - (assignment.rows[b] ?? 0)
  })

  const start = Math.max(0, offset)
  return picked.slice(start, start + Math.max(0, limit)).map((index) => assignment.rows[index]!)
}

/**
 * 화면 둘이 함께 쓰는 재료 한 벌 (결과 화면의 패널, 예측 화면의 이웃).
 *
 * **두 화면이 각자 조립하면 같은 파일을 놓고 다른 배정을 볼 수 있다.** 조립 순서 자체가
 * 규칙이라(인코딩은 그 실험의 것, 행 번호는 `trainIndices`, 배정은 해석기가 준 것)
 * 그 순서를 두 벌로 두지 않는다.
 */
export interface ClusterMaterial {
  readonly columns: readonly MatrixColumn[]
  readonly axes: readonly ClusterAxis[]
  /** 학습 행렬. 전처리된 값이다 — 되돌리기 전이다. */
  readonly matrix: readonly (readonly number[])[]
  readonly assignment: ClusterAssignment
}

/**
 * 파일에서 꺼낸 것들로 재료 한 벌을 만든다.
 *
 * **인코딩과 행 번호는 그 실험에서 나온다.** 다른 실험 것을 섞으면 좌표계가 어긋난 채로
 * 그림이 그려진다 — 예측이 (실험, run) 쌍에 매달려 있는 것과 같은 이유다(`ml/predict.ts`).
 *
 * 부르는 쪽이 실패를 삼킬 수 있도록 **던지는 것을 감추지 않는다.** 여기서 던지는 경우는
 * 남이 편집한 파일이거나 데이터가 바뀐 파일이고, 그때 화면은 그 자리에 아무것도 안 그린다.
 */
export function clusterMaterial(
  dataset: Dataset,
  preprocessor: Preprocessor,
  model: KMeansModel,
  settings: Experiment['settings'],
): ClusterMaterial {
  // 이 판은 표 전용이다 — 이미지 군집은 산점도를 안 그린다 (open-decisions.md #28-8).
  const encoding = dataSnapshot('tabular', settings).preprocessing.categoricalEncoding
  const rows = settings.trainIndices
  const matrix = transform(preprocessor, dataset, rows, encoding)

  return {
    columns: matrixColumns(preprocessor, encoding),
    axes: clusterAxes(preprocessor, encoding),
    matrix,
    assignment: assignClusters(matrix, rows, model),
  }
}

/**
 * **답을 무리로 설명할 수 있는 형식.** 지금은 K-평균 하나뿐이다.
 *
 * 이 목록이 여기 있는 이유는 §9.1이다 — **화면이 `taskType === 'clustering'`이나 형식
 * 이름을 알면 안 된다.** 두 번째 군집 알고리즘이 생기는 날 고칠 자리가 이 줄 하나여야
 * 하고, 그때 화면 셋을 뒤지게 되면 그중 하나를 빠뜨린 것은 아무도 못 잡는다.
 */
const CLUSTER_FORMATS: readonly string[] = [KMEANS_FORMAT]

/**
 * 이 형식이 답을 무리로 설명할 수 있는가. **재료를 만들지 않고 답한다.**
 *
 * 화면이 "무엇을 고를 수 있는가"를 세우는 데는 이것이면 되고, **학습 행렬은 고른
 * 하나에만 필요하다** (#28-7). 목록을 세우려고 행렬을 스무 개 만들면 그 목록에서
 * 하나를 고르는 의미가 없어진다.
 */
export function explainsAsClusters(format: string | undefined): boolean {
  return format !== undefined && CLUSTER_FORMATS.includes(format)
}

/**
 * 파일에서 꺼낸 것들로 재료를 만든다. **못 만들면 `null`이고, 그때 화면은 그 자리에
 * 아무것도 안 그린다** (`ml/models`의 `loadModelProba`와 같은 모양이다).
 *
 * `null`이 되는 경우는 셋이다 — 무리로 설명할 수 있는 형식이 아니거나, 재료 중 하나가
 * 파일에 없거나(데이터를 뺀 파일), 읽다가 실패했거나(남이 편집한 파일). **셋을 가르지
 * 않는 이유는 화면이 할 일이 셋 다 같기 때문이다.** 답 자체는 이미 다른 자리에 있다.
 */
export function clusterMaterialFor(
  format: string | undefined,
  bytes: Uint8Array | undefined,
  dataset: Dataset | null,
  preprocessor: Preprocessor | null | undefined,
  settings: Experiment['settings'],
): ClusterMaterial | null {
  if (!explainsAsClusters(format)) return null
  if (!bytes || !dataset || !preprocessor) return null

  try {
    const model = parseKMeansModel(JSON.parse(new TextDecoder().decode(bytes)))
    return clusterMaterial(dataset, preprocessor, model, settings)
  } catch {
    return null
  }
}

/**
 * **그 군집 안에서** 새 입력에 가까운 행들 (#28-6). 예측 화면이 "이거랑 비슷한 게
 * 뭔데"에 답하는 자리다.
 *
 * **`clusterMembers`와 정렬 기준이 다르다.** 저기는 중심점까지의 거리(그 군집에서 가장
 * 전형적인 것)이고 여기는 **입력까지의 거리**(진짜 이웃)다. 하나로 뭉치면 예측 화면이
 * "전형적인 것"을 "너와 비슷한 것"이라고 말하게 된다.
 *
 * **그 군집으로 좁히는 이유**는 이 자리가 답(`2번 군집`)이 무슨 뜻인지 말하는 자리이기
 * 때문이다. 전체에서 고르면 답과 다른 군집의 행이 "비슷한 것"으로 올라올 수 있고,
 * 그러면 바로 위에 적힌 답과 그 아래 표가 서로를 부정한다.
 *
 * 동점이면 행 번호가 앞선 것이 앞이다 — `clusterMembers`와 같은 규칙이다.
 */
export function nearestMembers(
  material: ClusterMaterial,
  cluster: number,
  input: readonly number[],
  limit: number,
): number[] {
  const { assignment, matrix } = material
  const picked: number[] = []
  for (let i = 0; i < assignment.rows.length; i += 1) {
    if (assignment.clusters[i] === cluster) picked.push(i)
  }

  const distanceOf = (index: number): number => {
    const row = matrix[index] ?? []
    let distance = 0
    for (let j = 0; j < input.length; j += 1) {
      const gap = (row[j] ?? 0) - (input[j] ?? 0)
      distance += gap * gap
    }
    return distance
  }

  const distances = new Map(picked.map((index) => [index, distanceOf(index)]))
  picked.sort((a, b) => {
    const gap = (distances.get(a) ?? 0) - (distances.get(b) ?? 0)
    return gap !== 0 ? gap : (assignment.rows[a] ?? 0) - (assignment.rows[b] ?? 0)
  })

  return picked.slice(0, Math.max(0, limit)).map((index) => assignment.rows[index]!)
}

/** 산점도에 찍는 점 하나. */
export interface ScatterPoint {
  /** 원본 표의 행 번호. */
  readonly row: number
  readonly cluster: number
  /** **`axes`와 같은 순서**의 되돌린 좌표. 행렬 열 번호가 아니다. */
  readonly values: readonly number[]
}

export interface ScatterData {
  readonly points: readonly ScatterPoint[]
  /** 실제로 찍는 점 수. */
  readonly drawn: number
  /** 그 군집 배정이 본 전체 행 수. **`drawn`과 다르면 화면이 그 사실을 말한다** (#28-5). */
  readonly total: number
}

/**
 * 찍을 점을 고른다. **상한을 넘으면 시드로 표본을 뽑는다** (#28-5).
 *
 * **시드는 그 실험의 `randomState`다.** 같은 설정이면 같은 그림이라야 학생이 어제 본
 * 것을 오늘도 본다 — 조용히 매번 다른 표본을 그리면 학생은 자기가 뭘 바꿔서 그림이
 * 바뀐 줄 안다.
 *
 * **뽑은 뒤 원래 순서로 되돌린다.** 그리는 순서가 겹침의 위아래를 정하는데, 그것이
 * 표본 뽑기의 부산물로 흔들릴 이유가 없다.
 *
 * 상한 이하면 표본을 안 뽑는다 — 그때 `drawn === total`이고 화면은 아무 말도 안 한다.
 */
export function scatterPoints(
  assignment: ClusterAssignment,
  axes: readonly ClusterAxis[],
  columns: readonly MatrixColumn[],
  matrix: readonly (readonly number[])[],
  limit: number,
  randomState: number,
): ScatterData {
  const total = assignment.rows.length
  const picked =
    total <= limit ? assignment.rows.map((_row, index) => index) : sample(total, limit, randomState)

  const points = picked.map((index) => {
    const row = matrix[index]!
    return {
      row: assignment.rows[index]!,
      cluster: assignment.clusters[index] ?? 0,
      values: axisValues(row, axes, columns),
    }
  })

  return { points, drawn: points.length, total }
}

/**
 * `count`개 중 `size`개를 시드로 뽑는다. **오름차순으로 돌려준다.**
 *
 * 부분 Fisher-Yates다 — 앞에서부터 `size`번만 섞으면 전체를 섞을 필요가 없다.
 * `ml/split.ts`와 같은 난수원을 쓴다. `Math.random`을 쓰면 시드를 줄 수 없어 같은
 * 설정이 같은 그림을 못 준다.
 */
function sample(count: number, size: number, seed: number): number[] {
  const pool = Array.from({ length: count }, (_value, index) => index)
  const rng = xoroshiro128plus(seed)
  const take = Math.min(size, count)

  for (let i = 0; i < take; i += 1) {
    const j = uniformInt(rng, i, count - 1)
    const swap = pool[i] as number
    pool[i] = pool[j] as number
    pool[j] = swap
  }

  return pool.slice(0, take).sort((a, b) => a - b)
}
