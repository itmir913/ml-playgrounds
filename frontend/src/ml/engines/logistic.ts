/**
 * 로지스틱 회귀 솔버 — **sklearn `LogisticRegression` 기본값의 목적함수를 그대로 푼다**
 * (open-decisions.md "로지스틱 회귀 솔버를 sklearn과 같은 구조로 바꾼다").
 *
 *   최소화:  0.5·‖W‖²  +  C · Σᵢ 로그손실ᵢ        (절편은 규제하지 않는다 — sklearn과 같다)
 *
 * L2 규제가 최적점을 유한하고 **유일하게** 만든다. 그래서 이 솔버의 검증은 경로가 아니라
 * **도착점**의 문제다 — 올바르게 수렴하면 계수 자체가 sklearn과 같아야 하고, 그 대조는
 * CI의 sklearn 픽스처(tests/sklearn-parity.spec.ts)가 상시로 지킨다.
 *
 * **다중 클래스는 multinomial(softmax)** — sklearn 1.9의 lbfgs 기본값과 같다.
 * **이진은 binomial(시그모이드)로 풀고** 부르는 쪽이 ±절반 두 줄로 나눠 담는다
 * (mlpx-spec.md 5.4.1) — 이진을 softmax로 직접 풀면 규제가 사실상 절반이 되어
 * sklearn과 계수가 갈린다.
 *
 * **최적화는 L-BFGS(메모리 10) + Armijo 역추적이다.** 원본 sklearn은 scipy의
 * L-BFGS-B를 쓰지만 상자 제약이 없으므로 같은 자리다. 수렴 판정도 같다 —
 * 기울기의 최대 성분이 `tol` 아래로 내려가면 수렴, `maxIter`(반복 수)에 닿으면
 * 부르는 쪽이 LOGISTIC_NOT_CONVERGED를 붙인다.
 *
 * **의존성도 벤더링도 아니고 우리가 짰다.** mljs 생태계에는 규제 있는 로지스틱이 없고
 * (떼어낸 `ml-logistic-regression`이 그 생태계의 답이었다), 범용 최적화 패키지는 방치돼
 * 있으며, 벤더링해도 검증 비용이 같다는 것을 SMO의 H 결함이 보여줬다(svm-smo.ts
 * 머리말 4). 기울기 식은 tests/mljs.spec.ts가 유한차분으로 재확인한다.
 */

/** 솔버의 손잡이. 기본값은 mljs-params.ts가 갖는다 — 여기는 받은 값을 쓸 뿐이다. */
export interface LogisticOptions {
  /** 규제 세기의 역수. 클수록 데이터를 더 믿는다 (sklearn `C`). */
  readonly C: number
  /** 수렴 판정 문턱 — 기울기 최대 성분이 이 아래면 멈춘다 (sklearn `tol`). */
  readonly tol: number
  /** 반복 상한 (sklearn `max_iter`). */
  readonly maxIter: number
}

export interface FittedLogistic {
  /** 클래스마다 한 줄, 원래 좌표계. 이진이면 ±절반 두 줄이다 (mlpx-spec.md 5.4.1). */
  readonly weights: number[][]
  readonly intercepts: number[]
  /** maxIter 안에 기울기가 tol 아래로 내려갔는가. */
  readonly converged: boolean
  readonly iterations: number
}

/** log(1 + e^z). z가 크면 e^z가 넘치므로 갈라 계산한다. */
function log1pExp(z: number): number {
  return z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z))
}

/** 목적함수 하나 — 값과 기울기를 같은 순회에서 낸다. */
interface Objective {
  readonly size: number
  evaluate(theta: Float64Array, gradient: Float64Array): number
}

/**
 * 이진 binomial 목적함수. θ = [w(d), b]. 양성 클래스는 **정렬 순서의 두 번째**다 —
 * sklearn이 `classes_[1]`을 양성으로 두는 것과 같다.
 */
function binomialObjective(
  features: readonly (readonly number[])[],
  encoded: readonly number[],
  width: number,
  C: number,
): Objective {
  return {
    size: width + 1,
    evaluate(theta, gradient) {
      // 규제 항. 절편(마지막 자리)은 규제하지 않는다.
      let value = 0
      for (let j = 0; j < width; j += 1) {
        const w = theta[j] as number
        value += 0.5 * w * w
        gradient[j] = w
      }
      gradient[width] = 0

      for (let i = 0; i < features.length; i += 1) {
        const row = features[i] as readonly number[]
        let score = theta[width] as number
        for (let j = 0; j < width; j += 1) score += (theta[j] as number) * (row[j] ?? 0)

        const y = encoded[i] === 1 ? 1 : 0
        value += C * (log1pExp(score) - y * score)
        const slope = C * (1 / (1 + Math.exp(-score)) - y)
        for (let j = 0; j < width; j += 1) {
          gradient[j] = (gradient[j] as number) + slope * (row[j] ?? 0)
        }
        gradient[width] = (gradient[width] as number) + slope
      }
      return value
    },
  }
}

/**
 * 다중 클래스 multinomial(softmax) 목적함수. θ = [W₀(d), b₀, W₁(d), b₁, …] —
 * 클래스마다 (가중치, 절편) 한 덩어리다.
 */
function multinomialObjective(
  features: readonly (readonly number[])[],
  encoded: readonly number[],
  width: number,
  classCount: number,
  C: number,
): Objective {
  const stride = width + 1
  const scores = new Float64Array(classCount)
  return {
    size: stride * classCount,
    evaluate(theta, gradient) {
      let value = 0
      for (let k = 0; k < classCount; k += 1) {
        for (let j = 0; j < width; j += 1) {
          const w = theta[k * stride + j] as number
          value += 0.5 * w * w
          gradient[k * stride + j] = w
        }
        gradient[k * stride + width] = 0
      }

      for (let i = 0; i < features.length; i += 1) {
        const row = features[i] as readonly number[]
        let top = Number.NEGATIVE_INFINITY
        for (let k = 0; k < classCount; k += 1) {
          let score = theta[k * stride + width] as number
          for (let j = 0; j < width; j += 1) {
            score += (theta[k * stride + j] as number) * (row[j] ?? 0)
          }
          scores[k] = score
          if (score > top) top = score
        }

        // 로그합지수 — 최댓값을 빼서 지수 넘침을 막는다.
        let sum = 0
        for (let k = 0; k < classCount; k += 1) sum += Math.exp((scores[k] as number) - top)
        const logSumExp = top + Math.log(sum)

        const target = encoded[i] as number
        value += C * (logSumExp - (scores[target] as number))

        for (let k = 0; k < classCount; k += 1) {
          const probability = Math.exp((scores[k] as number) - logSumExp)
          const slope = C * (probability - (k === target ? 1 : 0))
          for (let j = 0; j < width; j += 1) {
            gradient[k * stride + j] = (gradient[k * stride + j] as number) + slope * (row[j] ?? 0)
          }
          gradient[k * stride + width] = (gradient[k * stride + width] as number) + slope
        }
      }
      return value
    },
  }
}

function maxAbs(values: Float64Array): number {
  let worst = 0
  for (let i = 0; i < values.length; i += 1) {
    const magnitude = Math.abs(values[i] as number)
    if (magnitude > worst) worst = magnitude
  }
  return worst
}

/** L-BFGS 결과. θ는 제자리에서 갱신된다. */
interface Optimized {
  converged: boolean
  iterations: number
}

/** L-BFGS의 기억 깊이. scipy L-BFGS-B의 기본값(m=10)과 같다. */
const MEMORY = 10
/** Armijo 조건의 기울기 계수. Nocedal & Wright의 관행값(1e-4)이다. */
const ARMIJO = 1e-4

/**
 * L-BFGS + Armijo 역추적. 두-루프 재귀(Nocedal & Wright, Numerical Optimization 7.4)다.
 *
 * 목적함수가 강볼록(L2 규제)이라 곡률 조건(sᵀy > 0)이 항상 성립하고, 그래서
 * 강한 Wolfe 선탐색 없이 역추적만으로 안정적으로 수렴한다.
 */
function minimize(objective: Objective, theta: Float64Array, options: LogisticOptions): Optimized {
  const { size } = objective
  const gradient = new Float64Array(size)
  let value = objective.evaluate(theta, gradient)
  if (maxAbs(gradient) <= options.tol) return { converged: true, iterations: 0 }

  // 최근 MEMORY개의 (걸음 s, 기울기 변화 y)와 1/(sᵀy).
  const steps: Float64Array[] = []
  const changes: Float64Array[] = []
  const rhos: number[] = []

  const direction = new Float64Array(size)
  const trial = new Float64Array(size)
  const trialGradient = new Float64Array(size)
  const alphas = new Float64Array(MEMORY)

  for (let iteration = 1; iteration <= options.maxIter; iteration += 1) {
    // 두-루프 재귀: direction = -H·gradient.
    direction.set(gradient)
    for (let m = steps.length - 1; m >= 0; m -= 1) {
      const s = steps[m] as Float64Array
      const y = changes[m] as Float64Array
      let dot = 0
      for (let j = 0; j < size; j += 1) dot += (s[j] as number) * (direction[j] as number)
      const alpha = (rhos[m] as number) * dot
      alphas[m] = alpha
      for (let j = 0; j < size; j += 1) {
        direction[j] = (direction[j] as number) - alpha * (y[j] as number)
      }
    }
    if (steps.length > 0) {
      // 초기 헤시안 근사 γ = sᵀy / yᵀy (마지막 쌍).
      const s = steps[steps.length - 1] as Float64Array
      const y = changes[changes.length - 1] as Float64Array
      let sy = 0
      let yy = 0
      for (let j = 0; j < size; j += 1) {
        sy += (s[j] as number) * (y[j] as number)
        yy += (y[j] as number) * (y[j] as number)
      }
      const gamma = yy > 0 ? sy / yy : 1
      for (let j = 0; j < size; j += 1) direction[j] = (direction[j] as number) * gamma
    }
    for (let m = 0; m < steps.length; m += 1) {
      const s = steps[m] as Float64Array
      const y = changes[m] as Float64Array
      let dot = 0
      for (let j = 0; j < size; j += 1) dot += (y[j] as number) * (direction[j] as number)
      const beta = (rhos[m] as number) * dot
      const correction = (alphas[m] as number) - beta
      for (let j = 0; j < size; j += 1) {
        direction[j] = (direction[j] as number) + correction * (s[j] as number)
      }
    }
    for (let j = 0; j < size; j += 1) direction[j] = -(direction[j] as number)

    // 내리막이 아니면(수치 문제) 기억을 버리고 최급강하로 돌아간다.
    let slope = 0
    for (let j = 0; j < size; j += 1) slope += (gradient[j] as number) * (direction[j] as number)
    if (!(slope < 0)) {
      steps.length = 0
      changes.length = 0
      rhos.length = 0
      slope = 0
      for (let j = 0; j < size; j += 1) {
        direction[j] = -(gradient[j] as number)
        slope -= (gradient[j] as number) ** 2
      }
    }

    // Armijo 역추적: f(θ + t·d) ≤ f + ARMIJO·t·(gᵀd)가 될 때까지 반씩 줄인다.
    let stepSize = 1
    let trialValue = Number.POSITIVE_INFINITY
    for (let attempt = 0; attempt < 60; attempt += 1) {
      for (let j = 0; j < size; j += 1) {
        trial[j] = (theta[j] as number) + stepSize * (direction[j] as number)
      }
      trialValue = objective.evaluate(trial, trialGradient)
      if (trialValue <= value + ARMIJO * stepSize * slope) break
      stepSize /= 2
    }
    if (!(trialValue <= value + ARMIJO * stepSize * slope)) {
      // 선탐색 실패 — 더 못 내려간다. 지금 기울기로 수렴 여부를 판정한다.
      return { converged: maxAbs(gradient) <= options.tol, iterations: iteration - 1 }
    }

    // (s, y) 기억을 갱신한다.
    const s = new Float64Array(size)
    const y = new Float64Array(size)
    let sy = 0
    for (let j = 0; j < size; j += 1) {
      s[j] = (trial[j] as number) - (theta[j] as number)
      y[j] = (trialGradient[j] as number) - (gradient[j] as number)
      sy += (s[j] as number) * (y[j] as number)
    }
    if (sy > 1e-12) {
      steps.push(s)
      changes.push(y)
      rhos.push(1 / sy)
      if (steps.length > MEMORY) {
        steps.shift()
        changes.shift()
        rhos.shift()
      }
    }

    theta.set(trial)
    gradient.set(trialGradient)
    value = trialValue

    if (maxAbs(gradient) <= options.tol) return { converged: true, iterations: iteration }
  }

  return { converged: false, iterations: options.maxIter }
}

/**
 * 로지스틱 회귀를 학습한다. `encoded`는 정렬 순서의 클래스 번호(0..classCount-1)다.
 *
 * 반환 가중치는 언제나 클래스 수만큼의 줄이다 — 이진은 (w, b)를 ±절반으로 나눠
 * `softmax([−s/2, +s/2]) = sigmoid(s)`가 성립하게 담는다 (mlpx-spec.md 5.4.1).
 */
export function fitLogistic(
  features: readonly (readonly number[])[],
  encoded: readonly number[],
  classCount: number,
  options: LogisticOptions,
): FittedLogistic {
  const width = features[0]?.length ?? 0

  // 클래스가 하나뿐이면 배울 것이 없다 — 모든 점수가 0이어도 argmax는 그 클래스다.
  if (classCount <= 1) {
    return {
      weights: [new Array<number>(width).fill(0)],
      intercepts: [0],
      converged: true,
      iterations: 0,
    }
  }

  if (classCount === 2) {
    const objective = binomialObjective(features, encoded, width, options.C)
    const theta = new Float64Array(objective.size)
    const outcome = minimize(objective, theta, options)
    const half = [...theta.slice(0, width)].map((value) => value / 2)
    const halfIntercept = (theta[width] as number) / 2
    return {
      weights: [half.map((value) => -value), half],
      intercepts: [-halfIntercept, halfIntercept],
      converged: outcome.converged,
      iterations: outcome.iterations,
    }
  }

  const objective = multinomialObjective(features, encoded, width, classCount, options.C)
  const theta = new Float64Array(objective.size)
  const outcome = minimize(objective, theta, options)
  const stride = width + 1
  const weights: number[][] = []
  const intercepts: number[] = []
  for (let k = 0; k < classCount; k += 1) {
    weights.push([...theta.slice(k * stride, k * stride + width)])
    intercepts.push(theta[k * stride + width] as number)
  }
  return { weights, intercepts, converged: outcome.converged, iterations: outcome.iterations }
}

/**
 * 유한차분 검증용 — 목적함수의 값과 기울기를 밖에서 잴 수 있게 연다.
 * 테스트 전용이다 (tests/mljs.spec.ts의 기울기 검증).
 */
export function logisticObjectiveForTest(
  features: readonly (readonly number[])[],
  encoded: readonly number[],
  classCount: number,
  C: number,
): { size: number; evaluate(theta: Float64Array, gradient: Float64Array): number } {
  const width = features[0]?.length ?? 0
  return classCount === 2
    ? binomialObjective(features, encoded, width, C)
    : multinomialObjective(features, encoded, width, classCount, C)
}
