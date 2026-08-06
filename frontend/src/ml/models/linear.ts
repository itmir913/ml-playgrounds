/**
 * `mlpx-linear-v1` — 로지스틱 회귀 (mlpx-spec.md 5.4).
 *
 * **점수가 낮은 클래스가 이긴다.** 직관과 반대라 이 파일에서 가장 중요한 사실이다 —
 * `ml-logistic-regression`은 one-vs-all을 만들 때 **대상 클래스를 0, 나머지를 1로** 두고
 * 학습하므로 "그 클래스일수록 점수가 낮다"가 된다. 뒤집으면 **에러 없이 정확히 반대인
 * 답**이 나오고, 지표만 대조하면 그게 상쇄로 가려진다.
 *
 * **시그모이드를 씌워서 비교한다.** 단조 함수라 순서는 원점수와 같은데, **포화에서만
 * 다르다** — 원점수가 크면 시그모이드가 전부 정확히 1.0이 되어 동점이 되고, 그때는
 * 번호가 작은 클래스가 이긴다(라이브러리가 엄격한 `<`로 갱신한다). 원점수로 비교하면
 * 그 자리에서 답이 갈린다. 재현이 목적이므로 같은 식을 쓴다.
 *
 * **ml.js를 import하지 않는다.** 경계는 tree.ts와 같다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict } from './types'

export const LINEAR_FORMAT = 'mlpx-linear-v1'

export interface LinearModel extends ModelFile {
  readonly format: typeof LINEAR_FORMAT
  /** 라벨을 **정렬한** 순서. weights의 줄 번호가 이 배열의 인덱스다. */
  readonly classes: readonly string[]
  /** 전처리를 마친 행렬의 열 수. 이 값과 안 맞는 입력은 거부한다. */
  readonly featureCount: number
  /** 클래스마다 한 줄. 줄의 길이는 featureCount이고 **절편은 없다.** */
  readonly weights: readonly (readonly number[])[]
}

const linearModelSchema = z.looseObject({
  format: z.literal(LINEAR_FORMAT),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  weights: z.array(z.array(z.number())).min(1),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

/** 라이브러리와 같은 식이다. 포화 동작까지 같아야 예측이 재현된다. */
function sigmoid(score: number): number {
  return 1 / (1 + Math.exp(-score))
}

/**
 * 파일을 예측 함수로. **검증은 읽을 때 한 번 하고 예측 루프에서는 아무것도 안 본다**
 * (tree.ts와 같은 이유다).
 */
export function loadLinearModel(file: unknown): Predict {
  const parsed = linearModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { classes, featureCount, weights } = parsed.data
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  // 줄 하나가 클래스 하나다. 어긋나면 어느 줄이 어느 클래스인지 알 수 없다.
  if (weights.length !== classes.length) invalid('weights')

  const rows = weights.map((row) => {
    if (row.length !== featureCount) invalid('weights')
    if (!row.every((value) => Number.isFinite(value))) invalid('weights')
    return Float64Array.from(row)
  })

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')

      // **argmin이다.** 그리고 갱신이 엄격한 `<`라 동점이면 번호가 작은 쪽이 남는다.
      let best = 0
      let lowest = Number.POSITIVE_INFINITY
      rows.forEach((weightRow, index) => {
        let score = 0
        for (let column = 0; column < featureCount; column += 1) {
          score += (weightRow[column] ?? 0) * (input[column] ?? 0)
        }
        const squashed = sigmoid(score)
        if (squashed < lowest) {
          lowest = squashed
          best = index
        }
      })

      const label = classes[best]
      if (label === undefined) invalid('classes')
      return label
    })
}
