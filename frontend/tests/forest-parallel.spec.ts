// @vitest-environment jsdom
/**
 * **랜덤포레스트를 코어로 갈라도 같은 숲이 나온다** — 이 파일이 그 결정의 트립와이어다
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * 신경망과 달리 **엔진 버전이 안 움직인다.** 근거가 여기 있다 — `ml-random-forest`의
 * 씨앗 사슬은 표집 함수 둘에서만 진화하고 트리 학습은 그것을 안 건드리므로, 나무마다의
 * 씨앗만 뽑아 두면 어느 워커에서 몇 개씩 짓든 **라이브러리가 직렬로 지은 그 숲**이 나온다
 * (**값이 같다는 뜻이다** — `plainTree`가 `root`에 JSON을 태우므로 물건 자체는 다르다).
 *
 * **그래서 여기서 재는 것은 우리 코드끼리가 아니라 우리와 라이브러리다.** 남의 내부
 * 모듈(`src/utils.js`)을 부르고 있어 semver 밖이고, 저쪽이 표집을 바꾸면 **이 파일이
 * 빨개지는 것이 유일한 신호**다.
 */

import { RandomForestClassifier } from 'ml-random-forest'
import { Matrix } from 'ml-matrix'
import { describe, expect, it } from 'vitest'

import { MLJS_FOREST_PARALLEL_MIN_TREE_ROWS } from '../src/limits'
import { fit, loadForest } from '../src/ml/engines/mljs'
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
 * 검사용 풀 — 워커 없이 **같은 함수**(`growTree`)를 제자리에서 돌린다.
 *
 * **답을 `structuredClone`에 통과시킨다.** 이것이 없어서 실물 결함 하나를 놓쳤다
 * (2026-09-04): `DecisionTreeClassifier.toJSON()`이 살아 있는 `TreeNode`·`Matrix`를
 * 돌려주는데 구조화 복제가 프로토타입을 벗겨, **브라우저에서만** 예측이
 * *"maxRowIndex is not a function"*으로 죽었다. 제자리 풀은 그 경계를 안 지나가서
 * 초록이었다 — **가짜 풀이 진짜 경계보다 관대하면 그 차이만큼이 사각이다.**
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
        // 진짜 워커가 지나가는 그 경계다. 위 머리말의 그것.
        structuredClone(
          growTree(
            matrix,
            targets,
            one,
            seed.featureSampleCount,
            seed.replacement,
            seed.treeOptions,
          ),
        ),
      )
      return Promise.resolve(trees)
    },
    dispose() {},
  })
}

const TREES = 6

async function forestFit(pools?: ComputePools) {
  const { features, labels } = sample(120)
  return await fit('random_forest', {
    features,
    rowIndices: features.map((_, index) => index),
    target: labels,
    taskType: 'classification',
    hyperparameters: { nEstimators: TREES },
    randomState: 42,
    ...(pools ? { pools } : {}),
  })
}

describe('갈라도 같은 숲이다', () => {
  it('풀을 준 학습과 안 준 학습이 같은 모델 파일을 낸다', async () => {
    const log = { grown: 0 }
    const serial = await forestFit()
    const parallel = await forestFit({ forest: inProcessForestPool(log) })

    // 풀이 실제로 쓰였는지 먼저 — 안 쓰였으면 아래 비교는 아무것도 안 잰다.
    expect(log.grown).toBe(TREES)
    expect(parallel.model).toEqual(serial.model)
  })

  /**
   * **모델 파일만 견주면 못 잡는 것이 있다.** 실제로 놓쳤다 — 재조립한 숲이 **예측을
   * 못 하는데** 직렬화는 멀쩡했다(위 `inProcessForestPool` 머리말). 학습이 끝난 뒤
   * 채점에서 죽으므로 학생은 오래 기다린 다음에 실패를 본다.
   */
  it('재조립한 숲이 예측을 한다 — 그리고 직렬과 같은 답이다', async () => {
    const { features } = sample(120)
    const serial = await forestFit()
    const parallel = await forestFit({ forest: inProcessForestPool() })

    const answers = parallel.predict(features)
    expect(answers).toHaveLength(features.length)
    expect(answers).toEqual(serial.predict(features))
  })

  it('라이브러리가 직렬로 지은 숲과 나무 속·열 번호가 값까지 같다', () => {
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
      baseModel: { estimators: { root: unknown; options: unknown }[]; indexes: number[][] }
    }
    const trees = ours.map((one) => one.tree as { root: unknown; options: unknown })

    /**
     * **나무의 속을 값으로 견준다.** 우리 쪽은 `root`가 **평범한 객체**이고 저쪽은
     * `TreeNode` 인스턴스라 그대로 비교하면 클래스 정체성에서 갈린다 — 그건 의도한
     * 차이다(워커 경계를 넘어야 하므로, `forest-compute.ts`의 `plainTree`).
     * 양쪽을 같은 자로 펴서 **값만** 본다.
     */
    const flat = (one: unknown): unknown => JSON.parse(JSON.stringify(one)) as unknown
    expect(trees.map((one) => flat(one.root))).toEqual(
      json.baseModel.estimators.map((one) => flat(one.root)),
    )
    /**
     * **손잡이는 펴지 않고 그대로 본다.** JSON을 태우면 `maxDepth: Infinity`가 `null`이
     * 되어 **양쪽 다 null이 되므로 손실이 안 보인다** — 실제로 한 번 그렇게 놓칠 뻔했다.
     */
    expect(trees.map((one) => one.options)).toEqual(
      json.baseModel.estimators.map((one) => one.options),
    )
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

/**
 * **되세운 숲의 손잡이를 라이브러리와 맞댄다** (2026-09-04 R26 B-2·C-5).
 *
 * `loadForest`는 라이브러리가 `load`에 받는 모양을 **손으로 적는다** — 그럴 수밖에
 * 없는 사정은 그 함수의 머리말에 있다. 손으로 적은 것은 틀리고, 실제로 둘이 틀려
 * 있었다: `numberFeatures`·`numberSamples`가 빠져 `featureImportance()`가 `[NaN]`을
 * 냈고(C-5), `n`·`replacement`·`maxFeatures`를 **셋 동시에** 어긋내도 검사 마흔여섯이
 * 조용했다(B-2). 우리 모델 파일은 그 필드를 안 담아서 위의 파일 대조가 못 본다.
 */
describe('되세운 숲이 라이브러리의 숲과 같은 모양이다', () => {
  const { features, encoded } = sample(200)
  const columns = features[0]?.length ?? 0

  function stockForest(): RandomForestClassifier {
    const stock = new RandomForestClassifier({
      nEstimators: TREES,
      seed: 42,
      useSampleBagging: true,
      noOOB: true,
    })
    stock.train(features, encoded)
    return stock
  }

  function ours(): RandomForestClassifier {
    const matrix = Matrix.checkMatrix(features.map((row) => [...row]))
    const chain = forestSeeds(matrix, [...encoded], TREES, 42, columns, true)
    const trees = chain.map((seed) =>
      growTree(matrix, [...encoded], seed, columns, true, undefined),
    )
    return loadForest(trees, TREES, columns, 42, features.length)
  }

  it('나무를 뺀 손잡이가 전부 같다', () => {
    // 나무 자체는 위에서 이미 값으로 견줬다. 여기서 보는 것은 **그 둘레의 필드들**이다.
    const strip = (model: RandomForestClassifier): Record<string, unknown> => {
      const json = model.toJSON() as unknown as { baseModel: Record<string, unknown> }
      const rest = { ...json.baseModel }
      // 나무와 열 번호는 위 검사가 이미 값으로 견줬다. 여기서 보는 것은 그 둘레다.
      delete rest.estimators
      delete rest.indexes
      return rest
    }
    expect(strip(ours())).toEqual(strip(stockForest()))
  })

  /**
   * **패키지 타입이 `featureImportance()`를 안 적어 두었다** — 구현에는 있다
   * (`node_modules/ml-random-forest/src/RandomForestBase.js`). 선언을 덧대려 했더니
   * 원본 클래스와 병합되지 않고 가려서, 부르는 이 한 자리에서만 좁힌다.
   */
  const importanceOf = (model: RandomForestClassifier): number[] => [
    ...(model as unknown as { featureImportance(): number[] }).featureImportance(),
  ]

  it('특성 중요도가 라이브러리와 같다 — 빠진 필드는 길이부터 틀어진다', () => {
    const importance = importanceOf(ours())
    /**
     * **길이가 증상이었다.** `numberFeatures`가 없으면 `new Array(undefined)`가 되어
     * 칸 **하나**짜리 답이 나온다 — 열이 넷인데 하나다.
     */
    expect(importance).toHaveLength(columns)
    // 그리고 라이브러리가 직접 학습한 숲과 같은 답이다. 값 자체가 무엇이든.
    expect(importance).toEqual(importanceOf(stockForest()))
  })
})
