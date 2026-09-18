/**
 * 재실행 대조 — **파일에 적힌 숫자가 그 설정에서 실제로 나오는가** (mlpx-spec.md §7.1).
 *
 * 해시는 "파일이 만들어진 뒤에 바뀌었는가"만 답한다. 학생이 학습 전에 `runs.json`을
 * 고치고 저장했으면 해시는 멀쩡하다. **그때 주장을 검사하는 유일한 층이 여기다.**
 *
 * **재실행은 저장하지 않는 학습이다** (open-decisions.md "재실행은 학습 경로를 그대로
 * 탄다"). 여기에 학습의 사본을 두지 않는다 — `runExperiment`를 그대로 부르고, 이 파일이
 * 하는 일은 **셋뿐**이다.
 *
 *   1. 파일 → `ExperimentInput` 조립 (`reproduceInputOf`)
 *   2. 기록된 분할 넘기기 (`recordedSplitOf`, `ml/plan.ts`의 `recordedSplit`)
 *   3. 나온 지표와 파일의 지표 견주기 (`compareRun`)
 *
 * **사본이 두 번 뒤처졌던 자리다.** 채점이 `predictBatch ?? predict`로 바뀔 때도,
 * 학습에 풀이 붙을 때도 재실행만 안 따라갔다. 구조로 막는다 — 이 파일에는 `engine.fit`도
 * `evaluate`도 없고, `tests/inspect-rules.spec.ts`가 그것을 지킨다.
 *
 * **엔진을 넘지 않는다** (architecture.md §3.2). 배포 경로가 둘이라 학생이 Pages에서
 * 학습하고 교사가 도커 설치본에서 대조하는 일이 생기는데, 엔진이 다르면 숫자가 갈려
 * **무고한 학생이 위조를 의심받는다.** 그래서 만든 엔진과 같은 엔진이 아니면 대조하지
 * 않고 그 사실을 말한다 — 여기서는 **돌고 난 뒤의 스탬프**로 확인한다(조립이 틀린 날의
 * 그물이고, 미리 아는 것은 `reproduceBlockers`가 한다).
 *
 * **분할을 다시 계산하지 않는다.** 파일에 적힌 `trainIndices`/`testIndices`를 그대로 쓴다
 * (mlpx-spec.md §5.1) — 다시 나누면 라이브러리 버전 차이 하나로 테스트셋이 갈리고,
 * 그러면 대조가 아니라 새 학습이 된다.
 */

import type { ReproductionStatus } from '../errors'
import type { ConfusionMatrix, DataType, Experiment, Run, Settings } from '../project/schema'
import { ALGORITHMS } from './algorithms'
import { RUNTIMES, type ReproductionFidelity, type RuntimeContext } from './backend'
import { engineFor } from './engines'
import { runExperiment, type ExperimentInput } from './experiment'
import { asRecordedSplit, type RecordedSplit } from './plan'
import type { ComputePools } from './pools'
import type { Dataset } from './preprocess'
import { succeeded } from './results'

/** run 하나의 대조 결과. **판정이 아니라 사실이다.** */
export interface Reproduction {
  readonly runId: string
  readonly algorithm: string
  readonly status: ReproductionStatus
  /** 파일에 적힌 지표. */
  readonly stored: Readonly<Record<string, number>>
  /** 다시 돌려 나온 지표. 대조를 못 했으면 없다. */
  readonly again?: Readonly<Record<string, number>>
  /**
   * 지표마다 `다시 - 파일`. **화면이 보이는 값이다** — `advisory`인 칸에서는 판정 대신
   * 이것을 보이고 판단을 교사가 한다 (open-decisions.md "재현 판정은 (알고리즘 × 엔진)이
   * 정하고, 못 가르는 자리는 교사에게 넘긴다").
   *
   * 파일에만 있는 지표는 `NaN`이 아니라 아예 빠진다 — 없는 것과 어긋난 것은 다른 말이고,
   * 옛 파일에는 지금 없는 지표가 들어 있을 수 있다.
   */
  readonly deltas?: Readonly<Record<string, number>>
  /**
   * **몇 줄의 예측이 뒤집혔는가.** 혼동 행렬이 양쪽에 있고 라벨이 같을 때만 있다.
   *
   * 분류 지표의 눈금은 `1/시험 행 수`라 **한 칸 올린 변조와 한 행 뒤집힌 엔진 차이의
   * 크기가 같다** — `deltas`만으로는 둘을 못 가른다. 이 값이 #12가 실측 방법으로 정한
   * *"지표 차이가 아니라 어느 행이 뒤집혔는지"* 그 계량이다.
   */
  readonly flipped?: number
  /** 대조하지 못한 이유. `ENGINE_UNAVAILABLE`일 때만 있다. */
  readonly engine?: { readonly kind: string; readonly version: string }
  /**
   * 다시 돌리다 실패한 사유. **학습 경로가 코드로 들고 온다** — 눈금 밖 손잡이, 행 상한,
   * 서버 없음. 상태는 `ENGINE_UNAVAILABLE`이고(우리가 못 돌린 것이지 학생이 고친 것이
   * 아니다) 화면이 이 코드로 사유를 말한다.
   */
  readonly failure?: Run['failure']
}

export interface ReproduceInput {
  readonly experiment: Experiment
  /** 정본 표. `dataset/`이 없는 파일에서는 대조 자체가 불가능하다. */
  readonly dataset: Dataset
  /**
   * 테스트 데이터. **`experiment.settings.split.method`가 `provided`일 때만 쓴다.**
   *
   * **선택 인자가 아니라 필수다** (`ExperimentInput.testDataset`과 같은 이유다).
   * 없으면 `null`을 말해야 부르는 쪽이 그 자리를 지나칠 수 없다.
   */
  readonly testDataset: Dataset | null
  /**
   * 파일의 데이터 종류. **기본은 표다** — 지금 대조가 서는 것이 표뿐이고, 사진은
   * `reproduceBlockers`가 막는다.
   */
  readonly dataType?: DataType
}

export interface ReproduceOptions {
  /** 학습과 같은 손들. 워커만 준다 (`ml/worker/handler.ts`). */
  readonly pools?: ComputePools
  /** run 하나가 끝날 때마다. **취소가 끝난 것을 남기는 통로다.** */
  readonly onRun?: (reproduction: Reproduction, completed: number, total: number) => void
}

/**
 * 파일에 적힌 분할. **이것을 만들 수 있는 곳이 여기 하나다** (`ml/plan.ts`의 브랜드 타입).
 *
 * 학습 화면이 실수로 넘기면 분할이 굳으므로, 값을 짓는 자리를 조립 안에 둔다.
 */
export function recordedSplitOf(experiment: Experiment): RecordedSplit {
  const { trainIndices, testIndices } = experiment.settings
  return asRecordedSplit({ trainIndices, testIndices })
}

/**
 * **파일 → 학습 입력.** 여기가 재실행 고유 코드의 전부이고, A급 둘이 여기 있었다.
 *
 * **문서 설정을 한 글자도 안 읽는다** (open-decisions.md "재실행은 학습 경로를 그대로
 * 탄다"의 "조립은 문서 설정을 한 글자도 안 읽는다"). 입력은 실험과 표 둘뿐이다 —
 * 문서의 `settings.hyperparameters`는 **마지막 화면 상태**이고 실험 스냅샷에는 그 필드가
 * 아예 없어서, 어느 쪽을 써도 손잡이를 바꿔 가며 실험을 남긴 학생의 옛 실험이 다른 값으로
 * 다시 돈다.
 *
 * **그래서 run에서 읽는다.**
 *
 * - **실행 방법**은 `run.engine.kind`에서 되짚는다. 스냅샷의 `runtime`은 **요청한** 것이고
 *   run의 `engine`이 **실제로 돈** 것이다. 스냅샷이 그 칸을 늘 채우므로 그대로 쓰면
 *   `explicit`이 항상 참이 되어 자동 이동이 안 일어나고, **학습 때 자동으로 넘어가 돈 run이
 *   재실행에서 실패 run**이 된다 — 엔진이 바로 거기 있는데도.
 * - **하이퍼파라미터**는 `run.hyperparameters`다. 확정된 값이고 `resolve`가 멱등이라
 *   다시 확정해도 같다.
 *
 * **앞부분만 넘긴다.** 중단된 실험은 도착한 run만으로 조립되므로 `selectedAlgorithms`보다
 * 짧고, 그때 자리가 맞는 것은 앞부분뿐이다 (`ml/worker/client.ts`의 취소).
 */
export function reproduceInputOf(input: ReproduceInput): ExperimentInput {
  const { experiment, dataset, testDataset } = input
  const dataType = input.dataType ?? 'tabular'
  const runs = experiment.runs
  const snapshot = experiment.settings.data

  const selectedAlgorithms = experiment.settings.selectedAlgorithms
    .slice(0, runs.length)
    .map((selection, index) => {
      const runtime = runtimeIdFor(runs[index])
      return { ...selection, ...(runtime ? { runtime } : {}) }
    })

  const hyperparameters: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const [index, selection] of selectedAlgorithms.entries()) {
    const run = runs[index]
    if (!run || selection.runtime === undefined) continue
    const byRuntime = (hyperparameters[selection.algorithm] ??= {})
    byRuntime[selection.runtime] = { ...run.hyperparameters }
  }

  const settings: Settings = {
    ...experiment.settings,
    data: snapshot as Settings['data'],
    selectedAlgorithms,
    hyperparameters,
  }

  return {
    dataset,
    testDataset,
    taskType: experiment.settings.taskType,
    dataType,
    settings,
    context: inspectContext(dataType, dataset),
    snapshot,
    recordedSplit: recordedSplitOf(experiment),
  }
}

/**
 * 점검이 채우는 실행 환경.
 *
 * **상한은 끈다** (open-decisions.md "재실행은 학습 경로를 그대로 탄다"의 "점검이 채우는
 * 실행 환경"). 학생이 상한을 끄고 학습한 제출물을 교사 기기가 거절하면 **대조 자체가
 * 불가능해진다** — 거절 대신 경고가 맞고, 그 경고 자리는 학습 예상 시간이다.
 *
 * 서버와 무거운 엔진은 **모르는 채로 둔다.** 교사 기기에 그것이 있는지는 이 계산과 무관하고,
 * 없으면 그 run이 실패로 와서 `ENGINE_UNAVAILABLE`이 된다 — 오늘과 같은 답이다.
 */
function inspectContext(dataType: DataType, dataset: Dataset): RuntimeContext {
  return {
    serverStatus: 'unknown',
    engineStates: {},
    rowCount: dataset.rows.length,
    dataType,
    limitsOff: true,
  }
}

/** 이 run을 만든 엔진에 붙은 실행 방법 id. 무엇으로 만들었는지 모르면 없다. */
function runtimeIdFor(run: Run | undefined): string | undefined {
  const kind = run?.engine?.kind
  if (kind === undefined) return undefined
  return RUNTIMES.find((runtime) => runtime.engineKind === kind)?.id
}

/**
 * **이 run을 만든 엔진이 여기 있는가.** `kind`와 `version`이 둘 다 같아야 한다 —
 * 버전이 다르면 같은 이름의 다른 계산기다 (`MLJS_ENGINE.version`의 규칙).
 *
 * **여기서 하는 것은 조회이지 계산이 아니다.** 이 파일에 학습 계산을 들이지 않는 규칙은
 * `tests/inspect-rules.spec.ts`가 지키고, 그 규칙이 막는 것은 `fit`·`evaluate`·`transform`
 * 같은 부름이다 — 등록부를 읽어 "무엇이 있는가"를 묻는 것은 사본이 아니다.
 */
function engineIsHere(run: Run): boolean {
  const id = runtimeIdFor(run)
  const here = id === undefined ? undefined : engineFor(id)?.engine
  return here !== undefined && here.kind === run.engine?.kind && here.version === run.engine.version
}

/**
 * 실험 하나를 다시 돌려 파일의 지표와 견준다.
 *
 * **성공한 run만 견준다.** 실패한 run에는 견줄 주장이 없다 — 그 실패를 재현하는 것은
 * 다른 질문이고, 교사가 알고 싶은 것은 "이 점수가 진짜인가"다. 그래도 **돌리기는 한다**:
 * 자리를 맞추려면 `selectedAlgorithms`를 통째로 넘겨야 하고, 실패했던 조합은 대개 그
 * 자리에서 다시 튕긴다.
 */
export async function reproduceExperiment(
  input: ReproduceInput,
  options: ReproduceOptions = {},
): Promise<Reproduction[]> {
  const stored = input.experiment.runs
  const total = stored.filter(succeeded).length
  if (total === 0) return []

  const found: Reproduction[] = []
  const { experiment } = await runExperiment(reproduceInputOf(input), {
    ...(options.pools ? { pools: options.pools } : {}),
    onRun: (fresh, _completed, _all, index) => {
      const claim = stored[index]
      if (!claim || !succeeded(claim)) return
      const reproduction = compareRun(claim, fresh)
      found.push(reproduction)
      options.onRun?.(reproduction, found.length, total)
    },
  })

  // **`onRun`이 못 본 자리를 여기서 채운다.** 등록부에 없는 알고리즘처럼 학습 루프가
  // 콜백 없이 만드는 run이 있다 (`ml/experiment.ts`). 순서는 `runs.json` 그대로다.
  return found.length < total ? compareExperiments(input.experiment, experiment) : found
}

/**
 * 파일의 실험과 방금 나온 실험을 견준다. **순수 함수다.**
 *
 * **워커를 쓰는 화면이 부르는 자리다** (`views/inspect`). 거기서는 학습이 워커에서 돌고
 * 견주기는 메인 스레드에서 하므로 위 `reproduceExperiment`를 통째로 쓸 수 없다 —
 * **그래도 견주는 코드는 한 벌이어야 한다.**
 */
export function compareExperiments(claim: Experiment, fresh: Experiment): Reproduction[] {
  const found: Reproduction[] = []
  for (const [index, run] of claim.runs.entries()) {
    if (!succeeded(run)) continue
    found.push(compareRun(run, fresh.runs[index]))
  }
  return found
}

/**
 * 파일의 run 하나와 방금 나온 run 하나를 견준다. **순수 함수다.**
 *
 * 판정의 갈래는 셋이고 순서가 뜻을 갖는다.
 *
 *   1. **다시 돌리지 못했다** — 자리가 비었거나, 실패했거나, 엔진이 다르다 →
 *      `ENGINE_UNAVAILABLE`. **지목하지 않는다.**
 *   2. **차이가 없다** → `REPRODUCED`.
 *   3. **차이가 있다** → 그 (알고리즘 × 엔진)이 `exact`면 `NOT_REPRODUCED`, 아니면
 *      `NOT_JUDGED`(차이를 보이고 판정은 교사가).
 *
 * **run 하나씩 도착하는 화면이 이것을 직접 부른다** (`views/inspect/ReproducePanel.vue`).
 * 거기서는 워커가 run 하나를 끝낼 때마다 보고를 보내므로 실험 전체를 기다릴 수 없다 —
 * **그래도 견주는 코드는 한 벌이어야 한다.**
 */
export function compareRun(claim: Run, fresh: Run | undefined): Reproduction {
  const base = {
    runId: claim.id,
    algorithm: claim.algorithm,
    stored: claim.metrics ?? {},
  }
  const unavailable = (extra: Partial<Reproduction> = {}): Reproduction => ({
    ...base,
    status: 'ENGINE_UNAVAILABLE',
    ...(claim.engine ? { engine: claim.engine } : {}),
    ...extra,
  })

  if (!fresh) return unavailable()
  if (!succeeded(fresh)) {
    return unavailable(fresh.failure ? { failure: fresh.failure } : {})
  }
  // **엔진 스탬프를 돌고 나서 견준다.** 조립이 실행 방법을 되짚으므로 여기서 갈리는 것은
  // 버전이 다르거나(옛 파일) 조립이 틀렸을 때뿐이고, 어느 쪽이든 숫자를 버려야 한다.
  if (!sameEngine(claim, fresh)) return unavailable()

  const again = fresh.metrics ?? {}
  const deltas: Record<string, number> = {}
  for (const [name, value] of Object.entries(again)) {
    const stored = base.stored[name]
    if (typeof stored === 'number') deltas[name] = value - stored
  }

  const flipped = flippedRows(claim.confusionMatrix, fresh.confusionMatrix)
  const same = Object.keys(deltas).length > 0 && Object.values(deltas).every((delta) => delta === 0)
  const status: ReproductionStatus = same
    ? 'REPRODUCED'
    : fidelityOf(claim) === 'exact'
      ? 'NOT_REPRODUCED'
      : 'NOT_JUDGED'

  return {
    ...base,
    status,
    again,
    deltas,
    ...(flipped === undefined ? {} : { flipped }),
  }
}

function sameEngine(claim: Run, fresh: Run): boolean {
  const before = claim.engine
  const after = fresh.engine
  if (!before || !after) return false
  return before.kind === after.kind && before.version === after.version
}

/**
 * 이 run의 (알고리즘 × 엔진)에서 판정을 믿을 수 있는가 (`AlgorithmSpec.reproduction`).
 *
 * **모르면 `advisory`와 같게 다룬다** — 등록부에 없는 알고리즘(남의 파일)도, 재어 본 적
 * 없는 엔진도 여기로 온다. 모르는 자리에서 붉은 말을 하지 않는다.
 */
function fidelityOf(claim: Run): ReproductionFidelity {
  const spec = ALGORITHMS.find((one) => one.id === claim.algorithm)
  const kind = claim.engine?.kind
  if (!spec || kind === undefined) return 'unmeasured'
  const fidelity = spec.reproduction[kind as keyof typeof spec.reproduction]
  return fidelity ?? 'unmeasured'
}

/**
 * 두 혼동 행렬에서 **몇 줄이 뒤집혔는가.** 라벨이 다르거나 한쪽이 없으면 셀 수 없다.
 *
 * 다른 칸의 질량은 **나간 줄과 들어온 줄을 두 번 센다** — 한 줄이 옮겨 가면 원래 칸이
 * 하나 줄고 새 칸이 하나 는다. 그래서 절반이 곧 줄 수다.
 */
export function flippedRows(
  before: ConfusionMatrix | undefined,
  after: ConfusionMatrix | undefined,
): number | undefined {
  if (!before || !after) return undefined
  if (before.labels.length !== after.labels.length) return undefined
  if (before.labels.some((label, index) => label !== after.labels[index])) return undefined

  let mass = 0
  for (const [row, cells] of before.matrix.entries()) {
    const other = after.matrix[row]
    if (!other || other.length !== cells.length) return undefined
    for (const [column, count] of cells.entries()) {
      mass += Math.abs(count - (other[column] ?? 0))
    }
  }
  return mass / 2
}

/**
 * **파일 안에서 스스로 어긋나는가** — 저장된 정확도가 저장된 혼동 행렬과 맞는가.
 *
 * **재실행 없이 잡히는 신호다.** 지표만 한 칸 올린 파일은 행렬과 안 맞는다. 행렬까지
 * 맞춰 고친 변조는 못 가르고, 그것이 이 층의 한계다 (open-decisions.md "재현 판정은
 * (알고리즘 × 엔진)이 정하고, 못 가르는 자리는 교사에게 넘긴다"의 분류 눈금 문단).
 *
 * 재료가 없으면 `undefined`다 — 회귀·군집에는 행렬이 없고, 옛 파일에는 안 담겼을 수 있다.
 */
export function storedMetricsMatchMatrix(run: Run): boolean | undefined {
  const matrix = run.confusionMatrix
  const accuracy = run.metrics?.['accuracy']
  if (!matrix || typeof accuracy !== 'number') return undefined

  let total = 0
  let correct = 0
  for (const [row, cells] of matrix.matrix.entries()) {
    for (const [column, count] of cells.entries()) {
      total += count
      if (row === column) correct += count
    }
  }
  if (total === 0) return undefined
  // 파일에 적히는 정확도는 이미 반올림된 값이라(`ml/metrics.ts`) 같은 자릿수에서 견준다.
  return Math.abs(correct / total - accuracy) < 0.5 / total
}

/** 대조를 막는 이유. **boolean이 아니라 목록이다** (CLAUDE.md §2). */
export const REPRODUCE_BLOCKERS = [
  /** 정본 표가 파일에 없다. 다시 돌릴 재료가 없다. */
  'NO_DATASET',
  /** 성공한 run이 하나도 없다. 견줄 주장이 없다. */
  'NO_CLAIM',
  /** 사진 프로젝트. **첫 판에서 안 연다** — 못 하는 것이 아니다. */
  'IMAGE_NOT_OPEN',
  /** 이 파일을 만든 엔진이 여기 하나도 없다. */
  'ENGINE_MISSING',
  /** `provided`인데 테스트 표가 없다. */
  'NO_TEST_DATASET',
] as const

export type ReproduceBlocker = (typeof REPRODUCE_BLOCKERS)[number]

export interface ReproduceSubject {
  readonly experiment: Experiment
  readonly dataType: DataType
  readonly hasDataset: boolean
  readonly hasTestDataset: boolean
}

/**
 * 이 실험을 지금 대조할 수 있는가. **막히면 무엇이 막는지 전부 돌려준다.**
 *
 * **순서는 근본적인 것이 먼저다** (architecture.md §10.2) — 성공한 run이 0이면 엔진
 * 이야기는 공집합에 대한 말이라 뜻이 없다.
 *
 * **"도는 중"은 여기 없다.** 그건 파일의 성질이 아니라 화면의 상태이고, 화면이 이름 붙은
 * 값 하나로 둘을 합친다 (`ui-rules.spec.ts`의 `:disabled` 규칙).
 */
export function reproduceBlockers(subject: ReproduceSubject): ReproduceBlocker[] {
  const blockers: ReproduceBlocker[] = []
  if (subject.dataType !== 'tabular') blockers.push('IMAGE_NOT_OPEN')
  if (!subject.hasDataset) blockers.push('NO_DATASET')

  const claims = subject.experiment.runs.filter(succeeded)
  if (claims.length === 0) {
    blockers.push('NO_CLAIM')
    return blockers
  }

  // **`run.engine`이 없는 run은 "안 맞음"으로 센다** — 무엇으로 만들었는지 모르는 것과
  // 다른 엔진으로 만든 것은 대조 가능성에서 같다. **이번 학기까지의 파일은 전부 여기
  // 걸린다** (`mljs@2`로 만들었고 지금은 3이다) — 그것이 이 줄이 있는 이유다.
  if (!claims.some((claim) => engineIsHere(claim))) blockers.push('ENGINE_MISSING')

  if (subject.experiment.settings.split.method === 'provided' && !subject.hasTestDataset) {
    blockers.push('NO_TEST_DATASET')
  }
  return blockers
}
