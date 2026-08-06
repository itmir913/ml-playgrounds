/**
 * 실험 실행 - 조각들을 엮어 `runs.json`의 실험 하나를 만든다.
 *
 * [학습]을 한 번 누르면 실험 하나가 생기고, 고른 모델 수만큼 run이 들어간다.
 * **같은 실험은 같은 데이터·전처리·분할을 쓰므로 공정한 비교가 구조적으로 보장된다**
 * (mlpx-spec.md 4). 그래서 전처리기는 실험당 한 번만 학습하고 전체가 공유한다.
 *
 * ```
 * usableRows -> holdoutSplit -> fitPreprocessor -> transform -> fit -> predict -> evaluate
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
import type { Experiment, DataType, Run, RunsFile, Settings, TaskType } from '../project/schema'
import { algorithmOptions, type AlgorithmOption } from './algorithms'
import {
  reasonParams,
  type RuntimeContext,
  type RuntimeSpec,
  type UnavailableReason,
} from './backend'
import { engineFor, type TrainingEngine } from './engines'
import { assertInRange } from './hyperparams'
import { evaluate } from './metrics'
import type { ModelFile } from './models'
import {
  detectKind,
  fitPreprocessor,
  missingColumns,
  targetValues,
  transform,
  usableRows,
  type Dataset,
  type Preprocessor,
} from './preprocess'
// 전처리 화면이 [학습] 전에 같은 판정을 한다. 표가 두 벌이면 화면과 학습이 갈린다.
import { requiredTargetKind } from './selection'
import { splitRows } from './split'

export interface ExperimentInput {
  /** 정본 CSV를 읽은 표. 헤더는 rows에 없다 - 행 번호가 곧 분할 인덱스다. */
  dataset: Dataset
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
}

export interface ExperimentOptions {
  /**
   * 지금까지의 runs.json. id 일련번호와 changed 계산이 여기서 나온다.
   * 없으면 첫 실험이다.
   */
  history?: RunsFile
  /** 시각. 테스트가 결정적이려면 주입할 수 있어야 한다. */
  now?: () => string
  /** 모델 하나가 끝날 때마다. 워커 껍데기가 이걸 postMessage로 바꾼다. */
  onRun?: (run: Run, completed: number, total: number) => void
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
   * run id -> 우리 형식으로 담은 모델. **전처리기와 같은 이유로 따로 돌려준다.**
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
 * 못 돌면 되는 곳으로 넘어가지만(open-decisions.md "실행 방법은 하나의 목록이다"),
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
    features: settings.features,
    target: settings.target ?? null,
    preprocessing: settings.preprocessing,
    split: settings.split,
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

    const { predict, model, modelOmittedDetail, warning } = engine.fit(base.algorithm, {
      features: context.trainFeatures,
      rowIndices: context.trainRowIndices,
      target: context.trainTarget,
      hyperparameters: base.hyperparameters,
      randomState: context.randomState,
    })
    const evaluation = evaluate(context.taskType, context.testTarget, predict(context.testFeatures))

    const run: Run = {
      ...stamp,
      status: 'done',
      metrics: evaluation.metrics,
      ...(evaluation.perClass ? { perClass: evaluation.perClass } : {}),
      ...(evaluation.confusionMatrix ? { confusionMatrix: evaluation.confusionMatrix } : {}),
      // **성공한 run에 붙는다** (mlpx-spec.md 5.9). 실패로 뒤집지 않는다 - 지표도 모델도
      // 나왔고, 학생이 알아야 하는 것은 그 숫자가 덜 다듬어진 계수에서 나왔다는 사실이다.
      ...(warning ? { warning } : {}),
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
  const { dataset, settings, taskType, dataType, context } = input
  const now = options.now ?? (() => new Date().toISOString())
  const experiments = options.history?.experiments ?? []
  const { target } = settings

  // 군집화에는 타깃이 없지만 군집 알고리즘도 아직 없다. 여기 오는 것은 분류·회귀뿐이고
  // 둘 다 정답 열이 있어야 학습도 채점도 된다.
  if (target === undefined || target === '') throw new ClientError('TARGET_NOT_SELECTED')

  const rows = usableRows(dataset, settings.features, target, settings.preprocessing.missing)
  const labels = targetValues(dataset, rows, target)

  // **성립하지 않는 조합은 분할보다 먼저 거부한다.** 여기서 넘기면 지표가 NaN인 채로
  // run이 done으로 끝나고, 그 파일은 저장은 되는데 다시 열리지 않는다.
  const required = requiredTargetKind(taskType)
  if (required && detectKind(labels) !== required.kind) {
    throw new ClientError(required.code, { target })
  }

  // **"아무것도 안 함"은 빈 칸이 있으면 거부한다.** 조용히 두는 길이 없어서다 - 수치
  // 열의 빈 칸은 결국 0이 되고, 그러면 그 이름으로 0 채우기를 하는 셈이 된다
  // (open-decisions.md "전처리도 분할도 끌 수 있다"). 학습셋이 아니라 **전체**를 본다.
  if (settings.preprocessing.missing === 'none') {
    const blank = missingColumns(dataset, [...settings.features, target])[0]
    if (blank)
      throw new ClientError('FEATURE_HAS_MISSING', { feature: blank.name, count: blank.count })
  }

  // 층화하지 않으면 라벨은 쓰이지 않는다. 회귀에 층화를 켠 설정은 여기서 시끄럽게
  // 실패한다 - 조용히 층화를 끄지 않는다는 ml/split.ts의 규칙과 같다.
  const split = splitRows({ rows, labels }, settings.split)

  const preprocessor = fitPreprocessor(
    dataset,
    split.trainIndices,
    settings.features,
    settings.preprocessing,
  )

  const { categoricalEncoding } = settings.preprocessing
  const trainContext: TrainContext = {
    taskType,
    trainFeatures: transform(preprocessor, dataset, split.trainIndices, categoricalEncoding),
    trainRowIndices: split.trainIndices,
    testFeatures: transform(preprocessor, dataset, split.testIndices, categoricalEncoding),
    trainTarget: targetValues(dataset, split.trainIndices, target),
    testTarget: targetValues(dataset, split.testIndices, target),
    randomState: settings.split.randomState,
  }

  const available = new Map(
    algorithmOptions({ dataType, taskType }, context).map((option) => [
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

  const runs: Run[] = []
  const models = new Map<string, ModelFile>()
  for (const { algorithm, runtime: wanted, explicit } of requested) {
    const option = available.get(algorithm)
    const runtime = option ? chooseRuntime(option, wanted, explicit) : undefined
    const engine = runtime ? engineFor(runtime.id) : undefined

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
      const reason = unavailableReason(option, wanted)
      runs.push({
        ...base,
        computedBy: 'browser',
        status: 'failed',
        // 상한은 알고리즘마다 다르다. 전역을 그대로 쓰면 SVM이 3000행에서 꺼지는데
        // 실패한 run에는 5000이라고 적힌다.
        failure: { code: reason, params: reasonParams(reason, option.algorithm.maxRows) },
      })
    } else {
      const trained = trainOne(base, runtime, engine, trainContext)
      runs.push(trained.run)
      if (trained.model) models.set(trained.run.id, trained.model)
    }

    const finished = runs[runs.length - 1]
    if (finished) options.onRun?.(finished, runs.length, total)
  }

  const experimentSettings: Experiment['settings'] = {
    taskType,
    runtime: settings.runtime,
    // explicit은 요청을 만드는 동안만 쓰는 값이라 파일에 남기지 않는다.
    // 스냅샷에는 결과적으로 무엇을 요청했는지만 있으면 된다.
    selectedAlgorithms: requested.map(({ algorithm, runtime }) => ({ algorithm, runtime })),
    features: settings.features,
    target,
    preprocessing: settings.preprocessing,
    split: settings.split,
    trainIndices: split.trainIndices,
    testIndices: split.testIndices,
  }

  const previous = experiments[experiments.length - 1]

  return {
    experiment: {
      id: `experiment-${nextSequence(
        'experiment',
        experiments.map((experiment) => experiment.id),
      )}`,
      startedAt,
      // 첫 실험에는 직전이 없다. 빈 배열은 "아무것도 안 바꿨다"라는 다른 뜻이 된다.
      ...(previous ? { changed: changedSince(previous, experimentSettings, runs) } : {}),
      settings: experimentSettings,
      runs,
    },
    preprocessor,
    models,
  }
}
