// @vitest-environment jsdom
/**
 * **랜덤포레스트를 코어로 갈라도 같은 숲이 나온다** — 이 파일이 그 결정의 트립와이어다
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * 신경망과 달리 **엔진 버전이 안 움직인다.** 근거가 여기 있다 — `ml-random-forest`의
 * 씨앗 사슬은 표집 함수 둘에서만 진화하고 트리 학습은 그것을 안 건드리므로, 나무마다의
 * 씨앗만 뽑아 두면 어느 워커에서 몇 개씩 짓든 **라이브러리가 직렬로 지은 그 숲**이 나온다.
 *
 * **그래서 여기서 재는 것은 우리 코드끼리가 아니라 우리와 라이브러리다.** 남의 내부
 * 모듈(`src/utils.js`)을 부르고 있어 semver 밖이고, 저쪽이 표집을 바꾸면 **이 파일이
 * 빨개지는 것이 유일한 신호**다.
 */

import { RandomForestClassifier } from 'ml-random-forest'
import { Matrix } from 'ml-matrix'
import { describe, expect, it } from 'vitest'

import { MLJS_FOREST_PARALLEL_MIN_TREE_ROWS } from '../src/limits'
import { fit } from '../src/ml/engines/mljs'
import type { ComputePools, ForestPoolFactory, ForestTree } from '../src/ml/pools'
import { growTree } from '../src/ml/worker/forest-compute'
import { forestSeeds, shouldSplitForest } from '../src/ml/worker/forest-pool'
import { assignSpans } from '../src/ml/worker/pool'

/** 결정적 표본. 세 클래스가 실제로 갈리는 관계라 나무가 헛돌지 않는다. */
function sample(rows: number): { features: number[][]; labels: string[]; encoded: number[] } {
  let state = 5
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const features: number[][] = []
  const encoded: number[] = []
  for (let index = 0; index < rows; index += 1) {
    const a = random()
    const b = random()
    features.push([a, b, random(), random()])
    encoded.push(a + b > 1.2 ? 2 : a > 0.5 ? 1 : 0)
  }
  // 엔진은 라벨 문자열을 받는다. `labelCodec`이 정렬해 부호화하므로 이름을 그 순서로 짓는다.
  const names = ['a0', 'b1', 'c2']
  return { features, labels: encoded.map((one) => names[one] as string), encoded }
}

/**
 * 검사용 풀 — 워커 없이 **같은 함수**(`growTree`)를 제자리에서 돌린다. 진짜 풀과 다른
 * 것은 워커가 없다는 것뿐이라, 이 풀로 숲이 같으면 남는 변수는 씨앗 사슬 하나다.
 */
function inProcessForestPool(log?: { grown: number }): ForestPoolFactory {
  return (seed) => ({
    grow() {
      const matrix = Matrix.checkMatrix(seed.features.map((row) => [...row]))
      const targets = [...seed.targets]
      const chain = forestSeeds(
        matrix,
        targets,
        seed.treeCount,
        seed.randomState,
        seed.featureSampleCount,
        seed.replacement,
      )
      if (log) log.grown += chain.length
      const trees: ForestTree[] = chain.map((one) =>
        growTree(matrix, targets, one, seed.featureSampleCount, seed.replacement, seed.treeOptions),
      )
      return Promise.resolve(trees)
    },
    dispose() {},
  })
}

const TREES = 6

async function forestModel(pools?: ComputePools): Promise<unknown> {
  const { features, labels } = sample(120)
  const result = await fit('random_forest', {
    features,
    rowIndices: features.map((_, index) => index),
    target: labels,
    taskType: 'classification',
    hyperparameters: { nEstimators: TREES },
    randomState: 42,
    ...(pools ? { pools } : {}),
  })
  return result.model
}

describe('갈라도 같은 숲이다', () => {
  it('풀을 준 학습과 안 준 학습이 같은 모델 파일을 낸다', async () => {
    const log = { grown: 0 }
    const serial = await forestModel()
    const parallel = await forestModel({ forest: inProcessForestPool(log) })

    // 풀이 실제로 쓰였는지 먼저 — 안 쓰였으면 아래 비교는 아무것도 안 잰다.
    expect(log.grown).toBe(TREES)
    expect(parallel).toEqual(serial)
  })

  it('라이브러리가 직렬로 지은 숲과 나무·열 번호가 바이트 단위로 같다', () => {
    // **여기가 semver 밖을 지키는 자리다.** 저쪽이 표집을 바꾸면 이 단언이 깨진다.
    const { features, encoded } = sample(200)
    const stock = new RandomForestClassifier({
      nEstimators: TREES,
      seed: 42,
      useSampleBagging: true,
      noOOB: true,
    })
    stock.train(features, encoded)

    const matrix = Matrix.checkMatrix(features.map((row) => [...row]))
    const columns = features[0]?.length ?? 0
    const chain = forestSeeds(matrix, [...encoded], TREES, 42, columns, true)
    const ours = chain.map((seed) => growTree(matrix, [...encoded], seed, columns, true, undefined))

    const json = stock.toJSON() as unknown as {
      baseModel: { estimators: unknown[]; indexes: number[][] }
    }
    expect(ours.map((one) => one.tree)).toEqual(json.baseModel.estimators)
    expect(ours.map((one) => [...one.usedIndex])).toEqual(json.baseModel.indexes)
  })

  it('나무를 어떻게 나눠도 씨앗 순서가 같다 — 워커 수가 결과에 못 스민다', () => {
    const { features, encoded } = sample(60)
    const columns = features[0]?.length ?? 0
    const chain = forestSeeds(
      Matrix.checkMatrix(features.map((row) => [...row])),
      [...encoded],
      TREES,
      42,
      columns,
      true,
    )
    for (const workers of [1, 2, 3, 4, 7]) {
      // 배분을 이어 붙이면 언제나 같은 씨앗 목록이다 — 재조립이 곧 나무 번호 순서다.
      const merged = assignSpans(chain.length, workers).flatMap((span) =>
        chain.slice(span.start, span.end),
      )
      expect(merged, `workers=${workers}`).toEqual(chain)
    }
  })
})

describe('게이트', () => {
  it('작은 숲은 직렬로 남긴다 - 문턱은 속도만 가른다', () => {
    // 스폰 고정비(35ms)가 아끼는 시간을 먹는 자리.
    expect(shouldSplitForest(100, 10)).toBe(false)
    // 실측의 자리 — 500행×10그루가 직렬 575ms다.
    expect(500 * 10).toBeGreaterThanOrEqual(MLJS_FOREST_PARALLEL_MIN_TREE_ROWS)
    expect(shouldSplitForest(500, 10)).toBe(true)
  })
})
