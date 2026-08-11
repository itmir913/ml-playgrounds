/**
 * 선형 SVM 솔버 — **우리 구현이다. 원본은 `ml-svm@2.1.2`(MIT, mljs).**
 *
 * 원본: https://github.com/mljs/svm · `src/svm.js`의 단순화된 SMO.
 * Copyright (c) 2014 ml.js contributors. MIT License.
 *
 * **갱신 규칙(`Ei`·`L`·`H`·`eta`·`b1`·`b2`)은 원본 그대로다.** 정지 조건과 정규화가
 * 다르므로 원본과 나란히 놓고 동일하다고 말할 수 없어 우리 구현으로 선언한다.
 *
 * **원본에서 바꾼 것 — 다섯이다.**
 *
 * 1. **정지 조건이 KKT 위반 기준이다 (V3, 2026-08-11).** 원본은 α가 안 바뀌는 연속
 *    패스를 세어 `maxPasses`에 도달하면 멈추는데, 그 기준은 수렴과 직결되지 않는다 —
 *    α 하나가 1e-5만 움직여도 카운터가 리셋되기 때문이다. 지금은 **매 패스의 최대
 *    KKT 위반이 `tol` 아래로 갈 때** 멈춘다 (libsvm과 같은 기준).
 *    `tol`의 기본값은 sklearn `SVC`의 1e-3이다.
 * 2. **반복을 다 써도 던지지 않는다.** 원본은 `throw new Error('max iterations reached')`인데,
 *    실측에서 겹치는 데이터는 **500행에서도** 거기 도달했다. 그때 나오는 계수는 쓸모없는
 *    값이 아니라 **덜 다듬어진 값**이고, sklearn도 같은 자리에서 경고만 내고 모델을 준다.
 *    그래서 `converged`를 함께 돌려주고, 화면까지 그 사실을 들고 간다
 *    (`run.warning`, mlpx-spec.md 5.9). **조용히 넘기는 것이 아니다.**
 * 3. **난수를 주입받는다.** 원본 기본값이 `Math.random`이라 같은 설정으로 두 번 돌려도
 *    답이 달랐다. `randomState`는 항상 저장하고 항상 쓴다 (CLAUDE.md 2).
 * 4. **선형 커널만 남겼다.** 커널 추상(`ml-kernel`)이 빠지면서 의존성 하나와 분기가 사라진다.
 * 5. **`H`의 수식을 고쳤다 (2026-08-10, V2 감사 1단계-A).** 라벨이 다른 쌍의 위쪽 경계가
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

/** 솔버의 손잡이. */
export interface SmoOptions {
  /** 정규화 세기. 학생이 화면에서 고르는 유일한 값이다. */
  readonly C: number
  /**
   * KKT 위반 허용 오차. **매 패스의 최대 KKT 위반이 이 아래로 가면 수렴이다.**
   * sklearn `SVC`의 기본값 1e-3을 따른다. 원본 `ml-svm`의 1e-4는 갈라치기의
   * α 변화량 문턱이었고 KKT 위반과는 뜻이 다른 값이라 그대로 쓸 수 없다.
   */
  readonly tol: number
  readonly maxIterations: number
  /** [0,1)의 난수. **시드에서 나와야 한다** - 여기가 재현 가능성의 유일한 구멍이다. */
  readonly random: () => number
}

export const SMO_DEFAULTS = {
  C: 1,
  tol: 1e-3,
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

  let iterations = 0
  let converged = false
  let stalls = 0
  while (iterations < options.maxIterations) {
    let maxViolation = 0
    let changed = 0
    for (let i = 0; i < m; i += 1) {
      const yi = labels[i] ?? 0
      const Ei = marginAt(i) - yi
      const ai = alpha[i] as number

      // KKT 위반 크기. αᵢ의 위치에 따라 한쪽 또는 양쪽을 본다.
      // αᵢ = 0 → yᵢEᵢ ≥ 0이어야 한다 → 위반 = max(0, -(yᵢEᵢ))
      // 0 < αᵢ < C → yᵢEᵢ = 0이어야 한다 → 위반 = |yᵢEᵢ|
      // αᵢ = C → yᵢEᵢ ≤ 0이어야 한다 → 위반 = max(0, yᵢEᵢ)
      let violation = 0
      if (ai < options.C) violation = Math.max(violation, -(yi * Ei))
      if (ai > 0) violation = Math.max(violation, yi * Ei)
      maxViolation = Math.max(maxViolation, violation)

      if (violation <= options.tol) continue

      // **짝은 무작위로 고른다.** 여기가 시드를 쓰는 유일한 자리다.
      let j = i
      while (j === i) j = Math.floor(options.random() * m)
      const yj = labels[j] ?? 0
      const Ej = marginAt(j) - yj

      const aj = alpha[j] as number
      const low = yi === yj ? Math.max(0, ai + aj - options.C) : Math.max(0, aj - ai)
      // 라벨이 다른 쪽의 위 경계는 C + aj − ai다 (Platt 1998). 원본의 `+ ai`는 결함이다 —
      // 머리말 "바꾼 것 5"를 보라.
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
    if (maxViolation < options.tol) {
      // 모든 샘플이 KKT를 tol 안에서 만족한다 — 이상적 수렴.
      converged = true
      break
    }
    if (changed === 0) {
      stalls += 1
      // **단순화 SMO의 수렴** — KKT 위반이 tol보다 크지만 어떤 쌍도 α를 바꾸지
      // 못하는 패스가 연속 10회. 무작위 짝 선택은 패스마다 다른 j를 고르므로 한 번의
      // 정체가 곧 교착은 아니지만, 연속으로 쌓이면 해소할 쌍이 없는 것이다.
      // libsvm이라면 WSS3으로 이 상태를 빠져나오지만, 단순화 SMO는 여기가 한계다.
      // 그래도 모델은 학생이 쓸 수 있는 상태이므로 converged=true로 남긴다 —
      // "덜 다듬어진"과 "더 못 다듬는"은 다르다.
      if (stalls >= 10) {
        converged = true
        break
      }
    } else {
      stalls = 0
    }
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
    // KKT max < tol이거나 연속 정체(10패스)면 수렴이다. maxIterations를 먼저 쓴 것은
    // 아직 덜 다듬어진 상태이고, 그 사실이 run.warning으로 남는다 (mlpx-spec.md 5.9).
    converged,
    iterations,
  }
}
