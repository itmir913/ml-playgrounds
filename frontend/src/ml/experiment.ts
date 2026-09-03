/**
 * 실험 실행 - 조각들을 엮어 `runs.json`의 실험 하나를 만든다.
 *
 * [학습하기]를 한 번 누르면 실험 하나가 생기고, 고른 모델 수만큼 run이 들어간다.
 * **같은 실험은 같은 데이터·전처리·분할을 쓰므로 공정한 비교가 구조적으로 보장된다**
 * (mlpx-spec.md 4). 그래서 전처리기는 실험당 한 번만 학습하고 전체가 공유한다.
 *
 * ```
 * usableRows -> sampleRows -> holdoutSplit -> fitPreprocessor -> transform -> fit -> predict -> evaluate
 * ```
 *
 * **동기 함수다.** 이 함수는 Web Worker 안에서 돌므로 메인 스레드는 얼지 않고
 * (open-decisions.md "학습은 언제나 백그라운드다"), 취소는 워커 terminate가 한다.
 * async로 만들면 중간에 끊을 수 있는 것처럼 보이는 신호를 넣고 싶어지는데, 동기 루프
 * 안에서 그건 거짓말이다. 대신 모델 하나가 끝날 때마다 onRun을 부른다 -
 * **진행 표시는 모델 단위이고 실험 전체 진행률은 부르는 쪽이 센다** (mlpx-spec.md 0.3).
 *
 * **실패의 경계가 둘이다.**
 *
 * - 알고리즘 하나가 죽는 것은 run 하나의 실패다. 나머지 결과는 나온다 (mlpx-spec.md 4.1).
 * - 분할·전처리가 죽는 것은 실험 자체가 성립하지 않는 것이라 던진다. 여기서 run을
 *   만들어 봐야 전부 같은 사유로 실패하고, 학생은 같은 문장을 모델 수만큼 보게 된다.
 */

import { ClientError, failureDetail, isClientError } from '../errors'
import { DATA_COMPARABLE_KEYS, dataSettings } from '../project/schema'
import type {
  Experiment,
  DataType,
  Run,
  RunsFile,
  Settings,
  TaskType,
  Warning,
} from '../project/schema'
import { algorithmOptions, type Algorithm, type AlgorithmOption } from './algorithms'
import {
  reasonParams,
  type RuntimeContext,
  type RuntimeSpec,
  type UnavailableReason,
} from './backend'
import { engineFor, type TrainingEngine } from './engines'
import { assertInRange } from './hyperparams'
import { evaluate, evaluateCluster, type Evaluation } from './metrics'
import type { ModelFile } from './models'
import { targetValues, transform, type Dataset, type Preprocessor } from './preprocess'
// 행 고르기·뽑기·분할·전처리기. **전처리 화면의 요약 카드가 같은 함수를 부른다.**
import { planRunOrThrow } from './plan'

export interface ExperimentInput {
  /** 정본 CSV를 읽은 표. 헤더는 rows에 없다 - 행 번호가 곧 분할 인덱스다. */
  dataset: Dataset
  /**
   * 테스트 데이터. **`settings.split.method`가 `provided`일 때만 쓴다.**
   *
   * `testIndices`는 이 표의 행 번호다 - `dataset`(=data.csv)과는 다른 정본이라
   * `trainIndices`와 같은 표로 섞으면 안 된다 (mlpx-spec.md §1.1, ml/split.ts).
   * `holdout`이면 `null`이다 - 나눌 데이터가 하나뿐이라는 뜻이다.
   *
   * **선택 인자가 아니라 필수다.** 선택으로 두었더니 화면이 안 넘기는 것을 타입이
   * 못 잡았고, `provided`로 학습하면 평가할 행이 하나도 없다며 거부했다. 없다는 것을
   * `null`로 **말하게** 해야 부르는 쪽이 그 자리를 지나칠 수 없다.
   */
  testDataset: Dataset | null
  /** 학생이 고른다. 자동 판정하지 않는다 (mlpx-spec.md 0.1). */
  taskType: TaskType
  /** 업로드한 파일에서 판정된다. */
  dataType: DataType
  /**
   * 학습 시점의 설정. 그대로 실험에 스냅샷으로 남는다.
   *
   * 실행 방법도 여기 있다 - `settings.runtime`이 실험 기본이고 모델마다 덮어쓸 수 있다.
   */
  settings: Settings
  /** 서버 유무·엔진 준비 상태·행 수. 실행 방법 판정에 쓴다. */
  context: RuntimeContext
  /**
   * **파일에 남길 종류별 스냅샷.** 위 `settings`는 계산에 쓰는 값이고, 이것은 기록이다.
   *
   * 둘이 갈리는 자리는 여기 하나뿐이다 — 이미지는 임베딩을 **열 이름 붙인 표**로 바꿔서
   * 이 함수로 들어오는데(open-decisions.md "이미지 학습은 표 문제로 바꿔서 푼다"),
   * 그 표의 `f0…f1279`가 실험 기록에 적히면 거짓말이다. 학생이 고른 것도 아니고 다시
   * 열었을 때 뜻도 없다.
   *
   * **그래서 짓지 않고 받는다.** 인자로 세워 두면 이 함수 안에 `if (dataType ===
   * 'image')`가 안 생긴다. 표를 부르는 쪽은 `dataSnapshot('tabular', settings)`를 그대로
   * 넘기므로 파일에 남는 값이 안 바뀐다.
   */
  snapshot: Experiment['settings']['data']
}

export interface ExperimentOptions {
  /**
   * 지금까지의 runs.json. id 일련번호와 changed 계산이 여기서 나온다.
   * 없으면 첫 실험이다.
   */
  history?: RunsFile
  /** 시각. 테스트가 결정적이려면 주입할 수 있어야 한다. */
  now?: () => string
  /**
   * 모델 하나를 **시작할 때마다** (mlpx-spec.md §0.3). 워커 껍데기가 이걸 postMessage로
   * 바꾼다.
   *
   * **끝날 때(`onRun`)만으로는 지금 도는 것이 무엇인지 말할 수 없다.** 실행 방법을 함께
   * 주는 이유는 학생이 고른 것과 실제로 도는 것이 다를 수 있어서다(자동 이동).
   */
  onRunStart?: (
    started: { index: number; algorithm: string; runtime: string },
    total: number,
  ) => void
  /**
   * 모델 하나가 끝날 때마다. 워커 껍데기가 이걸 postMessage로 바꾼다.
   *
   * **`index`는 `onRunStart`와 같은 자리다.** 받는 쪽이 "끝난 개수 - 1"로 되짚으면
   * 순차 실행을 가정하는 셈이라, 세는 쪽이 아니라 도는 쪽이 말한다.
   */
  onRun?: (
    run: Run,
    completed: number,
    total: number,
    index: number,
    /**
     * 방금 추가한 모델. **없는 것이 정상이다** — 실패한 run과 직렬화기가 없는 알고리즘은
     * 지표만 남는다 (아래 `ExperimentResult.models`).
     *
     * **여기서 함께 넘기지 않으면 취소가 아무것도 못 건진다.** 모델은 `done`에서 한꺼번에
     * 가는데, terminate하면 워커와 함께 사라진다 (open-decisions.md "멈추기가 끝난 것을
     * 남긴다" §2).
     */
    model: ModelFile | undefined,
  ) => void
  /**
   * 모델 루프에 들어가기 직전에 한 번. **취소가 조립할 재료다** (같은 결정문 §3).
   *
   * 성공 경로만 보면 없어도 되는 콜백이다 — `done`이 완성품을 싣기 때문이다. 이것이
   * 있는 이유는 **끝을 못 보는 경로**이고, 그래서 루프보다 앞이어야 한다.
   */
  onPrelude?: (prelude: ExperimentPrelude) => void
  /**
   * 볼 알고리즘 등록부. 없으면 진짜 등록부다.
   *
   * **검사가 가짜 표본을 넣으려고 있다** (`algorithmOptions`·`runtimeOptions`와 같은
   * 방식이다). 지금 등록부에는 표에서 안 서는 알고리즘이 하나도 없는데, 그건 규칙이
   * 아니라 오늘의 사실이라 그것만 보고 검사를 짜면 규칙이 안 지켜진다.
   */
  algorithms?: readonly Algorithm[]
}

/**
 * 실험이 **돌기 전에** 이미 정해져 있는 것 전부. `runs`만 빠져 있다.
 *
 * 워커가 루프에 들어가기 전에 이것을 보내면, 취소된 학습도 메인 스레드에서 같은
 * `assembleExperiment()`로 조립된다 (open-decisions.md "멈추기가 끝난 것을 남긴다" §3).
 */
export interface ExperimentPrelude {
  readonly id: string
  readonly startedAt: string
  readonly settings: Experiment['settings']
  /** 학습된 전처리기. 부분 실험에도 그대로 딸려 간다 — 아래 `ExperimentResult`와 같다. */
  readonly preprocessor: Preprocessor
}

export interface ExperimentResult {
  experiment: Experiment
  /**
   * 학습된 전처리기. **실험에 넣지 않고 따로 돌려준다** - experiment.preprocessor는
   * zip 안의 경로를 가리키는 참조이고, 그 파일을 쓰는 것은 저장 계층의 일이다.
   * 여기서 있지도 않은 경로를 적어 두면 파일이 자기 자신에 대해 거짓말을 하게 된다.
   */
  preprocessor: Preprocessor
  /**
   * run id -> 우리 형식으로 추가한 모델. **전처리기와 같은 이유로 따로 돌려준다.**
   *
   * 여기 없는 run이 있는 것이 정상이다 - 직렬화기가 없는 알고리즘은 지표만 남고,
   * 그 사유는 run.modelOmitted에 적혀 있다 (mlpx-spec.md 4.2).
   */
  models: Map<string, ModelFile>
}

/**
 * 이 알고리즘을 지금 어디서 돌릴지 고른다.
 *
 * **자동 이동은 학생이 안 고른 칸만 채운다.** 실험 기본을 물려받은 모델은 그 방법으로
 * 못 돌면 되는 곳으로 넘어가지만(open-decisions.md "실행 방법은 (위치 × 엔진)이 아니라 하나의 목록이다"),
 * 모델별로 **콕 집어 고른 것은 옮기지 않는다.** 두 가지 이유가 있다.
 *
 * 1. 고른 것과 다른 데서 돌리는 것은 조용히 다른 일을 하는 것이다. 못 돌면 사유를
 *    주는 편이 낫다 - "엔진을 준비하세요"에는 학생이 할 일이 있다.
 * 2. **같은 알고리즘을 여러 실행 방법으로 나란히 돌릴 수 있기 때문이다.** SVM을 순수
 *    JS·sklearn·학교 서버로 셋 다 고른 학생에게 자동 이동이 걸리면 셋이 같은 곳으로
 *    몰려 **똑같은 줄 세 개**가 나온다. 비교하려던 것이 사라진다.
 *
 * 후보는 **엔진이 등록된 실행 방법뿐이다.** 서버 학습은 모양은 같지만 구현이 다르고
 * (ml/server.ts), 여기서 그쪽을 고르면 돌지도 않을 것을 골라 두는 셈이다.
 */
function chooseRuntime(
  option: AlgorithmOption,
  preferred: string,
  explicit: boolean,
): RuntimeSpec | undefined {
  // **축이 셋인데 여기서 보이는 것은 하나뿐이다** (mlpx-spec.md 0.1). runtimes[].enabled는
  // 실행 위치만 본다 - 데이터 타입과 과제 유형의 판정은 option.enabled에 들어 있고,
  // 그것을 안 보면 회귀 전용 모델이 분류 과제에서 **그대로 학습돼 done으로 끝난다.**
  // 화면은 못 고르게 막지만 selectedAlgorithms는 파일에 남는다 - 학생이 과제 유형만
  // 바꾸고 다시 학습하면 체크된 채로 여기 도착한다.
  if (!option.enabled) return undefined

  const usable = option.runtimes.filter(
    (candidate) => candidate.enabled && engineFor(candidate.runtime.id) !== undefined,
  )
  const wanted = usable.find((candidate) => candidate.runtime.id === preferred)
  return (explicit ? wanted : (wanted ?? usable[0]))?.runtime
}

/**
 * 실패 run에 적을 사유와, 그 사유가 쓰는 행 상한.
 *
 * **둘이 함께 나와야 한다.** 상한은 (알고리즘 × 구현)마다 다르므로 사유를 고른 뒤에
 * 등록부를 다시 뒤져 숫자를 고르면 다른 칸의 값이 붙는다.
 */
function unavailable(
  option: AlgorithmOption,
  preferred: string,
): { reason: UnavailableReason; maxRows?: number } {
  const reason = unavailableReason(option, preferred)
  const from =
    option.runtimes.find((candidate) => candidate.reason === reason) ??
    (option.reason === reason ? option : undefined)
  return { reason, ...(from?.maxRows === undefined ? {} : { maxRows: from.maxRows }) }
}

/**
 * 어디서도 못 도는 이유. **가장 근본적인 것을 준다.**
 *
 * 알고리즘 자체가 이 데이터·과제 유형에서 안 되는 것이 먼저고, 그다음이 학생이 고른
 * 실행 방법의 사유다. 이미지 데이터에 회귀를 고른 학생에게 "엔진이 준비되지 않았습니다"
 * 라고 답하면 안 된다 (ml/algorithms.ts와 같은 순서다).
 */
function unavailableReason(option: AlgorithmOption, preferred: string): UnavailableReason {
  // option.reason은 "이 데이터·과제에 안 맞다"와 "어디서도 못 돈다"를 한 값에 담는다.
  // 앞의 둘만 먼저 가로챈다 - 뒤엣것까지 가로채면 학생이 콕 집은 실행 방법의 사유를
  // 덮어써서, 서버를 고른 학생에게 "엔진이 준비되지 않았습니다"라고 답하게 된다.
  if (option.reason === 'ALGORITHM_NOT_FOR_DATA_TYPE') return option.reason
  if (option.reason === 'ALGORITHM_NOT_FOR_TASK_TYPE') return option.reason

  // 학생이 고른 실행 방법의 사유를 먼저 준다. 단 "여기선 실행할 수 없습니다"는
  // 막다른 답이라 건너뛴다 - 학생이 할 수 있는 일을 하나도 알려주지 않는다.
  const requested = option.runtimes.find((candidate) => candidate.runtime.id === preferred)
  if (requested?.reason && requested.reason !== 'ALGORITHM_NOT_AVAILABLE_HERE') {
    return requested.reason
  }

  // 그러면 이 알고리즘이 **실제로 지원하는** 실행 방법의 사유를 준다.
  // "엔진을 준비하세요"는 할 일이 있고 "여기선 안 됩니다"는 없다.
  const relevant = option.runtimes.find(
    (candidate) => candidate.reason && candidate.reason !== 'ALGORITHM_NOT_AVAILABLE_HERE',
  )
  return relevant?.reason ?? 'ALGORITHM_NOT_AVAILABLE_HERE'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 두 설정 사이에서 바뀐 경로. `preprocessing.scaling` 같은 점 표기다.
 *
 * 객체는 파고들고 배열은 통째로 하나로 본다 - `features.2`는 학생에게 아무 뜻이 없고
 * "특성 목록이 바뀌었다"가 알고 싶은 전부다.
 */
function changedPaths(before: unknown, after: unknown, prefix = ''): string[] {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    return keys.flatMap((key) =>
      changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key),
    )
  }
  return JSON.stringify(before ?? null) === JSON.stringify(after ?? null) ? [] : [prefix]
}

/**
 * 비교 대상으로 삼는 설정.
 *
 * **분할 인덱스는 뺀다.** split 설정에서 파생된 값이라 중복이고, `settings.trainIndices`가
 * 목록에 뜨면 학생은 자기가 무엇을 바꿨는지 알 수 없다.
 *
 * 알고리즘과 하이퍼파라미터는 넣는다 - 실험 사이에서 학생이 실제로 가장 자주 바꾸는 것이
 * 그것인데, 그게 안 잡히면 changed가 대부분 빈 배열이 되어 쓸모가 없어진다.
 */
function comparable(
  settings: Experiment['settings'],
  runs: readonly Run[],
  shared: ReadonlySet<string>,
): Record<string, unknown> {
  const hyperparameters: Record<string, Record<string, unknown>> = {}
  // runs는 selectedAlgorithms와 같은 순서로 만들어진다. 그래서 index로 짝지을 수 있고,
  // 같은 알고리즘이 두 실행 방법으로 두 번 들어와도 서로 덮어쓰지 않는다.
  settings.selectedAlgorithms.forEach((selection, index) => {
    const key = `${selection.algorithm}:${selection.runtime}`
    if (!shared.has(key)) return
    const values = runs[index]?.hyperparameters
    if (values) hyperparameters[key] = values
  })

  return {
    // 과제 유형이 바뀌면 지표 집합이 통째로 바뀐다. 가장 크게 바뀐 것이 목록에
    // 안 뜨면 학생은 비교표가 왜 딴판인지 알 수 없다.
    taskType: settings.taskType,
    runtime: settings.runtime,
    // **종류별 설정은 평평하게 편다** (schema.ts의 DATA_COMPARABLE_KEYS). 파일에서는
    // settings.data 안에 있지만 `changed`의 경로는 `preprocessing.scaling`처럼 평평하고,
    // 그 경로가 움직이면 옛 실험의 기록도 로케일 키도 함께 썩는다.
    //
    // **`null`로 펴는 것이 핵심이다.** 없는 값을 undefined로 두면 `JSON.stringify`가
    // 그 키를 지워 "없다가 생김"과 "있다가 없어짐"이 둘 다 안 잡힌다 - 타깃을 고르고
    // 안 고른 것이 학생이 한 변경인데도 목록에 안 뜬다.
    ...Object.fromEntries(DATA_COMPARABLE_KEYS.map((key) => [key, settings.data[key] ?? null])),
    split: settings.split,
    // **`null`로 펴는 것이 핵심이다** (target과 같은 방식). 뽑기를 켠 것과 끈 것은
    // 학생이 한 변경인데, undefined로 두면 `JSON.stringify`가 그 키를 지워 "없다가
    // 생김"과 "있다가 없어짐"이 둘 다 안 잡힌다.
    nSamples: settings.nSamples ?? null,
    // 모델과 그 실행 방법을 함께 본다. 알고리즘은 그대로인데 엔진만 바꾼 것도
    // 학생이 한 변경이고, 숫자가 움직이는 가장 흔한 이유다.
    algorithms: settings.selectedAlgorithms.map(
      (selection) => `${selection.algorithm}:${selection.runtime}`,
    ),
    hyperparameters,
  }
}

/** 견줄 수 있는 한 벌. Experiment가 그대로 들어맞는다. */
export interface ComparableSource {
  readonly settings: Experiment['settings']
  readonly runs: readonly Run[]
}

/**
 * 두 실험을 견주기 좋은 모양으로 나란히 편다.
 *
 * **`experiment.changed`의 경로가 이 객체의 경로다.** 그래서 결과 화면이 전후 값을
 * 보여줄 때도 여기서 꺼낸다 (architecture.md 8.13) - 값을 딴 데서 읽으면 경로 규칙이
 * 두 벌이 되고, 하이퍼파라미터를 `알고리즘:실행방법`으로 묶은 것이나 trainIndices를
 * 뺀 것 같은 판단이 **반드시 어긋난다.**
 *
 * 하이퍼파라미터는 **양쪽에 다 있는 (알고리즘, 실행 방법)만** 본다. KNN을 목록에서 빼면
 * 그 하이퍼파라미터도 같이 사라지는데, 둘 다 적으면 학생은 하나를 바꾸고 두 줄을 보게
 * 된다. 목록이 바뀐 것은 `algorithms` 한 줄로 이미 드러난다.
 */
export function comparablePair(
  previous: ComparableSource,
  current: ComparableSource,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const key = (selection: { algorithm: string; runtime: string }): string =>
    `${selection.algorithm}:${selection.runtime}`
  const after = new Set(current.settings.selectedAlgorithms.map(key))
  const shared = new Set(
    previous.settings.selectedAlgorithms.map(key).filter((id) => after.has(id)),
  )

  return {
    before: comparable(previous.settings, previous.runs, shared),
    after: comparable(current.settings, current.runs, shared),
  }
}

/** 직전 실험 대비 바뀐 설정 경로. */
function changedSince(
  previous: Experiment,
  settings: Experiment['settings'],
  runs: readonly Run[],
): string[] {
  const { before, after } = comparablePair(previous, { settings, runs })
  return changedPaths(before, after)
}

/**
 * 실험을 조립한다. **성공도 취소도 이 함수를 부른다** (open-decisions.md "멈추기가 끝난
 * 것을 남긴다" §3).
 *
 * 취소는 워커를 terminate하므로 부분 실험을 **메인 스레드가** 조립한다. 그때 성공 경로와
 * 조립이 갈리면 반드시 어긋나고, **어긋난 쪽이 파일로 나간다.** 그래서 한 곳이다.
 *
 * `runs` 말고는 전부 모델 루프보다 앞에서 확정되므로, 워커는 루프에 들어가기 전에
 * 그것들을 한 번 보내고(`prelude`) 메인 스레드는 쌓인 `runs`를 얹기만 하면 된다.
 */
export function assembleExperiment(input: {
  readonly prelude: ExperimentPrelude
  /** 직전 실험. 없으면 이것이 첫 실험이다. */
  readonly previous: Experiment | undefined
  readonly runs: readonly Run[]
}): Experiment {
  const { prelude, previous, runs } = input
  return {
    id: prelude.id,
    startedAt: prelude.startedAt,
    // 첫 실험에는 직전이 없다. 빈 배열은 "아무것도 안 바꿨다"라는 다른 뜻이 된다.
    ...(previous ? { changed: changedSince(previous, prelude.settings, runs) } : {}),
    settings: prelude.settings,
    runs: [...runs],
  }
}

/** `experiment-3` 같은 id에서 다음 번호. 번호는 프로젝트 전역이다 (mlpx-spec.md 4). */
function nextSequence(prefix: string, ids: Iterable<string>): number {
  let highest = 0
  for (const id of ids) {
    if (!id.startsWith(`${prefix}-`)) continue
    const value = Number.parseInt(id.slice(prefix.length + 1), 10)
    if (Number.isSafeInteger(value) && value > highest) highest = value
  }
  return highest + 1
}

interface TrainContext {
  taskType: TaskType
  trainFeatures: number[][]
  /** trainFeatures[i]의 원본 행 번호. 참조형 모델이 이것을 담는다 (mlpx-spec.md 5.1). */
  trainRowIndices: readonly number[]
  testFeatures: number[][]
  trainTarget: string[]
  testTarget: string[]
  randomState: number
}

/**
 * **갈라 볼 것이 없는 학습인가** (2026-09-03 교실 판단, `errors.ts`의
 * `TARGET_TOO_FEW_CLASSES`).
 *
 * 값이 한 종류인 열을 타깃으로 놓고 분류를 돌리면 **아무도 안 막았고 지금도 안 막는다** —
 * 학습은 실제로 돌고 지표도 나온다. 재 보니 정확도 100% · F1 100% · 혼동 행렬 1×1이었다.
 * **거절하지 않는 이유**는 *"정확도 100%인데 왜 쓸모없을까"*가 그 자체로 좋은 수업
 * 장면이라서다. **그래도 말은 해야 한다** — 교실에서 100%는 성공으로 읽히고, 유일한
 * 단서인 특이도 0%를 학생이 읽어내지 못한다.
 *
 * **엔진이 아니라 여기서 낸다.** 모델의 성질이 아니라 데이터의 성질이라, 엔진마다 넣으면
 * 알고리즘 수만큼 같은 판정이 생기고 새 엔진은 그것을 빠뜨린다.
 *
 * **훈련 몫을 센다. 열 전체가 아니다.** 열이 한 종류면 훈련 몫도 반드시 한 종류라
 * 전처리 화면의 주의(`ml/selection.ts`의 `targetCaution`)가 뜬 경우를 전부 덮고,
 * **분할이 만든 한 종류짜리 훈련 몫**까지 잡는다 — 그건 그 화면이 알 수 없던 것이다.
 *
 * **군집은 묻지 않는다.** 정답이 없는 것이 전제이므로 타깃이 비어 있다.
 *
 * **회귀도 묻지 않는다 — 재고 나서 그렇게 뒀다** (2026-09-03). 상수 타깃은 "갈릴 것이
 * 없다"가 아니라 **분산이 0인 것**이라 할 말이 다르다. 재 보니 그쪽의 문제는 문장이
 * 아니라 **숫자**였다: 완벽히 맞힌 선형회귀가 R² 0.000을 받고 있었다(sklearn은 1.0).
 * 원인은 정규방정식이 남긴 1e-14 먼지였고, sklearn처럼 센터링해서 고쳤다
 * (`ml/engines/mljs.ts`).
 */
function singleClassWarning(context: TrainContext): Warning | undefined {
  if (context.taskType !== 'classification') return undefined
  const classes = new Set(context.trainTarget)
  if (classes.size !== 1) return undefined
  return { code: 'TARGET_TOO_FEW_CLASSES', params: { value: [...classes][0] as string } }
}

type RunBase = Pick<Run, 'id' | 'algorithm' | 'hyperparameters' | 'trainedAt'>

/**
 * 모델 하나를 학습하고 채점한다. **여기서 던지지 않는다** - 무엇이 터지든 failed run이다.
 *
 * ml.js가 내부에서 던지는 것은 우리 어휘가 아니다. 그대로 흘리면 화면이 남의 라이브러리
 * 영어 문장을 보여주게 되므로(CLAUDE.md 1.4와 같은 이유다) JOB_FAILED로 덮는다.
 * **다만 원문을 버리지는 않는다** - failureDetail이 params.detail에 실어 보낸다.
 * 코드를 라이브러리 결함 수만큼 늘리지 않으면서도 "실패"만 뜨는 상태를 피하는 방법이다.
 */
function trainOne(
  base: RunBase,
  runtime: RuntimeSpec,
  engine: TrainingEngine,
  context: TrainContext,
): { run: Run; model?: ModelFile } {
  const stamp = {
    ...base,
    computedBy: runtime.location,
    engine: { kind: engine.engine.kind, version: engine.engine.version },
  }

  try {
    // **눈금 밖 값은 여기서 걸린다.** 화면이 이미 같은 서술로 말했지만 학생은 그대로
    // 학습할 수 있고(막지 않는다), 그때 남아야 하는 것은 "이 모델은 이래서 안 돌았다"다.
    // try 안이라 **이 run 하나만 실패하고 나머지 모델은 계속 돈다** (mlpx-spec.md 4.1).
    assertInRange(engine.parameters(base.algorithm), base.hyperparameters)

    const { predict, model, modelOmittedDetail, warning, clusterResult } = engine.fit(
      base.algorithm,
      {
        features: context.trainFeatures,
        rowIndices: context.trainRowIndices,
        target: context.trainTarget,
        taskType: context.taskType,
        hyperparameters: base.hyperparameters,
        randomState: context.randomState,
      },
    )

    // **군집은 시그니처가 다르다** (architecture.md §3.7). 정답이 없으므로
    // (actual, predicted)를 쓸 수 없고, 훈련 데이터·할당·중심점으로 지표를 낸다.
    // 분류·회귀는 테스트 데이터로 채점하고, 군집은 전체 데이터로 채점한다 (§3.6).
    let evaluation: Evaluation
    if (context.taskType === 'clustering') {
      if (!clusterResult) throw new ClientError('JOB_FAILED', { taskType: 'clustering' })
      evaluation = evaluateCluster(
        context.trainFeatures,
        clusterResult.assignments,
        clusterResult.centroids,
        // 실루엣 표본이 이 씨앗으로 뽑힌다. 분할과 같은 값이라 파일 하나로 재현된다.
        context.randomState,
      )
    } else {
      evaluation = evaluate(context.taskType, context.testTarget, predict(context.testFeatures))
    }

    /**
     * **데이터의 성질이 모델의 성질을 이긴다** (2026-09-03 교실 판단).
     *
     * `Run.warning`이 하나뿐이라 둘이 겹치면 골라야 한다. 타깃이 한 종류면 **그 점수
     * 자체에 뜻이 없으므로**, *"덜 다듬어진 계수에서 나온 숫자다"*보다 먼저 할 말이다.
     * 실제로 겹칠 일은 드물다 - 상수 타깃에서는 대개 곧바로 수렴한다.
     */
    const nothingToLearn = singleClassWarning(context)

    const run: Run = {
      ...stamp,
      status: 'done',
      metrics: evaluation.metrics,
      ...(evaluation.perClass ? { perClass: evaluation.perClass } : {}),
      ...(evaluation.confusionMatrix ? { confusionMatrix: evaluation.confusionMatrix } : {}),
      // **성공한 run에 붙는다** (mlpx-spec.md 5.9). 실패로 뒤집지 않는다 - 지표도 모델도
      // 나왔고, 학생이 알아야 하는 것은 그 숫자가 덜 다듬어진 계수에서 나왔다는 사실이다.
      ...((nothingToLearn ?? warning) ? { warning: nothingToLearn ?? warning } : {}),
      // **모델이 없는 이유를 여기서 적는다.** 저장까지 가야 알 수 있는 사유(예산, 개별
      // 상한)와 달리 이건 학습이 끝난 순간 확정되고, 그래서 저장 전에도 화면이 학생에게
      // 무엇을 할 수 있는지 말할 수 있다 (mlpx-spec.md 4.2).
      // **원문도 함께 남긴다** (mlpx-spec.md 4.2, 5.0.1). 사유 어휘는 학생에게 할 말이고
      // 원문은 교사와 우리가 읽는 단서다 - 직렬화가 터졌는데 아무 기록이 없으면
      // 학생 환경에서 재현할 단서가 0이 된다.
      ...(model ? {} : { modelOmitted: 'engineUnsupported' as const }),
      ...(model === undefined && modelOmittedDetail !== undefined ? { modelOmittedDetail } : {}),
    }
    return model ? { run, model } : { run }
  } catch (error) {
    return {
      run: {
        ...stamp,
        status: 'failed',
        failure: isClientError(error)
          ? { code: error.code, params: error.params }
          : { code: 'JOB_FAILED', params: failureDetail(error) },
      },
    }
  }
}

/**
 * 실험 하나를 실행한다.
 *
 * 분할·전처리가 실패하면 던진다. 개별 알고리즘의 실패는 failed run으로 남고 나머지는
 * 계속 돈다 - **실험 하나가 통째로 실패하는 일은 없다** (mlpx-spec.md 4.1).
 */
export function runExperiment(
  input: ExperimentInput,
  options: ExperimentOptions = {},
): ExperimentResult {
  const { dataset, testDataset, settings, taskType, dataType, context, snapshot } = input
  /**
   * **여기서 읽는 설정은 언제나 표의 모양이다.** 이미지도 임베딩을 열 이름 붙인 표로
   * 바꿔서 들어오므로(open-decisions.md "이미지 학습은 표 문제로 바꿔서 푼다") 이
   * 자리에 종류 분기가 없다. **파일에 남는 것만 갈리고**, 그건 `input.snapshot`이다.
   */
  const data = dataSettings('tabular', settings)
  const now = options.now ?? (() => new Date().toISOString())
  const experiments = options.history?.experiments ?? []
  const { target } = data

  /**
   * **행 고르기·뽑기·분할·전처리기는 `planRun`이 한다** (ml/plan.ts). 전처리 화면의
   * 요약 카드가 같은 함수를 부르므로, 화면이 말하는 숫자와 여기서 학습하는 숫자가
   * 같은 객체에서 나온다 (architecture.md §9.1.3).
   */
  const { split, preprocessor, isClustering } = planRunOrThrow({
    dataset,
    testDataset,
    settings,
    taskType,
  })

  // provided면 testIndices는 dataset이 아니라 testDataset의 행 번호다
  // (mlpx-spec.md §1.1) - trainIndices와 testIndices가 서로 다른 정본을 가리키는
  // 유일한 경우다. 군집화에는 testIndices가 비어 있어 testSource를 쓸 일이 없다.
  const testSource =
    !isClustering && settings.split.method === 'provided' && testDataset ? testDataset : dataset

  const { categoricalEncoding } = data.preprocessing
  const trainContext: TrainContext = {
    taskType,
    trainFeatures: transform(preprocessor, dataset, split.trainIndices, categoricalEncoding),
    trainRowIndices: split.trainIndices,
    // 군집화에는 테스트 데이터가 없다 — testIndices가 빈 배열이므로 빈 행렬이 나온다.
    testFeatures: transform(preprocessor, testSource, split.testIndices, categoricalEncoding),
    // 군집화에는 타깃이 없다 — 빈 배열이 들어가고, 트레이너가 무시한다.
    trainTarget: isClustering ? [] : targetValues(dataset, split.trainIndices, target!),
    testTarget: isClustering ? [] : targetValues(testSource, split.testIndices, target!),
    randomState: settings.split.randomState,
  }

  const available = new Map(
    algorithmOptions({ dataType, taskType }, context, options.algorithms).map((option) => [
      option.algorithm.id,
      option,
    ]),
  )

  const startedAt = now()
  const total = settings.selectedAlgorithms.length
  let sequence = nextSequence(
    'run',
    experiments.flatMap((experiment) => experiment.runs.map((run) => run.id)),
  )

  // **요청을 먼저 확정한다.** 모델마다 덮어쓴 것이 없으면 실험 기본을 따르고, 스냅샷에는
  // 언제나 채워진 값이 들어간다 - 기록을 읽는 쪽이 기본값 규칙을 알아야 한다면
  // 그건 스냅샷이 아니다.
  const requested = settings.selectedAlgorithms.map((selection) => ({
    algorithm: selection.algorithm,
    runtime: selection.runtime ?? settings.runtime,
    // 학생이 이 모델에 대해 직접 고른 것인가. 자동 이동 여부가 여기서 갈린다.
    explicit: selection.runtime !== undefined,
  }))

  /**
   * **모델보다 먼저 확정한다.** 여기 있는 것 중 루프가 정하는 값이 하나도 없으므로
   * 앞으로 끌어올 수 있고, 그래야 취소된 학습도 조립할 재료를 갖는다
   * (open-decisions.md "멈추기가 끝난 것을 남긴다" §3).
   */
  const experimentSettings: Experiment['settings'] = {
    taskType,
    runtime: settings.runtime,
    // explicit은 요청을 만드는 동안만 쓰는 값이라 파일에 남기지 않는다.
    // 스냅샷에는 결과적으로 무엇을 요청했는지만 있으면 된다.
    selectedAlgorithms: requested.map(({ algorithm, runtime }) => ({ algorithm, runtime })),
    // 데이터 종류별 스냅샷 (mlpx-spec.md §4). **부르는 쪽이 지어서 준다** — 정본 참조가
    // 여기 없는 것과 같은 이유이고(실험이 보장하는 것은 같은 데이터·전처리·분할이다),
    // 이미지는 계산에 쓴 표가 아니라 범주와 백본이 기록이다.
    data: snapshot,
    split: settings.split,
    // 선택 항목이다 - 안 뽑은 실험에는 아예 없다 (schema.ts). undefined를 그대로 넣으면
    // 그 키가 파일에 `null`로 남거나 사라지는 것이 직렬화에 달리게 된다.
    ...(settings.nSamples === undefined ? {} : { nSamples: settings.nSamples }),
    // **사본을 남긴다.** 계획이 들고 있는 배열을 그대로 넣으면 파일에 적힌 것과
    // 도는 것이 같은 객체가 된다.
    trainIndices: [...split.trainIndices],
    testIndices: [...split.testIndices],
  }

  const previous = experiments[experiments.length - 1]

  const prelude: ExperimentPrelude = {
    id: `experiment-${nextSequence(
      'experiment',
      experiments.map((experiment) => experiment.id),
    )}`,
    startedAt,
    settings: experimentSettings,
    preprocessor,
  }

  // **루프 앞이다.** 끝을 못 보는 경로가 이것을 재료로 쓴다.
  options.onPrelude?.(prelude)

  const runs: Run[] = []
  const models = new Map<string, ModelFile>()
  for (const [index, { algorithm, runtime: wanted, explicit }] of requested.entries()) {
    const option = available.get(algorithm)
    const runtime = option ? chooseRuntime(option, wanted, explicit) : undefined
    const engine = runtime ? engineFor(runtime.id) : undefined

    // **실행 방법이 정해진 뒤에 시작을 알린다.** 자동으로 넘어갔으면 넘어간 쪽을 말해야
    // 한다 - 화면이 "지금 무엇이 도는가"를 말하는 자리에서 틀리면 안 된다. 못 도는
    // 조합이면 학생이 고른 쪽을 말한다(그 run은 곧 실패로 끝난다).
    options.onRunStart?.({ index, algorithm, runtime: runtime?.id ?? wanted }, total)

    // **실행 방법이 정해진 뒤에 하이퍼파라미터를 읽는다.** 어휘가 실행 방법마다 다르므로
    // (ml.js maxDepth / sklearn max_depth) 어느 것으로 돌지 모르면 무엇을 먹일지도 모른다.
    // 자동으로 넘어갔으면 넘어간 쪽의 값을 쓰고, 아예 못 돌면 학생이 고른 쪽의 값을
    // 기록한다 - 실패한 run에도 "무엇을 시도했는지"는 남아야 한다.
    const given = settings.hyperparameters[algorithm]?.[runtime?.id ?? wanted] ?? {}

    // **확정은 학습보다 앞이다** (mlpx-spec.md 3). 여기서 채워 두면 fit이 무엇을 하든
    // run은 이미 완전한 값을 들고 있다 - 성공한 run만 기본값을 갖는 상태를 만들지 않는다.
    // 학생이 안 건드린 결정트리가 깊이 몇으로 돌았는지를 교사가 파일만 보고 답할 수 있어야
    // 한다. 엔진이 없으면 확정할 주체가 없다 - 아무것도 안 먹였으므로 준 값 그대로다.
    const base: RunBase = {
      id: `run-${sequence}`,
      algorithm,
      hyperparameters: engine ? engine.resolve(algorithm, given) : given,
      trainedAt: now(),
    }
    sequence += 1

    // 아무것도 안 돌았으면 computedBy는 여전히 browser다. 우리가 브라우저이기 때문이고,
    // 이 자리에 server를 적으면 서버가 거절한 것처럼 읽힌다.
    if (!option) {
      // 등록부에 없는 알고리즘이다. 남의 파일에 든 것을 다시 돌리려 할 때 나온다.
      runs.push({
        ...base,
        computedBy: 'browser',
        status: 'failed',
        failure: { code: 'ALGORITHM_UNSUPPORTED', params: { algorithm } },
      })
    } else if (!runtime || !engine) {
      const { reason, maxRows } = unavailable(option, wanted)
      runs.push({
        ...base,
        computedBy: 'browser',
        status: 'failed',
        // 상한은 (알고리즘 × 구현)마다 다르다. 전역을 그대로 쓰면 SVM이 3000행에서
        // 꺼지는데 실패한 run에는 5000이라고 적힌다.
        failure: { code: reason, params: reasonParams(reason, maxRows) },
      })
    } else {
      const trained = trainOne(base, runtime, engine, trainContext)
      runs.push(trained.run)
      if (trained.model) models.set(trained.run.id, trained.model)
    }

    const finished = runs[runs.length - 1]
    if (finished) {
      options.onRun?.(finished, runs.length, total, index, models.get(finished.id))
    }
  }

  return {
    experiment: assembleExperiment({ prelude, previous, runs }),
    preprocessor,
    models,
  }
}
