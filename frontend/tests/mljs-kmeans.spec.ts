/**
 * K-Means 엔진 — `fitKMeans` 단위 검사.
 *
 * **V3 감사가 찾은 수치 결함 셋이 전부 이 자리에서 잡혔어야 했다.** 군집 검사가
 * 통합(`experiment.spec.ts`)과 지표(`metrics.spec.ts`)에만 있어서 엔진이 내는
 * 숫자 자체를 아무도 안 봤다.
 *
 * **확인하는 것 넷.**
 *
 * 1. **빈 군집이 원점으로 가지 않는가.** 값이 같은 열과 중복 행은 교실 CSV에 흔하고,
 *    표준화한 데이터에서 원점은 곧 평균이라 유령 중심점이 실제 점들을 끌어간다.
 * 2. **centroids와 assignments가 서로 맞는가.** 파일에 남는 군집 번호가 파일에 남는
 *    중심점으로 설명되지 않으면 학생이 본 숫자를 다시 만들 수 없다.
 * 3. **성립하지 않는 요청을 거부하는가.** k > n은 sklearn이 던지는 자리다.
 * 4. **같은 씨앗이면 같은 답인가.** 재현 가능성이 교육용 도구의 생명이다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { engineFor } from '../src/ml/engines'
import { fitKMeans } from '../src/ml/engines/mljs-kmeans'
import { CLUSTER_EVALUATOR } from '../src/ml/metrics'

/** 돌려받은 중심점으로 직접 배정해 본 결과. 엔진의 답과 같아야 한다. */
function assignBy(
  features: readonly (readonly number[])[],
  centroids: readonly (readonly number[])[],
): { assignments: number[]; inertia: number } {
  const assignments: number[] = []
  let inertia = 0
  for (const row of features) {
    let best = 0
    let bestDist = Number.POSITIVE_INFINITY
    centroids.forEach((centroid, c) => {
      let dist = 0
      for (let j = 0; j < row.length; j += 1) {
        const gap = (row[j] ?? 0) - (centroid[j] ?? 0)
        dist += gap * gap
      }
      if (dist < bestDist) {
        bestDist = dist
        best = c
      }
    })
    assignments.push(best)
    inertia += bestDist
  }
  return { assignments, inertia }
}

/** 두 덩어리가 멀찍이 떨어진 데이터. 어떤 초기화에서도 답이 같다. */
const TWO_BLOBS = [
  [0, 0],
  [1, 0],
  [0, 1],
  [10, 10],
  [11, 10],
  [10, 11],
]

describe('빈 군집', () => {
  it('중심점이 원점으로 가지 않는다 - 같은 점만 있는 데이터', () => {
    // 감사 보고서의 실측 자리. 고치기 전에는 [[5,5],[0,0]]이 나왔다.
    const result = fitKMeans(
      [
        [5, 5],
        [5, 5],
        [5, 5],
      ],
      2,
      7,
    )

    expect(result.centroids).toHaveLength(2)
    for (const centroid of result.centroids) {
      expect(centroid).toEqual([5, 5])
    }
  })

  it('재배치한 중심점이 데이터 안에 있다 - 한 덩어리에 k가 큰 데이터', () => {
    const data = [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [9, 9],
    ]
    const result = fitKMeans(data, 3, 1)

    // 원점(0,0)은 이 데이터에 실제로 있는 점이므로 "원점이면 유령"이라고 볼 수 없다.
    // 대신 모든 중심점이 데이터의 볼록 껍질 안에 있는지를 본다 - 유령 중심점은
    // 어느 점의 평균도 아니다.
    for (const centroid of result.centroids) {
      const x = centroid[0]!
      const y = centroid[1]!
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(9)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(9)
    }
    // 멀리 떨어진 점은 자기 군집을 갖는다 - 재배치가 가장 먼 점을 고르기 때문이다.
    const lonely = result.assignments[4]!
    expect(result.assignments.filter((c) => c === lonely)).toHaveLength(1)
  })
})

describe('돌려주는 값이 서로 맞는다', () => {
  it('assignments와 inertia가 돌려준 중심점으로 설명된다 - 수렴한 경우', () => {
    const result = fitKMeans(TWO_BLOBS, 2, 42)
    const recomputed = assignBy(TWO_BLOBS, result.centroids)

    expect([...result.assignments]).toEqual(recomputed.assignments)
    expect(result.inertia).toBeCloseTo(recomputed.inertia, 10)
  })

  it('assignments와 inertia가 돌려준 중심점으로 설명된다 - maxIter를 다 쓴 경우', () => {
    // 감사 보고서의 실측 자리. 고치기 전에는 돌려준 inertia가 2, 다시 잰 값이 1이었다.
    const data = [
      [0, 0],
      [1, 0],
      [10, 10],
      [11, 10],
    ]
    const result = fitKMeans(data, 2, 3, 1)
    const recomputed = assignBy(data, result.centroids)

    expect(result.converged).toBe(false)
    expect(result.iterations).toBe(1)
    expect([...result.assignments]).toEqual(recomputed.assignments)
    expect(result.inertia).toBeCloseTo(recomputed.inertia, 10)
  })

  it('엔진의 이너셔가 지표 쪽 계산과 같다', () => {
    // **대조는 여기서 한다.** `metrics.ts`가 이너셔를 다시 계산하는 이유는 지표가
    // 엔진의 출력을 요구하지 않기 위해서다(이너셔를 안 주는 엔진이 들어올 수 있다).
    // 그렇다면 두 값이 같은지는 어디선가 봐야 하고, 그 자리가 검사다 - 예전에는
    // "검증을 위해"라고 주석만 있고 대조하는 코드가 없었다.
    const result = fitKMeans(TWO_BLOBS, 2, 42)
    const { metrics } = CLUSTER_EVALUATOR(TWO_BLOBS, result.assignments, result.centroids)
    expect(metrics.inertia).toBeCloseTo(result.inertia, 10)
  })
})

describe('성립하지 않는 요청', () => {
  it('데이터보다 군집이 많으면 거부한다', () => {
    expect.assertions(3)
    try {
      fitKMeans(
        [
          [0, 0],
          [1, 1],
        ],
        5,
        1,
      )
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('CLUSTER_TOO_FEW_ROWS')
      expect(error.params).toEqual({ rows: 2, clusters: 5 })
    }
  })

  it('k = 행 수는 거부하지 않는다 - 군집마다 점 하나씩이면 성립한다', () => {
    const data = [
      [0, 0],
      [1, 1],
      [2, 2],
    ]
    const result = fitKMeans(data, 3, 1)
    expect([...result.assignments].sort()).toEqual([0, 1, 2])
    expect(result.inertia).toBeCloseTo(0, 10)
  })
})

describe('엣지 케이스', () => {
  it('k=1이면 중심점이 전체 평균이다', () => {
    const result = fitKMeans(TWO_BLOBS, 1, 1)
    expect(result.centroids).toHaveLength(1)
    expect(result.centroids[0]![0]).toBeCloseTo(32 / 6, 10)
    expect(result.centroids[0]![1]).toBeCloseTo(32 / 6, 10)
    expect([...result.assignments]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('떨어진 두 덩어리를 그대로 가른다', () => {
    const result = fitKMeans(TWO_BLOBS, 2, 42)
    const [a, b, c, d, e, f] = [...result.assignments]
    expect(a).toBe(b)
    expect(a).toBe(c)
    expect(d).toBe(e)
    expect(d).toBe(f)
    expect(a).not.toBe(d)
    expect(result.converged).toBe(true)
  })
})

/**
 * **덩어리가 없는 데이터. 씨앗이 답을 가른다.**
 *
 * `TWO_BLOBS`는 이 파일이 스스로 "어떤 초기화에서도 답이 같다"고 적어 둔 데이터라
 * 씨앗 축을 **가를 수 없다.** 여기 줄 위에 흩뿌린 점들은 K-평균++의 뽑기가 초기
 * 중심점을 실제로 가르고, 씨앗 다섯이 서로 다른 답 다섯을 낸다(실측).
 */
const SPREAD = Array.from({ length: 24 }, (_, index) => [index, (index * 7) % 5])

describe('재현 가능성', () => {
  it('같은 씨앗이면 같은 답이다', () => {
    const first = fitKMeans(SPREAD, 3, 11)
    const second = fitKMeans(SPREAD, 3, 11)
    expect(second.centroids).toEqual(first.centroids)
    expect([...second.assignments]).toEqual([...first.assignments])
    expect(second.inertia).toBe(first.inertia)
  })

  /**
   * **씨앗이 `fitKMeans` 안까지 닿는가.**
   *
   * 위 검사만으로는 못 본다 — `fitKMeans`는 결정적 함수라 같은 인자로 두 번 부르면
   * 씨앗을 쓰든 버리든 언제나 같다. 실제로 초기화의 씨앗을 상수로 못 박아도
   * **저장소 전체 2028개가 전부 초록이었다** (R9 감사 A-4).
   *
   * `CLAUDE.md` §2가 절대 원칙으로 적은 자리다 — "`randomState`는 항상 저장하고
   * 항상 사용한다. 재현 가능성이 교육용 도구의 생명이다."
   */
  it('다른 씨앗이면 초기화가 갈린다 - 씨앗이 안 쓰이면 여기가 빨개진다', () => {
    const answers = [3, 11, 29].map((seed) => JSON.stringify(fitKMeans(SPREAD, 3, seed).centroids))
    expect(new Set(answers).size, '씨앗이 fitKMeans 안까지 안 닿았다').toBeGreaterThan(1)
  })

  /**
   * **한 홉을 더 간다.** 위 검사는 `fitKMeans`를 **직접 부르므로** 그 함수가 받은 씨앗을
   * 쓰는지만 본다. 실험이 실제로 지나는 길은 `engineFor('mljs').fit('k_means', input)`이고,
   * 그 어댑터가 `input.randomState`를 안 넘겨도 아무도 안 울었다 (R13-2 감사 A-3).
   *
   * **분류·회귀에는 이 이음매 검사가 이미 있다** — `experiment.spec.ts`가 `provided`
   * 하니스로 SVM과 배깅을 태운다. 군집은 **타깃이 없어 `provided`가 안 서서** 그 하니스에
   * 못 올라가고, 그래서 여기가 그 자리다.
   *
   * R9 감사 A-4가 잡았던 것과 같은 자리다 — 그때 고침이 직접 호출 검사만 세워
   * 어댑터 한 홉을 남겼다.
   */
  it('어댑터도 씨앗을 넘긴다 - 엔진 등록부를 지나서 본다', () => {
    const engine = engineFor('mljs')
    expect(engine, 'mljs 엔진이 등록부에 있어야 한다').toBeDefined()

    const answers = [3, 11, 29].map((seed) =>
      JSON.stringify(
        engine!.fit('k_means', {
          features: SPREAD,
          rowIndices: SPREAD.map((_, index) => index),
          target: [],
          hyperparameters: { nClusters: 3 },
          randomState: seed,
        }).clusterResult?.centroids,
      ),
    )

    expect(new Set(answers).size, '씨앗이 어댑터에서 끊겼다').toBeGreaterThan(1)
  })
})
