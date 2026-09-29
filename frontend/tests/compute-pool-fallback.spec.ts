// @vitest-environment jsdom
// 공장들이 `typeof Worker`와 코어 수를 본다 — DOM이 있어야 풀 길을 밟는다.
/**
 * **풀이 비동기로 죽어도 직렬 답이 나온다** (2026-09-29 감사 F B-3).
 *
 * 컴퓨트 워커가 뜨긴 했는데 청크를 못 받으면(수업 중 오프라인, 배포 뒤 옛 탭의 해시)
 * **생성자는 던지지 않는다.** 실패는 나중에 `error` 사건으로 오고, `spawnPool`의 폴백은
 * 동기로 던지는 스폰만 잡는다(`ml/worker/pool.ts`). 전에는 그 사건이 `askWorker`의 거절이
 * 되어 **그 모델이 통째로 실패 run으로 섰다** — 풀은 속도만 가르는 장치인데.
 *
 * 여기서는 `spawn.ts`만 **적재에 실패하는 워커**로 갈아 끼우고 공장·엔진은 전부 제품
 * 코드다. 셋 다 **풀이 실제로 워커를 띄웠는지**를 먼저 본다 — 게이트 아래로 내려가면
 * 공장이 `null`을 내고 이 파일은 아무것도 안 잰 채 초록이 된다.
 *
 * **같은 답이라는 성질 자체는 이웃이 문다** — `neural-parallel.spec.ts`(비트 단위로 같은
 * 모델), `forest-parallel.spec.ts`(같은 모델 파일), `knn-parallel.spec.ts`(`predictBatch`와
 * `predict`가 같은 답). 이 파일은 **물러남이 그 직렬 길로 가는가**를 잰다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawned = vi.hoisted(() => ({ count: 0 }))

/**
 * 적재에 실패하는 워커. **던지지 않고, 받은 요청마다 다음 태스크에 `error`를 쏜다** —
 * 브라우저가 청크를 못 받았을 때의 모양이다(스크립트 적재 실패는 `ErrorEvent`가 아니라
 * 그냥 `Event`다).
 */
vi.mock('../src/ml/worker/spawn', () => {
  const failing = (): Worker => {
    spawned.count += 1
    const target = new EventTarget()
    return {
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      postMessage() {
        setTimeout(() => target.dispatchEvent(new Event('error', { cancelable: true })), 0)
      },
      terminate() {},
    } as unknown as Worker
  }
  return {
    spawnTrainingWorker: () => {
      throw new Error('this spec never spawns a training worker')
    },
    spawnForestWorker: failing,
    spawnKnnWorker: failing,
    spawnNeuralComputeWorker: failing,
  }
})

import { installComputeWorkers } from './fixtures/compute-workers'
import { fit } from '../src/ml/engines/mljs'
import { fitNeural, type NeuralTask } from '../src/ml/engines/neural'
import type { ComputePools } from '../src/ml/pools'
import { forestPoolFactory, shouldSplitForest } from '../src/ml/worker/forest-pool'
import { knnPoolFactory, shouldSplitKnn } from '../src/ml/worker/knn-pool'
import { neuralPoolFactory, shouldSplitNeural } from '../src/ml/worker/neural-pool'

/** 결정적 표본. 세 클래스가 실제로 갈리는 관계라 학습이 헛돌지 않는다. */
function sample(rows: number, seed: number): { features: number[][]; labels: string[] } {
  let state = seed
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const features: number[][] = []
  const labels: string[] = []
  for (let index = 0; index < rows; index += 1) {
    const a = random()
    const b = random()
    features.push([a, b, random()])
    labels.push(a + b > 1.2 ? 'c' : a > 0.5 ? 'b' : 'a')
  }
  return { features, labels }
}

beforeEach(() => {
  spawned.count = 0
  installComputeWorkers()
})

describe('풀이 비동기로 죽어도 직렬 답이 나온다', () => {
  it('KNN — 채점이 실패 run이 되지 않고 직렬 예측과 같은 답이다', async () => {
    const train = sample(1500, 3)
    const test = sample(1400, 11)
    expect(shouldSplitKnn(test.features.length, train.features.length)).toBe(true)

    const fitted = await fit('knn', {
      features: train.features,
      rowIndices: train.features.map((_, index) => index),
      target: train.labels,
      taskType: 'classification',
      hyperparameters: { k: 5 },
      randomState: 42,
      pools: { knn: knnPoolFactory },
    })
    expect(fitted.predictBatch, 'the pool must hand one down').toBeDefined()

    const batched = await fitted.predictBatch!(test.features)
    expect(spawned.count, 'the pool never spawned').toBeGreaterThan(0)
    expect(batched).toEqual(fitted.predict(test.features))
  })

  it('랜덤포레스트 — 모델이 실패하지 않고 직렬로 지은 숲과 같다', async () => {
    const { features, labels } = sample(120, 5)
    const trees = 50
    expect(shouldSplitForest(features.length, trees)).toBe(true)

    const forestFit = (pools?: ComputePools) =>
      fit('random_forest', {
        features,
        rowIndices: features.map((_, index) => index),
        target: labels,
        taskType: 'classification',
        hyperparameters: { nEstimators: trees },
        randomState: 42,
        ...(pools ? { pools } : {}),
      })

    const fallen = await forestFit({ forest: forestPoolFactory })
    expect(spawned.count, 'the pool never spawned').toBeGreaterThan(0)
    const serial = await forestFit()
    expect(fallen.model).toEqual(serial.model)
  })

  it('신경망 — 학습이 실패하지 않고 직렬과 비트 단위로 같은 모델이다', async () => {
    const { features, labels } = sample(400, 7)
    const targets = labels.map((label) => ['a', 'b', 'c'].indexOf(label))
    const task: NeuralTask = { kind: 'classification', classCount: 3 }
    // 가중치 × 배치가 문턱을 넘는 크기. **`tol`을 크게 줘 몇 에폭 안에 멈춘다** — 재는 것은
    // 물러남이지 수렴이 아니다.
    const options = { hiddenLayers: 3, neuronsPerLayer: 100, tol: 1e9 }
    expect(shouldSplitNeural([3, 100, 100, 100, 3], features.length)).toBe(true)

    const fallen = await fitNeural(features, targets, task, options, 42, neuralPoolFactory)
    expect(spawned.count, 'the pool never spawned').toBeGreaterThan(0)
    const serial = await fitNeural(features, targets, task, options, 42)
    expect(fallen.weights).toEqual(serial.weights)
    expect(fallen.lossCurve).toEqual(serial.lossCurve)
  })
})
