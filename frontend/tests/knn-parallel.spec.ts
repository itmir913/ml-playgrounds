// @vitest-environment jsdom
/**
 * **KNN 채점을 코어로 갈라도 같은 답이 나온다**
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * KNN이 가르는 자리는 학습이 아니라 **채점**이다 — 담는 것이 행 번호뿐이라 학습에
 * 비용이 없고, 시험 행마다 이웃을 찾는 것이 전부다. **행마다 완전히 독립**이라 갈라도
 * 답이 같고, 그래서 엔진 버전이 안 움직인다.
 *
 * 여기서 재는 것 넷 —
 *
 * 1. 워커의 손이 엔진의 `knnPredict`와 **같은 답**을 낸다 (두 벌이 아니라 한 벌이다).
 * 2. `predictBatch`가 `predict`와 같은 답을 낸다 — 실험 실행이 채점에 쓰는 그 길이다.
 * 3. 어떻게 나눠도 이어 붙인 답이 같다 — 워커 수가 결과에 못 스민다.
 * 4. 게이트는 크기만 보고, 안 가르면 `null`로 **빈 답과 구분해서** 말한다.
 */

import { describe, expect, it } from 'vitest'

import { MLJS_KNN_PARALLEL_MIN_ROW_PRODUCT } from '../src/limits'
import { fit } from '../src/ml/engines/mljs'
import { knnPredict } from '../src/ml/models'
import type { ComputePools, KnnPool, KnnPoolFactory } from '../src/ml/pools'
import { createKnnComputeHandler, type KnnComputeReply } from '../src/ml/worker/knn-compute'
import { shouldSplitKnn } from '../src/ml/worker/knn-pool'
import { assignSpans } from '../src/ml/worker/pool'

const FEATURES = 3

/** 결정적 표본. 동점이 실제로 생기도록 좌표를 성기게 잡는다. */
function sample(rows: number, offset = 0): number[][] {
  let state = 13 + offset
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return Math.round((state / 4294967296) * 6) / 6
  }
  return Array.from({ length: rows }, () => Array.from({ length: FEATURES }, random))
}

const TRAIN = sample(40)
const LABELS = TRAIN.map((row) => ((row[0] ?? 0) > 0.5 ? 'high' : 'low'))
const TEST = sample(12, 7)

/** 워커 없이 **같은 손**(`createKnnComputeHandler`)을 제자리에서 돌리는 풀. */
function inProcessKnnPool(log?: { calls: number }): KnnPoolFactory {
  return (seed): KnnPool => {
    const handle = createKnnComputeHandler()
    const flat = new Float64Array(seed.rows.length * seed.featureCount)
    seed.rows.forEach((row, index) => flat.set(row, index * seed.featureCount))
    handle(
      {
        type: 'seed',
        k: seed.k,
        featureCount: seed.featureCount,
        rows: flat,
        labels: [...seed.labels],
        indices: [...seed.indices],
      },
      () => {
        throw new Error('seed must not reply')
      },
    )
    return {
      answer(queries) {
        if (log) log.calls += 1
        // 진짜 풀과 같은 배분으로 나눠 던지고, 워커 번호 순서로 이어 붙인다.
        const spans = assignSpans(queries.length, 3)
        const merged: string[] = []
        for (const span of spans) {
          const slice = queries.slice(span.start, span.end)
          const chunk = new Float64Array(slice.length * seed.featureCount)
          slice.forEach((row, index) => chunk.set(row, index * seed.featureCount))
          let reply: KnnComputeReply | null = null
          handle({ type: 'step', queries: chunk }, (message) => {
            reply = message
          })
          for (const one of (reply as unknown as KnnComputeReply).answers) merged.push(one)
        }
        return Promise.resolve(merged)
      },
      dispose() {},
    }
  }
}

async function knnFit(pools?: ComputePools) {
  return await fit('knn', {
    features: TRAIN,
    rowIndices: TRAIN.map((_, index) => index),
    target: LABELS,
    taskType: 'classification',
    hyperparameters: { k: 5 },
    randomState: 42,
    ...(pools ? { pools } : {}),
  })
}

describe('갈라도 같은 답이다', () => {
  it('워커의 손이 엔진의 knnPredict와 같은 답을 낸다', () => {
    const handle = createKnnComputeHandler()
    const flat = new Float64Array(TRAIN.length * FEATURES)
    TRAIN.forEach((row, index) => flat.set(row, index * FEATURES))
    handle(
      {
        type: 'seed',
        k: 5,
        featureCount: FEATURES,
        rows: flat,
        labels: LABELS,
        indices: TRAIN.map((_, index) => index),
      },
      () => {
        throw new Error('seed must not reply')
      },
    )

    const queries = new Float64Array(TEST.length * FEATURES)
    TEST.forEach((row, index) => queries.set(row, index * FEATURES))
    let reply: KnnComputeReply | null = null
    handle({ type: 'step', queries }, (message) => {
      reply = message
    })

    const direct = knnPredict({
      k: 5,
      featureCount: FEATURES,
      rows: TRAIN,
      labels: LABELS,
      indices: TRAIN.map((_, index) => index),
    })(TEST).map(String)

    expect((reply as unknown as KnnComputeReply).answers).toEqual(direct)
  })

  it('predictBatch가 predict와 같은 답을 낸다 — 채점이 쓰는 그 길이다', async () => {
    const log = { calls: 0 }
    const fitted = await knnFit({ knn: inProcessKnnPool(log) })
    expect(fitted.predictBatch, 'the pool must hand one down').toBeDefined()

    const batched = await fitted.predictBatch!(TEST)
    expect(log.calls).toBe(1)
    expect(batched).toEqual(fitted.predict(TEST))
  })

  it('손이 없으면 predictBatch도 없다 — 그때는 동기 예측 하나뿐이다', async () => {
    const fitted = await knnFit()
    expect(fitted.predictBatch).toBeUndefined()
  })

  it('어떻게 나눠도 이어 붙인 답이 같다', () => {
    const predict = knnPredict({
      k: 5,
      featureCount: FEATURES,
      rows: TRAIN,
      labels: LABELS,
      indices: TRAIN.map((_, index) => index),
    })
    const whole = predict(TEST).map(String)
    for (const workers of [1, 2, 3, 5, 12]) {
      const merged = assignSpans(TEST.length, workers).flatMap((span) =>
        predict(TEST.slice(span.start, span.end)).map(String),
      )
      expect(merged, `workers=${workers}`).toEqual(whole)
    }
  })
})

describe('게이트', () => {
  it('작은 채점은 직렬로 남긴다 - 문턱은 속도만 가른다', () => {
    expect(shouldSplitKnn(12, 40)).toBe(false)
    // 기준표의 자리 — 훈련 35,000 × 시험 15,000이 44.7초다.
    expect(35_000 * 15_000).toBeGreaterThanOrEqual(MLJS_KNN_PARALLEL_MIN_ROW_PRODUCT)
    expect(shouldSplitKnn(15_000, 35_000)).toBe(true)
  })
})
