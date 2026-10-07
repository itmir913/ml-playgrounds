/**
 * **빠른 분할 탐색이 원본과 같은 나무를 짓는다** (open-decisions.md "순수 JS
 * 의사결정트리의 분할 탐색을 우리 코드로 바꾼다 — 같은 나무를 더 빨리").
 *
 * 맞대는 상대는 우리 코드가 아니라 **`ml-cart`의 원본 `bestSplit`**이다. 같은 입력에서
 * 원본을 끼운 채 지은 나무와 우리 것을 끼운 채 지은 나무를 `toJSON()` 문자열로 견준다 —
 * 분할 값·열·이득·잎의 분포까지 비트 단위로 같아야 통과한다.
 */

import { DecisionTreeClassifier } from 'ml-cart'
import { RandomForestClassifier } from 'ml-random-forest'
import { afterAll, describe, expect, it } from 'vitest'

import {
  fastBestSplit,
  installFastSplit,
  libraryBestSplit,
  uninstallFastSplit,
} from '../src/ml/engines/cart-split'

interface Sample {
  readonly name: string
  readonly features: number[][]
  readonly labels: number[]
}

function generator(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/**
 * 원본이 까다로워하는 모양을 일부러 섞는다 — 같은 값이 많은 열(동점 후보), 라벨 잡음,
 * 쓰이지 않는 클래스 번호(빈 칸), 클래스가 많은 표.
 */
function samples(): Sample[] {
  const out: Sample[] = []
  const shapes = [
    { name: 'continuous', rows: 300, columns: 5, classes: 3, round: 0, noise: 0.1 },
    { name: 'ties', rows: 300, columns: 4, classes: 3, round: 4, noise: 0.2 },
    { name: 'binary-columns', rows: 200, columns: 6, classes: 2, round: 1, noise: 0.15 },
    { name: 'many-classes', rows: 400, columns: 8, classes: 10, round: 0, noise: 0.05 },
    { name: 'pure-noise', rows: 150, columns: 3, classes: 4, round: 2, noise: 1 },
    { name: 'gap-label', rows: 120, columns: 3, classes: 5, round: 0, noise: 0.1 },
  ]
  for (const [offset, shape] of shapes.entries()) {
    const random = generator(17 + offset)
    const features: number[][] = []
    const labels: number[] = []
    for (let row = 0; row < shape.rows; row += 1) {
      const values = Array.from({ length: shape.columns }, () => {
        const value = random() * 2 - 1
        return shape.round > 0 ? Math.round(value * shape.round) / shape.round : value
      })
      features.push(values)
      const signal = values.reduce((sum, value, index) => sum + value * (index + 1), 0)
      let label = Math.min(
        shape.classes - 1,
        Math.max(0, Math.floor(((signal / shape.columns + 1) / 2) * shape.classes)),
      )
      if (random() < shape.noise) label = Math.floor(random() * shape.classes)
      // 클래스 1을 비워 둔다 — 원본은 라벨을 첨자로 쓰므로 빈 칸이 생긴다.
      if (shape.name === 'gap-label' && label === 1) label = 2
      labels.push(label)
    }
    out.push({ name: shape.name, features, labels })
  }
  return out
}

const OPTIONS = [
  {},
  { minNumSamples: 1 },
  { minNumSamples: 5, maxDepth: 4 },
  { gainThreshold: 0 },
] as const

function treeJson(sample: Sample, options: object): string {
  const tree = new DecisionTreeClassifier(options)
  tree.train(sample.features, sample.labels)
  return JSON.stringify(tree.toJSON())
}

function forestJson(sample: Sample, nEstimators: number, seed: number): string {
  const forest = new RandomForestClassifier({ nEstimators, seed, noOOB: true })
  forest.train(sample.features, sample.labels)
  return JSON.stringify(forest.toJSON())
}

afterAll(() => {
  installFastSplit()
})

describe('빠른 분할 탐색', () => {
  it('노드 하나의 답이 원본 bestSplit과 비트 단위로 같다', () => {
    for (const sample of samples()) {
      // 원본은 `this`의 메서드(`featureSplit`·`split`)를 부르므로 살아 있는 노드를 빌린다.
      // 행렬은 `rows`와 `getRow`만 쓴다.
      const transposed = {
        rows: sample.features[0]!.length,
        getRow: (column: number) => sample.features.map((row) => row[column]!),
      }
      const probe = new DecisionTreeClassifier()
      probe.train(sample.features, sample.labels)
      const host = (
        probe.toJSON() as { root: { kind: string; gainFunction: string; splitFunction: string } }
      ).root
      const expected = libraryBestSplit.call(host, transposed, sample.labels)
      expect(fastBestSplit(transposed, sample.labels), sample.name).toEqual(expected)
    }
  })

  /**
   * **0/1 열에서도 선형이다** (R43-3 C-1). 같은 값 구간 안에서 라벨이 바뀔 때마다 같은 값의 후보가 다시 생겨 띠에 전부 남았고,
   * 2단계가 후보마다 O(n)을 돌아 40,000행 세 열이 개발 PC에서 0.9초였다(고친 뒤 30ms 안팎). 원-핫·범주 코드 열이 이 모양이다.
   * 문턱은 느린 CI를 위해 열 배 넘게 둔다 — 옛 코드는 행이 두 배면 네 배라 그래도 넘는다.
   */
  it('0/1 열 40,000행의 분할 탐색이 곧 끝난다 — 같은 값의 후보를 한 번만 센다', () => {
    const binary = (rows: number) => {
      const random = generator(99)
      const columns = [0, 1, 2].map(() =>
        Array.from({ length: rows }, () => (random() < 0.5 ? 0 : 1)),
      )
      const labels = columns[0]!.map((value) => (random() < 0.3 ? 1 - value : value))
      return { transposed: { rows: 3, getRow: (column: number) => columns[column]! }, labels }
    }
    // 같은 모양의 작은 표에서 원본과 비트 단위로 같다 — 같은 값의 후보를 건너뛰어도 답은 그대로다.
    const small = binary(2_000)
    const probe = new DecisionTreeClassifier()
    probe.train([[0], [1]], [0, 1])
    const host = (probe.toJSON() as { root: object }).root
    expect(fastBestSplit(small.transposed, small.labels)).toEqual(
      libraryBestSplit.call(host as never, small.transposed, small.labels),
    )

    const large = binary(40_000)
    const started = performance.now()
    const choice = fastBestSplit(large.transposed, large.labels)
    expect(performance.now() - started).toBeLessThan(250)
    expect(choice.maxColumn).toBe(0)
  })

  it('의사결정트리가 원본과 같은 나무를 짓는다', () => {
    for (const sample of samples()) {
      for (const options of OPTIONS) {
        uninstallFastSplit()
        const expected = treeJson(sample, options)
        installFastSplit()
        expect(treeJson(sample, options), `${sample.name} ${JSON.stringify(options)}`).toBe(
          expected,
        )
      }
    }
  })

  it('랜덤포레스트의 직렬 학습에도 닿고 같은 숲을 짓는다', () => {
    for (const sample of samples()) {
      uninstallFastSplit()
      const expected = forestJson(sample, 5, 42)
      installFastSplit()
      expect(forestJson(sample, 5, 42), sample.name).toBe(expected)
    }
  })

  it('끼우면 라이브러리의 두 경로가 모두 우리 탐색을 부른다', () => {
    installFastSplit()
    const tree = new DecisionTreeClassifier()
    tree.train([[0], [1], [2], [3]], [0, 0, 1, 1])
    const forest = new RandomForestClassifier({ nEstimators: 1, seed: 1, noOOB: true })
    forest.train(
      [
        [0, 1],
        [1, 0],
        [2, 1],
        [3, 0],
      ],
      [0, 0, 1, 1],
    )
    const treeRoot = (tree.toJSON() as { root: { bestSplit: unknown } }).root
    const forestRoot = (forest as unknown as { estimators: { root: { bestSplit: unknown } }[] })
      .estimators[0]!.root
    expect(treeRoot.bestSplit).not.toBe(libraryBestSplit)
    expect(forestRoot.bestSplit).toBe(treeRoot.bestSplit)
  })
})
