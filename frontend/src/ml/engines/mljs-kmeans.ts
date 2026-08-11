/**
 * K-Means 군집화 — K-Means++ 초기화 + Lloyd 반복.
 *
 * **직접 구현한다.** SVM을 벤더링한 기준이 세워 둔 잣대가 있다 — "라이브러리가 해 주는
 * 일이 직접 짜는 것보다 충분히 많은가." K-Means는 아니다. 핵심 루프는 짧고, sklearn
 * 엔진이 함께 붙으므로 교차 검증 대상이 이미 있다
 * (open-decisions.md "군집화(K-Means)의 핵심 결정 넷").
 *
 * **sklearn `KMeans` 기본값을 따른다** (CLAUDE.md §2 "파이썬 관행을 따른다"):
 * - 초기화: K-Means++ (`init='k-means++'`)
 * - 반복 상한: `max_iter=300`
 * - 수렴 판정: `tol=1e-4` (중심점 이동 제곱합)
 * - `n_init=1` (우리는 randomState를 고정하므로 여러 번 돌려도 같다)
 *
 * **randomState는 항상 저장하고 항상 쓴다.** 재현 가능성이 교육용 도구의 생명이다.
 */

import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'

import { ClientError } from '../../errors'

/**
 * 반복 상한과 수렴 문턱. **sklearn `KMeans`의 기본값 그대로다.**
 *
 * 학생에게 열지 않는다 (`mljs-params.ts`: "maxIter와 tol은 SVM과 같은 이유로 열지
 * 않는다"). 열지 않는 값이라도 출처는 하나여야 하므로 SVM의 `SMO_DEFAULTS`와 같은
 * 자리를 갖는다 — 함수 기본값 리터럴로 두면 부르는 쪽마다 다른 값이 설 수 있다.
 */
export const KMEANS_DEFAULTS = { maxIter: 300, tol: 1e-4 } as const

/** K-Means 학습 결과. */
export interface KMeansResult {
  /** 각 군집의 중심점. centroids[k][j] = 군집 k의 특성 j. */
  readonly centroids: readonly (readonly number[])[]
  /** 각 행이 속한 군집 번호 (0-based). */
  readonly assignments: readonly number[]
  /** 이너셔 — 각 데이터와 자기 군집 중심점까지 거리의 제곱합. */
  readonly inertia: number
  /** 수렴했는가. maxIter에 닿으면 false. */
  readonly converged: boolean
  /** 실제 반복 횟수. */
  readonly iterations: number
}

/**
 * K-Means++ 초기화. **첫 중심점을 잘 고르면 Lloyd 반복이 더 빨리, 더 좋은 곳으로 간다.**
 *
 * 알고리즘은 Arthur & Vassilvitskii (2007)의 원본 그대로다:
 * 1. 첫 중심점을 균등 무작위로 고른다.
 * 2. 각 데이터에서 가장 가까운 기존 중심점까지의 거리²를 구한다.
 * 3. 거리²에 비례하는 확률로 다음 중심점을 고른다.
 * 4. k개가 될 때까지 2-3을 반복한다.
 */
function kMeansPlusPlusInit(
  features: readonly (readonly number[])[],
  k: number,
  randomState: number,
): number[][] {
  const n = features.length
  const rng = xoroshiro128plus(randomState)
  const centroids: number[][] = []

  // 1. 첫 중심점: 균등 무작위
  const firstIndex = uniformInt(rng, 0, n - 1)
  centroids.push([...(features[firstIndex] ?? [])])

  // 나머지 중심점
  const minDistSq = new Float64Array(n).fill(Number.POSITIVE_INFINITY)

  for (let c = 1; c < k; c += 1) {
    const lastCentroid = centroids[c - 1]!

    // 2. 각 데이터와 가장 가까운 기존 중심점까지의 거리²
    let totalDistSq = 0
    for (let i = 0; i < n; i += 1) {
      const row = features[i]!
      let distSq = 0
      for (let j = 0; j < row.length; j += 1) {
        const gap = (row[j] ?? 0) - (lastCentroid[j] ?? 0)
        distSq += gap * gap
      }
      if (distSq < (minDistSq[i] ?? Number.POSITIVE_INFINITY)) {
        minDistSq[i] = distSq
      }
      totalDistSq += minDistSq[i]!
    }

    // 3. 거리²에 비례하는 확률로 다음 중심점 선택
    // 정수 난수로 누적 분포를 사용한다 — 부동소수점 균등 난수를 만들려면 별도의
    // 분포가 필요하고, pure-rand의 uniformInt만으로 충분하다.
    if (totalDistSq === 0) {
      // 모든 데이터가 기존 중심점과 같다. 남은 중심점은 아무거나 고른다.
      centroids.push([...(features[uniformInt(rng, 0, n - 1)] ?? [])])
      continue
    }

    // 정수로 스케일링한 누적 분포
    const SCALE = 2 ** 32
    const threshold = uniformInt(rng, 0, SCALE - 1)
    let cumulative = 0
    let chosen = n - 1
    for (let i = 0; i < n; i += 1) {
      cumulative += (minDistSq[i]! / totalDistSq) * SCALE
      if (cumulative > threshold) {
        chosen = i
        break
      }
    }
    centroids.push([...(features[chosen] ?? [])])
  }

  return centroids
}

/** 유클리드 거리². */
function distanceSquared(a: readonly number[], b: readonly number[]): number {
  let sum = 0
  for (let j = 0; j < a.length; j += 1) {
    const gap = (a[j] ?? 0) - (b[j] ?? 0)
    sum += gap * gap
  }
  return sum
}

/**
 * 각 데이터를 가장 가까운 중심점에 할당한다.
 *
 * `distances`는 각 데이터에서 **자기 군집 중심점까지의 거리²**다. 이너셔의 항이면서
 * 빈 군집 재배치가 "가장 먼 점"을 고르는 근거이기도 하다 (updateCentroids).
 */
function assign(
  features: readonly (readonly number[])[],
  centroids: readonly (readonly number[])[],
): { assignments: Int32Array; distances: Float64Array; inertia: number } {
  const n = features.length
  const assignments = new Int32Array(n)
  const distances = new Float64Array(n)
  let inertia = 0
  for (let i = 0; i < n; i += 1) {
    const row = features[i]!
    let bestCluster = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let c = 0; c < centroids.length; c += 1) {
      const dist = distanceSquared(row, centroids[c]!)
      if (dist < bestDist) {
        bestDist = dist
        bestCluster = c
      }
    }
    assignments[i] = bestCluster
    distances[i] = bestDist
    inertia += bestDist
  }
  return { assignments, distances, inertia }
}

/**
 * 할당에 따라 중심점을 다시 계산한다.
 *
 * **빈 군집은 sklearn처럼 재배치한다** (`_kmeans.py`의 `_relocate_empty_clusters_dense`).
 * 자기 중심점에서 가장 먼 점부터 빈 군집 하나씩에 옮겨 주고, 그 점을 원래 군집의
 * 합계에서 뺀다. 재배치하지 않으면 빈 군집의 합계는 0 벡터이므로 **중심점이 원점으로
 * 간다** - 표준화한 데이터에서 원점은 곧 평균이라, 데이터에 없는 곳에 찍힌 유령
 * 중심점이 다음 반복에서 실제 점들을 끌어간다. 값이 같은 열이나 중복 행은 교실 CSV에
 * 흔하다.
 *
 * 재배치로도 못 채운 군집(옮겨 줄 점보다 빈 군집이 많은 경우)은 **이전 중심점을
 * 그대로 유지한다.** 원점으로 보내는 경로를 구조적으로 없애기 위한 마지막 그물이다.
 */
function updateCentroids(
  features: readonly (readonly number[])[],
  assignments: Int32Array,
  distances: Float64Array,
  centroids: readonly (readonly number[])[],
  k: number,
  width: number,
): number[][] {
  const sums: number[][] = Array.from({ length: k }, () => new Array<number>(width).fill(0))
  const counts = new Int32Array(k)

  for (let i = 0; i < features.length; i += 1) {
    const cluster = assignments[i]!
    counts[cluster]! += 1
    const row = features[i]!
    const target = sums[cluster]!
    for (let j = 0; j < width; j += 1) {
      target[j]! += row[j] ?? 0
    }
  }

  const empty: number[] = []
  for (let c = 0; c < k; c += 1) {
    if (counts[c] === 0) empty.push(c)
  }

  if (empty.length > 0) {
    // 먼 순서. **같은 거리면 행 번호가 앞선 쪽이다** - sklearn의 argpartition은 동점
    // 순서를 정하지 않지만 우리는 재현 가능성이 먼저다 (CLAUDE.md §2).
    const farthest = Array.from({ length: features.length }, (_, i) => i).sort((a, b) => {
      const gap = (distances[b] ?? 0) - (distances[a] ?? 0)
      return gap !== 0 ? gap : a - b
    })

    for (let idx = 0; idx < empty.length && idx < farthest.length; idx += 1) {
      const target = empty[idx]!
      const point = farthest[idx]!
      const from = assignments[point]!
      // 점 하나짜리 군집에서 빼면 그 자리가 다시 빈다. 옮겨도 얻는 것이 없다.
      if (counts[from]! <= 1) continue
      const row = features[point]!
      const to = sums[target]!
      const source = sums[from]!
      for (let j = 0; j < width; j += 1) {
        const value = row[j] ?? 0
        to[j] = value
        source[j]! -= value
      }
      counts[target] = 1
      counts[from]! -= 1
    }
  }

  return sums.map((sum, c) => {
    const count = counts[c]!
    if (count === 0) return [...(centroids[c] ?? sum)]
    return sum.map((value) => value / count)
  })
}

/**
 * K-Means 학습. **순수 함수다.**
 *
 * **성립하지 않는 요청은 시작 전에 거부한다.** 데이터보다 군집이 많으면 빈 군집이
 * 반드시 생기고, 재배치로도 채울 점이 없다. sklearn도 같은 자리에서 던진다
 * (`n_samples=2 should be >= n_clusters=5`). 넘기면 학생은 데이터에 없는 유령
 * 중심점을 "찾은 군집"으로 보게 된다 - 실패가 아니라 조용히 틀린 숫자다.
 *
 * @param features 전처리를 마친 숫자 행렬
 * @param k 군집 수 (n_clusters)
 * @param randomState 난수 씨앗
 * @param maxIter 최대 반복 횟수 (KMEANS_DEFAULTS)
 * @param tol 수렴 판정 기준 (KMEANS_DEFAULTS)
 */
export function fitKMeans(
  features: readonly (readonly number[])[],
  k: number,
  randomState: number,
  maxIter: number = KMEANS_DEFAULTS.maxIter,
  tol: number = KMEANS_DEFAULTS.tol,
): KMeansResult {
  const n = features.length
  const width = features[0]?.length ?? 0

  if (k > n) throw new ClientError('CLUSTER_TOO_FEW_ROWS', { rows: n, clusters: k })

  // K-Means++ 초기화
  let centroids = kMeansPlusPlusInit(features, k, randomState)

  let converged = false
  let iterations = 0

  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1

    // 할당
    const result = assign(features, centroids)

    // 중심점 갱신
    const newCentroids = updateCentroids(
      features,
      result.assignments,
      result.distances,
      centroids,
      k,
      width,
    )

    // 수렴 판정: 중심점 이동의 제곱합 (sklearn과 같은 기준)
    let shift = 0
    for (let c = 0; c < k; c += 1) {
      shift += distanceSquared(newCentroids[c]!, centroids[c]!)
    }

    centroids = newCentroids

    if (shift <= tol) {
      converged = true
      break
    }
  }

  // **마지막 중심점으로 한 번 더 배정한다.** 루프 안의 할당은 갱신 전 중심점 기준이라
  // 그대로 돌려주면 centroids와 assignments가 한 스텝 어긋난다 - maxIter를 다 써서
  // 끝날 때는 온전히 한 스텝이고, 그때가 바로 학생이 숫자를 의심하는 상황이다.
  // sklearn의 `labels_`·`cluster_centers_`·`inertia_`도 이렇게 서로 맞는다.
  const final = assign(features, centroids)

  return {
    centroids,
    assignments: [...final.assignments],
    inertia: final.inertia,
    converged,
    iterations,
  }
}
