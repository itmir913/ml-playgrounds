/**
 * `mlpx-linear-v2` — 로지스틱 회귀 (mlpx-spec.md 5.4.1).
 *
 * **높은 점수가 이긴다.** `argmax`, 확률은 softmax — sklearn `predict`·`predict_proba`와
 * 같은 식이다. 절편이 있고, 동점이면 정렬 순서가 앞선 클래스다(argmax가 첫 최댓값을
 * 고른다). softmax는 로그합지수로 안정화하므로 **확률이 언제나 있다.**
 *
 * **`mlpx-linear-v1`은 2026-08-15에 지웠다** (mlpx-spec.md 5.4). 그쪽은 점수가 **낮은**
 * 쪽이 이겼고, 그 반대 방향이 이 파일에서 가장 헷갈리는 자리였다. 엔진이 안 만든 지
 * 오래였고 읽을 파일도 없었다 — `open-decisions.md`의 "`mlpx-linear-v1`을 배포 전에
 * 지운다".
 *
 * **ml.js를 import하지 않는다.** 경계는 tree.ts와 같다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict, ProbaModel } from './types'

export const LINEAR_V2_FORMAT = 'mlpx-linear-v2'

export interface LinearModelV2 extends ModelFile {
  readonly format: typeof LINEAR_V2_FORMAT
  readonly classes: readonly string[]
  readonly featureCount: number
  /** **원래 좌표계다** — 엔진의 내부 표준화는 접혀 있다 (mlpx-spec.md 5.4.1). */
  readonly weights: readonly (readonly number[])[]
  /** 클래스마다 하나. weights와 같은 순서다. */
  readonly intercepts: readonly number[]
}

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

/** 검증을 마친 모델. **`load`와 `loadProba`가 같은 것을 본다.** */
interface ParsedLinear {
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly rows: readonly Float64Array[]
  readonly intercepts: Float64Array
}

/** 검증을 마친 가중치 행렬. */
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
export function loadLinearV2Model(file: unknown): Predict {
  return predictOfV2(parseLinearV2(file))
}

export function loadLinearV2Proba(file: unknown): ProbaModel {
  return probaOfV2(parseLinearV2(file))
}
