/**
 * `mlpx-neural-v1` — 다층 퍼셉트론 (`open-decisions.md` "인공신경망을 넣는다").
 *
 * **앞으로 한 번 도는 것이 전부다.** 은닉층은 ReLU, 출력은 이진이면 로지스틱 한 칸이고
 * 다중이면 softmax다 — sklearn `MLPClassifier`의 `predict`·`predict_proba`와 같은 식이다.
 *
 * **손실 곡선을 여기 담는다.** sklearn의 `loss_curve_`와 같은 자리다 — 학습이 남긴 것이라
 * `Run`의 새 필드가 아니라 모델 파일 안이고, 결과 화면의 패널이 그것을 그린다.
 * **모델을 못 담은 실행에는 곡선도 없다**(계수가 그런 것과 같다).
 *
 * **ml.js도 엔진도 import하지 않는다.** 경계는 `tree.ts`·`linear.ts`와 같다 — 해석하는
 * 쪽이 학습하는 쪽을 참조하면 지난 학기의 `.mlpx`가 엔진 교체에 딸려 죽는다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { ModelFile, Predict, ProbaModel } from './types'

export const NEURAL_FORMAT = 'mlpx-neural-v1'

export interface NeuralModel extends ModelFile {
  readonly format: typeof NEURAL_FORMAT
  readonly classes: readonly string[]
  readonly featureCount: number
  /** 층마다 `[들어오는 칸][나가는 칸]`. 은닉층 수 + 1개다. */
  readonly weights: readonly (readonly (readonly number[])[])[]
  /** 층마다 나가는 칸 수만큼. `weights`와 같은 순서다. */
  readonly intercepts: readonly (readonly number[])[]
  /** 에폭마다의 훈련 손실. **화면이 이것을 그린다.** */
  readonly lossCurve: readonly number[]
}

const neuralModelSchema = z.looseObject({
  format: z.literal(NEURAL_FORMAT),
  classes: z.array(z.string()).min(2),
  featureCount: z.number(),
  weights: z.array(z.array(z.array(z.number()))).min(1),
  intercepts: z.array(z.array(z.number())).min(1),
  lossCurve: z.array(z.number()),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

/** 검증을 마친 모델. **`load`와 `loadProba`가 같은 것을 본다.** */
export interface ParsedNeural {
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly weights: readonly Float64Array[][]
  readonly intercepts: readonly Float64Array[]
  readonly lossCurve: readonly number[]
}

/**
 * 파일 내용을 확인해 꺼낸다. **검증은 읽을 때 한 번 하고 예측 루프에서는 아무것도 안
 * 본다.**
 *
 * **층의 모양이 서로 맞물리는지까지 본다** — 한 층의 나가는 칸 수와 다음 층의 들어오는
 * 칸 수가 어긋난 파일은 예측 루프에서 `undefined`를 곱해 **NaN을 답으로 낸다.**
 */
export function parseNeural(file: unknown): ParsedNeural {
  const parsed = neuralModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')
  const model = parsed.data

  const { featureCount, classes } = model
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')
  if (model.weights.length !== model.intercepts.length) invalid('weights')

  const weights: Float64Array[][] = []
  const intercepts: Float64Array[] = []
  let fanIn = featureCount

  for (const [layer, matrix] of model.weights.entries()) {
    if (matrix.length !== fanIn) invalid('weights')
    const bias = model.intercepts[layer] as number[]
    const fanOut = bias.length
    if (fanOut === 0) invalid('intercepts')

    const rows: Float64Array[] = []
    for (const row of matrix) {
      if (row.length !== fanOut) invalid('weights')
      if (!row.every((value) => Number.isFinite(value))) invalid('weights')
      rows.push(Float64Array.from(row))
    }
    if (!bias.every((value) => Number.isFinite(value))) invalid('intercepts')

    weights.push(rows)
    intercepts.push(Float64Array.from(bias))
    fanIn = fanOut
  }

  // **마지막 층의 칸 수가 클래스 수를 말한다.** 이진은 한 칸이다 (sklearn과 같다).
  const outputs = fanIn
  if (outputs !== (classes.length === 2 ? 1 : classes.length)) invalid('weights')

  return { classes, featureCount, weights, intercepts, lossCurve: model.lossCurve }
}

/** 한 행을 앞으로 흘려 출력층의 확률을 낸다. */
function forward(model: ParsedNeural, input: readonly number[]): Float64Array {
  const last = model.weights.length - 1
  let current = Float64Array.from({ length: model.featureCount }, (_, i) => input[i] ?? 0)

  for (let layer = 0; layer <= last; layer += 1) {
    const matrix = model.weights[layer] as Float64Array[]
    const bias = model.intercepts[layer] as Float64Array
    const next = Float64Array.from(bias)

    for (let i = 0; i < current.length; i += 1) {
      const value = current[i] as number
      if (value === 0) continue
      const row = matrix[i] as Float64Array
      for (let j = 0; j < next.length; j += 1) {
        next[j] = (next[j] as number) + value * (row[j] as number)
      }
    }

    if (layer < last) {
      for (let j = 0; j < next.length; j += 1) next[j] = Math.max(0, next[j] as number)
    } else if (next.length === 1) {
      const z = next[0] as number
      next[0] = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))
    } else {
      let max = -Infinity
      for (const value of next) if (value > max) max = value
      let sum = 0
      for (let j = 0; j < next.length; j += 1) {
        const e = Math.exp((next[j] as number) - max)
        next[j] = e
        sum += e
      }
      for (let j = 0; j < next.length; j += 1) next[j] = (next[j] as number) / sum
    }
    current = next
  }
  return current
}

/**
 * 확률을 클래스 순서의 배열로. **이진의 한 칸을 두 칸으로 펴는 자리다** —
 * sklearn `predict_proba`가 `[1-p, p]`를 주는 것과 같고, `p`는 **두 번째 클래스**의 것이다.
 */
function probabilities(model: ParsedNeural, input: readonly number[]): Float64Array {
  const output = forward(model, input)
  if (model.classes.length === 2) {
    const p = output[0] as number
    return Float64Array.from([1 - p, p])
  }
  return output
}

/**
 * **높은 확률이 이긴다.** 동점이면 정렬 순서가 앞선 클래스다(`argmax`가 첫 최댓값을
 * 고른다) — `linear.ts`와 같은 규칙이다.
 */
export function loadNeuralModel(file: unknown): Predict {
  const model = parseNeural(file)
  return (features) =>
    features.map((row) => {
      const proba = probabilities(model, row)
      let best = 0
      for (let i = 1; i < proba.length; i += 1) {
        if ((proba[i] as number) > (proba[best] as number)) best = i
      }
      return model.classes[best] as string
    })
}

/**
 * 확률. **`load`와 같은 계산을 쓴다** — 따로 짜면 포화 구간에서 라벨과 확률이 갈린다
 * (mlpx-spec.md §5.4).
 *
 * **softmax는 언제나 값을 낸다.** 로그합지수로 안정화하므로 분모가 0이 되는 자리가 없다.
 */
export function loadNeuralProba(file: unknown): ProbaModel {
  const model = parseNeural(file)
  return {
    classes: model.classes,
    predict: (features) => features.map((row) => probabilities(model, row)),
  }
}
