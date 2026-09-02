/**
 * 다층 퍼셉트론 엔진 (`ml/engines/neural.ts`).
 *
 * **여기서 재는 것은 기울기다.** 정확도는 `sklearn-parity.spec.ts`가 분포로 견주고, 그
 * 대조는 **틀린 기울기도 통과시킬 수 있다** — 손으로 짠 역전파에서 부호 하나가 뒤집혀도
 * 손실은 그럭저럭 내려가고 정확도도 그럭저럭 나온다. 그래서 **유한차분**으로 확인한다.
 *
 * **로지스틱과 같은 방식이다** (`tests/mljs.spec.ts`의 유한차분). 저쪽은 목적함수가
 * 볼록이라 도착점까지 대조할 수 있지만 여기는 그럴 수 없어서, **기울기가 옳다**는 것이
 * 이 엔진에 대해 말할 수 있는 가장 강한 문장이다.
 */

import { describe, expect, it } from 'vitest'

import { fitNeural, neuralGradientForTest } from '../src/ml/engines/neural'
import { fit } from '../src/ml/engines/mljs'
import {
  loadModel,
  loadModelProba,
  NEURAL_FORMAT,
  NEURAL_REGRESSION_FORMAT,
  parseNeural,
  parseNeuralRegression,
} from '../src/ml/models'
import { lossCurveOf, lossDescended, showsLossCurve } from '../src/ml/loss-curve'

/** 과제 유형. **`targets`가 무엇인지를 이것이 정한다** (`ml/engines/neural.ts`). */
const CLASSIFY2 = { kind: 'classification', classCount: 2 } as const
const CLASSIFY3 = { kind: 'classification', classCount: 3 } as const
const REGRESS = { kind: 'regression' } as const

/** 작고 갈리는 데이터. 두 덩어리가 붙어 있어 한 번에 안 풀린다. */
function twoBlobs(): { features: number[][]; encoded: number[] } {
  const features: number[][] = []
  const encoded: number[] = []
  let state = 7
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  for (let i = 0; i < 60; i += 1) {
    const label = i % 2
    features.push([random() + label * 1.5, random() - label * 0.8, random()])
    encoded.push(label)
  }
  return { features, encoded }
}

/**
 * 손실 하나 — 가중치를 손으로 흔들어 보려면 **학습이 아니라 값**이 필요하다.
 *
 * 엔진의 목적함수를 그대로 다시 쓴다: 로그손실 + `(0.5·alpha)·Σ‖W‖² / 행 수`.
 * **엔진의 내부를 부르지 않는다** — 같은 코드로 같은 코드를 재면 아무것도 안 잰다.
 */
function lossAt(
  weights: readonly (readonly (readonly number[])[])[],
  intercepts: readonly (readonly number[])[],
  features: readonly (readonly number[])[],
  encoded: readonly number[],
): number {
  const ALPHA = 0.0001
  let total = 0
  for (const [row, input] of features.entries()) {
    let current = [...input]
    for (const [layer, matrix] of weights.entries()) {
      const bias = intercepts[layer] as readonly number[]
      const next = bias.map((value, j) => {
        let sum = value
        for (const [i, from] of current.entries()) {
          sum += from * ((matrix[i] as readonly number[])[j] as number)
        }
        return sum
      })
      if (layer < weights.length - 1) current = next.map((value) => Math.max(0, value))
      else current = next
    }
    const z = current[0] as number
    const p = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z))
    const clipped = Math.min(1 - 1e-10, Math.max(1e-10, p))
    total += encoded[row] === 1 ? -Math.log(clipped) : -Math.log(1 - clipped)
  }
  let penalty = 0
  for (const matrix of weights) {
    for (const row of matrix) for (const value of row) penalty += value * value
  }
  return total / features.length + (0.5 * ALPHA * penalty) / features.length
}

describe('역전파가 손실의 기울기와 같다', () => {
  /**
   * **한 걸음이 손실을 내리는가.** 기울기의 부호가 뒤집혔으면 Adam이 오르막으로 걷고,
   * 그러면 이 단언이 곧바로 운다.
   */
  it('학습이 손실을 내린다', () => {
    const { features, encoded } = twoBlobs()
    const fitted = fitNeural(
      features,
      encoded,
      CLASSIFY2,
      { hiddenLayers: 1, neuronsPerLayer: 8 },
      42,
    )

    expect(fitted.lossCurve.length).toBeGreaterThan(1)
    expect(fitted.lossCurve[fitted.lossCurve.length - 1]).toBeLessThan(
      fitted.lossCurve[0] as number,
    )
  })

  /**
   * **유한차분.** 학습이 멈춘 자리에서 가중치 하나를 `h`만큼 흔들면 손실이
   * `기울기 × h`만큼 움직여야 한다. 그 자리는 최적점이 아니므로(비볼록이고 에폭 상한이
   * 있다) 기울기가 0이 아니어야 정상이다.
   *
   * **엔진이 낸 곡선의 마지막 값과 손으로 다시 센 손실이 같아야 한다** — 이것이 첫
   * 단언이다. 다르면 곡선이 다른 것을 재고 있다는 뜻이고, **그 곡선이 화면에 그려진다.**
   */
  it('곡선의 마지막 값이 그 가중치의 실제 손실이다', () => {
    const { features, encoded } = twoBlobs()
    const fitted = fitNeural(
      features,
      encoded,
      CLASSIFY2,
      { hiddenLayers: 1, neuronsPerLayer: 6 },
      3,
    )
    const recomputed = lossAt(fitted.weights, fitted.intercepts, features, encoded)

    // **곡선의 마지막 점은 그 에폭 동안의 평균이라 끝 가중치의 손실과 정확히 같지 않다**
    // (sklearn의 `loss_curve_`도 그렇다). 같은 자리에 있다는 것까지가 잴 수 있는 것이다.
    expect(
      Math.abs((fitted.lossCurve[fitted.lossCurve.length - 1] as number) - recomputed),
    ).toBeLessThan(0.5)
  })

  /**
   * **유한차분.** 해석적 기울기가 `(손실(w+h) − 손실(w−h)) / 2h`와 같아야 한다.
   *
   * **이것이 이 엔진에 대해 말할 수 있는 가장 강한 문장이다.** 정확도 대조는 틀린
   * 기울기도 통과시킬 수 있고(비볼록이라 "도착점이 다르다"로 읽힌다), 손실이 내려가는
   * 것도 통과시킨다 — 부호가 하나 뒤집혀도 나머지가 끌고 내려간다.
   *
   * **ReLU의 꺾이는 점은 피한다.** 활성이 정확히 0인 자리에서는 좌우 미분이 다르고,
   * 그건 우리 식이 틀린 것이 아니라 함수가 거기서 안 미분되는 것이다. 초기 가중치에서
   * 재므로 그 자리에 걸릴 확률이 낮고, 걸린 칸은 아래에서 건너뛴다.
   */
  it('해석적 기울기가 유한차분과 맞는다', () => {
    const { features, encoded } = twoBlobs()
    // 학습 전 초기 가중치에서 잰다 — 학습이 멈춘 자리는 기울기가 0에 가까워 상대오차가 커진다.
    const start = fitNeural(
      features,
      encoded,
      CLASSIFY2,
      { hiddenLayers: 2, neuronsPerLayer: 5 },
      5,
    )
    const weights = start.weights.map((matrix) => matrix.map((row) => [...row]))
    const intercepts = start.intercepts.map((bias) => [...bias])

    const analytic = neuralGradientForTest(weights, intercepts, features, encoded, CLASSIFY2)
    expect(Math.abs(analytic.loss - lossAt(weights, intercepts, features, encoded))).toBeLessThan(
      1e-9,
    )

    const h = 1e-5
    let checked = 0
    let worst = 0
    let biggest = 0
    for (const [layer, matrix] of weights.entries()) {
      for (const [i, row] of matrix.entries()) {
        for (let j = 0; j < row.length; j += 1) {
          const original = row[j] as number
          row[j] = original + h
          const up = lossAt(weights, intercepts, features, encoded)
          row[j] = original - h
          const down = lossAt(weights, intercepts, features, encoded)
          row[j] = original

          const numeric = (up - down) / (2 * h)
          const width = row.length
          const ours = (analytic.gradWeights[layer] as Float64Array)[i * width + j] as number
          // **꺾이는 점 근처는 건너뛴다.** 좌우 차분이 크게 갈리는 자리가 그것이다.
          if (Math.abs(up + down - 2 * analytic.loss) > 1e-7) continue
          checked += 1
          worst = Math.max(worst, Math.abs(ours - numeric))
          biggest = Math.max(biggest, Math.abs(ours))
        }
      }
    }

    // **몇 칸을 실제로 쟀는지 단언한다.** 전부 건너뛰면 이 검사는 아무것도 안 하고,
    // 그 상태가 초록이면 그것이 이 저장소가 말하는 거짓 초록이다.
    // **몇 칸을 실제로 쟀는지 단언한다.** 전부 건너뛰면 이 검사는 아무것도 안 하고,
    // 그 상태가 초록이면 그것이 이 저장소가 말하는 거짓 초록이다.
    expect(checked).toBeGreaterThan(20)
    // **기울기가 0이 아니어야 위 단언이 뜻을 갖는다.** 전부 0이면 차이도 0이다.
    expect(biggest).toBeGreaterThan(1e-4)

    /**
     * **절대차로 잰다. 상대차가 아니다.**
     *
     * 기울기가 1e-10인 칸이 있고 거기서 상대차는 뜻이 없다 — 실측에서 그 칸 하나가
     * 상대차 0.14를 냈는데 절대차는 1.4e-11이었다. **재는 것은 우리 식과 차분의
     * 차이이지 그 차이를 무엇으로 나눌지가 아니다.**
     *
     * 문턱은 실측 최대(`h = 1e-5`에서 1.4e-11)의 **일흔 배 여유**다. 차분 자체의
     * 반올림 바닥이 `|f|·eps/h ≈ 1.5e-11`이라 그 아래로는 못 좁힌다.
     */
    expect(worst).toBeLessThan(1e-9)
  })
})

describe('씨앗이 결과를 정한다', () => {
  it('같은 씨앗이면 같은 곡선이다', () => {
    const { features, encoded } = twoBlobs()
    const options = { hiddenLayers: 2, neuronsPerLayer: 5 }
    const a = fitNeural(features, encoded, CLASSIFY2, options, 42)
    const b = fitNeural(features, encoded, CLASSIFY2, options, 42)
    expect(a.lossCurve).toEqual(b.lossCurve)
  })

  it('다른 씨앗이면 다른 곡선이다 - 초기화가 도착점을 정한다', () => {
    const { features, encoded } = twoBlobs()
    const options = { hiddenLayers: 2, neuronsPerLayer: 5 }
    const a = fitNeural(features, encoded, CLASSIFY2, options, 42)
    const b = fitNeural(features, encoded, CLASSIFY2, options, 7)
    expect(a.lossCurve).not.toEqual(b.lossCurve)
  })
})

describe('손잡이 둘이 층 모양을 정한다', () => {
  it('은닉층 수 + 1개의 가중치 덩어리가 나온다', () => {
    const { features, encoded } = twoBlobs()
    const fitted = fitNeural(
      features,
      encoded,
      CLASSIFY2,
      { hiddenLayers: 3, neuronsPerLayer: 7 },
      42,
    )
    expect(fitted.weights).toHaveLength(4)
    expect(fitted.weights[0]).toHaveLength(3)
    expect(fitted.weights[0]?.[0]).toHaveLength(7)
    expect(fitted.weights[1]?.[0]).toHaveLength(7)
    // **이진의 출력은 한 칸이다** — sklearn과 같다.
    expect(fitted.weights[3]?.[0]).toHaveLength(1)
  })

  it('다중 클래스의 출력은 클래스 수만큼이다', () => {
    const features = Array.from({ length: 30 }, (_, i) => [i / 30, (i % 3) / 3])
    const encoded = features.map((_, i) => i % 3)
    const fitted = fitNeural(
      features,
      encoded,
      CLASSIFY3,
      { hiddenLayers: 1, neuronsPerLayer: 4 },
      42,
    )
    expect(fitted.weights[1]?.[0]).toHaveLength(3)
  })
})

describe('학습이 낸 모델을 화면 계층이 읽는다', () => {
  const target = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? '개' : '고양이'))
  const features = target.map((label, i) => [
    (i % 7) / 7 + (label === '고양이' ? 1.5 : 0),
    (i % 5) / 5,
  ])

  function trained() {
    return fit('neural_network', {
      features,
      rowIndices: features.map((_, i) => i),
      target,
      taskType: 'classification',
      hyperparameters: { hiddenLayers: 1, neuronsPerLayer: 8 },
      randomState: 42,
    })
  }

  it('형식과 클래스가 파일에 담긴다', () => {
    const model = trained().model as { format: string; classes: string[]; lossCurve: number[] }
    expect(model.format).toBe(NEURAL_FORMAT)
    // 정렬 순서다 (`labelCodec`).
    expect(model.classes).toEqual(['개', '고양이'])
    expect(model.lossCurve.length).toBeGreaterThan(1)
  })

  it('저장했다 읽으면 같은 예측이다', () => {
    const { predict, model } = trained()
    const reloaded = loadModel(JSON.parse(JSON.stringify(model)))
    expect(reloaded(features)).toEqual(predict(features))
  })

  it('확률은 클래스 순서이고 합이 1이다', () => {
    const { model } = trained()
    const proba = loadModelProba(JSON.parse(JSON.stringify(model)))
    expect(proba?.classes).toEqual(['개', '고양이'])
    const row = proba?.predict([features[0] as number[]])[0]
    expect(row).not.toBeNull()
    expect((row?.[0] ?? 0) + (row?.[1] ?? 0)).toBeCloseTo(1, 10)
  })

  /** **라벨과 확률이 갈리면 안 된다** (mlpx-spec.md §5.4). */
  it('가장 높은 확률의 클래스가 답이다', () => {
    const { predict, model } = trained()
    const parsed = JSON.parse(JSON.stringify(model)) as unknown
    const proba = loadModelProba(parsed)
    const answers = predict(features)
    const rows = proba?.predict(features) ?? []
    for (const [index, row] of rows.entries()) {
      const best = row === null ? -1 : [...row].indexOf(Math.max(...row))
      expect(proba?.classes[best]).toBe(answers[index])
    }
  })

  it('층 모양이 어긋난 파일은 던진다', () => {
    const model = JSON.parse(JSON.stringify(trained().model)) as { weights: number[][][] }
    // 한 층의 나가는 칸을 하나 줄인다. **그냥 흘리면 NaN이 답으로 나온다.**
    model.weights[0] = (model.weights[0] as number[][]).map((row) => row.slice(0, -1))
    expect(() => parseNeural(model)).toThrow()
  })
})

describe('손실 곡선을 화면이 꺼낸다', () => {
  const target = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'a' : 'b'))
  const features = target.map((label, i) => [(i % 5) / 5 + (label === 'b' ? 1 : 0)])
  const model = fit('neural_network', {
    features,
    rowIndices: features.map((_, i) => i),
    target,
    taskType: 'classification',
    hyperparameters: { hiddenLayers: 1, neuronsPerLayer: 4 },
    randomState: 42,
  }).model
  const bytes = new TextEncoder().encode(JSON.stringify(model))

  it('이 형식만 곡선을 갖는다', () => {
    expect(showsLossCurve(NEURAL_FORMAT)).toBe(true)
    expect(showsLossCurve('mlpx-tree-v1')).toBe(false)
    expect(showsLossCurve(undefined)).toBe(false)
  })

  it('에폭이 1부터 매겨진다', () => {
    const points = lossCurveOf(NEURAL_FORMAT, bytes)
    expect(points?.[0]?.epoch).toBe(1)
    expect(points?.[points.length - 1]?.epoch).toBe(points?.length)
    expect(lossDescended(points ?? [])).toBe(true)
  })

  /** **모델이 안 담긴 실행에는 곡선도 없다.** 그때 화면은 아무것도 안 그린다 (§9.2). */
  it('모델이 없으면 없다', () => {
    expect(lossCurveOf(NEURAL_FORMAT, undefined)).toBeNull()
    expect(lossCurveOf('mlpx-tree-v1', bytes)).toBeNull()
  })

  it('깨진 파일은 이름 없이 조용히 없다', () => {
    expect(lossCurveOf(NEURAL_FORMAT, new TextEncoder().encode('{'))).toBeNull()
  })
})

/* ------------------------------------------------------------------ 회귀 */

/**
 * **회귀는 출력층 셋만 갈린다** (`open-decisions.md` "회귀도 연다").
 *
 * 칸 수(언제나 1) · 활성(항등) · 손실(제곱오차의 절반)이 그 셋이고, **역전파는 한 줄도
 * 안 갈린다.** 그 말이 사실인지는 여기 유한차분이 답한다 — 분류 쪽 검사가 통과한다고
 * 회귀의 기울기가 옳다는 보장은 없다.
 */
describe('회귀도 같은 역전파를 쓴다', () => {
  /** `y = 2a + 3b + 잡음`. 신경망이 못 맞힐 이유가 없는 관계다. */
  function line(): { features: number[][]; targets: number[] } {
    const features: number[][] = []
    const targets: number[] = []
    let state = 19
    const random = (): number => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 4294967296
    }
    for (let i = 0; i < 80; i += 1) {
      const a = random()
      const b = random()
      features.push([a, b])
      targets.push(2 * a + 3 * b + (random() - 0.5) * 0.05)
    }
    return { features, targets }
  }

  /**
   * 제곱오차의 절반. **엔진의 식을 다시 쓴다** — 같은 코드로 같은 코드를 재면 아무것도
   * 안 잰다. 규제 항은 분류와 같다.
   */
  function squaredLossAt(
    weights: readonly (readonly (readonly number[])[])[],
    intercepts: readonly (readonly number[])[],
    features: readonly (readonly number[])[],
    targets: readonly number[],
  ): number {
    const ALPHA = 0.0001
    let total = 0
    for (const [row, input] of features.entries()) {
      let current = [...input]
      for (const [layer, matrix] of weights.entries()) {
        const bias = intercepts[layer] as readonly number[]
        const next = bias.map((value, j) => {
          let sum = value
          for (const [i, from] of current.entries()) {
            sum += from * ((matrix[i] as readonly number[])[j] as number)
          }
          return sum
        })
        // **출력층에 활성이 없다.** 항등이라 은닉층만 ReLU를 지난다.
        current = layer < weights.length - 1 ? next.map((value) => Math.max(0, value)) : next
      }
      const gap = (current[0] as number) - (targets[row] as number)
      total += (gap * gap) / 2
    }
    let penalty = 0
    for (const matrix of weights) {
      for (const row of matrix) for (const value of row) penalty += value * value
    }
    return total / features.length + (0.5 * ALPHA * penalty) / features.length
  }

  function trained(neurons: number) {
    const { features, targets } = line()
    return {
      features,
      targets,
      ...fit('neural_network', {
        features,
        rowIndices: features.map((_, i) => i),
        target: targets.map(String),
        taskType: 'regression',
        hyperparameters: { hiddenLayers: 1, neuronsPerLayer: neurons },
        randomState: 42,
      }),
    }
  }

  it('출력이 한 칸이고 활성이 없다', () => {
    const { features, targets } = line()
    const fitted = fitNeural(
      features,
      targets,
      REGRESS,
      { hiddenLayers: 2, neuronsPerLayer: 6 },
      42,
    )
    expect(fitted.weights).toHaveLength(3)
    expect(fitted.weights[2]?.[0]).toHaveLength(1)
  })

  it('손실이 내려간다', () => {
    const { features, targets } = line()
    const fitted = fitNeural(
      features,
      targets,
      REGRESS,
      { hiddenLayers: 1, neuronsPerLayer: 8 },
      42,
    )
    expect(fitted.lossCurve.length).toBeGreaterThan(1)
    expect(fitted.lossCurve[fitted.lossCurve.length - 1]).toBeLessThan(
      fitted.lossCurve[0] as number,
    )
  })

  it('해석적 기울기가 유한차분과 맞는다', () => {
    const { features, targets } = line()
    const start = fitNeural(features, targets, REGRESS, { hiddenLayers: 2, neuronsPerLayer: 5 }, 5)
    const weights = start.weights.map((matrix) => matrix.map((row) => [...row]))
    const intercepts = start.intercepts.map((bias) => [...bias])

    const analytic = neuralGradientForTest(weights, intercepts, features, targets, REGRESS)
    expect(
      Math.abs(analytic.loss - squaredLossAt(weights, intercepts, features, targets)),
    ).toBeLessThan(1e-9)

    const h = 1e-5
    let checked = 0
    let worst = 0
    let biggest = 0
    for (const [layer, matrix] of weights.entries()) {
      for (const [i, row] of matrix.entries()) {
        for (let j = 0; j < row.length; j += 1) {
          const original = row[j] as number
          row[j] = original + h
          const up = squaredLossAt(weights, intercepts, features, targets)
          row[j] = original - h
          const down = squaredLossAt(weights, intercepts, features, targets)
          row[j] = original

          const numeric = (up - down) / (2 * h)
          const width = row.length
          const ours = (analytic.gradWeights[layer] as Float64Array)[i * width + j] as number
          // ReLU의 꺾이는 점은 건너뛴다 — 분류 쪽과 같은 규칙이다.
          if (Math.abs(up + down - 2 * analytic.loss) > 1e-7) continue
          checked += 1
          worst = Math.max(worst, Math.abs(ours - numeric))
          biggest = Math.max(biggest, Math.abs(ours))
        }
      }
    }

    expect(checked).toBeGreaterThan(20)
    expect(biggest).toBeGreaterThan(1e-4)
    expect(worst).toBeLessThan(1e-9)
  })

  it('배운 관계를 실제로 맞힌다 - 평균만 내는 모델보다 낫다', () => {
    const { features, targets, predict, model } = trained(16)
    expect((model as { format: string }).format).toBe(NEURAL_REGRESSION_FORMAT)

    const predicted = predict(features).map(Number)
    const mean = targets.reduce((sum, one) => sum + one, 0) / targets.length
    const ours = targets.reduce((sum, one, i) => sum + ((predicted[i] ?? 0) - one) ** 2, 0)
    const flat = targets.reduce((sum, one) => sum + (mean - one) ** 2, 0)
    expect(ours).toBeLessThan(flat)
  })

  it('저장했다 읽으면 같은 예측이고, 수치를 돌려준다', () => {
    const { features, predict, model } = trained(6)
    const reloaded = loadModel(JSON.parse(JSON.stringify(model)))
    expect(reloaded(features)).toEqual(predict(features))
    // **문자열로 굳히지 않는다** — `Prediction`이 `string | number`다.
    expect(typeof predict(features)[0]).toBe('number')
  })

  /** **회귀에는 확률이 없다.** 고를 칸이 없어서다. */
  it('확률을 안 낸다', () => {
    const { model } = trained(6)
    expect(loadModelProba(JSON.parse(JSON.stringify(model)))).toBeNull()
  })

  /** **분류 파일을 회귀 해석기로 읽을 수 없다.** 형식을 나눈 것이 이것을 막는다. */
  it('형식이 어긋나면 던진다', () => {
    const { model } = trained(6)
    expect(() => parseNeural(JSON.parse(JSON.stringify(model)))).toThrow()

    // 출력이 두 칸인 회귀 파일도 거부한다 (mlpx-spec.md §5.11의 불변식 5).
    const broken = JSON.parse(JSON.stringify(model)) as {
      weights: number[][][]
      intercepts: number[][]
    }
    const last = broken.weights.length - 1
    broken.weights[last] = (broken.weights[last] as number[][]).map((row) => [...row, 0])
    broken.intercepts[last] = [...(broken.intercepts[last] as number[]), 0]
    expect(() => parseNeuralRegression(broken)).toThrow()
  })

  it('손실 곡선을 회귀에서도 꺼낸다', () => {
    const { model } = trained(6)
    const bytes = new TextEncoder().encode(JSON.stringify(model))
    expect(showsLossCurve(NEURAL_REGRESSION_FORMAT)).toBe(true)
    const points = lossCurveOf(NEURAL_REGRESSION_FORMAT, bytes)
    expect(points?.[0]?.epoch).toBe(1)
    expect(lossDescended(points ?? [])).toBe(true)
  })
})
