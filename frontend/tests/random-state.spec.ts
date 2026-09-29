/**
 * **`randomState`는 항상 저장하고 항상 사용한다** (`CLAUDE.md` §2) — 쓰는 자리마다 씨앗이
 * 실제로 결과까지 이어지는지 본다.
 *
 * **"같은 씨앗이면 같다"만으로는 못 문다.** 씨앗을 상수로 못 박아도 같은 씨앗은 같은 값을
 * 낸다. 그래서 여기 판은 전부 **두 씨앗이 갈린다**와 **같은 씨앗이 같다**를 함께 잰다.
 */

import { describe, expect, it, vi } from 'vitest'

import { fitNeural, type NeuralPoolFactory } from '../src/ml/engines/neural'
import { CLUSTER_EVALUATOR, silhouetteSampleSize } from '../src/ml/metrics'

/**
 * **실루엣 표본이 켜지는 예산으로 줄인다.** 실물 예산에서는 표본이 켜지는 순간 그 한 번이
 * 예산(`SILHOUETTE_BUDGET_MS`)만큼 걸리도록 표본 크기가 정해진다 — 관문에 둘 수 없다.
 * 예산만 줄이면 표본이 켜지는 행 수가 작아진다. 나머지 상수는 실물 그대로다.
 */
vi.mock('../src/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/limits')>()),
  SILHOUETTE_BUDGET_MS: 0.01,
}))

/** 결정적 표본 — 두 무리가 갈리는 2차원 점. */
function blobs(rows: number): number[][] {
  let state = 11
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  return Array.from({ length: rows }, (_, row) => [
    (row % 2) * 4 + random() * 3,
    (row % 2) * 4 + random() * 3,
  ])
}

describe('실루엣 표본은 randomState로 뽑는다', () => {
  const data = blobs(300)
  const assignments = data.map((_, index) => index % 2)
  const centroids = [
    [1.5, 1.5],
    [5.5, 5.5],
  ]

  it('이 판에서는 표본이 켜진다 - 안 켜지면 씨앗이 안 끼어 아래 판이 뜻을 잃는다', () => {
    expect(silhouetteSampleSize(data.length, 2)).toBeLessThan(data.length)
  })

  it('두 씨앗이면 갈리고 같은 씨앗이면 같다', () => {
    const first = CLUSTER_EVALUATOR(data, assignments, centroids, 42).metrics.silhouette
    const again = CLUSTER_EVALUATOR(data, assignments, centroids, 42).metrics.silhouette
    const other = CLUSTER_EVALUATOR(data, assignments, centroids, 7).metrics.silhouette
    expect(again).toBe(first)
    expect(other).not.toBe(first)
  })
})

describe('신경망의 에폭 섞기는 randomState로 섞는다', () => {
  /**
   * **초기화가 아니라 섞기를 따로 본다.** 초기 가중치도 `randomState`로 뽑으므로 곡선만
   * 견주면 섞기에서 씨앗을 빼도 두 씨앗의 곡선이 갈린다. 그래서 **첫 배치의 행 순서**를
   * 받아 적는다 — 풀의 `step`이 조각을 받는 자리이고, 조각을 이어 붙이면 그 배치의 순서다.
   * 받아 적은 뒤에는 거절하고, 학습은 직렬로 물러나 끝난다(아래 `firstBatchOrder`).
   */
  const rows = 120
  const features = Array.from({ length: rows }, (_, index) => [index / rows, (index % 3) / 3])
  const targets = features.map((_, index) => index % 2)
  const task = { kind: 'classification', classCount: 2 } as const
  const options = { hiddenLayers: 1, neuronsPerLayer: 3 }

  /**
   * 첫 배치의 행 순서를 받아 적는다.
   *
   * **풀의 거절은 학습을 끊지 않는다** (2026-09-29 감사 F B-3). `fitNeural`은 풀이 거절하면
   * 그 스텝부터 직렬로 물러나 끝까지 돈다(`engines/neural.ts`의 `active`). 그래서 이 기록 풀은
   * **첫 호출만 적고 거절한 뒤 학습이 끝나기를 기다린다** — 전에는 그 거절을 "여기서 끊는다"는
   * 장치로 썼고, 폴백이 들어오자 이 검사가 옛 의미에 기대 있던 것이 드러났다.
   *
   * **덤으로 물러난 학습이 같은 순서를 쓰는지 본다.** 풀 없이 돈 직렬 학습과 모델이 같으면
   * 폴백이 첫 배치를 버리거나 섞기를 다시 하지 않은 것이다.
   */
  async function firstBatchOrder(randomState: number): Promise<number[]> {
    const seen: number[] = []
    let calls = 0
    const recording: NeuralPoolFactory = () => ({
      step(_parameters, chunks) {
        calls += 1
        seen.push(...chunks.flat())
        // 첫 배치만 필요하다 — 거절해서 남은 학습을 직렬로 물러나게 한다.
        return Promise.reject(new Error('first batch recorded'))
      },
      dispose() {},
    })
    const fallen = await fitNeural(features, targets, task, options, randomState, recording)
    // 한 번 거절하면 풀을 다시 안 부른다 — 둘째 배치가 섞여 들면 위 순서가 첫 배치가 아니다.
    expect(calls, 'the pool was asked again after it refused').toBe(1)
    const serial = await fitNeural(features, targets, task, options, randomState)
    expect(fallen.weights).toEqual(serial.weights)
    expect(fallen.lossCurve).toEqual(serial.lossCurve)
    return seen
  }

  it('첫 배치가 표본 전부를 한 번씩 담는다 - 순서를 견줄 재료가 온전하다', async () => {
    const order = await firstBatchOrder(42)
    expect([...order].sort((a, b) => a - b)).toEqual(features.map((_, index) => index))
  })

  it('두 씨앗이면 첫 배치의 순서가 갈리고 같은 씨앗이면 같다', async () => {
    const first = await firstBatchOrder(42)
    const again = await firstBatchOrder(42)
    const other = await firstBatchOrder(7)
    expect(again).toEqual(first)
    expect(other).not.toEqual(first)
  })
})
