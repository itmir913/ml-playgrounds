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
  MLJS_KMEANS_BASELINE_CLUSTERS,
  MLJS_KMEANS_CLUSTERS_MS,
  MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER,
  MLJS_LOGISTIC_REGRESSION_MAX_ITER_MS,
  MLJS_RANDOM_FOREST_BASELINE_TREES,
  TRAINING_ESTIMATE_COARSE_FROM_SECONDS,
  TRAINING_ESTIMATE_COARSE_STEP_SECONDS,
} from '../limits'

import type { DataType } from '../project/schema'

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
  /**
   * 데이터 종류. **화면이 종류를 비교해서 끄지 않는다** — 어느 종류를 쟀는지는 등록부가
   * 안다 (architecture.md §9.1). 사진은 아직 안 쟀고, 그 자리는 `알 수 없음`이 된다.
   */
  readonly dataType: DataType
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
 * **지배적인 손잡이 셋만 곱한다** — 랜덤포레스트의 그루 수, 로지스틱의 `maxIter`,
 * K-평균의 군집 수다. 기기 배수로는 못 덮는다: 나무를 10에서 500으로 올리면 50배이고,
 * 정확한 예상이 가장 필요한 순간이 바로 그 순간이다.
 *
 * **`k`는 처음에 "나머지"로 묶여 있었다** — `C`·최대 깊이와 함께 시간을 크게 안 바꾼다고
 * 봤는데, **재 보니 8.4배였다** (2026-09-01). 비용이 `행 × k × 특성 × 반복`이라 `k`가
 * 곧바로 붙는다. 남은 둘(`C`·최대 깊이)은 그대로 무시한다.
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
  if (algorithm === 'k_means') {
    const clusters = numberOr(hyperparameters, 'nClusters', MLJS_KMEANS_BASELINE_CLUSTERS)
    // 반복 횟수가 `k`마다 달라 곧은 선이 아니다. 잰 표를 보간한다.
    const baseline = interpolate(MLJS_KMEANS_CLUSTERS_MS, MLJS_KMEANS_BASELINE_CLUSTERS)
    return interpolate(MLJS_KMEANS_CLUSTERS_MS, Math.max(clusters, 1)) / baseline
  }
  return 1
}

function baselineOf(algorithm: string, dataType: DataType): Baseline | null {
  const found = ALGORITHMS.find((entry) => entry.id === algorithm)?.baseline[dataType]
  // 빈 표는 "0초"가 아니라 **안 쟀다**는 뜻이다 (`UNMEASURED_BASELINE`).
  return found === undefined || found.ms.length === 0 ? null : found
}

/**
 * 개발 PC 기준으로 몇 ms 걸릴 일인가. **모르면 `null`이다** — 등록부에 없는 알고리즘이
 * 그렇고, 지어내지 않는다.
 */
export function baselineMs(input: EstimateInput): number | null {
  const baseline = baselineOf(input.algorithm, input.dataType)
  if (baseline === null) return null

  const rows = interpolate(baseline.ms, Math.max(input.rows, 1))
  // 특성 수에 선형인 것은 트리 계열과 SVM뿐이다. KNN과 로지스틱은 안 곱한다 (실측).
  const columns = baseline.columns === 'linear' ? Math.max(input.columns, 1) / BASELINE_COLUMNS : 1
  return rows * columns * handleFactor(input.algorithm, input.hyperparameters)
}

/**
 * 이 종류에 **예상이 나오기는 하는가.** 등록부에 기준표가 하나라도 있으면 참이다.
 *
 * **화면이 종류를 비교하지 않게 하려고 있다** (`architecture.md` §9.1). 사진 기준표
 * 하나도 안 차 있어 사진 프로젝트의 예상 칸은 **모든 줄에서 `알 수 없음`**인데,
 * 그 사실을 화면이 `dataType === 'image'`로 알면 **기준표를 채우는 날 그 화면도 함께
 * 고쳐야 한다** — 그리고 빠뜨린 것은 컴파일도 검사도 못 잡는다.
 *
 * **여기 물으면 실측이 들어오는 순간 문구가 저절로 바뀐다.**
 */
export function hasEstimates(dataType: DataType, algorithms = ALGORITHMS): boolean {
  return algorithms.some((entry) => entry.baseline[dataType].ms.length > 0)
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
  /**
   * **못 낸다.** 서버에서 학습하는 경우가 그렇다(우리가 모르는 기기다). 배수를 아직 못
   * 잰 것과는 다르다 — "아직"과 "못"은 다른 상태이고, 화면이 그 둘을 같은 말로 적으면
   * 학생은 기다리면 될 것을 안 된다고 읽는다.
   */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'seconds'; readonly value: number }
  | { readonly kind: 'minutes'; readonly value: number }

/**
 * **올림한다.** 길게 틀리기로 했으므로 내림도 반올림도 아니다.
 *
 * **짧아도 적는다** (2026-08-31, 사용자). 5초 미만은 안 적기로 했었는데, 화면에서
 * **아무것도 없는 것과 모르는 것이 같은 모양이 됐다** — 학생은 그 자리를 보고 "빠른
 * 건가 못 재는 건가"를 알 수 없다. `약 1초`가 소음이라고 봤지만, 없는 칸이 주는
 * 물음표가 더 나쁘다.
 *
 * **1초 아래로는 안 내려간다.** `약 0초`는 시간이 아니라 부정이다.
 */
export function describe(ms: number | null): Estimate {
  if (ms === null || !Number.isFinite(ms)) return { kind: 'unknown' }
  const seconds = ms / 1000
  if (seconds < TRAINING_ESTIMATE_COARSE_FROM_SECONDS) {
    return { kind: 'seconds', value: Math.max(Math.ceil(seconds), 1) }
  }
  if (seconds < 60) {
    const step = TRAINING_ESTIMATE_COARSE_STEP_SECONDS
    return { kind: 'seconds', value: Math.ceil(seconds / step) * step }
  }
  return { kind: 'minutes', value: Math.ceil(seconds / 60) }
}
