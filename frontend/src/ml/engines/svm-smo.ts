/**
 * 선형 SVM 솔버 — **`ml-svm@2.1.2`(MIT, mljs)를 벤더링한 것이다.**
 *
 * 원본: https://github.com/mljs/svm · `src/svm.js`의 단순화된 SMO.
 * Copyright (c) 2014 ml.js contributors. MIT License.
 *
 * **직접 짜지 않기로 한 판단은 그대로다** (open-decisions.md "순수 JS 서포트 벡터 머신을
 * 넣는다"). 이 종류의 코드는 틀렸을 때 예외를 던지지 않고 그럴듯한 숫자를 내는데,
 * 브라우저 안에는 대조할 상대가 없다. 그래서 **갱신 규칙과 그 순서를 원본 그대로 옮겼다** —
 * `Ei`·`L`·`H`·`eta`·`b1`·`b2`의 식과 건너뛰는 조건까지 같다. 읽을 때 원본과 나란히
 * 놓고 볼 수 있어야 한다.
 *
 * **바꾼 것은 넷이다.**
 *
 * 1. **반복을 다 써도 던지지 않는다.** 원본은 `throw new Error('max iterations reached')`인데,
 *    실측에서 겹치는 데이터는 **500행에서도** 거기 도달했다. 그때 나오는 계수는 쓸모없는
 *    값이 아니라 **덜 다듬어진 값**이고, sklearn도 같은 자리에서 경고만 내고 모델을 준다.
 *    그래서 `converged`를 함께 돌려주고, 화면까지 그 사실을 들고 간다
 *    (`run.warning`, mlpx-spec.md 5.9). **조용히 넘기는 것이 아니다.**
 * 2. **난수를 주입받는다.** 원본 기본값이 `Math.random`이라 같은 설정으로 두 번 돌려도
 *    답이 달랐다. `randomState`는 항상 저장하고 항상 쓴다 (CLAUDE.md 2).
 * 3. **선형 커널만 남겼다.** 커널 추상(`ml-kernel`)이 빠지면서 의존성 하나와 분기가 사라진다.
 * 4. **`H`의 수식을 고쳤다 (2026-08-10, V2 감사 1단계-A).** 라벨이 다른 쌍의 위쪽 경계가
 *    원본에는 `min(C, C + aj + ai)`로 적혀 있는데 **표준 SMO(Platt 1998)는
 *    `min(C, C + aj − ai)`다.** 부호 하나가 틀리면 α가 제약(Σαy 보존·상자 [0,C])을
 *    벗어나 자랄 수 있고, 실측에서 잡음 있는 600행부터 가중치가 Infinity로 폭주해
 *    **에러 없이 전부 한 클래스로 답하는 모델**이 나왔다(정확도 = 동전 던지기).
 *    원본 저장소(mljs/svm)의 `src/svm.js`에도 같은 식이 있다 — 벤더링 전사 오류가
 *    아니라 원본의 결함이다.
 *
 * 표현만 바꾼 것이 하나 더 있다 — 커널 행렬을 `Float64Array`의 배열로 든다. **값과 계산
 * 순서는 같고** 3000행에서 72MB로 고정된다(중첩 배열이면 그 두 배가 넘는다).
 *
 * **정규화는 원본과 같이 min-max다.** 다만 선형이라 그 변환을 가중치와 절편에 접어
 * 돌려준다 (mlpx-spec.md 5.8) - 담았다가 예측에서 다시 적용하는 것을 잊는 경로를 없앤다.
 */

/** 솔버의 손잡이. 기본값은 원본과 같다. */
export interface SmoOptions {
  /** 정규화 세기. 학생이 화면에서 고르는 유일한 값이다. */
  readonly C: number
  readonly tol: number
  readonly maxPasses: number
  readonly maxIterations: number
  /** [0,1)의 난수. **시드에서 나와야 한다** - 여기가 재현 가능성의 유일한 구멍이다. */
  readonly random: () => number
}

export const SMO_DEFAULTS = {
  C: 1,
  tol: 1e-4,
  maxPasses: 10,
  maxIterations: 10000,
} as const

export interface LinearSvm {
  /** **원래 좌표계의** 가중치. 정규화가 접혀 있다. */
  readonly weights: number[]
  readonly intercept: number
  /** 반복 예산 안에 멈췄는가. false면 덜 다듬어진 계수다 (mlpx-spec.md 5.9). */
  readonly converged: boolean
  readonly iterations: number
}

/**
 * 결정적 난수. **`randomState`에서 나온다.**
 *
 * 선형 합동 생성기다 - 통계적 품질이 필요한 자리가 아니라 짝을 고르는 자리이고,
 * 필요한 성질은 하나뿐이다: **같은 시드면 같은 순서.**
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** 열마다 최솟값과 폭. **폭이 0이면 1이다** - 0으로 나누면 행렬 전체가 NaN이 된다. */
function minMaxOf(
  features: readonly (readonly number[])[],
  width: number,
): { min: number[]; range: number[] } {
  const min = new Array<number>(width).fill(Number.POSITIVE_INFINITY)
  const max = new Array<number>(width).fill(Number.NEGATIVE_INFINITY)
  for (const row of features) {
    for (let j = 0; j < width; j += 1) {
      const value = row[j] ?? 0
      if (value < (min[j] as number)) min[j] = value
      if (value > (max[j] as number)) max[j] = value
    }
  }
  return {
    min,
    range: min.map((low, j) => (max[j] as number) - low || 1),
  }
}

/**
 * 이진 선형 SVM 하나를 학습한다. **라벨은 +1/-1이다.**
 *
 * 부르는 쪽이 다중 클래스를 one-vs-one으로 감싼다 (ml/engines/mljs.ts).
 */
export function trainLinearSvm(
  features: readonly (readonly number[])[],
  labels: readonly number[],
  options: SmoOptions,
): LinearSvm {
  const m = features.length
  const width = features[0]?.length ?? 0

  // 정규화한 학습 행렬. 원본은 옵션이지만 여기서는 언제나 한다 - 끄면 단위가 큰 열
  // (원, 밀리미터)이 하나만 있어도 SMO가 사실상 수렴하지 못한다.
  const { min, range } = minMaxOf(features, width)
  const X = features.map((row) =>
    Float64Array.from(
      { length: width },
      (_, j) => ((row[j] ?? 0) - (min[j] as number)) / (range[j] as number),
    ),
  )

  // 커널 행렬. 선형이므로 내적이다.
  const kernel = X.map((rowI) => {
    const line = new Float64Array(m)
    for (let j = 0; j < m; j += 1) {
      const rowJ = X[j] as Float64Array
      let dot = 0
      for (let k = 0; k < width; k += 1) dot += (rowI[k] as number) * (rowJ[k] as number)
      line[j] = dot
    }
    return line
  })

  const alpha = new Float64Array(m)
  let b = 0

  /** 지금 계수로 본 i번째 행의 결정함수 값. 원본의 `_marginOnePrecomputed`다. */
  const marginAt = (index: number): number => {
    const line = kernel[index] as Float64Array
    let sum = b
    for (let i = 0; i < m; i += 1) sum += (alpha[i] as number) * (labels[i] ?? 0) * (line[i] ?? 0)
    return sum
  }

  let passes = 0
  let iterations = 0
  while (passes < options.maxPasses && iterations < options.maxIterations) {
    let changed = 0
    for (let i = 0; i < m; i += 1) {
      const yi = labels[i] ?? 0
      const Ei = marginAt(i) - yi
      const violates =
        (yi * Ei < -options.tol && (alpha[i] as number) < options.C) ||
        (yi * Ei > options.tol && (alpha[i] as number) > 0)
      if (!violates) continue

      // 짝은 무작위로 고른다. **여기가 시드를 쓰는 유일한 자리다.**
      let j = i
      while (j === i) j = Math.floor(options.random() * m)
      const yj = labels[j] ?? 0
      const Ej = marginAt(j) - yj

      const ai = alpha[i] as number
      const aj = alpha[j] as number
      const low = yi === yj ? Math.max(0, ai + aj - options.C) : Math.max(0, aj - ai)
      // 라벨이 다른 쪽의 위 경계는 C + aj − ai다 (Platt 1998). 원본의 `+ ai`는 결함이다 —
      // 머리말 "바꾼 것 4"를 보라.
      const high =
        yi === yj ? Math.min(options.C, ai + aj) : Math.min(options.C, options.C + aj - ai)
      if (Math.abs(low - high) < 1e-4) continue

      const kii = (kernel[i] as Float64Array)[i] as number
      const kjj = (kernel[j] as Float64Array)[j] as number
      const kij = (kernel[i] as Float64Array)[j] as number
      const eta = 2 * kij - kii - kjj
      if (eta >= 0) continue

      let newAj = aj - (yj * (Ei - Ej)) / eta
      if (newAj > high) newAj = high
      else if (newAj < low) newAj = low
      if (Math.abs(aj - newAj) < 10e-4) continue

      alpha[j] = newAj
      alpha[i] = ai + yi * yj * (aj - newAj)

      const b1 = b - Ei - yi * ((alpha[i] as number) - ai) * kii - yj * (newAj - aj) * kij
      const b2 = b - Ej - yi * ((alpha[i] as number) - ai) * kij - yj * (newAj - aj) * kjj
      b = (b1 + b2) / 2
      if ((alpha[i] as number) < options.C && (alpha[i] as number) > 0) b = b1
      if (newAj < options.C && newAj > 0) b = b2
      changed += 1
    }

    iterations += 1
    if (changed === 0) passes += 1
    else passes = 0
  }

  // 정규화된 좌표계의 가중치.
  const scaled = new Array<number>(width).fill(0)
  for (let r = 0; r < width; r += 1) {
    let sum = 0
    for (let i = 0; i < m; i += 1) {
      sum += (labels[i] ?? 0) * (alpha[i] as number) * ((X[i] as Float64Array)[r] as number)
    }
    scaled[r] = sum
  }

  // **정규화를 접는다** (mlpx-spec.md 5.8). w'ᵢ = wᵢ/폭ᵢ, b' = b - Σ wᵢ·최솟값ᵢ/폭ᵢ.
  const weights = scaled.map((value, j) => value / (range[j] as number))
  const intercept = weights.reduce((sum, value, j) => sum - value * (min[j] as number), b)

  return {
    weights,
    intercept,
    // 원본이 던지던 조건과 같다. 여기서는 사실로 남긴다.
    converged: iterations < options.maxIterations,
    iterations,
  }
}
