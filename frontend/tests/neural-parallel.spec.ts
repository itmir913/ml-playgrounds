// @vitest-environment jsdom
/**
 * **결과는 코어 수와 무관하다** — 이 파일이 그 결정의 트립와이어다
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * 신경망 기울기는 고정 조각(chunk) 접기가 정본이고, 워커 풀은 조각을 **계산할 뿐**
 * 접는 순서를 못 바꾼다. 그래서 여기서 재는 것은 넷이다 —
 *
 * 1. 풀을 준 학습과 안 준 학습이 **비트 단위로 같은 모델**을 낸다 (엔진 버전 3의 정의).
 * 2. 컴퓨트 워커의 손(`createNeuralComputeHandler`)이 엔진의 `accumulateChunk`와
 *    같은 답을 낸다 — 두 벌이 아니라 한 벌임을 못 박는다.
 * 3. 조각 배분(`assignChunks`)이 이어진 덩어리로 전부를 정확히 한 번씩 덮는다 —
 *    워커 답을 순서대로 이어 붙이면 조각 번호 순서가 되는 근거다.
 * 4. 게이트(`shouldSplitNeural`)는 크기만 보고, 갈라도 안 갈라도 결과가 같으므로
 *    문턱이 틀려도 잃는 것은 시간뿐이다.
 */

import { describe, expect, it } from 'vitest'

import { NEURAL_PARALLEL_CHUNK_ROWS, NEURAL_BATCH_SIZE } from '../src/limits'
import {
  accumulateChunk,
  fitNeural,
  objectiveFor,
  parameterCellCount,
  readParameters,
  weightCellCount,
  type NeuralPoolFactory,
  type NeuralTask,
} from '../src/ml/engines/neural'
import { createNeuralComputeHandler } from '../src/ml/worker/neural-compute'
import { assignChunks, shouldSplitNeural } from '../src/ml/worker/neural-pool'

/** 결정적 표본. 세 클래스가 실제로 갈리는 관계라 학습이 헛돌지 않는다. */
function sample(rows: number): { features: number[][]; targets: number[] } {
  let state = 7
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const features: number[][] = []
  const targets: number[] = []
  for (let i = 0; i < rows; i += 1) {
    const a = random()
    const b = random()
    features.push([a, b, random() * 0.1])
    targets.push(a + b > 1.2 ? 2 : a > 0.5 ? 1 : 0)
  }
  return { features, targets }
}

const TASK: NeuralTask = { kind: 'classification', classCount: 3 }

/**
 * 검사용 풀 — 엔진과 **같은 함수**를 제자리에서 돌린다. 진짜 풀과 다른 것은 워커가
 * 없다는 것뿐이고, 그래서 이 풀로 결과가 같으면 남는 변수는 접는 순서 하나다.
 */
function inProcessPool(log?: { steps: number }): NeuralPoolFactory {
  return (seed) => {
    const objective = objectiveFor(seed.task)
    const activations = seed.sizes.map((size) => new Float64Array(size))
    const deltas = seed.sizes.slice(1).map((size) => new Float64Array(size))
    return {
      step(parameters, chunks) {
        if (log) log.steps += 1
        const { weights, intercepts } = readParameters(parameters, seed.sizes)
        return Promise.resolve(
          chunks.map((rows) => {
            const gradWeights = seed.sizes
              .slice(0, -1)
              .map((size, layer) => new Float64Array(size * (seed.sizes[layer + 1] as number)))
            const gradIntercepts = seed.sizes.slice(1).map((size) => new Float64Array(size))
            const lossSum = accumulateChunk(
              weights,
              intercepts,
              seed.features,
              seed.targets,
              rows,
              objective,
              activations,
              deltas,
              gradWeights,
              gradIntercepts,
            )
            return { lossSum, gradWeights, gradIntercepts }
          }),
        )
      },
      dispose() {},
    }
  }
}

describe('결과는 코어 수와 무관하다', () => {
  it('풀을 준 학습과 안 준 학습이 비트 단위로 같은 모델을 낸다', async () => {
    // 조각 셋(50·50·20)이 나오는 크기 — 접기가 실제로 여러 번 일어난다.
    const { features, targets } = sample(120)
    expect(features.length).toBeGreaterThan(NEURAL_PARALLEL_CHUNK_ROWS * 2)

    const options = { hiddenLayers: 2, neuronsPerLayer: 8 }
    const serial = await fitNeural(features, targets, TASK, options, 42)
    const log = { steps: 0 }
    const pooled = await fitNeural(features, targets, TASK, options, 42, inProcessPool(log))

    // 풀이 실제로 쓰였는지 먼저 — 안 쓰였으면 아래 비교는 아무것도 안 잰다.
    expect(log.steps).toBeGreaterThan(0)
    // toEqual은 수를 정확히 견준다. "가깝다"가 아니라 "같다"가 이 결정의 내용이다.
    expect(pooled.weights).toEqual(serial.weights)
    expect(pooled.intercepts).toEqual(serial.intercepts)
    expect(pooled.lossCurve).toEqual(serial.lossCurve)
    expect(pooled.epochs).toBe(serial.epochs)
    expect(pooled.converged).toBe(serial.converged)
  })

  it('회귀도 같다 — 목적함수가 갈려도 접는 순서는 하나다', async () => {
    const { features, targets } = sample(120)
    const raw = targets.map((value, i) => value * 2 + (features[i]?.[0] ?? 0))
    const task: NeuralTask = { kind: 'regression' }

    const options = { hiddenLayers: 1, neuronsPerLayer: 6 }
    const serial = await fitNeural(features, raw, task, options, 7)
    const pooled = await fitNeural(features, raw, task, options, 7, inProcessPool())

    expect(pooled.weights).toEqual(serial.weights)
    expect(pooled.lossCurve).toEqual(serial.lossCurve)
  })
})

describe('컴퓨트 워커의 손', () => {
  it('엔진의 accumulateChunk와 같은 답을 낸다 — 두 벌이 아니라 한 벌이다', () => {
    const { features, targets } = sample(60)
    const sizes = [3, 5, 3] as const
    const handle = createNeuralComputeHandler()

    // 씨앗 — 진짜 풀이 보내는 그 모양(행을 이어 붙인 버퍼)이다.
    const flat = new Float64Array(features.length * 3)
    features.forEach((row, i) => flat.set(row, i * 3))
    handle(
      {
        type: 'seed',
        rows: flat,
        columns: 3,
        targets: Float64Array.from(targets),
        sizes: [...sizes],
        task: TASK,
      },
      () => {
        throw new Error('seed must not reply')
      },
    )

    const parameters = new Float64Array(parameterCellCount(sizes)).map(
      (_, index) => Math.sin(index) * 0.3,
    )
    const chunk = [3, 1, 4, 1, 5, 9, 2, 6]
    let reply: Parameters<Parameters<typeof handle>[1]>[0] | null = null
    handle({ type: 'step', parameters, chunks: [chunk] }, (message) => {
      reply = message
    })

    // 같은 조각을 엔진 함수로 직접 계산한다.
    const { weights, intercepts } = readParameters(parameters, sizes)
    const gradWeights = [new Float64Array(15), new Float64Array(15)]
    const gradIntercepts = [new Float64Array(5), new Float64Array(3)]
    const lossSum = accumulateChunk(
      weights,
      intercepts,
      features,
      targets,
      chunk,
      objectiveFor(TASK),
      sizes.map((size) => new Float64Array(size)),
      [new Float64Array(5), new Float64Array(3)],
      gradWeights,
      gradIntercepts,
    )

    expect(reply).not.toBeNull()
    const result = reply!.results[0]!
    expect(result.lossSum).toBe(lossSum)
    expect(result.gradWeights).toEqual(gradWeights)
    expect(result.gradIntercepts).toEqual(gradIntercepts)
  })

  it('씨앗 전의 스텝은 던진다 — 조용한 빈 답은 접는 값을 통째로 틀리게 한다', () => {
    const handle = createNeuralComputeHandler()
    expect(() =>
      handle({ type: 'step', parameters: new Float64Array(1), chunks: [[0]] }, () => {}),
    ).toThrow()
  })
})

describe('조각 배분', () => {
  it('이어진 덩어리로 전부를 정확히 한 번씩 덮는다', () => {
    for (const [chunks, workers] of [
      [4, 4],
      [4, 2],
      [4, 3],
      [3, 4],
      [1, 4],
      [7, 3],
    ] as const) {
      const spans = assignChunks(chunks, workers)
      // 빈 몫은 아예 안 나온다 — 빈 스텝을 워커에 보내면 답 재조립이 어긋난다.
      expect(spans.every((span) => span.end > span.start)).toBe(true)
      expect(spans.length).toBeLessThanOrEqual(Math.min(chunks, workers))
      // 이어 붙이면 0..chunks가 그대로다 — 워커 번호 순서가 곧 조각 번호 순서인 근거.
      let cursor = 0
      for (const span of spans) {
        expect(span.start).toBe(cursor)
        cursor = span.end
      }
      expect(cursor).toBe(chunks)
    }
  })
})

describe('게이트', () => {
  it('작은 일은 직렬로 남긴다 - 문턱은 속도만 가른다', () => {
    // 작은 망 × 적은 행 — 통신이 계산을 이기는 자리.
    expect(shouldSplitNeural([8, 16, 3], 100)).toBe(false)
    // 큰 망 × 기본 배치 — 실측의 자리(가중치 4.2만 × 배치 200 = 8.3M ≥ 문턱).
    const big = [8, 100, 100, 100, 100, 100, 3]
    expect(weightCellCount(big) * NEURAL_BATCH_SIZE).toBeGreaterThan(3_000_000)
    expect(shouldSplitNeural(big, 14_000)).toBe(true)
  })
})
