/**
 * `mlpx-linear-v1`·`mlpx-linear-v2` — 로지스틱 회귀 (mlpx-spec.md 5.4·5.4.1).
 *
 * **두 형식은 점수의 방향이 반대다.** 가장 헷갈리기 쉬운 사실이라 맨 위에 적는다.
 *
 * - **v2 (엔진이 지금 만드는 형식): 높은 점수가 이긴다.** `argmax`, 확률은 softmax —
 *   sklearn `predict`·`predict_proba`와 같은 식이다. 절편이 있고, 동점이면 정렬 순서가
 *   앞선 클래스다(argmax가 첫 최댓값을 고른다). softmax는 로그합지수로 안정화하므로
 *   **확률이 언제나 있다.**
 * - **v1 (읽기 전용 유산): 낮은 점수가 이긴다.** 떼어낸 `ml-logistic-regression`이
 *   one-vs-all에서 **대상 클래스를 0, 나머지를 1로** 두고 학습했기 때문이다. 시그모이드를
 *   씌워 비교하고(포화 동점은 번호가 작은 쪽), 확률은 `sigmoid(−score)`를 정규화하며,
 *   전부 언더플로하면 확률이 없다(null). 이 규칙들은 그 라이브러리의 재현이므로
 *   v1에만 적용된다.
 *
 * **ml.js를 import하지 않는다.** 경계는 tree.ts와 같다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict, ProbaModel } from './types'

export const LINEAR_FORMAT = 'mlpx-linear-v1'
export const LINEAR_V2_FORMAT = 'mlpx-linear-v2'

export interface LinearModel extends ModelFile {
  readonly format: typeof LINEAR_FORMAT
  /** 라벨을 **정렬한** 순서. weights의 줄 번호가 이 배열의 인덱스다. */
  readonly classes: readonly string[]
  /** 전처리를 마친 행렬의 열 수. 이 값과 안 맞는 입력은 거부한다. */
  readonly featureCount: number
  /** 클래스마다 한 줄. 줄의 길이는 featureCount이고 **절편은 없다.** */
  readonly weights: readonly (readonly number[])[]
}

export interface LinearModelV2 extends ModelFile {
  readonly format: typeof LINEAR_V2_FORMAT
  readonly classes: readonly string[]
  readonly featureCount: number
  /** **원래 좌표계다** — 엔진의 내부 표준화는 접혀 있다 (mlpx-spec.md 5.4.1). */
  readonly weights: readonly (readonly number[])[]
  /** 클래스마다 하나. weights와 같은 순서다. */
  readonly intercepts: readonly number[]
}

const linearModelSchema = z.looseObject({
  format: z.literal(LINEAR_FORMAT),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  weights: z.array(z.array(z.number())).min(1),
})

const linearV2ModelSchema = z.looseObject({
  format: z.literal(LINEAR_V2_FORMAT),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  weights: z.array(z.array(z.number())).min(1),
  intercepts: z.array(z.number()).min(1),
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
  /** v1은 전부 0이다 — 절편 0인 v2와 정확히 같은 산수가 된다. */
  readonly intercepts: Float64Array
}

/** 검증을 마친 가중치 행렬. 두 형식이 공유하는 부분이다. */
function weightRows(
  weights: readonly (readonly number[])[],
  classes: readonly string[],
  featureCount: number,
): Float64Array[] {
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  // 줄 하나가 클래스 하나다. 어긋나면 어느 줄이 어느 클래스인지 알 수 없다.
  if (weights.length !== classes.length) invalid('weights')

  return weights.map((row) => {
    if (row.length !== featureCount) invalid('weights')
    if (!row.every((value) => Number.isFinite(value))) invalid('weights')
    return Float64Array.from(row)
  })
}

/**
 * 파일 내용을 확인해 꺼낸다. **검증은 읽을 때 한 번 하고 예측 루프에서는 아무것도 안
 * 본다** (tree.ts와 같은 이유다).
 */
function parseLinear(file: unknown): ParsedLinear {
  const parsed = linearModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { classes, featureCount, weights } = parsed.data
  return {
    classes,
    featureCount,
    rows: weightRows(weights, classes, featureCount),
    intercepts: new Float64Array(classes.length),
  }
}

function parseLinearV2(file: unknown): ParsedLinear {
  const parsed = linearV2ModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { classes, featureCount, weights, intercepts } = parsed.data
  // 절편도 클래스마다 하나다 (mlpx-spec.md 5.4.1 불변식 5).
  if (intercepts.length !== classes.length) invalid('intercepts')
  if (!intercepts.every((value) => Number.isFinite(value))) invalid('intercepts')

  return {
    classes,
    featureCount,
    rows: weightRows(weights, classes, featureCount),
    intercepts: Float64Array.from(intercepts),
  }
}

/** 클래스마다의 원점수. **라벨과 확률이 같은 값을 본다** (mlpx-spec.md 5.4). */
function scoresOf(model: ParsedLinear, input: readonly number[]): Float64Array {
  const { featureCount, rows, intercepts } = model
  const scores = new Float64Array(rows.length)
  rows.forEach((weightRow, index) => {
    let score = intercepts[index] ?? 0
    for (let column = 0; column < featureCount; column += 1) {
      score += (weightRow[column] ?? 0) * (input[column] ?? 0)
    }
    scores[index] = score
  })
  return scores
}

/** v1 예측 — **argmin이다.** 갱신이 엄격한 `<`라 동점이면 번호가 작은 쪽이 남는다. */
function predictOfV1(model: ParsedLinear): Predict {
  const { classes, featureCount } = model

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')

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
 * v1 확률 (mlpx-spec.md 5.4). 판별기가 "이 클래스가 **아닐** 확률"을 재므로 뒤집어서
 * 정규화한다. 전부 언더플로하면 확률이 없다(null) — 균등분포로 채우지 않는다.
 */
function probaOfV1(model: ParsedLinear): ProbaModel {
  const { classes, featureCount } = model

  return {
    classes,
    predict: (features) =>
      features.map((input) => {
        if (input.length !== featureCount) invalid('featureCount')

        const raw = scoresOf(model, input).map((score) => sigmoid(-score))
        let sum = 0
        for (const value of raw) sum += value

        if (!(sum > 0)) return null
        return raw.map((value) => value / sum)
      }),
  }
}

/** v2 예측 — **argmax다.** 동점이면 첫 최댓값, 곧 정렬 순서가 앞선 클래스다. */
function predictOfV2(model: ParsedLinear): Predict {
  const { classes, featureCount } = model

  return (features) =>
    features.map((input) => {
      if (input.length !== featureCount) invalid('featureCount')

      let best = 0
      let highest = Number.NEGATIVE_INFINITY
      scoresOf(model, input).forEach((score, index) => {
        if (score > highest) {
          highest = score
          best = index
        }
      })

      const label = classes[best]
      if (label === undefined) invalid('classes')
      return label
    })
}

/**
 * v2 확률 — softmax (mlpx-spec.md 5.4.1). sklearn `predict_proba`와 같은 식이고,
 * 로그합지수로 안정화하므로 **언제나 있다.** argmax가 예측과 같은 점수를 보므로
 * "예측: A, P(A)=12%" 같은 자기모순이 구조적으로 불가능하다.
 */
function probaOfV2(model: ParsedLinear): ProbaModel {
  const { classes, featureCount } = model

  return {
    classes,
    predict: (features) =>
      features.map((input) => {
        if (input.length !== featureCount) invalid('featureCount')

        const scores = scoresOf(model, input)
        let top = Number.NEGATIVE_INFINITY
        for (const score of scores) if (score > top) top = score
        const raw = scores.map((score) => Math.exp(score - top))
        let sum = 0
        for (const value of raw) sum += value
        return raw.map((value) => value / sum)
      }),
  }
}

/** 파일을 예측 함수로. */
export function loadLinearModel(file: unknown): Predict {
  return predictOfV1(parseLinear(file))
}

export function loadLinearProba(file: unknown): ProbaModel {
  return probaOfV1(parseLinear(file))
}

export function loadLinearV2Model(file: unknown): Predict {
  return predictOfV2(parseLinearV2(file))
}

export function loadLinearV2Proba(file: unknown): ProbaModel {
  return probaOfV2(parseLinearV2(file))
}
