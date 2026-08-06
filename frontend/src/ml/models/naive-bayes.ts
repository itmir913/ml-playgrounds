/**
 * `mlpx-naive-bayes-v1` — 가우시안 나이브 베이즈 (mlpx-spec.md 5.5).
 *
 * **로그 공간에서 끝까지 간다.** 확률로 되돌리지 않는다 - `exp`를 한 번 왕복하면 지수
 * 합이 대략 -745 아래에서 0으로 언더플로해서 **모든 클래스가 같아진다**. 예전에 쓰던
 * 라이브러리가 거기서 "예측 없음"을 냈고, 그게 이 알고리즘을 직접 구현한 이유 중 하나다
 * (open-decisions.md "가우시안 나이브 베이즈는 의존성을 빼고 우리가 구현한다").
 *
 * **정규화 상수를 빼면 안 된다.** 흔히 상수라서 지워도 된다고들 하는데 그건 클래스마다
 * 분산이 같을 때 얘기다 - 여기서는 클래스마다 다르므로 `log(2π·분산)`이 **클래스마다
 * 다른 값**이고, 빼면 답이 갈린다. 입력이 두 클래스의 평균과 같을 때 거리 항이 0이라
 * 이 상수만 남고 분산이 작은 쪽이 이긴다 - tests/models.spec.ts가 그 경우를 못 박았다. **학습 쪽 구현과 같은 식이어야 예측이 재현된다** (ml/engines/mljs.ts).
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict } from './types'

export const NAIVE_BAYES_FORMAT = 'mlpx-naive-bayes-v1'

export interface NaiveBayesModel extends ModelFile {
  readonly format: typeof NAIVE_BAYES_FORMAT
  /** 라벨을 **정렬한** 순서. 아래 배열들의 줄 번호가 이 배열의 인덱스다. */
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly logPriors: readonly number[]
  readonly means: readonly (readonly number[])[]
  /** 평활을 더한 뒤의 값. */
  readonly variances: readonly (readonly number[])[]
}

const naiveBayesModelSchema = z.looseObject({
  format: z.literal(NAIVE_BAYES_FORMAT),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  logPriors: z.array(z.number()).min(1),
  means: z.array(z.array(z.number())).min(1),
  variances: z.array(z.array(z.number())).min(1),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

/** 클래스마다 한 줄이고 줄 길이가 특성 수인가. */
function matrix(
  rows: readonly (readonly number[])[],
  classCount: number,
  featureCount: number,
  field: string,
): Float64Array[] {
  if (rows.length !== classCount) invalid(field)
  return rows.map((row) => {
    if (row.length !== featureCount) invalid(field)
    if (!row.every((value) => Number.isFinite(value))) invalid(field)
    return Float64Array.from(row)
  })
}

export function loadNaiveBayesModel(file: unknown): Predict {
  const parsed = naiveBayesModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { classes, featureCount, logPriors, means, variances } = parsed.data
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  if (logPriors.length !== classes.length) invalid('logPriors')
  if (!logPriors.every((value) => Number.isFinite(value))) invalid('logPriors')

  const meanRows = matrix(means, classes.length, featureCount, 'means')
  const varianceRows = matrix(variances, classes.length, featureCount, 'variances')

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')

      let best = -1
      let bestScore = Number.NEGATIVE_INFINITY

      logPriors.forEach((prior, index) => {
        let score = prior
        for (let column = 0; column < featureCount; column += 1) {
          // **분산이 0 이하인 열은 건너뛴다.** 평활이 0을 막지만 학습셋 전체가 상수인
          // 극단이 남고, 0으로 나누면 모든 클래스가 NaN이 되어 비교가 통째로 무너진다.
          const variance = varianceRows[index]?.[column] ?? 0
          if (variance <= 0) continue
          const gap = (input[column] ?? 0) - (meanRows[index]?.[column] ?? 0)
          score += -0.5 * (Math.log(2 * Math.PI * variance) + (gap * gap) / variance)
        }
        // 동점이면 번호가 작은 쪽이 이긴다. 라벨은 정렬 순서라 결정적이다.
        if (score > bestScore) {
          bestScore = score
          best = index
        }
      })

      const label = classes[best]
      if (label === undefined) invalid('classes')
      return label
    })
}
