/**
 * 지금 고른 것이 성립하는가 - 타깃·특성·모델 선택의 판정.
 *
 * **전처리 화면과 학습이 같은 함수를 본다.** 화면이 따로 판정하면 "화면은 멀쩡한데
 * [학습]을 누르니 거부한다"가 생기고, 그건 학생이 고칠 자리를 못 찾는 고장이다
 * (router/steps.ts가 체크리스트와 잠금을 한 파일에 둔 것과 같은 이유다).
 *
 * **두 종류를 가른다.**
 *
 * - **issue** - 학습이 실제로 거부한다. 코드가 곧 에러 코드다.
 * - **caution** - 화면만 하는 말이다. 도구는 그대로 학습한다.
 *
 * 섞으면 안 된다. 학습이 안 막는 것을 에러처럼 보여주면 도구가 거짓말을 하고,
 * 학습이 막는 것을 주의로 보여주면 학생이 [학습]에서 처음 알게 된다.
 *
 * **여기서 엔진을 부르지 않는다.** 이 파일은 화면이 import하므로, 엔진(ml-cart 등)을
 * 끌어오면 학습 라이브러리가 첫 화면 번들에 들어간다. 워커로 미뤄 둔 것이 되돌아온다.
 */

import type { ColumnSummary } from '../data/columns'
import type { Preprocessing, TaskType } from '../project/schema'
import { ALGORITHMS, type Algorithm, type AlgorithmOption } from './algorithms'
import type { UnavailableReason } from './backend'
import type { ColumnKind } from './preprocess'

/**
 * 과제 유형이 타깃 열에 요구하는 자료형. **없으면 요구가 없다.**
 *
 * **과제 유형을 자동 판정하는 표가 아니다** (mlpx-spec.md 0.1). 학생이 고른 것을 다른
 * 것으로 바꾸지 않고, 그 선택으로는 답이 나오지 않는 조합만 거부한다. 분류에는 요구가
 * 없다 - 3과 "3"을 가르지 않고 라벨로 다루므로 어느 자료형이든 성립한다.
 *
 * 거부하지 않으면 어떻게 되는지가 이 표가 있는 이유다. 회귀 + `'상'/'중'/'하'`는
 * `Number('상')`이 NaN이라 지표가 통째로 NaN인 채 run이 **done으로 끝나고**, 저장할 때
 * JSON이 그 NaN을 null로 바꿔 **다시 열리지 않는 .mlpx**가 된다. 교실에서 아주 자연스러운
 * 실수다 - 성적 등급을 타깃으로 회귀를 고르는 것.
 *
 * `if (taskType === 'regression')`을 쓰지 않는 이유는 ml/metrics.ts와 같다. 군집이
 * 들어오면 여기에 줄이 하나 늘거나 안 늘 뿐이고, 부르는 쪽은 그대로다.
 */
const TARGET_KIND_REQUIRED: Partial<
  Record<TaskType, { kind: ColumnKind; code: 'TARGET_NOT_NUMERIC' }>
> = {
  regression: { kind: 'numeric', code: 'TARGET_NOT_NUMERIC' },
}

/**
 * 유형을 아직 안 골랐으면 **요구도 없다** - 무엇을 하려는지 모르는 채로 열을 거부할
 * 근거가 없다 (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
 */
export function requiredTargetKind(
  taskType?: TaskType | undefined,
): { kind: ColumnKind; code: 'TARGET_NOT_NUMERIC' } | undefined {
  return taskType === undefined ? undefined : TARGET_KIND_REQUIRED[taskType]
}

export type ColumnRole = 'target' | 'feature' | 'unused'

/** 이 열을 타깃으로 두면 학습이 거부한다. */
export type TargetIssue = 'TARGET_NOT_NUMERIC'
/** 학습은 그대로 되지만 학생이 알아야 하는 것. */
export type TargetCaution = 'singleValue'
/**
 * 이 열을 고르면 학습이 거부한다.
 *
 * - `FEATURE_ALL_MISSING` - 값이 통째로 비었다. 어떤 전략으로도 못 쓴다.
 * - `FEATURE_HAS_MISSING` - 빈 칸이 있는데 "그대로 두기"를 골랐다. 전략을 바꾸면 풀린다.
 */
export type FeatureIssue = 'FEATURE_ALL_MISSING' | 'FEATURE_HAS_MISSING'
/** 학습은 되지만 이 열이 빠진다. ml/preprocess.ts의 excludedColumns와 같은 어휘다. */
export type FeatureNote = 'notEncodable'

export interface ColumnChoice {
  readonly summary: ColumnSummary
  readonly role: ColumnRole
  readonly targetIssue?: TargetIssue
  readonly targetCaution?: TargetCaution
  readonly featureIssue?: FeatureIssue
  readonly featureNote?: FeatureNote
}

export interface ColumnPlanInput {
  readonly columns: readonly ColumnSummary[]
  readonly rowCount: number
  /** 아직 안 골랐으면 없다. 그때는 어떤 열도 타깃 자격을 잃지 않는다. */
  readonly taskType?: TaskType | undefined
  readonly target: string | undefined
  readonly features: readonly string[]
  readonly preprocessing: Preprocessing
}

export interface ColumnPlan {
  readonly columns: readonly ColumnChoice[]
  /**
   * 실제로 행렬에 들어갈 특성의 수. **고른 수와 다를 수 있다** - 인코딩이 꺼져 있으면
   * 문자 열이 빠진다. 0이면 fitPreprocessor가 FEATURE_NOT_SELECTED로 던진다.
   */
  readonly usableFeatures: number
}

/**
 * 열마다 지금 무엇으로 쓰이는지와 무엇이 걸리는지.
 *
 * **타깃과 특성을 한 번에 본다.** 화면이 둘을 같은 표에서 고르게 하므로
 * (architecture.md 8.9) 판정도 한 번에 나와야 줄마다 다시 계산하지 않는다.
 */
export function columnPlan(input: ColumnPlanInput): ColumnPlan {
  const chosen = new Set(input.features)
  const required = requiredTargetKind(input.taskType)
  const encodes = input.preprocessing.categoricalEncoding !== 'none'

  let usableFeatures = 0
  const columns = input.columns.map((summary): ColumnChoice => {
    const role: ColumnRole =
      summary.name === input.target ? 'target' : chosen.has(summary.name) ? 'feature' : 'unused'

    // 값이 전부 비었으면 전처리가 던진다. 학습셋만 비어도 던지지만 그건 분할을 해 봐야
    // 알고, 열 전체가 빈 것은 지금 알 수 있다 - 알 수 있는 것을 나중으로 미루지 않는다.
    //
    // "그대로 두기"는 빈 칸이 하나만 있어도 거부한다 - 빈 칸을 그대로 모델에 넣을
    // 방법이 없어서다 (open-decisions.md "전처리도 분할도 끌 수 있다").
    const featureIssue =
      summary.missing === input.rowCount
        ? ('FEATURE_ALL_MISSING' as const)
        : summary.missing > 0 && input.preprocessing.missing === 'none'
          ? ('FEATURE_HAS_MISSING' as const)
          : null
    // 문자 열을 그대로 모델에 넣을 수는 없다. 인코딩이 꺼져 있으면 학습에서 빠진다.
    const featureNote =
      featureIssue === null && summary.kind === 'categorical' && !encodes
        ? ('notEncodable' as const)
        : null

    if (role === 'feature' && featureIssue === null && featureNote === null) usableFeatures += 1

    return {
      summary,
      role,
      ...(required && summary.kind !== required.kind ? { targetIssue: required.code } : {}),
      // 예측할 것이 없는 열이다. 학습은 되고 지표도 나오지만 아무것도 배우지 않는다.
      ...(summary.unique <= 1 ? { targetCaution: 'singleValue' as const } : {}),
      ...(featureIssue ? { featureIssue } : {}),
      ...(featureNote ? { featureNote } : {}),
    }
  })

  return { columns, usableFeatures }
}

/** 축의 칸 하나. **꺼진 칸도 목록에 남고 왜 꺼졌는지를 함께 든다** (architecture.md 8.12). */
export interface AxisChoice {
  readonly id: string
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. 화면이 t()에 넣어 한 줄로 보여준다. */
  readonly reason?: UnavailableReason
}

/**
 * 지금 걸린 쌍을 담을 수 없는 이유.
 *
 * `alreadyAdded`만 성질이 다르다 - 학습이 거부하는 것이 아니라 **같은 쌍을 두 줄 담아 봐야
 * 하이퍼파라미터가 공유되어 똑같은 줄이 둘 생기기 때문**이다
 * (open-decisions.md "실행 방법은 하나의 목록이다").
 */
export type AddBlocked = UnavailableReason | 'alreadyAdded'

export interface ModelAxes {
  /** 모델 축. 목록 순서는 등록부 그대로다. */
  readonly algorithms: readonly AxisChoice[]
  /** 실행 방법 축. **지금 걸린 모델 기준이다** - 모델마다 지원하는 것이 다르다. */
  readonly runtimes: readonly AxisChoice[]
  /** null이면 담을 수 있다. */
  readonly blocked: AddBlocked | null
}

/**
 * 담긴 줄 하나. **실행 방법이 언제나 채워져 있다** — 화면이 쌍으로 담기 때문이다.
 * 파일에서는 선택 항목이라(`{algorithm}`만 있는 줄이 정상이다) 화면이 실험 기본을 끌어와
 * 채운다. 실제 학습도 같은 규칙으로 정한다 (`ml/experiment.ts`).
 */
export interface ChosenModel {
  readonly algorithm: string
  readonly runtime: string
}

export interface ModelAxesInput {
  /** algorithmOptions의 결과. 데이터 종류와 과제 유형은 여기서 이미 반영됐다. */
  readonly options: readonly AlgorithmOption[]
  /** 지금 걸린 모델. */
  readonly algorithm: string
  /** 지금 걸린 실행 방법. */
  readonly runtime: string
  /** 이미 담은 쌍들. */
  readonly chosen: readonly ChosenModel[]
}

/**
 * 학습 화면의 세 축이 서로를 좁힌 결과.
 *
 * **판정을 새로 하지 않는다.** algorithmOptions와 runtimeOptions가 이미 낸 값을 축의
 * 모양으로 바꿔 놓을 뿐이다. 축마다 따로 판정하면 세 벌이 되고 반드시 어긋난다.
 *
 * 유형 축은 여기 없다. 무엇도 그것을 좁히지 않기 때문이다 - 알고리즘이 하나도 없는
 * 유형은 supportedTaskTypes가 애초에 목록에서 뺀다.
 *
 * **지키는 불변식이 하나 있다 - 담을 수 없으면 그 칸이 꺼져 있다.** 그래서 blocked를
 * 모델 축의 칸에서 그대로 읽는다. 두 곳에서 따로 판정하면 "카드는 멀쩡한데 [추가]가
 * 꺼져 있다"가 생기고, 학생은 무엇을 고쳐야 하는지 알 수 없다.
 */
export function modelAxes(input: ModelAxesInput): ModelAxes {
  const algorithms = input.options.map((option): AxisChoice => {
    const id = option.algorithm.id
    // 데이터 종류·과제 유형에서 이미 걸린 것. 더 근본적인 사유가 먼저다 (mlpx-spec.md 0.1).
    if (!option.enabled)
      return { id, enabled: false, ...(option.reason ? { reason: option.reason } : {}) }

    // **지금 걸린 실행 방법에서 도는가.** 이것이 축이 서로를 좁힌다는 말의 실체다 -
    // 순수 JS를 고르면 서포트 벡터 머신이 여기서 꺼진다.
    const here = option.runtimes.find((one) => one.runtime.id === input.runtime)
    if (here && !here.enabled)
      return { id, enabled: false, ...(here.reason ? { reason: here.reason } : {}) }

    return { id, enabled: true }
  })

  const drafted = input.options.find((option) => option.algorithm.id === input.algorithm)
  const runtimes = (drafted?.runtimes ?? []).map((one): AxisChoice => ({
    id: one.runtime.id,
    enabled: one.enabled,
    ...(one.reason ? { reason: one.reason } : {}),
  }))

  const choice = algorithms.find((one) => one.id === input.algorithm)
  const already = input.chosen.some(
    (one) => one.algorithm === input.algorithm && one.runtime === input.runtime,
  )

  // 카드가 아예 없는 경우는 등록부에 없는 알고리즘이 걸린 것이다. 화면은 목록에서만
  // 고르므로 정상 경로에서는 나오지 않지만, 나온다면 담을 수 없는 것이 맞다.
  const blocked: AddBlocked | null = !choice
    ? 'ALGORITHM_NOT_AVAILABLE_HERE'
    : !choice.enabled
      ? (choice.reason ?? 'ALGORITHM_NOT_AVAILABLE_HERE')
      : already
        ? 'alreadyAdded'
        : null

  return { algorithms, runtimes, blocked }
}

/**
 * 이 과제 유형에서 뜻을 잃는 모델들.
 *
 * **실행 위치는 보지 않는다.** 서버가 꺼져 있다고 SVM 선택을 지우면, 학생이 서버가
 * 켜진 다음 시간에 돌아왔을 때 골라 둔 것이 사라져 있다. 여기서 지우는 것은 과제 유형이
 * 바뀌면서 **의미가 없어진 것**뿐이다 - 분류에서 고른 선형 회귀 같은 것.
 *
 * **등록부에 없는 알고리즘은 남긴다.** 남의 파일에서 온 것이고, 우리가 모른다는 이유로
 * 지우면 그 파일을 열었다 저장한 학생이 조용히 잃는다 (mlpx-spec.md 5.2).
 */
export function algorithmsLosingMeaning(
  selected: readonly { algorithm: string }[],
  taskType: TaskType,
  algorithms: readonly Algorithm[] = ALGORITHMS,
): string[] {
  const known = new Map(algorithms.map((algorithm) => [algorithm.id, algorithm]))
  return selected
    .map((selection) => selection.algorithm)
    .filter((id) => {
      const algorithm = known.get(id)
      return algorithm !== undefined && !algorithm.taskTypes.includes(taskType)
    })
}
