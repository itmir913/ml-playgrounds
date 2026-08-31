/**
 * **학습이 얼마나 걸릴지 누르기 전에 말한다** (open-decisions.md "학습 예상 시간은
 * 실측표에 기기 배수를 곱해 낸다").
 *
 * 학생이 알아야 하는 것은 "몇 초인가"가 아니라 **"지금 눌러도 되는 일인가"**다. 그래서
 * 정밀할 필요가 없고, 대신 **틀릴 때는 길게 틀린다** — 3분이라 해 놓고 1분에 끝나면
 * 학생은 안도하지만, 1분이라 해 놓고 3분을 끌면 화면을 못 믿게 된다.
 *
 * **곱하는 것은 전부 실측에서 온다.** 기준표도, 특성 배수도, 그루 수도, `maxIter`도
 * `limits.ts`가 갖는 실측값이다. 여기서 상수를 만들지 마라.
 */

import {
  BASELINE_COLUMNS,
  MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER,
  MLJS_LOGISTIC_REGRESSION_MAX_ITER_MS,
  MLJS_RANDOM_FOREST_BASELINE_TREES,
  TRAINING_ESTIMATE_FLOOR_MS,
} from '../limits'

import { ALGORITHMS } from './algorithms'
import type { Baseline } from './backend'

type Ladder = readonly (readonly [number, number])[]

/**
 * 표의 두 점 사이를 로그-로그로 잇는다. **비용이 행 수의 거듭제곱으로 붙기 때문이다** —
 * 트리는 대략 제곱이고 나이브 베이즈는 일차다. 직선으로 이으면 그 사이가 다 틀린다.
 *
 * **표 아래로는 외삽하지 않고 첫 점의 값을 쓴다.** 행이 적을수록 실제는 더 빠르니 이쪽
 * 방향의 오차는 "길게 틀린다"에 맞고, 표의 첫 두 점이 뒤집혀 있는 알고리즘(나이브
 * 베이즈의 1,000행 6ms · 5,000행 5ms)에서 아래로 외삽하면 값이 되레 커진다.
 *
 * **표 위로는 가장 가파른 구간의 기울기로 늘린다.** 마지막 구간의 기울기를 쓰면 짧게
 * 틀린다 — 트리의 구간별 증가율이 2.6 · 4.0 · 3.7 · 6.4 · 4.1로 뒤로 갈수록 가팔라진다.
 */
export function interpolate(ladder: Ladder, x: number): number {
  const first = ladder[0]
  const last = ladder[ladder.length - 1]
  if (first === undefined || last === undefined) return 0
  if (x <= first[0]) return first[1]

  for (let index = 1; index < ladder.length; index += 1) {
    const low = ladder[index - 1] as readonly [number, number]
    const high = ladder[index] as readonly [number, number]
    if (x <= high[0]) {
      const ratio = Math.log(x / low[0]) / Math.log(high[0] / low[0])
      return low[1] * Math.pow(high[1] / low[1], ratio)
    }
  }

  let steepest = 1
  for (let index = 1; index < ladder.length; index += 1) {
    const low = ladder[index - 1] as readonly [number, number]
    const high = ladder[index] as readonly [number, number]
    steepest = Math.max(steepest, Math.log(high[1] / low[1]) / Math.log(high[0] / low[0]))
  }
  return last[1] * Math.pow(x / last[0], steepest)
}

export interface EstimateInput {
  readonly algorithm: string
  /** 학습에 실제로 들어가는 행 수. **전체 행이 아니라 훈련 몫이다.** */
  readonly rows: number
  /** **전처리 뒤의** 특성 수. 원핫으로 늘어난 열이 그대로 셈에 든다. */
  readonly columns: number
  /** 확정된 손잡이. 비어 있으면 기본값으로 본다. */
  readonly hyperparameters: Record<string, unknown>
}

function numberOr(source: Record<string, unknown>, name: string, fallback: number): number {
  const value = source[name]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * **지배적인 손잡이 둘만 곱한다** — 랜덤포레스트의 그루 수와 로지스틱의 `maxIter`다.
 * 기기 배수로는 못 덮는다: 나무를 10에서 500으로 올리면 50배이고, 정확한 예상이 가장
 * 필요한 순간이 바로 그 순간이다. 나머지(`k`·`C`·최대 깊이)는 시간을 크게 안 바꾼다.
 */
function handleFactor(algorithm: string, hyperparameters: Record<string, unknown>): number {
  if (algorithm === 'random_forest') {
    const trees = numberOr(hyperparameters, 'nEstimators', MLJS_RANDOM_FOREST_BASELINE_TREES)
    // 그루 수에는 선형이다 (실측: 1,000행에서 그루당 223~226ms로 일정).
    return Math.max(trees, 1) / MLJS_RANDOM_FOREST_BASELINE_TREES
  }
  if (algorithm === 'logistic_regression') {
    const iterations = numberOr(
      hyperparameters,
      'maxIter',
      MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER,
    )
    /**
     * **선형으로 곱하지 않는다.** 100회에서 1000회는 10배가 아니라 19.2배다.
     *
     * **아래로도 안 내린다.** 25→50이 9.3배라 초반이 유난히 싼데, 그 구간을 그대로 쓰면
     * 25회를 4분의 1이 아니라 44분의 1로 말하게 된다. 100회 미만은 어차피 몇백 ms라
     * 표시 문턱에 안 걸린다.
     */
    const clamped = Math.max(iterations, MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER)
    const ceiling = interpolate(
      MLJS_LOGISTIC_REGRESSION_MAX_ITER_MS,
      MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER,
    )
    return interpolate(MLJS_LOGISTIC_REGRESSION_MAX_ITER_MS, clamped) / ceiling
  }
  return 1
}

function baselineOf(algorithm: string): Baseline | null {
  return ALGORITHMS.find((entry) => entry.id === algorithm)?.baseline ?? null
}

/**
 * 개발 PC 기준으로 몇 ms 걸릴 일인가. **모르면 `null`이다** — 등록부에 없는 알고리즘이
 * 그렇고, 지어내지 않는다.
 */
export function baselineMs(input: EstimateInput): number | null {
  const baseline = baselineOf(input.algorithm)
  if (baseline === null) return null

  const rows = interpolate(baseline.ms, Math.max(input.rows, 1))
  // 특성 수에 선형인 것은 트리 계열과 SVM뿐이다. KNN과 로지스틱은 안 곱한다 (실측).
  const columns = baseline.columns === 'linear' ? Math.max(input.columns, 1) / BASELINE_COLUMNS : 1
  return rows * columns * handleFactor(input.algorithm, input.hyperparameters)
}

/** 이 기기에서 몇 ms 걸릴 일인가. `factor`는 `ml/calibration.ts`가 잰 배수다. */
export function estimateMs(input: EstimateInput, factor: number): number | null {
  const baseline = baselineMs(input)
  return baseline === null ? null : baseline * factor
}

/**
 * 화면이 적을 것. **문자열이 아니다** — 무엇을 적을지는 여기가 정하고, 어떻게 적을지는
 * 로케일이 정한다 (CLAUDE.md §3).
 *
 * `none`은 **적을 것이 없다**는 뜻이다. `약 0초`는 소음이고, 그 자리는 원래 안내가
 * 필요 없는 자리다.
 */
export type Estimate =
  | { readonly kind: 'none' }
  | { readonly kind: 'seconds'; readonly value: number }
  | { readonly kind: 'minutes'; readonly value: number }

/**
 * **올림한다.** 길게 틀리기로 했으므로 내림도 반올림도 아니다.
 *
 * 초는 5초 단위로 올린다 — `약 7초`와 `약 8초`가 학생에게 다른 정보를 주지 않는데,
 * 그 자릿수는 우리가 그만큼 정확한 것처럼 보이게 한다.
 */
export function describe(ms: number | null): Estimate {
  if (ms === null || !Number.isFinite(ms) || ms < TRAINING_ESTIMATE_FLOOR_MS) {
    return { kind: 'none' }
  }
  const seconds = ms / 1000
  if (seconds < 60) return { kind: 'seconds', value: Math.ceil(seconds / 5) * 5 }
  return { kind: 'minutes', value: Math.ceil(seconds / 60) }
}
