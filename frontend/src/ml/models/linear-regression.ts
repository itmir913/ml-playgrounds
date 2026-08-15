/**
 * `mlpx-linear-regression-v1` — 선형 회귀 (mlpx-spec.md 5.7).
 *
 * **형식 넷 중 가장 단순하다** — 예측이 `Σ(특성 × 계수) + 절편`이고 그게 전부다.
 *
 * `mlpx-linear-v2`(로지스틱)와 이름을 나눈 이유는 payload가 다르기 때문이다. 그쪽은
 * **클래스별 가중치 행렬**이고 이쪽은 **계수 한 줄에 절편 하나**라 같은 해석기가 읽을 수
 * 없다. 묶으면 해석기가 `classes`가 있는지 보고 갈라져야 하는데, 그건 mlpx-spec.md 5가
 * 금지한 분기를 형식 안쪽으로 옮긴 것에 불과하다.
 *
 * **돌려주는 것이 라벨이 아니라 수치다.** 분류 해석기들과 갈리는 유일한 자리이고,
 * Prediction 타입이 둘을 다 담으므로 부르는 쪽에는 분기가 없다 (ml/metrics.ts).
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict } from './types'

export const LINEAR_REGRESSION_FORMAT = 'mlpx-linear-regression-v1'

export interface LinearRegressionModel extends ModelFile {
  readonly format: typeof LINEAR_REGRESSION_FORMAT
  readonly featureCount: number
  /** 특성마다 하나. **절편은 여기 섞지 않는다.** */
  readonly coefficients: readonly number[]
  readonly intercept: number
}

const linearRegressionSchema = z.looseObject({
  format: z.literal(LINEAR_REGRESSION_FORMAT),
  featureCount: z.number(),
  coefficients: z.array(z.number()).min(1),
  intercept: z.number(),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

export function loadLinearRegressionModel(file: unknown): Predict {
  const parsed = linearRegressionSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { featureCount, coefficients, intercept } = parsed.data
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  // 계수는 특성마다 하나다. 안 맞으면 다른 열에 계수를 곱하게 된다.
  if (coefficients.length !== featureCount) invalid('coefficients')
  if (!coefficients.every((value) => Number.isFinite(value))) invalid('coefficients')
  if (!Number.isFinite(intercept)) invalid('intercept')

  const weights = Float64Array.from(coefficients)

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')
      let value = intercept
      for (let column = 0; column < featureCount; column += 1) {
        value += (weights[column] ?? 0) * (input[column] ?? 0)
      }
      return value
    })
}
