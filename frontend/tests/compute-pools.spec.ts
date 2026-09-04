// @vitest-environment jsdom
/**
 * **세 풀 공장을 진짜로 부르는 유일한 스펙** (2026-09-04 R26 A-1·A-3·A-4).
 *
 * 병렬 스펙 셋(`neural-parallel`·`forest-parallel`·`knn-parallel`)이 재는 것은 순수
 * 헬퍼와 **스펙이 다시 구현한 가짜 풀**이었다. 공장의 몸통 — 평탄화, span↔워커
 * 짝짓기, 재조립, `dispose` — 은 한 줄도 안 돌았고, 그래서 감사자가 재조립 순서를
 * 뒤집고 표 색인을 어긋내고 실물 배선을 지워도 **관문이 전부 초록이었다.**
 *
 * 여기서는 `spawn.ts`만 갈아 끼우고 **나머지는 전부 제품 코드다.** 가짜 워커는 양쪽
 * 방향에 `structuredClone`을 태운다 (`fixtures/compute-workers.ts`).
 *
 * **표본 크기를 줄이지 마라.** 세 게이트(`shouldSplit*`)가 문턱 아래면 공장이 `null`을
 * 내고 **이 파일의 단언들은 아무것도 안 잰 채 초록이 된다.** 그래서 검사마다
 * `spawned`를 먼저 본다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Matrix } from 'ml-matrix'

import {
  computeWorkerLog,
  installComputeWorkers,
  resetComputeWorkers,
} from './fixtures/compute-workers'

vi.mock('../src/ml/worker/spawn', async () => {
  const forest = await import('../src/ml/worker/forest-compute')
  const knn = await import('../src/ml/worker/knn-compute')
  const neural = await import('../src/ml/worker/neural-compute')
  const fixture = await import('./fixtures/compute-workers')
  return {
    spawnTrainingWorker: () => {
      throw new Error('this spec never spawns a training worker')
    },
    spawnForestWorker: () => fixture.fakeComputeWorker(forest.createForestComputeHandler()),
    spawnKnnWorker: () => fixture.fakeComputeWorker(knn.createKnnComputeHandler()),
    spawnNeuralComputeWorker: () => fixture.fakeComputeWorker(neural.createNeuralComputeHandler()),
  }
})

/**
 * **실물 주입 한 줄을 잡아 두는 손** (R26 A-4). `handler.ts:33`이 유일한 배선 자리인데
 * 아무 검사도 안 물어서, 감사자가 `knn`을 지우자 **KNN 병렬화가 통째로 꺼진 채 관문이
 * 초록이었다.** 학생은 2.36배를 잃고 아무도 모른다.
 */
const wiring = vi.hoisted(() => ({ options: null as Record<string, unknown> | null }))
vi.mock('../src/ml/experiment', async () => {
  const actual =
    await vi.importActual<typeof import('../src/ml/experiment')>('../src/ml/experiment')
  return {
    ...actual,
    runExperiment: (_input: unknown, options: Record<string, unknown>) => {
      wiring.options = options
      // 여기서 멈춘다 — 재는 것은 넘어간 손들이지 학습이 아니다.
      throw new Error('wiring probe: stop here')
    },
  }
})

import { NEURAL_BATCH_SIZE } from '../src/limits'
import { knnPredict } from '../src/ml/models'
import { parameterCellCount, weightCellCount, type NeuralTask } from '../src/ml/engines/neural'
import { growTree } from '../src/ml/worker/forest-compute'
import {
  createNeuralComputeHandler,
  type NeuralComputeChunk,
  type NeuralComputeReply,
} from '../src/ml/worker/neural-compute'
import { forestSeeds, forestPoolFactory } from '../src/ml/worker/forest-pool'
import { assignSpans, poolWorkerCount } from '../src/ml/worker/pool'
import { knnPoolFactory } from '../src/ml/worker/knn-pool'
import { neuralPoolFactory } from '../src/ml/worker/neural-pool'

beforeEach(() => {
  resetComputeWorkers()
  installComputeWorkers()
})

/** 결정적 표본. 값이 겹치지 않아 이웃과 갈래가 흔들리지 않는다. */
function rows(count: number, columns: number, seed: number): number[][] {
  let state = seed >>> 0
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  return Array.from({ length: count }, () => Array.from({ length: columns }, () => random()))
}

describe('포레스트 풀 공장 — 진짜 워커 경계를 지난다', () => {
  // 500행 × 10그루가 게이트(`MLJS_FOREST_PARALLEL_MIN_TREE_ROWS`)의 자리다.
  const FEATURES = rows(500, 4, 7)
  const TARGETS = FEATURES.map((row) => ((row[0] as number) > 0.5 ? 1 : 0))
  const SEED = {
    features: FEATURES,
    targets: TARGETS,
    treeCount: 10,
    randomState: 42,
    featureSampleCount: 4,
    replacement: true,
    treeOptions: undefined,
  }

  it('갈라 지은 숲이 직렬 사슬과 나무 순서까지 같다', async () => {
    const pool = forestPoolFactory(SEED)
    // 게이트가 닫히면 표본이 문턱 아래라는 뜻이고, 그러면 아래가 아무것도 안 잰다.
    expect(pool, 'gate closed: sample is below the threshold').not.toBeNull()
    const grown = await (pool as NonNullable<typeof pool>).grow()
    // 워커가 실제로 넷 떴는가. 하나면 재조립 순서가 안 걸린다.
    expect(computeWorkerLog.spawned).toBe(4)

    const matrix = Matrix.checkMatrix(FEATURES.map((row) => [...row]))
    const chain = forestSeeds(matrix, [...TARGETS], 10, 42, 4, true)
    const expected = chain.map((one) => growTree(matrix, [...TARGETS], one, 4, true, undefined))

    // 나무마다의 열 번호가 순서까지 같아야 한다 — 재조립이 뒤집히면 여기가 먼저 운다.
    expect(grown.map((one) => [...one.usedIndex])).toEqual(
      expected.map((one) => [...one.usedIndex]),
    )
    expect(JSON.parse(JSON.stringify(grown))).toEqual(JSON.parse(JSON.stringify(expected)))

    ;(pool as NonNullable<typeof pool>).dispose()
    expect(computeWorkerLog.terminated).toBe(4)
  })

  it('씨앗이 스텝보다 먼저 간다 — 순서가 뒤집히면 워커가 던진다', async () => {
    const pool = forestPoolFactory(SEED)
    await (pool as NonNullable<typeof pool>).grow()
    for (let worker = 0; worker < 4; worker += 1) {
      const mine = computeWorkerLog.requests.filter((one) => one.worker === worker)
      expect(mine[0]?.type, `worker ${worker}`).toBe('seed')
    }
    ;(pool as NonNullable<typeof pool>).dispose()
  })

  it('작은 숲에는 워커를 안 띄운다', () => {
    expect(forestPoolFactory({ ...SEED, treeCount: 1 })).toBeNull()
    expect(computeWorkerLog.spawned).toBe(0)
  })
})

describe('KNN 풀 공장 — 진짜 워커 경계를 지난다', () => {
  // 시험 2,000 × 훈련 1,000 = 200만이 게이트의 자리다.
  const TRAIN = rows(1_000, 2, 11)
  const QUERIES = rows(2_000, 2, 29)
  const LABELS = TRAIN.map((row) => ((row[1] as number) > 0.5 ? 'yes' : 'no'))
  const SEED = {
    k: 3,
    featureCount: 2,
    rows: TRAIN,
    labels: LABELS,
    indices: TRAIN.map((_, index) => index),
  }

  it('갈라 낸 답이 직렬 예측과 행 순서까지 같다', async () => {
    const pool = knnPoolFactory(SEED)
    expect(pool).not.toBeNull()
    const answers = await (pool as NonNullable<typeof pool>).answer(QUERIES)
    expect(computeWorkerLog.spawned).toBe(4)
    // `null`은 "안 갈랐다"이고 그러면 아래 비교가 무의미하다.
    expect(answers, 'pool did not split').not.toBeNull()

    const serial = knnPredict({
      k: 3,
      featureCount: 2,
      rows: TRAIN,
      labels: [...LABELS],
      indices: SEED.indices,
    })(QUERIES).map(String)
    expect(answers).toEqual(serial)

    ;(pool as NonNullable<typeof pool>).dispose()
    expect(computeWorkerLog.terminated).toBe(4)
  })

  it('작은 일에는 `null`을 내고 워커를 안 띄운다 — 빈 배열이 아니다', async () => {
    const pool = knnPoolFactory(SEED)
    const answer = await (pool as NonNullable<typeof pool>).answer(QUERIES.slice(0, 5))
    expect(answer).toBeNull()
    expect(computeWorkerLog.spawned).toBe(0)
  })
})

describe('신경망 풀 공장 — 진짜 워커 경계를 지난다', () => {
  // 가중치 15,300 × 배치 200 = 306만이 게이트의 자리다.
  const SIZES = [50, 100, 100, 3]
  const FEATURES = rows(NEURAL_BATCH_SIZE, 50, 13)
  const TARGETS = FEATURES.map((row) => ((row[0] as number) * 3) | 0)
  const TASK: NeuralTask = { kind: 'classification', classCount: 3 }
  const SEED = { features: FEATURES, targets: TARGETS, sizes: SIZES, task: TASK }

  it('갈라 접은 조각들이 조각 번호 순서로 돌아온다', async () => {
    expect(weightCellCount(SIZES) * NEURAL_BATCH_SIZE).toBeGreaterThan(3_000_000)
    const pool = neuralPoolFactory(SEED)
    expect(pool).not.toBeNull()

    const parameters = new Float64Array(parameterCellCount(SIZES))
    for (let cell = 0; cell < parameters.length; cell += 1)
      parameters[cell] = (cell % 17) / 100 - 0.08
    // 조각 여덟 — 워커 넷에 둘씩 간다. 하나면 재조립이 안 걸린다.
    const chunks = Array.from({ length: 8 }, (_, index) =>
      Array.from({ length: 25 }, (_, row) => index * 25 + row),
    )
    const results = await (pool as NonNullable<typeof pool>).step(parameters, chunks)
    expect(computeWorkerLog.spawned).toBe(4)
    expect(results).toHaveLength(chunks.length)

    /**
     * **같은 손을 제자리에서 한 번에 돌린 것과 견준다.** 워커 넷이 둘씩 나눠 접은
     * 답을 이어 붙이면 조각 여덟을 통째로 준 것과 **순서까지** 같아야 한다 —
     * 재조립이 뒤집히면 여기가 운다.
     */
    const columns = FEATURES[0]?.length ?? 0
    const flat = new Float64Array(FEATURES.length * columns)
    for (let row = 0; row < FEATURES.length; row += 1)
      for (let column = 0; column < columns; column += 1)
        flat[row * columns + column] = (FEATURES[row] as number[])[column] as number
    const handle = createNeuralComputeHandler()
    handle(
      {
        type: 'seed',
        rows: flat,
        columns,
        targets: Float64Array.from(TARGETS),
        sizes: SIZES,
        task: TASK,
      },
      () => {},
    )
    let expected: NeuralComputeReply | null = null
    handle({ type: 'step', parameters, chunks }, (reply) => {
      expected = reply
    })
    /** 양쪽을 같은 자로 편다 — 한쪽은 구조화 복제를 지났고 저쪽은 살아 있는 버퍼다. */
    const flatten = (chunks: readonly NeuralComputeChunk[]): unknown[] =>
      chunks.map((one) => [
        one.lossSum,
        one.gradWeights.map((buffer) => [...buffer]),
        one.gradIntercepts.map((buffer) => [...buffer]),
      ])
    expect(flatten(results)).toEqual(flatten((expected as unknown as NeuralComputeReply).results))

    /**
     * **기울기 버퍼는 복사가 아니라 이관으로 돌아온다** (R26 C-7). `emit`의 둘째
     * 인자를 아무 검사도 안 봐서, 이관 목록을 통째로 비워도 조용했다 — 그러면
     * 스텝마다 수만 칸이 복사된다.
     */
    expect(computeWorkerLog.transferred).toBeGreaterThan(0)

    ;(pool as NonNullable<typeof pool>).dispose()
    expect(computeWorkerLog.terminated).toBe(4)
  })

  it('작은 신경망에는 워커를 안 띄운다', () => {
    expect(neuralPoolFactory({ ...SEED, sizes: [4, 5, 3] })).toBeNull()
    expect(computeWorkerLog.spawned).toBe(0)
  })
})

describe('실물 배선 — 학습 워커가 세 손을 다 넘긴다', () => {
  it('`handleTrain`이 신경망·포레스트·KNN 손을 전부 준다', async () => {
    wiring.options = null
    const { handleTrain } = await import('../src/ml/worker/handler')
    const messages: { type: string }[] = []
    await handleTrain(
      {
        type: 'train',
        input: {
          features: [[0]],
          target: ['a'],
          taskType: 'classification',
          algorithms: [],
          randomState: 42,
        },
      } as unknown as Parameters<typeof handleTrain>[0],
      (message) => messages.push(message),
    )
    // 위에서 일부러 던졌으니 실패 메시지가 나온다 — 재는 것은 그 전에 넘어간 손들이다.
    expect(wiring.options, 'runExperiment was never called').not.toBeNull()
    const pools = (wiring.options as unknown as Record<string, unknown>).pools as Record<
      string,
      unknown
    >
    expect(pools, 'no pools were passed at all').toBeDefined()
    // **셋 다다.** 하나라도 빠지면 그 알고리즘만 조용히 직렬로 돌아간다.
    expect(Object.keys(pools).sort()).toEqual(['forest', 'knn', 'neural'])
    for (const [name, factory] of Object.entries(pools))
      expect(typeof factory, `${name} is not a function`).toBe('function')
  })
})

describe('일감 배분의 가장자리', () => {
  /**
   * **`if (size === 0) continue`는 죽은 가지가 아니다** (2026-09-04 R26 C-4).
   *
   * 감사자가 그 줄을 지웠는데 아무도 안 울어서 죽은 가지로 봤다. 실제로는
   * **일감이 0일 때만** 사는 줄이다 — `lanes`가 `max(1, …)`이라 1이 되고, `base`가
   * 0이라 빈 구간 `{0,0}`이 하나 나간다. 그러면 워커가 **빈 스텝**을 받는다.
   * 지금 부르는 자리 셋은 전부 1 이상을 주지만, 그것은 그쪽의 사정이지 이 함수의
   * 계약이 아니다.
   */
  it('일감이 없으면 빈 구간을 안 낸다', () => {
    expect(assignSpans(0, 4)).toEqual([])
  })

  it('일감보다 워커가 많으면 몫 없는 워커가 안 나온다', () => {
    expect(assignSpans(3, 8)).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 2, end: 3 },
    ])
  })

  it('일감이 하나면 가르지 않는다 - 워커 수가 0이다', () => {
    expect(poolWorkerCount(1)).toBe(0)
  })
})
