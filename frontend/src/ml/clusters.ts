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
import type { Preprocessing } from '../project/schema'
import { kmeansPredict, type KMeansModel } from './models'
import type { FittedColumn, Preprocessor } from './preprocess'

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

/** 군집 한 줄의 요약. **크기와 특성별 평균이다** (#28-6). */
export interface ClusterSummary {
  readonly cluster: number
  readonly size: number
  /** `axes`와 같은 순서. 되돌린 중심점 = 그 군집의 특성별 평균이다. */
  readonly means: readonly number[]
}

/**
 * 군집마다 한 줄. **새로 계산하는 것이 없다.**
 *
 * K-Means의 중심점은 정의상 구성원의 평균이고(Lloyd 반복의 갱신 단계가 합을 개수로
 * 나눈다), 되돌리기가 1차식이라 **되돌린 중심점이 곧 원래 단위의 평균**이다. 즉
 * `키 172.3`이 이미 모델 파일 안에 있었다 (#28-6).
 *
 * **빈 군집도 줄을 갖는다.** 크기 0이 사실이고, 감추면 군집 번호가 중간에 건너뛴다.
 */
export function clusterSummaries(
  assignment: ClusterAssignment,
  axes: readonly ClusterAxis[],
  columns: readonly MatrixColumn[],
): ClusterSummary[] {
  return assignment.centroids.map((centroid, cluster) => ({
    cluster,
    size: assignment.counts[cluster] ?? 0,
    means: axes.map((axis) => unscale(columns[axis.index]!.column, centroid[axis.index] ?? 0)),
  }))
}

/**
 * 그 군집의 구성원. **중심점에 가까운 순으로 `limit`개까지** (#28-6).
 *
 * 가까운 순인 이유는 **가장 전형적인 것부터**이기 때문이다. 돌려주는 것은 원본 표의
 * 행 번호라, 화면은 그 줄을 원본 값 그대로 보인다 — 그림의 좌표(되돌린 값)와 다를 수
 * 있고 그것이 맞다.
 *
 * **동점이면 행 번호가 앞선 것이 앞이다.** 정렬이 결정적이어야 같은 파일을 두 번 열어
 * 같은 표를 본다.
 */
export function clusterMembers(
  assignment: ClusterAssignment,
  cluster: number,
  limit: number,
): number[] {
  const picked: number[] = []
  for (let i = 0; i < assignment.rows.length; i += 1) {
    if (assignment.clusters[i] === cluster) picked.push(i)
  }

  picked.sort((a, b) => {
    const gap = (assignment.distances[a] ?? 0) - (assignment.distances[b] ?? 0)
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
      values: axes.map((axis) => unscale(columns[axis.index]!.column, row[axis.index] ?? 0)),
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
