/**
 * 다층 퍼셉트론 솔버 — **sklearn `MLPClassifier` 기본값과 같은 구조로 푼다**
 * (`open-decisions.md` "인공신경망을 넣는다 — 손잡이는 층 수와 뉴런 수 둘").
 *
 *   은닉층: ReLU · 출력: 이진이면 로지스틱 한 칸, 다중이면 softmax
 *   손실: 로그손실 + (0.5·alpha)·Σ‖W‖² / 배치 크기      (절편은 규제하지 않는다)
 *   최적화: Adam(lr 0.001, β₁ 0.9, β₂ 0.999, ε 1e-8) · 미니배치 200 · 에폭 200
 *
 * **로지스틱과 결정적으로 다른 것이 하나 있다.** 저쪽은 L2가 최적점을 **유일하게**
 * 만들어 *"올바르게 수렴하면 계수가 sklearn과 같다"*가 성립했다. 여기는 목적함수가
 * 비볼록이고 도착점이 **초기화와 배치 순서**에 달렸다. sklearn은 numpy `RandomState`로
 * 가중치를 뽑고 배치를 섞는데, 그 난수열을 JS에서 재현하는 것은 **sklearn을 이식하는
 * 일이지 같은 알고리즘을 짜는 일이 아니다.**
 *
 * **그래서 대조는 계수가 아니라 분포다** — `tests/sklearn-parity.spec.ts`가 씨앗을 여럿
 * 돌려 얻은 sklearn의 정확도 **구간**과 견준다. 가중치와 손실 곡선의 값 자체는 안 잰다.
 *
 * **씨앗은 반드시 쓴다.** `Math.random`은 이 파일 어디에도 없다 — 같은 설정으로 두 번
 * 돌리면 같은 곡선이 나와야 하고, 재현 가능성이 교육용 도구의 생명이다 (CLAUDE.md §2).
 *
 * **기울기 식은 `tests/neural.spec.ts`가 유한차분으로 재확인한다.** 손으로 짠 역전파에서
 * 부호 하나가 뒤집혀도 손실은 그럴듯하게 내려갈 수 있다.
 */

import { uniformInt } from 'pure-rand/distribution/uniformInt'
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus'

import { hashText } from '../../hash'
import { NEURAL_BATCH_SIZE, NEURAL_MAX_EPOCHS } from '../../limits'
import { shuffled } from '../shuffle'

/**
 * sklearn `MLPClassifier`의 기본값. **여는 손잡이는 층 수와 뉴런 수 둘뿐이고**
 * (`ml/engines/mljs-params.ts`) 나머지는 여기 고정이다 — 수렴 설정은 수업 내용이 아니라
 * 수업 시간을 말아먹는 값이다(k-means·SVM과 같은 판단).
 *
 * **값을 바꾸면 학생의 결과가 바뀐다.** 그리고 sklearn 기본값에서 멀어지는 순간
 * *"파이썬으로 옮겨 가면 같은 것이 나온다"*가 깨진다 (CLAUDE.md §2).
 */
const ALPHA = 0.0001
const LEARNING_RATE_INIT = 0.001
const BETA_1 = 0.9
const BETA_2 = 0.999
const EPSILON = 1e-8
const TOL = 1e-4
/** 손실이 `TOL`만큼도 안 줄어든 에폭이 이만큼 이어지면 멈춘다 (sklearn과 같다). */
const NO_IMPROVEMENT_LIMIT = 10

/** 솔버의 손잡이. 기본값은 `mljs-params.ts`가 갖는다 — 여기는 받은 값을 쓸 뿐이다. */
export interface NeuralOptions {
  /** 은닉층 수. sklearn `hidden_layer_sizes`의 **길이**. */
  readonly hiddenLayers: number
  /** 층당 뉴런 수. sklearn `hidden_layer_sizes`의 **값**. */
  readonly neuronsPerLayer: number
}

export interface FittedNeural {
  /** 층마다 `[들어오는 칸][나가는 칸]`. 은닉층 수 + 1개다. */
  readonly weights: number[][][]
  /** 층마다 나가는 칸 수만큼. `weights`와 같은 순서다. */
  readonly intercepts: number[][]
  /**
   * 에폭마다의 훈련 손실. **sklearn의 `loss_curve_`와 같은 것이고 화면이 이것을 그린다.**
   */
  readonly lossCurve: number[]
  /** 손실이 더 안 줄어들어 스스로 멈췄는가. 에폭 상한에 닿았으면 거짓이다. */
  readonly converged: boolean
  /** 실제로 돈 에폭 수. */
  readonly epochs: number
}

/** 0과 1 사이의 실수 하나. **정수 분포 하나로 만든다** — 씨앗 규약이 저장소에 하나다. */
function uniform01(rng: ReturnType<typeof xoroshiro128plus>): number {
  return uniformInt(rng, 0, 0xffffffff) / 0x100000000
}

/**
 * 층 크기 목록. `[특성 수, 은닉…, 출력 칸 수]`.
 *
 * **이진의 출력이 한 칸인 것은 sklearn과 같다** — `MLPClassifier`가 라벨 이진화로
 * 열 하나를 얻고 출력 활성을 로지스틱으로 둔다. 두 칸 softmax로 풀면 같은 모델이 아니다.
 */
function layerSizes(
  featureCount: number,
  classCount: number,
  options: NeuralOptions,
): readonly number[] {
  const hidden = Math.max(1, Math.round(options.hiddenLayers))
  const width = Math.max(1, Math.round(options.neuronsPerLayer))
  const output = classCount === 2 ? 1 : classCount
  return [featureCount, ...Array.from({ length: hidden }, () => width), output]
}

/**
 * Glorot 초기화. **sklearn `_init_coef`과 같은 식이다** —
 * `bound = sqrt(6 / (fan_in + fan_out))`이고 그 안에서 균등하게 뽑는다.
 *
 * **0으로 채우면 안 된다.** 한 층의 모든 뉴런이 같은 기울기를 받아 영원히 같은 값으로
 * 남는다 — 뉴런을 백 개 두어도 하나짜리 신경망이 되고, 그 사실은 손실 곡선에 안 보인다.
 */
function initialize(
  sizes: readonly number[],
  seed: number,
): { weights: number[][][]; intercepts: number[][] } {
  const rng = xoroshiro128plus(seed)
  const weights: number[][][] = []
  const intercepts: number[][] = []

  for (let layer = 0; layer + 1 < sizes.length; layer += 1) {
    const fanIn = sizes[layer] as number
    const fanOut = sizes[layer + 1] as number
    const bound = Math.sqrt(6 / (fanIn + fanOut))
    const matrix: number[][] = []
    for (let i = 0; i < fanIn; i += 1) {
      const row: number[] = []
      for (let j = 0; j < fanOut; j += 1) row.push((uniform01(rng) * 2 - 1) * bound)
      matrix.push(row)
    }
    weights.push(matrix)
    intercepts.push(Array.from({ length: fanOut }, () => (uniform01(rng) * 2 - 1) * bound))
  }
  return { weights, intercepts }
}

/** `z`의 softmax. 로그합지수로 안정화한다 — 큰 점수에서 `e^z`가 넘친다. */
function softmax(z: Float64Array): void {
  let max = -Infinity
  for (const value of z) if (value > max) max = value
  let sum = 0
  for (let i = 0; i < z.length; i += 1) {
    const e = Math.exp((z[i] as number) - max)
    z[i] = e
    sum += e
  }
  for (let i = 0; i < z.length; i += 1) z[i] = (z[i] as number) / sum
}

/** 로지스틱. 큰 음수에서 `e^-z`가 넘치므로 갈라 계산한다. */
function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))
}

/** 확률이 정확히 0이나 1이면 로그가 무한이 된다. sklearn도 같은 자리를 자른다. */
const CLIP = 1e-10

/**
 * 앞으로 한 번. `activations[0]`이 입력이고 마지막이 출력이다.
 *
 * **은닉층은 ReLU, 출력층만 다르다** — 이진이면 로지스틱 한 칸, 다중이면 softmax.
 */
function forward(
  weights: readonly number[][][],
  intercepts: readonly number[][],
  input: readonly number[],
  activations: Float64Array[],
): void {
  const first = activations[0] as Float64Array
  for (let i = 0; i < first.length; i += 1) first[i] = input[i] ?? 0

  const last = weights.length - 1
  for (let layer = 0; layer <= last; layer += 1) {
    const from = activations[layer] as Float64Array
    const to = activations[layer + 1] as Float64Array
    const matrix = weights[layer] as number[][]
    const bias = intercepts[layer] as number[]

    for (let j = 0; j < to.length; j += 1) to[j] = bias[j] as number
    for (let i = 0; i < from.length; i += 1) {
      const value = from[i] as number
      if (value === 0) continue
      const row = matrix[i] as number[]
      for (let j = 0; j < to.length; j += 1) to[j] = (to[j] as number) + value * (row[j] as number)
    }

    if (layer < last) {
      for (let j = 0; j < to.length; j += 1) to[j] = Math.max(0, to[j] as number)
    } else if (to.length === 1) {
      to[0] = sigmoid(to[0] as number)
    } else {
      softmax(to)
    }
  }
}

/** Adam의 상태. 층마다 1차·2차 모멘트를 가중치와 절편 각각에 든다. */
interface Adam {
  readonly mWeights: Float64Array[]
  readonly vWeights: Float64Array[]
  readonly mIntercepts: Float64Array[]
  readonly vIntercepts: Float64Array[]
  step: number
}

function adamFor(sizes: readonly number[]): Adam {
  const mWeights: Float64Array[] = []
  const vWeights: Float64Array[] = []
  const mIntercepts: Float64Array[] = []
  const vIntercepts: Float64Array[] = []
  for (let layer = 0; layer + 1 < sizes.length; layer += 1) {
    const cells = (sizes[layer] as number) * (sizes[layer + 1] as number)
    mWeights.push(new Float64Array(cells))
    vWeights.push(new Float64Array(cells))
    mIntercepts.push(new Float64Array(sizes[layer + 1] as number))
    vIntercepts.push(new Float64Array(sizes[layer + 1] as number))
  }
  return { mWeights, vWeights, mIntercepts, vIntercepts, step: 0 }
}

/**
 * 한 배치의 **손실과 기울기**를 낸다. 걸음은 안 걷는다 — 그것은 `adamStep`의 일이다.
 *
 * **둘을 가른 이유는 유한차분이다** (`neuralGradientForTest`). 한 함수 안에 있으면
 * 기울기를 밖에서 잴 방법이 없고, **틀린 기울기로도 손실은 그럭저럭 내려간다.**
 *
 * **규제 항은 배치 크기로 나눈다** — sklearn `_backprop`이 그렇게 한다. 안 나누면
 * 배치가 작을수록 규제가 세지고, 마지막 자투리 배치만 다른 목적함수를 푼다.
 *
 * 돌려주는 기울기는 **아직 배치 크기로 안 나눈 합**이다. 나누는 자리는 한 곳이어야 하고
 * (`adamStep`), 손실만 여기서 나눈다.
 */
function accumulate(
  weights: readonly number[][][],
  intercepts: readonly number[][],
  features: readonly (readonly number[])[],
  encoded: readonly number[],
  rows: readonly number[],
  sizes: readonly number[],
  activations: Float64Array[],
  deltas: Float64Array[],
  gradWeights: Float64Array[],
  gradIntercepts: Float64Array[],
): number {
  const last = weights.length - 1
  const outputs = sizes[sizes.length - 1] as number
  for (const grad of gradWeights) grad.fill(0)
  for (const grad of gradIntercepts) grad.fill(0)

  let loss = 0
  for (const row of rows) {
    forward(weights, intercepts, features[row] as readonly number[], activations)
    const output = activations[last + 1] as Float64Array
    const label = encoded[row] as number

    // 로그손실. 이진은 한 칸의 베르누이, 다중은 정답 칸의 로그다.
    if (outputs === 1) {
      const p = Math.min(1 - CLIP, Math.max(CLIP, output[0] as number))
      loss += label === 1 ? -Math.log(p) : -Math.log(1 - p)
    } else {
      const p = Math.min(1 - CLIP, Math.max(CLIP, output[label] as number))
      loss += -Math.log(p)
    }

    /**
     * **출력층의 델타는 softmax·로지스틱 둘 다 `예측 - 정답`이다.** 활성 함수의 미분이
     * 로그손실의 미분과 상쇄되어 사라지는 자리이고, 그래서 여기에 `p(1-p)`를 곱하면
     * **틀린 기울기인데도 손실이 그럭저럭 내려간다** — 유한차분 검사가 이것을 잡는다.
     */
    const outDelta = deltas[last] as Float64Array
    if (outputs === 1) {
      outDelta[0] = (output[0] as number) - (label === 1 ? 1 : 0)
    } else {
      for (let j = 0; j < outputs; j += 1) {
        outDelta[j] = (output[j] as number) - (j === label ? 1 : 0)
      }
    }

    for (let layer = last; layer >= 0; layer -= 1) {
      const delta = deltas[layer] as Float64Array
      const from = activations[layer] as Float64Array
      const gw = gradWeights[layer] as Float64Array
      const gb = gradIntercepts[layer] as Float64Array
      const width = delta.length

      for (let i = 0; i < from.length; i += 1) {
        const value = from[i] as number
        if (value === 0) continue
        const base = i * width
        for (let j = 0; j < width; j += 1) {
          gw[base + j] = (gw[base + j] as number) + value * (delta[j] as number)
        }
      }
      for (let j = 0; j < width; j += 1) gb[j] = (gb[j] as number) + (delta[j] as number)

      if (layer === 0) continue
      // 아래 층으로 되돌린다. ReLU의 미분은 활성이 0보다 클 때만 1이다.
      const below = deltas[layer - 1] as Float64Array
      const matrix = weights[layer] as number[][]
      const belowActivation = activations[layer] as Float64Array
      for (let i = 0; i < below.length; i += 1) {
        if ((belowActivation[i] as number) <= 0) {
          below[i] = 0
          continue
        }
        const rowWeights = matrix[i] as number[]
        let sum = 0
        for (let j = 0; j < width; j += 1) sum += (rowWeights[j] as number) * (delta[j] as number)
        below[i] = sum
      }
    }
  }

  const size = rows.length
  // 규제. **절편은 규제하지 않는다** — sklearn과 같다.
  let penalty = 0
  for (let layer = 0; layer <= last; layer += 1) {
    const matrix = weights[layer] as readonly number[][]
    const gw = gradWeights[layer] as Float64Array
    const width = (matrix[0]?.length ?? 0) as number
    for (let i = 0; i < matrix.length; i += 1) {
      const row = matrix[i] as readonly number[]
      for (let j = 0; j < width; j += 1) {
        const w = row[j] as number
        penalty += w * w
        gw[i * width + j] = (gw[i * width + j] as number) + ALPHA * w
      }
    }
  }

  return loss / size + (0.5 * ALPHA * penalty) / size
}

/** Adam 한 걸음. **기울기는 배치 평균이다** — 나누는 자리가 여기 하나다. */
function adamStep(
  weights: number[][][],
  intercepts: number[][],
  adam: Adam,
  gradWeights: readonly Float64Array[],
  gradIntercepts: readonly Float64Array[],
  size: number,
): void {
  const last = weights.length - 1
  adam.step += 1
  const scale =
    (LEARNING_RATE_INIT * Math.sqrt(1 - Math.pow(BETA_2, adam.step))) /
    (1 - Math.pow(BETA_1, adam.step))

  for (let layer = 0; layer <= last; layer += 1) {
    const matrix = weights[layer] as number[][]
    const bias = intercepts[layer] as number[]
    const gw = gradWeights[layer] as Float64Array
    const gb = gradIntercepts[layer] as Float64Array
    const mw = adam.mWeights[layer] as Float64Array
    const vw = adam.vWeights[layer] as Float64Array
    const mb = adam.mIntercepts[layer] as Float64Array
    const vb = adam.vIntercepts[layer] as Float64Array
    const width = (matrix[0]?.length ?? 0) as number

    for (let i = 0; i < matrix.length; i += 1) {
      const row = matrix[i] as number[]
      for (let j = 0; j < width; j += 1) {
        const cell = i * width + j
        const gradient = (gw[cell] as number) / size
        mw[cell] = BETA_1 * (mw[cell] as number) + (1 - BETA_1) * gradient
        vw[cell] = BETA_2 * (vw[cell] as number) + (1 - BETA_2) * gradient * gradient
        row[j] =
          (row[j] as number) -
          (scale * (mw[cell] as number)) / (Math.sqrt(vw[cell] as number) + EPSILON)
      }
    }
    for (let j = 0; j < bias.length; j += 1) {
      const gradient = (gb[j] as number) / size
      mb[j] = BETA_1 * (mb[j] as number) + (1 - BETA_1) * gradient
      vb[j] = BETA_2 * (vb[j] as number) + (1 - BETA_2) * gradient * gradient
      bias[j] =
        (bias[j] as number) - (scale * (mb[j] as number)) / (Math.sqrt(vb[j] as number) + EPSILON)
    }
  }
}

/**
 * 학습한다. `encoded[i]`는 클래스 번호이고, 이진이면 **1이 두 번째 클래스**다 —
 * sklearn이 `classes_[1]`을 양성으로 두는 것과 같다.
 */
export function fitNeural(
  features: readonly (readonly number[])[],
  encoded: readonly number[],
  classCount: number,
  options: NeuralOptions,
  randomState: number,
): FittedNeural {
  const featureCount = features[0]?.length ?? 0
  const sizes = layerSizes(featureCount, classCount, options)
  const { weights, intercepts } = initialize(sizes, randomState)
  const adam = adamFor(sizes)

  const activations = sizes.map((size) => new Float64Array(size))
  const deltas = sizes.slice(1).map((size) => new Float64Array(size))
  const gradWeights = sizes
    .slice(0, -1)
    .map((size, layer) => new Float64Array(size * (sizes[layer + 1] as number)))
  const gradIntercepts = sizes.slice(1).map((size) => new Float64Array(size))

  const order = features.map((_, index) => index)
  const batchSize = Math.min(NEURAL_BATCH_SIZE, Math.max(1, features.length))
  const lossCurve: number[] = []
  let best = Infinity
  let stale = 0
  let converged = false
  let epochs = 0

  for (let epoch = 0; epoch < NEURAL_MAX_EPOCHS; epoch += 1) {
    /**
     * **에폭마다 섞는다** (sklearn `shuffle=True`). 안 섞으면 정렬된 교실 CSV에서 배치
     * 하나가 한 라벨로만 채워지고, 그 순서가 그대로 학습에 새겨진다.
     *
     * **씨앗은 에폭마다 흔든다.** `randomState + epoch`로는 인접한 씨앗이 붙어 다닐 수
     * 있어 `labelSeed`와 같은 방식으로 해시를 쓴다 (`ml/shuffle.ts`).
     */
    const shuffledRows = shuffled(
      order,
      randomState ^ Number.parseInt(hashText(`epoch:${epoch}`).slice(0, 8), 16),
    )

    let accumulated = 0
    for (let start = 0; start < shuffledRows.length; start += batchSize) {
      const batch = shuffledRows.slice(start, start + batchSize)
      const loss = accumulate(
        weights,
        intercepts,
        features,
        encoded,
        batch,
        sizes,
        activations,
        deltas,
        gradWeights,
        gradIntercepts,
      )
      adamStep(weights, intercepts, adam, gradWeights, gradIntercepts, batch.length)
      accumulated += loss * batch.length
    }

    const epochLoss = accumulated / shuffledRows.length
    lossCurve.push(epochLoss)
    epochs = epoch + 1

    // sklearn `_update_no_improvement_count`와 같은 판정이다.
    if (epochLoss > best - TOL) stale += 1
    else stale = 0
    if (epochLoss < best) best = epochLoss
    if (stale > NO_IMPROVEMENT_LIMIT) {
      converged = true
      break
    }
  }

  return { weights, intercepts, lossCurve, converged, epochs }
}

/**
 * 유한차분 검증용 — **한 번의 전체 배치에서 손실과 기울기를 밖에서 잴 수 있게 연다.**
 * 테스트 전용이다 (`tests/neural.spec.ts`의 기울기 검증), `logisticObjectiveForTest`와
 * 같은 자리다.
 *
 * 돌려주는 기울기는 **배치 크기로 나눈 값**이다 — `adamStep`이 실제로 걷는 그 값이고,
 * 손실도 같은 자로 나뉘어 있어야 유한차분이 성립한다.
 */
export function neuralGradientForTest(
  weights: readonly number[][][],
  intercepts: readonly number[][],
  features: readonly (readonly number[])[],
  encoded: readonly number[],
): { loss: number; gradWeights: Float64Array[]; gradIntercepts: Float64Array[] } {
  const sizes = [(weights[0]?.length ?? 0) as number, ...intercepts.map((bias) => bias.length)]
  const activations = sizes.map((size) => new Float64Array(size))
  const deltas = sizes.slice(1).map((size) => new Float64Array(size))
  const gradWeights = sizes
    .slice(0, -1)
    .map((size, layer) => new Float64Array(size * (sizes[layer + 1] as number)))
  const gradIntercepts = sizes.slice(1).map((size) => new Float64Array(size))
  const rows = features.map((_, index) => index)

  const loss = accumulate(
    weights,
    intercepts,
    features,
    encoded,
    rows,
    sizes,
    activations,
    deltas,
    gradWeights,
    gradIntercepts,
  )
  for (const grad of gradWeights)
    for (let i = 0; i < grad.length; i += 1) grad[i] = (grad[i] as number) / rows.length
  for (const grad of gradIntercepts)
    for (let i = 0; i < grad.length; i += 1) grad[i] = (grad[i] as number) / rows.length
  return { loss, gradWeights, gradIntercepts }
}
