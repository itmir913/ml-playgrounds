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
    /**
     * **unknown이다.** 이 라이브러리가 내주는 노드 구조에 타입을 주장하면 그 사본이 먼저
     * 낡고, 낡은 사본은 확인을 건너뛰게 만든다. 읽는 쪽이 런타임에 확인한다
     * (ml/engines/mljs-serialize.ts).
     */
    toJSON(): unknown
  }
}

declare module 'ml-naivebayes' {
  /** 라벨은 0부터 n-1까지의 정수여야 한다 (라이브러리 문서). */
  export class GaussianNB {
    train(features: number[][], target: number[]): void
    predict(features: number[][]): number[]
  }

  export class MultinomialNB {
    train(features: number[][], target: number[]): void
    predict(features: number[][]): number[]
  }
}

