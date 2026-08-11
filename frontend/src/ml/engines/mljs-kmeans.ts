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

/** 각 데이터를 가장 가까운 중심점에 할당한다. */
function assign(
  features: readonly (readonly number[])[],
  centroids: readonly (readonly number[])[],
): { assignments: Int32Array; inertia: number } {
  const n = features.length
  const assignments = new Int32Array(n)
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
    inertia += bestDist
  }
  return { assignments, inertia }
}

/** 할당에 따라 중심점을 다시 계산한다. */
function updateCentroids(
  features: readonly (readonly number[])[],
  assignments: Int32Array,
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

  return sums.map((sum, c) => {
    const count = counts[c]!
    if (count === 0) return sum // 빈 군집은 중심점이 그대로 남는다 (sklearn과 같다)
    return sum.map((value) => value / count)
  })
}

/**
 * K-Means 학습. **순수 함수다.**
 *
 * @param features 전처리를 마친 숫자 행렬
 * @param k 군집 수 (n_clusters)
 * @param randomState 난수 씨앗
 * @param maxIter 최대 반복 횟수 (기본 300, sklearn 기본값)
 * @param tol 수렴 판정 기준 (기본 1e-4, sklearn 기본값)
 */
export function fitKMeans(
  features: readonly (readonly number[])[],
  k: number,
  randomState: number,
  maxIter: number = 300,
  tol: number = 1e-4,
): KMeansResult {
  const n = features.length
  const width = features[0]?.length ?? 0

  // K-Means++ 초기화
  let centroids = kMeansPlusPlusInit(features, k, randomState)

  let converged = false
  let iterations = 0
  let currentAssignments: Int32Array = new Int32Array(n)
  let currentInertia = 0

  for (let iter = 0; iter < maxIter; iter += 1) {
    iterations = iter + 1

    // 할당
    const result = assign(features, centroids)
    currentAssignments = result.assignments
    currentInertia = result.inertia

    // 중심점 갱신
    const newCentroids = updateCentroids(features, currentAssignments, k, width)

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

  return {
    centroids,
    assignments: [...currentAssignments],
    inertia: currentInertia,
    converged,
    iterations,
  }
}
