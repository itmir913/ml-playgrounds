/**
 * `mlpx-svm-v1` — 선형 서포트 벡터 머신 (mlpx-spec.md 5.8).
 *
 * **여기 있는 예측 함수를 학습 쪽도 그대로 쓴다.** 참조형(reference.ts)과 같은 방식이고,
 * 그래서 "저장했다가 읽은 모델의 예측이 원본과 같다"가 테스트로 확인하는 성질이 아니라
 * **구조로 보장되는 성질**이 된다.
 *
 * **`mlpx-linear-v2`와 배열 모양이 비슷하지만 뜻이 다르다.** 저쪽은 클래스마다 한 줄
 * (one-vs-all)이고 이쪽은 클래스 **쌍**마다 한 줄(one-vs-one)이라 투표 규칙이 다르다.
 * 같은 해석기가 읽을 수 없어서 형식을 나눴다 (mlpx-spec.md 5).
 *
 * **솔버를 import하지 않는다.** 경계는 tree.ts와 같다 - 해석하는 쪽이 학습하는 쪽을
 * 참조하면 ml.js를 갈아 끼울 때 지난 학기 파일이 안 열린다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict } from './types'

export const SVM_FORMAT = 'mlpx-svm-v1'

/** 클래스 쌍 하나를 가르는 초평면. `a`·`b`는 `classes`의 인덱스이고 **a < b다.** */
export interface PairwiseClassifier {
  readonly a: number
  readonly b: number
  /** 원래 좌표계의 가중치. 정규화가 접혀 있다 (mlpx-spec.md 5.8). */
  readonly weights: readonly number[]
  readonly intercept: number
}

export interface SvmModel extends ModelFile {
  readonly format: typeof SVM_FORMAT
  /** 라벨을 **정렬한** 순서. 예측이 돌려주는 문자열이 여기서 나온다. */
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly classifiers: readonly PairwiseClassifier[]
}

const svmModelSchema = z.looseObject({
  format: z.literal(SVM_FORMAT),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  // **비어 있을 수 있다** - 훈련 데이터에 클래스가 하나뿐이면 가를 쌍이 없다.
  // 그 경우가 정상인지는 classes의 길이가 정한다 (svmPredict의 검사).
  classifiers: z.array(
    z.looseObject({
      a: z.number(),
      b: z.number(),
      weights: z.array(z.number()),
      intercept: z.number(),
    }),
  ),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

export interface VotingInput {
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly classifiers: readonly PairwiseClassifier[]
}

/**
 * one-vs-one 투표로 예측한다. **sklearn `SVC`와 같은 규칙이다** (mlpx-spec.md 5.8).
 *
 * 쌍마다 결정함수 값이 양수면 `b`, 음수면 `a`에 한 표다. 표가 같으면 **결정함수 값의
 * 합**으로 가르고, 그래도 같으면 클래스 이름 순(= 인덱스 순)이다.
 *
 * 마지막 단계가 필요한 이유는 **답이 결정적이어야 하기 때문**이다. 3파전 동점은 드물지만
 * 일어나고, 거기서 순회 순서에 답을 맡기면 같은 모델이 같은 입력에 다른 답을 낼 수 있다.
 */
export function svmPredict(input: VotingInput): Predict {
  const { classes, featureCount, classifiers } = input
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  // 클래스가 여럿인데 가르는 쌍이 하나도 없으면 **전부 첫 클래스로 답한다.** 조용히 틀린
  // 답이라 여기서 막는다. 클래스가 하나뿐인 훈련 데이터는 정상이고, 그때는 답도 하나뿐이다.
  if (classes.length > 1 && classifiers.length === 0) invalid('classifiers')

  for (const pair of classifiers) {
    if (pair.weights.length !== featureCount) invalid('weights')
    // 인덱스가 범위를 벗어나면 표가 없는 클래스로 가고, 그러면 **예측이 조용히 한 칸
    // 밀린다.** 담긴 쌍이 우리가 만든 것이 아닐 수 있다 (남이 편집한 파일).
    if (
      !Number.isInteger(pair.a) ||
      !Number.isInteger(pair.b) ||
      pair.a < 0 ||
      pair.b >= classes.length ||
      pair.a >= pair.b
    ) {
      invalid('classifiers')
    }
  }

  return (features) =>
    features.map((row) => {
      if (row.length !== featureCount) invalid('featureCount')

      const votes = new Array<number>(classes.length).fill(0)
      // 클래스마다 자기에게 유리한 쪽으로 쌓인 결정함수 값. 동점을 가르는 값이다.
      const scores = new Array<number>(classes.length).fill(0)

      for (const pair of classifiers) {
        let value = pair.intercept
        for (let j = 0; j < featureCount; j += 1) {
          value += (pair.weights[j] as number) * (row[j] ?? 0)
        }
        const winner = value > 0 ? pair.b : pair.a
        votes[winner] = (votes[winner] ?? 0) + 1
        scores[pair.b] = (scores[pair.b] ?? 0) + value
        scores[pair.a] = (scores[pair.a] ?? 0) - value
      }

      let best = 0
      for (let index = 1; index < classes.length; index += 1) {
        const better =
          (votes[index] ?? 0) > (votes[best] ?? 0) ||
          ((votes[index] ?? 0) === (votes[best] ?? 0) && (scores[index] ?? 0) > (scores[best] ?? 0))
        if (better) best = index
      }

      const label = classes[best]
      if (label === undefined) invalid('classes')
      return label
    })
}

/** 파일을 예측 함수로. **훈련 행이 필요 없다** - 가중치뿐이라 자체 완결이다. */
export function loadSvmModel(file: unknown): Predict {
  const parsed = svmModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { classes, featureCount, classifiers } = parsed.data
  return svmPredict({ classes, featureCount, classifiers })
}
