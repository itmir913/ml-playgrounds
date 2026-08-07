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
 * **확률도 낸다** (`loadLinearProba`, mlpx-spec.md 5.4). 판별기가 재는 것이 "이 클래스가
 * **아닐** 확률"이라 뒤집어서 정규화한다. **점수 계산은 라벨과 공유하고, 라벨은 확률에서
 * 유도하지 않는다** — 위 포화 문단이 그 이유다. 두 벌로 계산하면 "예측: A, P(A)=12%"
 * 같은 자기모순이 에러 없이 나온다.
 *
 * **ml.js를 import하지 않는다.** 경계는 tree.ts와 같다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict, ProbaModel } from './types'

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

/** 검증을 마친 모델. **`load`와 `loadProba`가 같은 것을 본다.** */
interface ParsedLinear {
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly rows: readonly Float64Array[]
}

/**
 * 파일 내용을 확인해 꺼낸다. **검증은 읽을 때 한 번 하고 예측 루프에서는 아무것도 안
 * 본다** (tree.ts와 같은 이유다).
 */
function parseLinear(file: unknown): ParsedLinear {
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

  return { classes, featureCount, rows }
}

/** 클래스마다의 원점수. **라벨과 확률이 같은 값을 본다** (mlpx-spec.md 5.4). */
function scoresOf(model: ParsedLinear, input: readonly number[]): Float64Array {
  const { featureCount, rows } = model
  const scores = new Float64Array(rows.length)
  rows.forEach((weightRow, index) => {
    let score = 0
    for (let column = 0; column < featureCount; column += 1) {
      score += (weightRow[column] ?? 0) * (input[column] ?? 0)
    }
    scores[index] = score
  })
  return scores
}

/** 파일을 예측 함수로. */
export function loadLinearModel(file: unknown): Predict {
  const model = parseLinear(file)
  const { classes, featureCount } = model

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')

      // **argmin이다.** 그리고 갱신이 엄격한 `<`라 동점이면 번호가 작은 쪽이 남는다.
      let best = 0
      let lowest = Number.POSITIVE_INFINITY
      scoresOf(model, input).forEach((score, index) => {
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

/**
 * 파일을 확률 함수로 (mlpx-spec.md 5.4). **`classes` 순서·같은 길이이고 합은 1이다.**
 *
 * **라벨을 여기서 정하지 않는다.** 포화하지 않은 입력에서는 이 확률의 argmax가
 * `loadLinearModel`의 argmin과 반드시 같지만, 점수가 37을 넘으면 시그모이드가 전부
 * 정확히 1.0으로 뭉개져 저쪽은 동점이 되는 반면 `sigmoid(-score)`는 710까지 살아 있어
 * 이쪽은 여전히 구별한다. 재현이 목적이므로 **라벨은 언제나 저쪽 규칙이다.**
 */
export function loadLinearProba(file: unknown): ProbaModel {
  const model = parseLinear(file)
  const { classes, featureCount } = model

  return {
    classes,
    predict: (features) =>
      features.map((input) => {
        if (input.length !== featureCount) invalid('featureCount')

        // 판별기는 "이 클래스가 **아닐** 확률"을 잰다. 뒤집어서 합이 1이 되게 나눈다.
        const raw = scoresOf(model, input).map((score) => sigmoid(-score))
        let sum = 0
        for (const value of raw) sum += value

        // 전부 언더플로했다(또는 입력이 유한하지 않다). **균등분포로 채우지 않는다** —
        // 일대다 판별기가 전부 "나는 아니다"라고 답한 것이지 모르겠다는 뜻이 아니다.
        if (!(sum > 0)) return null
        return raw.map((value) => value / sum)
      }),
  }
}
