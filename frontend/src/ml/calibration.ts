/**
 * **이 기기가 개발 PC보다 몇 배 느린가.**
 *
 * 예상 시간의 기준표(`limits.ts`)는 개발 PC 크롬에서 쟀다. 다른 기기는 그 표에 배수를
 * 곱해야 하는데, **배수를 계층 표에서 꺼내지 않고 그 기기에서 짧은 일감을 실제로 돌려
 * 낸다** (open-decisions.md "학습 예상 시간은 실측표에 기기 배수를 곱해 낸다").
 *
 * **브라우저가 말해 주는 성질에는 신호가 없어서다.** 8코어 아이패드가 4코어 아이폰보다
 * 느리고, 잰 다섯 환경이 전부 1.6배 안에 들어왔으며, 정작 갈릴 구형 컴퓨터실 PC는 UA에
 * 안 보인다. 표를 세워 봐야 잰 칸은 전부 1이고 안 잰 칸은 지어내야 한다.
 *
 * **일감 정의가 여기 있는 것이 중요하다.** `tools/workloads.ts`의 하니스가 이 정의를
 * 그대로 가져다 쓴다 — 기준값(`CALIBRATION_BASELINE_MS`)을 잰 일감과 앱이 도는 일감이
 * 갈리면 배수가 통째로 어긋나고, 그 어긋남은 아무 데서도 안 보인다.
 */

import { CALIBRATION_BASELINE_MS } from '../limits'

import { fit } from './engines/mljs'

/**
 * `localStorage` 열쇠. 기기마다 다른 값이라 IndexedDB(프로젝트)가 아니다.
 *
 * **`.mlpx`에는 안 담는다.** 파일은 기기를 넘어 다니므로, 아이폰에서 잰 배수가 컴퓨터실
 * PC에서 살아나면 그건 거짓말이다. 컴퓨터실 PC는 리셋을 전제라 이 값이 차시마다
 * 사라지는데, 다시 재는 데 100ms가 안 든다.
 */
const STORAGE_KEY = 'ml-playgrounds:device-factor'

/**
 * 알고리즘마다의 배수. **교정 일감이 낸 기기 배수를 덮어쓴다.**
 *
 * **하나로 두면 오염된다.** 기준표가 어느 한 알고리즘에서 크게 틀리면(K-평균이 그랬다)
 * 그 학습으로 기기 배수를 고치는 순간 **다른 알고리즘의 예상까지 그만큼 밀린다.**
 * 기기가 느린 것과 표가 틀린 것을 한 값이 구분하지 못한다. 알고리즘마다 두면 둘 다
 * 그 자리에서 교정된다.
 */
const MODEL_STORAGE_KEY = 'ml-playgrounds:model-factors'

const CLASSES = 3
const NOISE = 0.15

/** 결정적 난수. **기기마다 같은 데이터를 봐야 배수가 데이터 차이를 안 담는다.** */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

export function syntheticData(
  rows: number,
  columns: number,
  regression = false,
): { features: number[][]; target: string[] } {
  const random = lcg(42)
  const features: number[][] = []
  const target: string[] = []
  for (let row = 0; row < rows; row += 1) {
    const cluster = row % CLASSES
    const values: number[] = []
    for (let column = 0; column < columns; column += 1) values.push(cluster + random() * 2 - 1)
    features.push(values)
    if (regression) {
      target.push(String(values.reduce((sum, value) => sum + value, 0) + random()))
    } else {
      // 라벨의 15%를 흔든다. 완전히 갈리는 데이터는 솔버가 너무 쉽게 끝난다.
      const flipped = random() < NOISE ? (cluster + 1) % CLASSES : cluster
      target.push(String.fromCharCode(97 + flipped))
    }
  }
  return { features, target }
}

export interface CalibrationJob {
  readonly algorithm: string
  readonly rows: number
  readonly columns?: number
  readonly hyperparameters?: Record<string, number>
  readonly regression?: boolean
}

/**
 * **두 종류를 섞는다.** 트리는 분할 탐색이고 로지스틱은 행렬과 경사다 — 한쪽만 재면
 * 다른 쪽이 다른 배수를 갖는 기기에서 어긋난다.
 *
 * **개발 PC에서 둘을 합쳐 70ms다.** 로지스틱의 `maxIter`를 25로 낮춰 둔 것이 그
 * 이유이고, 재려는 것이 절대 시간이 아니라 배수라 짧아도 된다.
 */
export const CALIBRATION_JOBS: readonly CalibrationJob[] = [
  { algorithm: 'decision_tree', rows: 300 },
  { algorithm: 'logistic_regression', rows: 5000, hyperparameters: { tol: 0, maxIter: 25 } },
]

/**
 * 한 일감을 잰다. **데이터 생성은 시계 밖이다** — 재려는 것은 학습이지 난수가 아니다.
 *
 * **예측까지 지나간다.** 기준표를 그렇게 쟀고, 학생이 기다리는 것도 [학습하기]를 누르고
 * 결과가 나올 때까지다.
 */
export async function measureJob(job: CalibrationJob): Promise<number> {
  const { features, target } = syntheticData(job.rows, job.columns ?? 8, job.regression ?? false)
  const rowIndices = features.map((_, index) => index)
  const started = performance.now()
  const { predict } = await fit(job.algorithm, {
    features,
    rowIndices,
    target,
    taskType: job.regression ? 'regression' : 'classification',
    hyperparameters: job.hyperparameters ?? {},
    randomState: 42,
  })
  predict(features.slice(0, Math.max(1, Math.round(job.rows * 0.2))))
  return performance.now() - started
}

/** 일감 전부를 돌린 시간의 합. **워커에서 부른다** — 메인에서 돌리면 화면이 그만큼 멈춘다. */
export async function runCalibration(): Promise<number> {
  let total = 0
  for (const job of CALIBRATION_JOBS) total += await measureJob(job)
  return total
}

/**
 * 잰 시간을 배수로 바꾼다. **1보다 작을 수 있다** — 개발 PC보다 빠른 기기가 실재한다.
 *
 * 0 이하는 배수가 될 수 없다. `performance.now()`의 해상도가 낮은 환경에서 0이 나올 수
 * 있는데, 그것을 배수로 쓰면 모든 예상이 0초가 된다.
 */
export function factorFrom(elapsedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null
  return elapsedMs / CALIBRATION_BASELINE_MS
}

/**
 * 저장된 배수. **못 읽으면 없는 것이다.**
 *
 * 사파리의 사생활 보호 모드처럼 `localStorage` 접근 자체가 던지는 환경이 있다
 * (`prefs.ts`와 같은 이유). 예상 시간 하나 때문에 화면이 안 뜨면 안 된다.
 */
export function readFactor(): number | null {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (stored === null) return null
  const value = Number(stored)
  // 손으로 넣어 둔 값이나 옛 형식을 믿지 않는다. 0과 음수도 배수가 아니다.
  return Number.isFinite(value) && value > 0 ? value : null
}

export function writeFactor(factor: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(factor))
  } catch {
    // 저장에 실패해도 이번 세션의 배수는 이미 메모리에 있다 (`prefs.ts`와 같다).
  }
}

/**
 * 학습 한 번이 남긴 배수. **실제 걸린 시간을 기준표가 말한 시간으로 나눈 것이다**
 * (`open-decisions.md`의 "그다음 학습이 배수를 다듬는다").
 *
 * **평활 계수를 두지 않는다.** 지수 이동 평균은 근거 없는 상수(α)를 하나 만들고,
 * 한 번 튄 값은 **다음 학습이 바로 고친다** — 같은 학생이 같은 기기에서 설정만 바꿔
 * 되풀이하는 것이 이 도구의 핵심 활동이라 관측이 자주 온다.
 */
export function factorFromRun(elapsedMs: number, expectedMs: number): number | null {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null
  if (!Number.isFinite(expectedMs) || expectedMs <= 0) return null
  return elapsedMs / expectedMs
}

/** 저장된 알고리즘별 배수 전부. **못 읽거나 깨졌으면 빈 것이다.** */
export function readModelFactors(): Record<string, number> {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(MODEL_STORAGE_KEY)
  } catch {
    return {}
  }
  if (stored === null) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(stored)
  } catch {
    // 남이 손으로 넣어 둔 값이나 옛 형식. 지어내지 않고 없는 것으로 본다.
    return {}
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  const factors: Record<string, number> = {}
  for (const [algorithm, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) factors[algorithm] = value
  }
  return factors
}

export function writeModelFactors(factors: Record<string, number>): void {
  try {
    window.localStorage.setItem(MODEL_STORAGE_KEY, JSON.stringify(factors))
  } catch {
    // 저장에 실패해도 이번 세션의 값은 이미 메모리에 있다 (`writeFactor`와 같다).
  }
}
