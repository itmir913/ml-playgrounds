/**
 * 학습을 코어로 가르는 **손들의 계약**
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 *
 * **여기는 계약만 있고 워커가 없다.** 실물은 `ml/worker/*-pool.ts`가 만들고, 학습
 * 워커만 그것을 주입한다 (`ml/worker/handler.ts`) — 검사와 재실행 대조는 안 주고
 * 직렬로 돈다. **어느 쪽이든 결과는 같다.**
 *
 * **계약이 엔진 쪽에 사는 이유**는 방향이다. 엔진이 "이런 손이 있으면 쓴다"를 선언하고
 * 워커가 그 모양으로 붙는다 — 반대로 두면 등록부가 워커 구현을 알아야 한다.
 */

import type { NeuralPoolFactory } from './engines/neural'

// --------------------------------------------------------------------------
// 랜덤포레스트 — 나무를 나눈다
// --------------------------------------------------------------------------

/** 나무 하나의 결과. 라이브러리가 `toJSON`에 담는 것과 같은 짝이다. */
export interface ForestTree {
  /** `DecisionTreeClassifier.toJSON()`. 모양은 직렬화기가 런타임에 확인한다. */
  readonly tree: unknown
  /** 이 나무가 쓴 원본 열 번호들 (`baseModel.indexes[i]`). */
  readonly usedIndex: readonly number[]
}

/** 숲 하나를 짓는 데 필요한 것 전부. 등록부의 값으로 채운다. */
export interface ForestSeed {
  readonly features: readonly (readonly number[])[]
  /** 부호화한 라벨. */
  readonly targets: readonly number[]
  readonly treeCount: number
  readonly randomState: number
  /** 나무마다 고르는 특성 수 (`RandomForestBase`의 `n`). */
  readonly featureSampleCount: number
  /** 특성 표집에 중복을 허용하는가 (라이브러리 기본값 `true`). */
  readonly replacement: boolean
  /** `ml-cart`에 그대로 넘기는 손잡이. **우리는 안 채운다.** */
  readonly treeOptions: object | undefined
}

export interface ForestPool {
  /** 나무 전부를 짓는다. **돌려주는 순서는 나무 번호 순서다.** */
  grow(): Promise<readonly ForestTree[]>
  dispose(): void
}

/** `null`은 "이 환경에서는 못 가른다" 또는 "가를 만큼 크지 않다"이다. */
export type ForestPoolFactory = (seed: ForestSeed) => ForestPool | null

// --------------------------------------------------------------------------
// KNN — 시험 행을 나눈다
// --------------------------------------------------------------------------

/** 훈련 쪽 재료. 풀을 세울 때 한 번 건넨다. */
export interface KnnSeed {
  readonly k: number
  readonly featureCount: number
  readonly rows: readonly (readonly number[])[]
  readonly labels: readonly string[]
  /** 훈련 행의 원본 행 번호. 동점을 가르는 데 쓴다 (mlpx-spec.md §5.6). */
  readonly indices: readonly number[]
}

export interface KnnPool {
  /**
   * 시험 행들의 답. **돌려주는 순서는 받은 행 순서다.**
   *
   * **`null`은 "안 갈랐다"이고 빈 배열과 다른 말이다** — 가를 만큼 크지 않거나 워커를
   * 못 띄웠다는 뜻이고, 그때 부르는 쪽은 직렬 예측을 쓴다. 빈 배열로 뭉뚱그리면
   * 시험 행이 0개인 경우와 구분되지 않는다.
   */
  answer(queries: readonly (readonly number[])[]): Promise<readonly string[] | null>
  dispose(): void
}

export type KnnPoolFactory = (seed: KnnSeed) => KnnPool | null

// --------------------------------------------------------------------------

/**
 * 학습 워커가 엔진에 건네는 손들. **없으면 전부 직렬이고 결과는 같다** — 그래서
 * 검사가 이것을 안 줘도 되고, 안 주는 것이 기본이다.
 */
export interface ComputePools {
  readonly neural?: NeuralPoolFactory
  readonly forest?: ForestPoolFactory
  readonly knn?: KnnPoolFactory
}
