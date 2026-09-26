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
import {
  DATA_SCHEMAS,
  type ConfusionMatrix,
  type DataType,
  type Experiment,
  type Run,
  type Settings,
  type TabularSnapshot,
} from '../project/schema'
import { ALGORITHMS } from './algorithms'
import { RUNTIMES, type ReproductionFidelity, type RuntimeContext } from './backend'
import { engineFor } from './engines'
import { runExperiment, type ExperimentInput } from './experiment'
import { asRecordedSplit, type RecordedSplit } from './plan'
import type { ComputePools } from './pools'
import { categoryOrder, type Dataset, type Preprocessor } from './preprocess'
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
   * **그 파일을 만든 뒤 바뀐 계산 규칙이 이 run에 걸린다** — 그래서 차이가 있어도 판정하지
   * 않았다 (`underRuleChanges`, open-decisions.md 62). 차이가 있는 줄에만 붙는다.
   */
  readonly rulesChanged?: {
    /** 그 파일의 `manifest.appVersion`. */
    readonly appVersion: string
    readonly rules: readonly CalculationRule[]
  }
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
    // **파일이 말하는 배포판으로 띄운다.** 안 주면 교사 기기의 오늘 판으로 돌고, 갈린
    // 숫자가 학생의 것으로 읽힌다.
    enginePins: enginePinsOf(experiment),
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
 * **이 run을 만든 엔진이 여기 있는가.** `kind`는 언제나 같아야 하고, **버전은 엔진이
 * 정한다** — 순수 JS는 정확히 같아야 하고(다른 판은 같은 이름의 다른 계산기다,
 * `MLJS_ENGINE.version`의 규칙) sklearn은 배포판 이름이라 받아 오면 된다.
 *
 * **여기서 하는 것은 조회이지 계산이 아니다.** 이 파일에 학습 계산을 들이지 않는 규칙은
 * `tests/inspect-rules.spec.ts`가 지키고, 그 규칙이 막는 것은 `fit`·`evaluate`·`transform`
 * 같은 부름이다 — 등록부를 읽어 "무엇이 있는가"를 묻는 것은 사본이 아니다.
 */
function engineIsHere(run: Run): boolean {
  const id = runtimeIdFor(run)
  const engine = id === undefined ? undefined : engineFor(id)
  if (engine === undefined || engine.engine.kind !== run.engine?.kind) return false
  /**
   * **버전을 감당하는 방식이 엔진마다 다르다** (2026-09-19, 결정문의 넷째 조항).
   *
   * 순수 JS의 버전은 *우리 코드*의 판이라 다른 판을 흉내 낼 수 없지만, sklearn의 버전은
   * *받아 오는 배포판*의 이름이라 **그 이름으로 받아 오면 된다.** 그래서 판정을 등록부에
   * 맡긴다 — 여기서 `if (kind === 'pyodide-sklearn')`을 쓰면 그 지식이 흩어진다.
   */
  return engine.acceptsVersion?.(run.engine.version) ?? engine.engine.version === run.engine.version
}

/**
 * **엔진 종류마다, 파일이 말하는 배포판.** 받아 오는 엔진이 그것으로 뜬다.
 *
 * **한 종류에 하나다.** 워커 하나에 파이썬은 하나뿐이라(`pyodide-runtime.ts`) 여럿을 줄
 * 자리가 없다. 한 실험의 run들은 같은 세션에서 만들어져 같은 판을 말하므로 **첫 것을
 * 쓴다** — 어긋나면 먼저 뜬 것으로 돌고 **파일에는 뜬 것이 적힌다.**
 */
function enginePinsOf(experiment: Experiment): Record<string, string> {
  const pins: Record<string, string> = {}
  for (const run of experiment.runs) {
    const engine = run.engine
    if (engine === undefined || pins[engine.kind] !== undefined) continue
    pins[engine.kind] = engine.version
  }
  return pins
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

  // **`onRun`이 못 본 자리를 여기서 채운다.** 여기 오는 길은 **신선한 쪽의 run이 주장보다
  // 적을 때** 하나다 — `selectedAlgorithms`가 `runs`보다 짧은 파일이 그렇다. 그때 안 온
  // 자리는 `compareExperiments`가 `엔진 없음`으로 적는다. 순서는 `runs.json` 그대로다.
  //
  // **"등록부에 없는 알고리즘은 콜백 없이 만들어진다"고 적혀 있었고 그것은 거짓이다**
  // (2026-09-18 R28 C-2). `ml/experiment.ts`는 실패한 run에도 `onRun`을 부른다 — 그 문장을
  // 근거로 이 줄을 지우면 진짜 이유가 함께 사라진다.
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
  /**
   * **엔진 스탬프를 돌고 나서 견준다.** 조립이 실행 방법을 되짚으므로 여기서 갈리는 것은
   * 판이 다르거나(옛 파일) 조립이 틀렸을 때뿐이다.
   *
   * **버릴지 보일지는 엔진이 정한다** (2026-09-19 R30 B-1, 코드 소유자).
   *
   * 순수 JS의 판은 *우리 코드*의 판이라 다른 판의 숫자를 나란히 놓는 것 자체가 뜻이 없다 —
   * 버린다. **받아 오는 엔진은 다르다**: 원본이 파일이 말한 배포판을 더 안 주면 우리가
   * 못 박은 것으로 돌리는데(`pyodide-runtime.ts`의 `attempt`), 그때 숫자까지 버리면
   * **27.3MB를 받고 다시 학습한 것을 통째로 버리고 나서 "대조했습니다"라고 말하게 된다.**
   * 숫자는 보이고 판정만 안 한다 — *"못 가르는 자리는 교사에게 넘긴다"*가 이 저장소의 길이다.
   */
  const engineJudges = sameEngine(claim, fresh)
  if (!engineJudges && !versionIsFetched(claim)) return unavailable()

  const again = fresh.metrics ?? {}
  const deltas: Record<string, number> = {}
  for (const [name, value] of Object.entries(again)) {
    const stored = base.stored[name]
    if (typeof stored === 'number') deltas[name] = value - stored
  }

  const flipped = flippedRows(claim.confusionMatrix, fresh.confusionMatrix)
  const same = Object.keys(deltas).length > 0 && Object.values(deltas).every((delta) => delta === 0)
  /**
   * **판이 갈렸으면 숫자가 같아도 "재현됐다"고 말하지 않는다.** 그건 파일이 말한 배포판으로
   * 확인한 것이 아니고, 이 화면에서 `재현됨`은 **학생의 주장을 우리가 보증하는 말**이다.
   */
  const status: ReproductionStatus = !engineJudges
    ? 'NOT_JUDGED'
    : same
      ? 'REPRODUCED'
      : fidelityOf(claim) === 'exact'
        ? 'NOT_REPRODUCED'
        : 'NOT_JUDGED'

  return {
    ...base,
    status,
    again,
    deltas,
    // **무엇으로 돌았는지를 함께 보낸다.** 판이 갈린 줄에서 화면이 그 사실을 말할 수 있어야
    // 하고, 갈리지 않았으면 적을 것이 없다.
    ...(engineJudges || !fresh.engine ? {} : { engine: fresh.engine }),
    ...(flipped === undefined ? {} : { flipped }),
  }
}

/**
 * 이 run의 엔진은 **판을 받아 오는** 종류인가. 그러면 판이 갈려도 숫자를 보인다.
 *
 * **묻는 곳이 등록부다** (`TrainingEngine.acceptsVersion`) — `engineIsHere`가 들어올 때 쓰는
 * 바로 그 축이고, **들어올 때와 견줄 때가 다른 축을 보면 안 된다.** 그 어긋남이 B-1이었다.
 */
function versionIsFetched(claim: Run): boolean {
  const id = runtimeIdFor(claim)
  const engine = id === undefined ? undefined : engineFor(id)
  return engine?.acceptsVersion !== undefined
}

/**
 * 파일이 말한 배포판으로 못 돌았으면 **무엇으로 돌았는지**를 낸다. 아니면 `undefined`.
 *
 * **화면이 아니라 여기 있는 이유는 축이 하나여야 하기 때문이다** (2026-09-19 R31 C-5).
 * 이 사실을 말하는 문구는 *"숫자는 보이고 판정을 안 한다"*까지 말하는데, 그 말이 참인
 * run은 `versionIsFetched`가 참인 것뿐이다 — 순수 JS는 판이 갈리면 `compareRun`이
 * `unavailable()`을 내어 **숫자가 하나도 안 보인다.** 판정하는 자리와 말하는 자리가 다른
 * 축을 보면 화면이 자기 모순을 말하고, **엔진 이름까지 틀린다.**
 *
 * **한 번만 낸다.** 한 실험의 run들은 같은 세션에서 같은 판으로 돌므로 문장이 반복된다.
 */
export function engineVersionFallback(
  claim: Experiment,
  fresh: Experiment,
): { stored: string; used: string } | undefined {
  for (const [index, run] of fresh.runs.entries()) {
    const claimed = claim.runs[index]
    const stored = claimed?.engine
    const used = run.engine
    if (!claimed || !stored || !used) continue
    if (stored.kind !== used.kind || stored.version === used.version) continue
    if (!versionIsFetched(claimed)) continue
    return { stored: stored.version, used: used.version }
  }
  return undefined
}

/**
 * 앱이 바꾼 계산 규칙의 이름. 각 규칙의 결정문은 `CALCULATION_RULE_CHANGES`가 적는다.
 */
export type CalculationRule =
  | 'MODE_TIE'
  | 'SILHOUETTE_SINGLETON'
  | 'CONSTANT_COLUMN_SCALE'
  | 'CATEGORY_ORDER'
  | 'CONSTANT_TARGET_R2'
  | 'CODE_POINT_ORDER'

/** 판정을 거를지 볼 때 쓰는, 그 파일이 가진 것. */
export interface RuleFile {
  /**
   * `manifest.appVersion`. **프로젝트를 만든 앱의 판이고 저장해도 안 바뀐다**
   * (`project/create.ts`만 쓴다) — 그래서 run이 돈 판의 **하한**이다. 이 판이 규칙이 바뀐
   * 판보다 앞이면, 그 뒤에 새로 학습한 run도 옛 규칙으로 돌았을 수 있다고 본다.
   */
  readonly appVersion: string
  /** 이 실험의 기록된 전처리기. 못 읽었으면 `null`이고 그때는 규칙이 걸린다고 본다. */
  readonly preprocessor: Preprocessor | null
  readonly dataset: Dataset | null
  readonly testDataset: Dataset | null
}

/** 규칙 하나가 이 run에 걸리는가를 물을 재료. */
interface RuleSubject {
  readonly experiment: Experiment
  readonly run: Run
  readonly file: RuleFile
  /** 이 실험의 표 스냅숏. 못 읽으면 `null`이다. */
  readonly data: TabularSnapshot | null
}

interface CalculationRuleChange {
  readonly rule: CalculationRule
  /** **이 판부터** 새 규칙이다. */
  readonly since: string
  /**
   * 이 규칙이 이 run의 숫자를 바꿀 수 있는가. **모르면 참이다** — 판정을 거르는 쪽이
   * 무고한 학생을 지목하는 쪽보다 낫다.
   */
  readonly touches: (subject: RuleSubject) => boolean
}

/**
 * **앱의 계산 규칙이 바뀐 자리와 그 판** (open-decisions.md 62). 판은 그 규칙을 담아 나간
 * 태그이고, 규칙이 바뀔 때마다 여기에 한 줄을 더한다.
 *
 * 재실행 대조는 **지금 규칙으로** 다시 계산해 파일의 숫자와 견주므로, 규칙이 바뀌기 전에
 * 만든 파일은 학생이 아무것도 안 고쳐도 차이가 난다. 그 차이를 "재현되지 않음"으로 말하면
 * 앱의 변경이 학생의 위조로 읽힌다.
 */
export const CALCULATION_RULE_CHANGES: readonly CalculationRuleChange[] = [
  // 52 — 결측 채움의 최빈값이 동점이면 가장 작은 값. 채움값을 쓰는 전략에서만 걸린다.
  {
    rule: 'MODE_TIE',
    since: '0.26.6',
    touches: ({ data, file }) =>
      data === null ||
      (data.preprocessing.missing !== 'none' &&
        data.preprocessing.missing !== 'drop' &&
        (data.preprocessing.missing === 'mostFrequent' ||
          file.preprocessor === null ||
          file.preprocessor.columns.some((column) => column.kind === 'categorical'))),
  },
  // 57 ① — 점 하나뿐인 군집의 실루엣은 0. 군집 run에서만 걸린다.
  {
    rule: 'SILHOUETTE_SINGLETON',
    since: '0.28.0',
    touches: ({ experiment }) => experiment.settings.taskType === 'clustering',
  },
  // 57 ② — 상수 열인지를 sklearn `_is_constant_feature`로 본다. 표준화에서만 걸린다.
  {
    rule: 'CONSTANT_COLUMN_SCALE',
    since: '0.28.0',
    touches: ({ data }) => data === null || data.preprocessing.scaling === 'standard',
  },
  // 61 — 범주 순서는 정렬. 기록된 범주가 이미 정렬돼 있으면 순서가 같아 안 걸린다.
  {
    rule: 'CATEGORY_ORDER',
    since: '0.28.2',
    touches: ({ data, file }) =>
      data === null ||
      (data.preprocessing.categoricalEncoding !== 'none' &&
        (file.preprocessor === null ||
          file.preprocessor.columns.some(
            (column) =>
              column.categories !== undefined &&
              categoryOrder(column.categories).join('\u0000') !== column.categories.join('\u0000'),
          ))),
  },
  // 57 ③ — 정답이 한 값뿐인 시험 몫의 결정계수. 회귀에서 그 시험 몫일 때만 걸린다.
  {
    rule: 'CONSTANT_TARGET_R2',
    since: '0.28.2',
    touches: (subject) =>
      subject.experiment.settings.taskType === 'regression' && !testTargetVaries(subject),
  },
  // 61 — 라벨 번호·혼동 행렬의 축·최빈값 동점을 코드 포인트로 견준다. 분류의 정답 열이나
  // 최빈값으로 채우는 특성 열에 두 순서가 갈리는 값이 함께 있을 때만 걸린다.
  {
    rule: 'CODE_POINT_ORDER',
    since: '0.28.3',
    touches: (subject) => labelsOrderDiffers(subject) || fillOrderDiffers(subject),
  },
]

/**
 * 이 값들 가운데 **코드 포인트 순서와 UTF-16 코드 단위 순서가 갈리는 쌍이 있는가.** 전체에서
 * 두 순서가 같으면 어느 부분에서도 같다 — 그래서 훈련 몫·시험 몫·예측을 따로 안 세고 열 전체를
 * 본다.
 */
function orderDiffers(values: Iterable<string>): boolean {
  const byCodePoints = categoryOrder(values)
  const byCodeUnits = [...byCodePoints].sort()
  return byCodePoints.some((value, at) => value !== byCodeUnits[at])
}

/**
 * 분류 run의 라벨 순서가 규칙 변경에 걸리는가. 라벨은 정답 열의 값이고(예측은 훈련 몫의 라벨
 * 가운데 하나다), 학습과 같이 앞뒤 공백을 떼고 본다(`targetValues`). **못 읽으면 참이다.**
 */
function labelsOrderDiffers({ experiment, file, data }: RuleSubject): boolean {
  if (experiment.settings.taskType !== 'classification') return false
  const target = data?.target
  if (target === undefined || file.dataset === null) return true
  const sources =
    experiment.settings.split.method === 'provided'
      ? [file.dataset, file.testDataset]
      : [file.dataset]
  const values: string[] = []
  for (const source of sources) {
    if (source === null) return true
    const column = source.columns.indexOf(target)
    if (column < 0) return true
    for (const row of source.rows) values.push((row[column] ?? '').trim())
  }
  return orderDiffers(values)
}

/**
 * 결측 채움의 최빈값 동점이 규칙 변경에 걸리는가. 채움값을 쓰는 전략에서 특성 열의 값을 열마다
 * 본다(`fitPreprocessor`처럼 칸 그대로). **못 읽으면 참이다.**
 */
function fillOrderDiffers({ file, data }: RuleSubject): boolean {
  if (data === null) return true
  if (data.preprocessing.missing === 'none' || data.preprocessing.missing === 'drop') return false
  const dataset = file.dataset
  if (dataset === null) return true
  return data.features.some((feature) => {
    const column = dataset.columns.indexOf(feature)
    return column < 0 || orderDiffers(dataset.rows.map((row) => row[column] ?? ''))
  })
}

/**
 * 이 run에 걸리는, 그 파일을 만든 뒤 바뀐 계산 규칙들. **순서는 목록 그대로다.**
 */
export function changedRules(experiment: Experiment, run: Run, file: RuleFile): CalculationRule[] {
  const parsed = DATA_SCHEMAS.tabular.snapshot.safeParse(experiment.settings.data)
  const subject: RuleSubject = {
    experiment,
    run,
    file,
    data: parsed.success ? parsed.data : null,
  }
  return CALCULATION_RULE_CHANGES.filter(
    (change) => versionBefore(file.appVersion, change.since) && change.touches(subject),
  ).map((change) => change.rule)
}

/**
 * **판정을 규칙 변경에 비춰 거른다.** 차이가 있는 줄에 그 파일 뒤에 바뀐 규칙이 걸리면
 * `NOT_JUDGED`로 내리고 그 사실을 붙인다 — 차이는 그대로 보인다.
 *
 * **차이가 없는 줄은 그대로다.** 지금 규칙으로 다시 계산해 같은 숫자가 나왔으면 그것이
 * 확인이다. 못 돌린 줄(`ENGINE_UNAVAILABLE`)도 그대로다.
 *
 * **판정을 세우는 `compareRun`은 그대로 두고 여기서 거른다** — 대조 판은 도착한 사실을
 * 담아 두고 보일 때 이것을 한 번 지난다(`views/inspect/ReproducePanel.vue`의 `found`).
 * `tests/reproduce.spec.ts`의 *"계산 규칙이 바뀐 뒤"*가 문다.
 */
export function underRuleChanges(
  reproductions: readonly Reproduction[],
  experiment: Experiment,
  file: RuleFile,
): Reproduction[] {
  return reproductions.map((reproduction) => {
    if (reproduction.status !== 'NOT_REPRODUCED' && reproduction.status !== 'NOT_JUDGED') {
      return reproduction
    }
    const run = experiment.runs.find((one) => one.id === reproduction.runId)
    const rules = run === undefined ? [] : changedRules(experiment, run, file)
    if (rules.length === 0) return reproduction
    return {
      ...reproduction,
      status: 'NOT_JUDGED',
      rulesChanged: { appVersion: file.appVersion, rules },
    }
  })
}

/**
 * 채점한 정답에 다른 값이 둘 이상 있는가. **못 읽으면 `false`다** — 모르는 것은 걸리는
 * 쪽으로 센다. 정답은 학습과 같은 자리에서 읽는다(`ml/experiment.ts`: `provided`면 테스트
 * 표, 아니면 정본 표의 `testIndices`).
 */
function testTargetVaries({ experiment, file, data }: RuleSubject): boolean {
  const target = data?.target
  const source = experiment.settings.split.method === 'provided' ? file.testDataset : file.dataset
  if (target === undefined || source === null) return false
  const column = source.columns.indexOf(target)
  if (column < 0) return false
  let first: number | undefined
  for (const row of experiment.settings.testIndices) {
    const cell = source.rows[row]?.[column]
    if (cell === undefined) return false
    const value = Number(cell.trim())
    if (first === undefined) first = value
    else if (value !== first) return true
  }
  return false
}

/**
 * `left` 판이 `right` 판보다 앞인가. **읽을 수 없는 판은 앞으로 본다** — 모르는 파일에서
 * 판정을 거르는 쪽이 지목하는 쪽보다 낫다.
 */
function versionBefore(left: string, right: string): boolean {
  const a = versionParts(left)
  const b = versionParts(right)
  if (a === null || b === null) return true
  for (let at = 0; at < 3; at += 1) {
    const gap = (a[at] ?? 0) - (b[at] ?? 0)
    if (gap !== 0) return gap < 0
  }
  return false
}

function versionParts(version: string): number[] | null {
  const matched = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return matched ? matched.slice(1).map(Number) : null
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
 * **모르면 `advisory`와 같게 다룬다** — 재어 본 적 없는 엔진이 그 자리다. 모르는 자리에서
 * 붉은 말을 하지 않는다.
 *
 * **등록부에 없는 알고리즘은 여기까지 못 온다** (2026-09-18 R28 C-3). 그런 run은 학습
 * 루프가 `ALGORITHM_UNSUPPORTED`로 먼저 떨어뜨리므로 `compareRun`의 앞 갈래에서 걸린다 —
 * `!spec`을 남겨 두는 것은 등록부가 줄어드는 날의 그물이고, **지금 이 갈래가 하는 일은 없다.**
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
  /** 같은 판에서 다른 실험의 대조가 돈다. 판 하나가 워커 하나를 쥔다. */
  'COMPARING_OTHER',
] as const

export type ReproduceBlocker = (typeof REPRODUCE_BLOCKERS)[number]

export interface ReproduceSubject {
  readonly experiment: Experiment
  readonly dataType: DataType
  readonly hasDataset: boolean
  readonly hasTestDataset: boolean
  /** 이 판에서 **다른** 실험의 대조가 도는가. 이 실험 자신이 도는 것은 여기 안 든다. */
  readonly comparingOther: boolean
}

/**
 * 이 실험을 지금 대조할 수 있는가. **막히면 무엇이 막는지 전부 돌려준다.**
 *
 * **순서는 근본적인 것이 먼저다** (architecture.md §10.2) — 성공한 run이 0이면 엔진
 * 이야기는 공집합에 대한 말이라 뜻이 없다.
 *
 * **이 실험 자신이 도는 것은 여기 없다** — 그때 단추 자리는 [멈추기]다. **다른 실험이
 * 도는 것은 있다**(`COMPARING_OTHER`, 맨 뒤) — 파일의 사정이 아니지만, 이유 목록 밖에서
 * 잠그면 교사가 왜 회색인지 모른다 (architecture.md §8.21). `inspect-reproduce-live.spec.ts`의
 * *"다른 실험이 대조 중이면"*이 문다.
 */
export function reproduceBlockers(subject: ReproduceSubject): ReproduceBlocker[] {
  const blockers = fileBlockers(subject)
  if (subject.comparingOther) blockers.push('COMPARING_OTHER')
  return blockers
}

/** 파일이 막는 것. 순서는 근본적인 것이 먼저다. */
function fileBlockers(subject: ReproduceSubject): ReproduceBlocker[] {
  const blockers: ReproduceBlocker[] = []
  // 사진 프로젝트의 정본은 표가 아니라 파일 안의 사진이다 — 표가 없다고 `NO_DATASET`을
  // 붙이면 거짓말이 된다. `reproduce.spec.ts`의 *"사진 프로젝트에는"*이 문다.
  if (subject.dataType !== 'tabular') blockers.push('IMAGE_NOT_OPEN')
  else if (!subject.hasDataset) blockers.push('NO_DATASET')

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
