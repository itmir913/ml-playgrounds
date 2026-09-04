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
 *
 * ─────────────────────────────────────────────────────────────────────────
 * **알려진 어긋남: 기준표는 직렬 시간이고 학습은 이제 병렬로 돈다**
 * (2026-09-04 R26 C-6). 포레스트·KNN·신경망이 문턱을 넘으면 워커로 갈라 도는데
 * (`limits.ts`의 `MLJS_*_PARALLEL_*`), 표와 기기 배수는 둘 다 **가르기 전에** 쟀다.
 * 그래서 문턱 위에서는 예상이 **체계적으로 길다** — 브라우저 실측으로 포레스트가
 * 1.95배, KNN이 2.36배, 신경망이 1.76배였으니 그만큼이다.
 *
 * **지금은 고치지 않는다.** 위 머리말대로 이 화면은 *"틀릴 때는 길게 틀린다"*를
 * 택했고, 이 어긋남은 정확히 그 방향이다. 고치려면 배수를 지어내는 것이 아니라
 * **기준표를 병렬로 다시 재야 한다** — 기기마다 코어가 다르므로 나눗셈 상수 하나로는
 * 안 되고, 근거 없는 임계값은 이 저장소가 안 받는다.
 * ─────────────────────────────────────────────────────────────────────────
 */

import {
  BASELINE_COLUMNS,
  MLJS_KMEANS_BASELINE_CLUSTERS,
  MLJS_KMEANS_CLUSTERS_MS,
  MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER,
  MLJS_LOGISTIC_REGRESSION_MAX_ITER_MS,
  MLJS_NEURAL_NETWORK_BASELINE_LAYERS,
  MLJS_NEURAL_NETWORK_BASELINE_NEURONS,
  MLJS_NEURAL_NETWORK_WEIGHTS_MS,
  MLJS_RANDOM_FOREST_BASELINE_TREES,
  TRAINING_ELAPSED_VISIBLE_AFTER_MS,
  TRAINING_ESTIMATE_COARSE_FROM_SECONDS,
  TRAINING_ESTIMATE_COARSE_STEP_SECONDS,
} from '../limits'

import type { DataType } from '../project/schema'

import { ALGORITHMS } from './algorithms'
import { DEFAULT_BACKBONE_ID, backboneFor } from './backbones'
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
 * 인공신경망의 가중치 수. **손잡이 둘과 특성 수가 여기서 하나로 접힌다.**
 *
 * **출력 칸은 1로 센다.** 클래스 수는 예상 시간을 낼 시점에 모르고(학습이 돌아야 안다),
 * `뉴런 × 클래스`는 은닉층의 `뉴런²` 옆에서 작은 항이다 — 기본 손잡이에서 전체의 11%,
 * 2층부터는 1% 아래다. **모르는 값을 지어내는 것보다 작은 항을 빠뜨리는 쪽이 낫고, 그
 * 방향은 짧게 틀린다** — 이 파일이 피하려는 방향이지만 크기가 저 정도다.
 */
function neuralWeights(columns: number, layers: number, neurons: number): number {
  const width = Math.max(neurons, 1)
  const depth = Math.max(layers, 1)
  return Math.max(columns, 1) * width + (depth - 1) * width * width + width
}

/**
 * 이 종류의 기준표가 **몇 개의 특성에서 재어졌나.**
 *
 * **사진에서 특성 수를 두 번 세지 않으려고 있다.** 사진 기준표는 임베딩 차원에서 재어져
 * 있고(`backbones.ts`), 학습 화면이 넘기는 `columns`는 **사진에서 0이다**
 * (`TrainView.vue`의 `featureWidth`가 `tabularDataOf`를 읽는다). 그 0을 그대로 가중치
 * 식에 넣으면 배수가 **3분의 1로 줄어** 예상이 크게 짧아진다 — `UNMEASURED_BASELINE`의
 * 주석이 `columns: 'flat'`에 대해 말하는 것과 같은 함정이고, 손잡이 배수에서 한 번 더
 * 나타난 것이다.
 *
 * 그래서 사진에서는 **분자와 분모가 같은 차원을 쓴다** — 배수가 손잡이로만 움직인다.
 *
 * **백본이 하나 더 생기면 사진 기준표를 다시 재야 한다** (`UNMEASURED_BASELINE`의 같은
 * 경고). 여기서 기본 백본의 차원을 쓰는 것도 그 전제 위에 있다.
 */
function baselineColumnsOf(dataType: DataType): number {
  if (dataType !== 'image') return BASELINE_COLUMNS
  return backboneFor(DEFAULT_BACKBONE_ID)?.embeddingDim ?? BASELINE_COLUMNS
}

/**
 * **지배적인 손잡이 넷만 곱한다** — 랜덤포레스트의 그루 수, 로지스틱의 `maxIter`,
 * K-평균의 군집 수, 신경망의 층 수와 뉴런 수다. 기기 배수로는 못 덮는다: 나무를 10에서
 * 500으로 올리면 50배이고, 정확한 예상이 가장 필요한 순간이 바로 그 순간이다.
 *
 * **`k`는 처음에 "나머지"로 묶여 있었다** — `C`·최대 깊이와 함께 시간을 크게 안 바꾼다고
 * 봤는데, **재 보니 8.4배였다** (2026-09-01). 비용이 `행 × k × 특성 × 반복`이라 `k`가
 * 곧바로 붙는다. 남은 둘(`C`·최대 깊이)은 그대로 무시한다.
 *
 * **신경망만 특성 수를 여기서 받는다** (2026-09-03). 등록부의 `columns` 축은 곱셈
 * 하나뿐이라 "첫 층에만 붙는다"를 표현할 수 없고, 가중치 수는 그것을 이미 품고 있다.
 */
function handleFactor(
  algorithm: string,
  hyperparameters: Record<string, unknown>,
  columns: number,
  dataType: DataType,
): number {
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
  if (algorithm === 'neural_network') {
    /**
     * **두 손잡이의 배수를 따로 곱하지 않는다.** 실측에서 2층 × 200뉴런이 57.9초인데
     * 곱셈 규칙은 35.2초를 냈다 — 층이 늘면 `뉴런²` 덩어리가 늘어 두 손잡이가 서로를
     * 곱하기 때문이다 (`limits.ts`의 표).
     */
    const layers = numberOr(hyperparameters, 'hiddenLayers', MLJS_NEURAL_NETWORK_BASELINE_LAYERS)
    const neurons = numberOr(
      hyperparameters,
      'neuronsPerLayer',
      MLJS_NEURAL_NETWORK_BASELINE_NEURONS,
    )
    // **분모는 그 종류의 기준표가 재어진 특성 수다.** 사진에서는 분자도 같은 값이라
    // 특성 축이 상쇄되고 손잡이만 남는다 (`baselineColumnsOf`).
    const measuredAt = baselineColumnsOf(dataType)
    const actual = dataType === 'image' ? measuredAt : columns
    const baseline = interpolate(
      MLJS_NEURAL_NETWORK_WEIGHTS_MS,
      neuralWeights(
        measuredAt,
        MLJS_NEURAL_NETWORK_BASELINE_LAYERS,
        MLJS_NEURAL_NETWORK_BASELINE_NEURONS,
      ),
    )
    return (
      interpolate(MLJS_NEURAL_NETWORK_WEIGHTS_MS, neuralWeights(actual, layers, neurons)) / baseline
    )
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
  return (
    rows *
    columns *
    handleFactor(input.algorithm, input.hyperparameters, input.columns, input.dataType)
  )
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

/**
 * 지금까지 얼마나 걸렸나. **예상과 나란히 서는 값이라 여기 산다.**
 *
 * **`hidden`은 아직 말 걸 때가 아니라는 뜻이다** — 값이 없는 것도, 못 재는 것도 아니다.
 * 위 `Estimate`의 `unknown`과 헷갈리면 안 된다: 저쪽은 **영영 못 낸다**이고 이쪽은
 * **아직 이르다**이다.
 */
export type Elapsed =
  | { readonly kind: 'hidden' }
  /** 두 칸 다 **글자다.** `9`가 아니라 `09` — 숫자로 넘기면 앞의 0이 사라진다. */
  | { readonly kind: 'shown'; readonly minutes: string; readonly seconds: string }

/**
 * 경과 시간을 화면이 적을 모양으로.
 *
 * **`mm:ss`로 굳힌다. 시간 단위는 안 만든다** — 한 시간을 넘기는 학습은 상한이 막고,
 * 상한을 푼 학생에게는 `72:30`이 `1:12:30`보다 낫다. **자리 수가 흔들리면 숫자가
 * 줄마다 들쑥날쑥해 보인다**(예상 시간을 [제거] 왼편에 못 박은 것과 같은 이유).
 *
 * **안 시작했으면 안 띄운다.** `startedAt`이 `null`인 줄은 아직 대기이거나 이미 끝났다.
 *
 * **뒤로 가는 시계를 안 만든다.** `performance.now()`는 단조라 음수가 안 나오지만,
 * 두 값이 다른 시계에서 오면 나올 수 있고 그때 `-1:-30`을 적으면 화면이 고장으로 보인다.
 *
 * @param startedAt `performance.now()`로 찍은 시작 시각. 안 돌고 있으면 `null`
 * @param now 같은 시계의 지금
 */
export function elapsedOf(startedAt: number | null, now: number): Elapsed {
  if (startedAt === null) return { kind: 'hidden' }
  const ms = now - startedAt
  if (!Number.isFinite(ms) || ms < TRAINING_ELAPSED_VISIBLE_AFTER_MS) return { kind: 'hidden' }
  const total = Math.floor(ms / 1000)
  return {
    kind: 'shown',
    minutes: String(Math.floor(total / 60)).padStart(2, '0'),
    seconds: String(total % 60).padStart(2, '0'),
  }
}
