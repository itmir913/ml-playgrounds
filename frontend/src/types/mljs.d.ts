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
  import type { Matrix } from 'ml-matrix'

  export interface DecisionTreeOptions {
    gainFunction?: 'gini' | 'regression'
    maxDepth?: number
    minNumSamples?: number
  }

  export class DecisionTreeClassifier {
    constructor(options?: DecisionTreeOptions)
    /**
     * **`Matrix`도 받는다.** 라이브러리가 안에서 `Matrix.checkMatrix`를 부르고,
     * 랜덤포레스트가 실제로 특성 배깅의 결과(`Matrix`)를 그대로 넘긴다
     * (`ml/worker/forest-compute.ts`).
     */
    train(features: number[][] | Matrix, target: number[]): void
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

/**
 * **랜덤포레스트의 내부 모듈이다.** 공개 API가 아니라 `src/` 아래를 직접 부르는 것이고,
 * 그래서 여기에만 타입이 있다 (패키지의 `types.d.ts`는 `ml-random-forest`만 선언한다).
 *
 * **왜 내부를 부르는가.** 나무를 워커로 나누려면 나무마다의 씨앗이 필요한데, 그 사슬을
 * 진화시키는 것이 정확히 이 두 함수다 (`ml/worker/forest-pool.ts`). 뽑기 횟수를 우리가
 * 다시 세면 같은 규칙이 두 군데 살고 저쪽이 바뀔 때 조용히 어긋난다.
 *
 * **치르는 값은 이것이 semver 밖이라는 것이다.** `forest-parallel.spec.ts`가 라이브러리의
 * 직렬 학습과 우리 병렬 학습을 맞대어 그 위험을 막는다 — 내부가 바뀌면 거기가 빨개진다.
 *
 * `Matrix`를 `unknown`으로 두지 않는 이유는 `bag.X`를 그대로 다음 함수에 넘기기
 * 때문이다. 우리가 그 안을 읽지는 않는다.
 */
declare module 'ml-random-forest/src/utils.js' {
  import type { Matrix } from 'ml-matrix'

  /** 행을 중복 허용으로 뽑는다. `seed`는 **다음 씨앗**이다. */
  export function examplesBaggingWithReplacement(
    trainingSet: Matrix,
    trainingValue: number[],
    seed: number,
  ): { X: Matrix; y: number[]; seed: number }

  /** 열을 `n`개 뽑는다. `usedIndex`가 그 열 번호이고 `seed`는 **다음 씨앗**이다. */
  export function featureBagging(
    trainingSet: Matrix,
    n: number,
    replacement: boolean,
    seed: number,
  ): { X: Matrix; usedIndex: number[]; seed: number }
}
