/**
 * ml.js 계열 패키지의 타입 선언.
 *
 * 몇몇 패키지가 .d.ts를 담고 있지 않다. `declare module 'ml-cart'` 한 줄로 넘기면
 * 통째로 any가 되고, 그러면 하이퍼파라미터 이름을 잘못 써도 컴파일이 통과한다 -
 * ml.js와 sklearn은 이름이 다르므로(maxDepth / max_depth) 그게 실제로 일어난다.
 *
 * **우리가 실제로 쓰는 것만 적는다.** 라이브러리 전체를 옮겨 적을 이유가 없고,
 * 옮겨 적으면 그 사본이 먼저 낡는다.
 */

declare module 'ml-cart' {
  export interface DecisionTreeOptions {
    gainFunction?: 'gini' | 'regression'
    maxDepth?: number
    minNumSamples?: number
  }

  export class DecisionTreeClassifier {
    constructor(options?: DecisionTreeOptions)
    train(features: number[][], target: number[]): void
    predict(features: number[][]): number[]
  }
}

declare module 'ml-knn' {
  export interface KNNOptions {
    k?: number
    distance?: (a: number[], b: number[]) => number
  }

  /** 생성자에서 학습한다 - 사실상 학습 데이터 전체가 모델이다. */
  export default class KNN {
    constructor(features: number[][], target: number[], options?: KNNOptions)
    predict(features: number[][]): number[]
  }
}

declare module 'ml-logistic-regression' {
  import type { Matrix } from 'ml-matrix'

  export interface LogisticRegressionOptions {
    numSteps?: number
    learningRate?: number
  }

  export default class LogisticRegression {
    constructor(options?: LogisticRegressionOptions)
    train(features: Matrix, target: Matrix): void
    predict(features: Matrix): number[]
  }
}
