/**
 * 지금 고른 것이 성립하는가 - 타깃·특성·모델 선택의 판정.
 *
 * **전처리 화면과 학습이 같은 함수를 본다.** 화면이 따로 판정하면 "화면은 멀쩡한데
 * [학습하기]를 누르니 거부한다"가 생기고, 그건 학생이 고칠 자리를 못 찾는 고장이다
 * (router/steps.ts가 체크리스트와 잠금을 한 파일에 둔 것과 같은 이유다).
 *
 * **두 종류를 가른다.**
 *
 * - **issue** - 학습이 실제로 거부한다. 코드가 곧 에러 코드다.
 * - **caution** - 화면만 하는 말이다. 도구는 그대로 학습한다.
 *
 * 섞으면 안 된다. 학습이 안 막는 것을 에러처럼 보여주면 도구가 거짓말을 하고,
 * 학습이 막는 것을 주의로 보여주면 학생이 [학습하기]에서 처음 알게 된다.
 *
 * **여기서 엔진을 부르지 않는다.** 이 파일은 화면이 import하므로, 엔진(ml-cart 등)을
 * 끌어오면 학습 라이브러리가 첫 화면 번들에 들어간다. 워커로 미뤄 둔 것이 되돌아온다.
 */

import type { ColumnSummary } from '../data/columns'
import { MIN_SPLIT_ROWS } from '../limits'
import type { Preprocessing, Split, TaskType } from '../project/schema'
import { ALGORITHMS, type Algorithm, type AlgorithmOption } from './algorithms'
import { supports } from './axes'
import type { UnavailableReason } from './backend'
import { targetValues, usableRows, type Dataset } from './preprocess'
import { testCountFor } from './split'
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
/**
 * 학습은 되지만 이 열이 빠진다. ml/preprocess.ts의 excludedColumns와 같은 어휘다.
 *
 * **배열이 먼저다.** 화면이 이 값으로 문구 키를 조립하므로(`preprocess.tabular.${note}`)
 * 값 목록이 실행 중에도 있어야 로케일과 짝지어 검사할 수 있다 — 타입만 두면 그 짝을
 * 아무것도 안 본다. **실제로 그래서 한 번 깨졌다** (2026-08-12): 키를 종류 아래로
 * 옮겼는데 부르는 쪽은 옛 이름 그대로였고, CI는 전부 초록이었다.
 */
export const FEATURE_NOTES = ['notEncodable'] as const
export type FeatureNote = (typeof FEATURE_NOTES)[number]

export interface ColumnChoice {
  readonly summary: ColumnSummary
  readonly role: ColumnRole
  /**
   * 특성 목록에 들어 있는가. **역할과 다를 수 있다** — 특성으로 골라 둔 열을 타깃으로 고르면
   * 역할은 `target`인데 목록에는 남는다(`open-decisions.md` 55). 화면의 특성 칸은 이 값으로
   * **켜진 채 잠겨** 보인다 — 역할로 그리면 꺼진 것처럼 보이고, 학생은 타깃을 옮기면 그 열이
   * 특성으로 돌아온다는 것을 모른다.
   */
  readonly featureChosen: boolean
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
   * 이 유형이 타깃을 쓰는가. **화면이 타깃 칸을 그릴지 말지가 이 값이다**
   * (`architecture.md` §8.9).
   *
   * **판정을 여기 실어 보내는 이유는 화면이 과제 유형을 직접 비교하지 않게 하려는
   * 것이다** (`CLAUDE.md` §2). 표는 이미 이 계획을 받고 있으므로 프롭이 늘지 않는다.
   */
  readonly usesTarget: boolean
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
  /**
   * **군집화에서는 저장된 타깃이 어떤 열도 타깃으로 만들지 않는다.** 이름만 비교하던
   * 때에는 그 열의 특성 체크박스가 계속 잠겨 있었다 (`architecture.md` §8.9).
   * 값 자체는 안 지운다 — 분류로 되돌리면 그대로 돌아와야 한다.
   */
  const wantsTarget = usesTarget(input.taskType)

  let usableFeatures = 0
  const columns = input.columns.map((summary): ColumnChoice => {
    const role: ColumnRole =
      wantsTarget && summary.name === input.target
        ? 'target'
        : chosen.has(summary.name)
          ? 'feature'
          : 'unused'

    // 값이 전부 비었으면 전처리가 던진다. 훈련 데이터만 비어도 던지지만 그건 분할을 해 봐야
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
      featureChosen: chosen.has(summary.name),
      ...(required && summary.kind !== required.kind ? { targetIssue: required.code } : {}),
      // 예측할 것이 없는 열이다. 학습은 되고 지표도 나오지만 아무것도 배우지 않는다.
      ...(summary.unique <= 1 ? { targetCaution: 'singleValue' as const } : {}),
      ...(featureIssue ? { featureIssue } : {}),
      ...(featureNote ? { featureNote } : {}),
    }
  })

  return { columns, usableFeatures, usesTarget: wantsTarget }
}

/**
 * 그 줄에 적을 사유. **순서가 곧 우선순위다** — 위엣것이 이긴다.
 *
 * **문구가 아니라 키를 돌려준다.** 이 층은 `t()`를 모른다 (`CLAUDE.md` §1.4).
 *
 * **화면에 두었을 때 이 넷의 순서를 통째로 뒤집어도 저장소가 조용했다**
 * (R14-4 감사 A-4). 그때 값이 한 종류뿐이면서 수치가 아닌 열을 회귀 타깃으로 고르면
 * `TARGET_NOT_NUMERIC`(학습이 거부한다) 대신 `값이 한 종류입니다`(주의)가 뜬다 —
 * **학생이 읽는 것이 고쳐야 할 것이 아니라 안 고쳐도 되는 것이 된다.**
 */
export function columnNote(
  column: ColumnChoice,
): { key: string; param?: 'feature' | 'target' } | null {
  if (column.featureIssue !== undefined) {
    return { key: `errors.${column.featureIssue}`, param: 'feature' }
  }
  if (column.role === 'target' && column.targetIssue !== undefined) {
    return { key: `errors.${column.targetIssue}`, param: 'target' }
  }
  if (column.role === 'feature' && column.featureNote !== undefined) {
    return { key: `preprocess.tabular.${column.featureNote}` }
  }
  if (column.role === 'target' && column.targetCaution !== undefined) {
    return { key: 'preprocess.tabular.targetSingleValue' }
  }
  return null
}

/**
 * 그 줄이 **학습이 거부하는 것**을 말하고 있는가. 화면은 이때만 빨강을 쓴다.
 *
 * **`columnNote`가 고른 것과 같은 조건이어야 한다** — 색이 문장보다 넓게 잡히면
 * 회색으로 말할 것을 빨강으로 말한다. `columnPlan`은 `targetIssue`를 역할과 무관하게
 * 모든 열에 채우므로 역할을 안 거르면 **안 고른 열이 빨개진다** (R14-4 감사 A-4).
 */
export function columnBlocks(column: ColumnChoice): boolean {
  const issue =
    column.featureIssue !== undefined ||
    (column.role === 'target' && column.targetIssue !== undefined)
  return issue && column.role !== 'unused'
}

/**
 * 특성 체크박스를 잠글 열인가.
 *
 * 타깃을 거르는 것이 여기 있어야 **눌러도 아무 일도 안 일어나는 체크박스**가 안 생긴다.
 * 잠겨도 켜 둔 값은 목록에 남고 학습 계획이 타깃을 뺀다(`open-decisions.md` 55) —
 * `withFeatures`는 더 거르지 않는다.
 */
export function featureLocked(column: ColumnChoice): boolean {
  return column.role === 'target' || column.featureIssue !== undefined
}

/** 축의 칸 하나. **꺼진 칸도 목록에 남고 왜 꺼졌는지를 함께 든다** (architecture.md 8.12). */
export interface AxisChoice {
  readonly id: string
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. 화면이 t()에 넣어 한 줄로 보여준다. */
  readonly reason?: UnavailableReason
  /**
   * 사유 문장이 쓸 행 상한. **사유와 같은 칸에서 함께 온다** (ml/backend.ts).
   *
   * 화면이 알고리즘 id로 등록부를 되짚어 상한을 고르던 자리가 여기다. 상한이
   * (알고리즘 × 구현)마다 다르므로 id 하나로는 애초에 고를 수 없다.
   */
  readonly maxRows?: number
  /**
   * 이걸 쓰려면 무엇이 드는가 (`ml/backend.ts`의 `RuntimeSpec.preparation`).
   *
   * **꺼진 칸이 아니라 켜진 칸에 붙는다.** 무거운 엔진을 잠그지 않기로 했으므로
   * (`open-decisions.md` "scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다")
   * 학생이 **고르기 전에** 무엇이 드는지 알아야 한다. 사유가 *"왜 못 쓰나"*라면
   * 이것은 *"쓰면 무엇이 드나"*다.
   *
   * **실행 방법 축에만 있다.** 모델 축은 같은 알고리즘이 실행 방법마다 다른 비용을
   * 갖는데, 그 축에서는 어느 실행 방법인지가 안 정해져 있다.
   */
  readonly preparation?: { readonly bytes: number; readonly ms: number }
}

/**
 * 지금 걸린 쌍을 담을 수 없는 이유.
 *
 * `alreadyAdded`만 성질이 다르다 - 학습이 거부하는 것이 아니라 **같은 쌍을 두 줄 담아 봐야
 * 하이퍼파라미터가 공유되어 똑같은 줄이 둘 생기기 때문**이다
 * (open-decisions.md "실행 방법은 (위치 × 엔진)이 아니라 하나의 목록이다").
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
 * 모델 축의 칸에서 그대로 읽는다. 두 곳에서 따로 판정하면 "카드는 멀쩡한데 [담기]가
 * 꺼져 있다"가 생기고, 학생은 무엇을 고쳐야 하는지 알 수 없다.
 */
export function modelAxes(input: ModelAxesInput): ModelAxes {
  const algorithms = input.options.map((option): AxisChoice => {
    const id = option.algorithm.id
    // 데이터 종류·과제 유형에서 이미 걸린 것. 더 근본적인 사유가 먼저다 (mlpx-spec.md 0.1).
    if (!option.enabled)
      return {
        id,
        enabled: false,
        ...(option.reason ? { reason: option.reason } : {}),
        ...(option.maxRows === undefined ? {} : { maxRows: option.maxRows }),
      }

    // **지금 걸린 실행 방법에서 도는가.** 이것이 축이 서로를 좁힌다는 말의 실체다 -
    // 순수 JS를 고르면 서포트 벡터 머신이 여기서 꺼진다.
    const here = option.runtimes.find((one) => one.runtime.id === input.runtime)
    if (here && !here.enabled)
      return {
        id,
        enabled: false,
        ...(here.reason ? { reason: here.reason } : {}),
        ...(here.maxRows === undefined ? {} : { maxRows: here.maxRows }),
      }

    return { id, enabled: true }
  })

  const drafted = input.options.find((option) => option.algorithm.id === input.algorithm)
  const runtimes = (drafted?.runtimes ?? []).map((one): AxisChoice => ({
    id: one.runtime.id,
    enabled: one.enabled,
    ...(one.reason ? { reason: one.reason } : {}),
    ...(one.maxRows === undefined ? {} : { maxRows: one.maxRows }),
    // **등록부가 그대로 들려 보낸다.** 화면이 id로 되짚으면 그 순간 두 벌이 된다 —
    // `maxRows`가 같은 이유로 이 자리에 실려 온다.
    ...(one.runtime.preparation === undefined ? {} : { preparation: one.runtime.preparation }),
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
 * 이 과제 유형에서 뜻을 잃는 모델들. **지우지 않는다 — 고를 뿐이다** (`open-decisions.md` 55).
 * 부르는 쪽은 담긴 줄을 잠그는 것(`chosenModelBlocks`)과 학습에 넘길 것을 거르는 것
 * (`trainableSelections`) 둘이다.
 *
 * **실행 위치는 보지 않는다.** 여기 걸리는 것은 과제 유형이 바뀌면서 **의미가 없어진 것**
 * 뿐이다 - 분류에서 고른 선형 회귀 같은 것.
 *
 * **등록부에 없는 알고리즘은 고르지 않는다.** 남의 파일에서 온 것이고, 우리가 모른다는
 * 이유로 거르면 그 파일을 연 학생이 조용히 잃는다 (mlpx-spec.md 5.2).
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
      return algorithm !== undefined && !supports(algorithm.taskTypes, taskType)
    })
}

/**
 * 담긴 줄 하나가 지금 학습에 못 들어가는 이유. **없으면 빈 목록이다** (architecture.md §10).
 *
 * **선택을 지우지 않고 잠근다** (`open-decisions.md` 55 *"끄지 않고 잠근다"*). 전에는 유형을
 * 바꿀 때 그 유형에 안 맞는 줄을 목록에서 지웠고(`withTaskType`의 `drop`), **유형을 되돌려도
 * 안 돌아와** 학생이 다시 담아야 했다. 이제 줄은 남고 이 이유로 잠기며, 학습에는
 * `trainableSelections`가 거른 것만 간다 — **둘이 같은 판정(`algorithmsLosingMeaning`)을 본다.**
 *
 * **실행 위치는 안 본다.** 서버가 꺼진 것은 학습이 run의 실패 사유로 말한다 — 그쪽은 담을
 * 때 이미 막히고, 파일에서 온 줄은 학생이 다음 시간에 서버를 켜고 돌아올 수 있다.
 */
export type ChosenModelBlock = 'ALGORITHM_NOT_FOR_TASK_TYPE'

export function chosenModelBlocks(
  row: { readonly algorithm: string },
  taskType: TaskType | undefined,
  algorithms: readonly Algorithm[] = ALGORITHMS,
): readonly ChosenModelBlock[] {
  if (taskType === undefined) return []
  return algorithmsLosingMeaning([row], taskType, algorithms).length > 0
    ? ['ALGORITHM_NOT_FOR_TASK_TYPE']
    : []
}

/**
 * [학습하기]를 막는 이유. **근본적인 것이 먼저다** (architecture.md §10.2).
 *
 * - `NO_MODEL` — 담은 모델이 없다.
 * - `NO_TRAINABLE_MODEL` — 담았는데 **전부** 지금 유형에 안 맞는다 (`open-decisions.md` 55).
 *   *"추가한 모델이 없다"*와 가른다 — 목록에 줄이 보이는 학생에게 그 말은 거짓이다.
 *
 * **유형이 빠진 것은 여기 없다** (`open-decisions.md` 60, architecture.md §10.6). 잠그지 않고
 * 누를 때 학습 화면이 실패를 알린다 — `option-cascade.spec.ts`의 *"유형이 빠진 파일에서 …"*.
 */
export type TrainBlock = 'NO_MODEL' | 'NO_TRAINABLE_MODEL'

/**
 * **[학습하기]의 gate** (architecture.md §10.2). 비어 있으면 누를 수 있다.
 *
 * **버튼 잠금과 동작의 거절이 이 함수 하나를 본다** (`TrainView`의 `trainBlocks`). 잠긴 줄
 * 판정은 `chosenModelBlocks`와 같다. `train-gate.spec.ts`가 조건마다 묻고,
 * `option-cascade.spec.ts`의 *"담은 모델이 전부 잠기면 …"*이 잠금과 거절을 둘 다 문다.
 *
 * **새 이유를 더하기 전에 코드 소유자에게 묻는다** (architecture.md §10.6) — 동작이 실패할
 * 조건을 여기에 옮겨 적으면 둘이 갈라져 할 수 있는데 잠긴 버튼이 생긴다.
 *
 * **"도는 중"은 여기 없다** — 파일의 성질이 아니라 화면의 상태다.
 */
export function trainGate(
  input: {
    readonly taskType: TaskType | undefined
    readonly chosen: readonly { readonly algorithm: string }[]
  },
  algorithms: readonly Algorithm[] = ALGORITHMS,
): readonly TrainBlock[] {
  const blocks: TrainBlock[] = []
  if (input.chosen.length === 0) {
    blocks.push('NO_MODEL')
  } else if (
    input.chosen.every((row) => chosenModelBlocks(row, input.taskType, algorithms).length > 0)
  ) {
    blocks.push('NO_TRAINABLE_MODEL')
  }
  return blocks
}

/**
 * 학습에 넘길 모델. **지금 유형에 안 맞는 줄을 뺀다** — 파일의 선택은 그대로다
 * (`open-decisions.md` 55). 실험 기록(`selectedAlgorithms`)에는 **돈 것만** 남는다 — 기록은
 * run과 자리로 짝지어지므로(`ml/experiment.ts`의 `comparable`) 안 돈 줄이 섞이면 어긋난다.
 *
 * **등록부에 없는 알고리즘은 남긴다** (`algorithmsLosingMeaning`과 같다). 학습이 그 줄을
 * 실패한 run으로 말한다 — 남의 파일에서 온 것이라 우리가 조용히 빼면 학생이 모른다.
 */
export function trainableSelections<T extends { readonly algorithm: string }>(
  selected: readonly T[],
  taskType: TaskType,
  algorithms: readonly Algorithm[] = ALGORITHMS,
): T[] {
  const losing = new Set(algorithmsLosingMeaning(selected, taskType, algorithms))
  return selected.filter((selection) => !losing.has(selection.algorithm))
}

/**
 * 학습이 보낸 줄마다의 값(상태·시작 시각)을 **담긴 줄 자리로** 옮긴다.
 *
 * 학습에는 잠긴 줄을 뺀 목록이 간다(`trainableSelections`). 그래서 학습이 보내는 자리는 **그
 * 목록의** 자리이고, 잠긴 줄을 사이에 두고 그대로 붙이면 **다른 모델의 줄에 상태가 앉는다.**
 * 잠긴 줄은 학습에 안 들어가므로 `null`이다. `blocks`는 줄마다의 잠금 이유
 * (`chosenModelBlocks`)이고 `trainableSelections`와 같은 판정이라 둘의 순서가 같다.
 */
export function byChosenRow<T>(
  blocks: readonly (readonly unknown[])[],
  sent: readonly T[],
): (T | null)[] {
  let next = 0
  return blocks.map((reasons) => (reasons.length > 0 ? null : (sent[next++] ?? null)))
}

/**
 * 층화가 뜻을 잃는 과제 유형. **비율을 맞출 대상이 없다** - 값이 연속이면 "종류"가 없다.
 *
 * `if (taskType === 'regression')`을 쓰지 않는 이유는 위 `TARGET_KIND_REQUIRED`와 같다.
 * 군집이 들어오는 날 여기에 줄이 하나 늘거나 안 늘 뿐이고, 부르는 쪽은 그대로다.
 */
const STRATIFY_MEANINGLESS: Partial<Record<TaskType, true>> = {
  regression: true,
}

/**
 * 데이터를 나누지 않는 과제 유형. **군집화가 그것이다** (`architecture.md` §3.6).
 *
 * `if (taskType === 'clustering')`을 안 쓰는 이유는 위 `STRATIFY_MEANINGLESS`와 같다.
 */
const SPLIT_MEANINGLESS: Partial<Record<TaskType, true>> = {
  clustering: true,
}

/**
 * 타깃이 뜻을 잃는 과제 유형. **군집화가 그것이다** (`architecture.md` §3.6) —
 * 정답 열 없이 묶는 것이 그 일이고, `planRun`도 그 값을 통째로 무시한다.
 */
const TARGET_MEANINGLESS: Partial<Record<TaskType, true>> = {
  clustering: true,
}

/**
 * 이 유형이 **타깃을 쓰는가.**
 *
 * 안 쓰면 화면은 타깃 칸을 **잠그는 것이 아니라 안 그린다** (`architecture.md` §8.9).
 * 잠그기만 하면 남아 있는 라디오가 "군집화에도 타깃이 있다"고 가르치고, 그냥 두면
 * 이름이 같은 열의 특성 체크박스가 계속 잠긴다 — 실제로 그 상태였다(전 경로 감사).
 *
 * **아직 안 골랐으면 참이다** — `splitsData`와 같은 이유다. 유형은 학습 화면에서
 * 고르므로 전처리에서 비어 있는 것이 정상이고, 그때 감추면 고르지도 않은 것을 단정한다.
 */
export function usesTarget(taskType: TaskType | undefined): boolean {
  return taskType === undefined || !TARGET_MEANINGLESS[taskType]
}

/**
 * 학습에 넣는 특성. **타깃과 같은 이름은 뺀다** (`open-decisions.md` 55 *"끄지 않고 잠근다"*).
 *
 * 설정의 특성 목록은 학생이 켠 것을 그대로 들어서, 특성으로 골라 둔 열을 나중에 타깃으로
 * 고르면 그 이름이 남는다. **타깃이 없으면(군집) 거르지 않는다** — 군집에는 정답이 없고,
 * 저장된 타깃 이름은 어떤 열도 타깃으로 만들지 않는다(`columnPlan`의 `wantsTarget`).
 *
 * **정답이 특성에 들어가는 것을 막는 자리는 학습 계획(`ml/plan.ts`) 하나다.** 나머지 부르는
 * 자리는 **세는** 곳이다 — 실험 기록(`ml/training-source.ts`), 예상 폭(`TrainView.vue`),
 * 프로젝트 요약(`TabularSummaryRows.vue`), 체크리스트(`project/facts.ts`). 행 수를 세는
 * 자리(`usableRows`)는 안 불러도 같다 — 타깃이 빈 행은 이미 빠지므로 같은 열을 특성으로 한 번
 * 더 봐도 빠지는 행이 안 는다. (사람 확인 — 이 목록을 세는 검사는 없다.)
 */
export function featuresInUse(features: readonly string[], target: string | undefined): string[] {
  return target === undefined ? [...features] : features.filter((name) => name !== target)
}

/**
 * 이 유형이 **데이터를 나누는가.** 나누지 않으면 비율도 층화도 아무 일을 안 한다.
 *
 * **화면이 과제 유형을 직접 비교하지 않게 하려고 여기 있다** (`CLAUDE.md` §2,
 * `ui-rules.spec.ts`). 판이 둘인데 사실은 하나라서, 전처리의 표 판과 이미지 판이 같은
 * 이 함수를 본다 — 갈라 두면 한쪽만 고쳐진다.
 *
 * **아직 안 골랐으면 참이다.** 유형은 학습 화면에서 고르므로 전처리에서는 비어 있는
 * 것이 정상이고, 그때 "안 나눈다"고 말하면 고르지도 않은 것을 단정하게 된다
 * (`data/image/test-set.ts`의 `scoresWithTestImages`가 같은 이유로 같은 답을 낸다).
 */
export function splitsData(taskType: TaskType | undefined): boolean {
  return taskType === undefined || !SPLIT_MEANINGLESS[taskType]
}

/**
 * 쓸 수 있는 행 중 **훈련에 드는 몫** (0~1). 학습 예상 시간이 곱한다.
 *
 * 테스트 데이터를 따로 올렸으면(`provided`) 시험 행은 다른 파일에서 오고 정본은 **전부**
 * 훈련이다(`ml/plan.ts`의 `testFromProvided`). 군집은 나누지 않는다(`splitsData`) — 역시 전부다.
 * 그 밖에는 `1 − testSize`다(분할의 올림은 예상이 말할 크기가 아니다). `train-share.spec.ts`가
 * 묻고, `train-prep-kind.spec.ts`의 *"군집이면 …"*이 화면의 배선을 문다.
 */
export function trainShare(
  split: Pick<Split, 'method' | 'testSize'>,
  taskType: TaskType | undefined,
): number {
  if (!splitsData(taskType) || split.method === 'provided') return 1
  return 1 - split.testSize
}

/**
 * 층화를 걸 수 없는 이유. **없으면 null이다.**
 *
 * 코드는 `CLIENT_ERROR_CODES`에 있고 화면이 `client.*`로 문장을 만든다
 * (architecture.md §10.2 - 이유는 코드이고 문장이 아니다).
 */
export interface StratifyBlock {
  readonly code:
    | 'STRATIFY_NOT_FOR_TASK_TYPE'
    | 'SPLIT_STRATIFY_IMPOSSIBLE'
    | 'SPLIT_STRATIFY_TARGET_CONTINUOUS'
    // 나눈 몫이 범주 수보다 적다 — 시험 비율이 원인이다 (결정문 55).
    | 'SPLIT_STRATIFY_SHARE_TOO_SMALL'
    // 뽑을 줄 수가 라벨 종류를 감당 못 한다 (open-decisions.md #22). 위 셋과 달리
    // **학생이 방금 정한 숫자**가 원인이라 할 일이 다르다 - 그 숫자를 올리거나 층화를 끈다.
    | 'SAMPLE_STRATIFY_IMPOSSIBLE'
  readonly params?: Record<string, string | number>
  /**
   * **나눌 때의 사유인데 뽑기는 층화한다.** 뽑기가 실제로 일어나면 층화는 추출에 작용하므로
   * 체크박스를 잠그지 않는다(`stratifyLocked`, `open-decisions.md` 64 ①).
   */
  readonly stillSamples?: boolean
}

/**
 * 값이 1개뿐인 타깃 값들. **층화가 성립하려면 비어 있어야 한다.**
 *
 * 층화는 값 종류마다 훈련 데이터와 테스트 데이터에 하나씩 보내므로 그 종류의 행이 하나면 한쪽이 빈다
 * (limits.ts의 MIN_SPLIT_ROWS).
 */
function lonelyValues(values: readonly string[]): {
  lonely: { label: string; count: number }[]
  kinds: number
} {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return {
    // **개수를 함께 돌려준다.** 문구가 그 수를 그대로 그리는데 예전에는 부르는 쪽이
    // `1`을 박아 넣었다 — `MIN_SPLIT_ROWS`가 2인 지금은 맞지만, 그 상수가 움직이는
    // 순간 화면이 "1개뿐이라"라고 **거짓말한다** (2026-08-30, R12 감사 C-2).
    lonely: [...counts]
      .filter(([, count]) => count < MIN_SPLIT_ROWS)
      .map(([label, count]) => ({ label, count })),
    kinds: counts.size,
  }
}

/**
 * 층화가 실제로 걸리는가. **파일의 값은 안 건드린다** (`open-decisions.md` 55
 * *"끄지 않고 잠근다"*).
 *
 * **막힌 이유가 무엇이든 학습이 무시한다.** 처음에는 유형 사유만 무시하고 나머지(값이
 * 1개뿐 · 연속 타깃 · 표본 수)는 학습이 거부하게 두었다 — 끄는 것이 학생의 유일한 탈출구라
 * 그랬다. 그러면 **조건이 풀린 뒤 학생이 전처리 화면까지 다시 걸어가 켜야 했다**(2026-08-31에
 * 유형 사유로 겪은 것과 같다). 거부 대신 무시하면 그 문이 필요 없다.
 *
 * **무시하는 자리는 학습 계획 하나다** (`ml/plan.ts`). 화면마다 무시하면 화면과 학습이
 * 다른 것을 돌린다. **판정은 `stratifyBlockFor` 하나다** — 화면이 잠그는 조건과 학습이
 * 무시하는 조건이 같은 객체에서 나온다. **분할 쪽만 막혔는데 뽑기가 실제로 일어나면** 그 객체가
 * `stillSamples`를 달고, 학습은 뽑기에만 층화를 걸며(`sampleStratifyBlockFor`) 화면은 잠그지 않는다
 * (`open-decisions.md` 64 ①).
 */
export function stratifyApplies(stratify: boolean, block: StratifyBlock | null): boolean {
  return stratify && block === null
}

/**
 * 층화 체크박스를 잠글 것인가. **막힌 이유가 있으면 잠근다 — 켜져 있어도.**
 *
 * 옛 규칙은 *"값이 1개뿐이거나 타깃이 연속이면 켜져 있을 때 잠그지 않는다"*였다. 그때는
 * 학습이 거부했으므로 잠그면 **빠져나갈 문이 없는 영구 차단**이었다. 이제 학습이 무시하므로
 * (`stratifyApplies`) 그 문이 필요 없고, 끄게 두면 **조건이 풀렸을 때 켜 두었던 것이 사라진다**
 * (결정문 55).
 *
 * `tests/selection.spec.ts`가 이 함수를 지킨다.
 */
export function stratifyLocked(block: StratifyBlock | null): boolean {
  return block !== null && block.stillSamples !== true
}

export interface StratifyInput {
  readonly dataset: Dataset | null
  /** 아직 안 골랐으면 없다. 그때는 유형으로 좁히지 않는다. */
  readonly taskType?: TaskType | undefined
  readonly target: string | undefined
  readonly features: readonly string[]
  readonly preprocessing: Preprocessing
  /**
   * 뽑기로 정한 행 수 (`open-decisions.md` #22). 없으면 전부 쓴다.
   *
   * **선택 인자로 두지 않는다.** `trainableRowCount`가 같은 이유로 필수를 고집한다 —
   * 빠뜨린 자리는 조용히 "안 뽑은 것"이 되고, 그러면 화면이 [학습하기]보다 관대해진다.
   */
  readonly nSamples: number | undefined
  /** 분할 방식과 시험 비율. 시험 비율이 층화를 막을 수 있다 (`shareStratifyBlock`). */
  readonly split: StratifySplit
}

/**
 * 지금 이 데이터에 층화를 걸 수 있는가. **[학습하기]를 누르기 전에 답한다.**
 *
 * 판정이 `ml/split.ts`에만 있었을 때는 학생이 [학습하기]에서 처음 알았고, 회귀 데이터에서는
 * **"이 값의 데이터를 2개 이상 모아 주세요"라는 불가능한 조언**을 받았다
 * (open-decisions.md "층화는 갈리는 값에서만 뜻이 있다").
 *
 * **학습이 보는 것과 같은 행을 센다** (`usableRows`). 결측 처리에서 빠질 행을 함께 세면
 * 화면은 멀쩡한데 학습이 거부한다.
 *
 * **1개뿐인 값이 하나인지 여럿인지로 문구가 갈린다.** 하나면 "그 값을 더 모아라"가 실행
 * 가능한 조언이고, 여럿이면 타깃이 사실상 연속이라 할 일이 없다 — 층화가 적용되지 않을 뿐
 * 학습은 그대로 돈다(결정문 55, 전에는 "끄라"였다). **"고유값이 몇 %
 * 이상이면 연속"이라는 임계값을 두지 않는다** - 세는 것은 사실이고 임계값은 판단이다.
 */
/**
 * 뽑을 줄 수가 라벨 종류를 감당 못 하는가 (`ml/sample.ts`의 `allocate`와 같은 판정).
 *
 * **경계를 두 곳에서 따로 계산하는 것이 아니다** — 뽑기는 워커 안에서 돌아 화면이 그
 * 함수를 부를 수 없고, 그래서 **같은 식을 여기 한 번 더 쓴다.** 어긋나면 화면과 [학습하기]가
 * 다른 말을 하므로, 저쪽을 고치는 사람은 여기도 고쳐야 한다
 * (`tests/selection.spec.ts`가 두 경계가 같은 값인지 확인한다).
 *
 * `nSamples`가 쓸 수 있는 행보다 크거나 같으면 뽑기 자체가 안 일어난다 — `sampleRows`가
 * 그대로 돌려주므로 여기서도 통과다.
 */
function sampleStratifyBlock(
  values: readonly string[],
  nSamples: number | undefined,
): StratifyBlock | null {
  if (nSamples === undefined || nSamples >= values.length) return null

  const sizes = new Map<string, number>()
  for (const value of values) sizes.set(value, (sizes.get(value) ?? 0) + 1)

  let floors = 0
  for (const size of sizes.values()) floors += Math.min(size, MIN_SPLIT_ROWS)
  if (floors <= nSamples) return null

  return {
    code: 'SAMPLE_STRATIFY_IMPOSSIBLE',
    params: { nSamples, labels: sizes.size, minRows: MIN_SPLIT_ROWS },
  }
}

/**
 * **뽑기에** 층화를 걸 수 있는가 — 유형과 뽑기의 사유만 본다.
 *
 * 나눌 때의 사유(한 값뿐인 라벨·시험 비율)는 여기 안 들어온다. 그것까지 보면 분할 층화가
 * 막힐 때 뽑기 층화도 꺼져 **드문 범주가 표본에서 조용히 빠진다** — 씨앗 200개 중 66번을
 * 쟀다(`open-decisions.md` 64 ①). `tests/plan.spec.ts`의 *"나눌 때만 막히면 뽑기는 층화한다"*가 문다.
 */
export function sampleStratifyBlockFor(
  taskType: TaskType | undefined,
  labels: readonly string[],
  nSamples: number | undefined,
): StratifyBlock | null {
  if (taskType !== undefined && STRATIFY_MEANINGLESS[taskType]) {
    return { code: 'STRATIFY_NOT_FOR_TASK_TYPE' }
  }
  return sampleStratifyBlock(labels, nSamples)
}

/**
 * 층화를 걸 수 있는가 — **라벨만 보고 답한다.**
 *
 * 판정에 실제로 필요한 것은 **쓸 수 있는 표본의 라벨 하나하나**뿐이다. 그것을 무엇에서
 * 뽑는지는 데이터 종류마다 다르다 — 표는 타깃 열의 값이고 이미지는 사진이 든 범주다.
 * **그래서 뽑는 일은 판이 하고, 판정은 여기 하나로 남는다** (architecture.md §9.1.2).
 * `MIN_SPLIT_ROWS`의 주석이 "층화할 때는 **라벨마다** 이만큼 필요하다"고 적어 둔 그 뜻이다.
 *
 * `labels`는 **표본 하나에 원소 하나**다. 미리 센 개수가 아니라 값의 나열인 이유는
 * 아래 둘이 "값이 몇 종류인가"와 "1개뿐인 값이 몇 개인가"를 함께 봐야 하기 때문이다.
 */
export function stratifyBlockFor(
  taskType: TaskType | undefined,
  labels: readonly string[],
  nSamples: number | undefined,
  split: StratifySplit,
): StratifyBlock | null {
  // **뽑기를 먼저 본다.** 학습에서도 뽑기가 분할보다 앞이라(ml/experiment.ts) 둘 다
  // 걸리는 데이터에서 화면과 [학습하기]가 다른 말을 하면 안 된다.
  const forSampling = sampleStratifyBlockFor(taskType, labels, nSamples)
  if (forSampling) return forSampling

  /**
   * **여기부터는 나눌 때의 사유다 — `provided`는 나누지 않는다** (R38-D55 A-1). 그 갈래에서
   * 층화는 뽑기에만 걸리고, 뽑기는 1개뿐인 범주에도 바닥을 남긴다(`ml/sample.ts`). 여기서
   * 막으면 계획이 층화 뽑기를 꺼서(`stratifyApplies`) **드문 범주가 표본에서 조용히 빠졌다.**
   * `tests/plan.spec.ts`의 *"따로 받은 테스트 데이터면 1개뿐인 범주도 층화 뽑기에 남는다"*가 문다.
   */
  if (split.method !== 'holdout') return null

  const { lonely, kinds } = lonelyValues(labels)
  const forSplit =
    lonely.length > 0 ? blockFor(lonely, kinds) : shareStratifyBlock(labels, nSamples, split)
  if (forSplit === null) return null
  // 여기까지 왔으면 뽑기 쪽 사유는 없다 — 뽑기가 실제로 일어나면 층화는 거기 작용한다.
  const samples = nSamples !== undefined && nSamples < labels.length
  return samples ? { ...forSplit, stillSamples: true } : forSplit
}

/** 층화 판정이 보는 분할 설정. 씨앗과 층화 여부는 판정에 안 쓰인다. */
export interface StratifySplit {
  readonly method: Split['method']
  readonly testSize: number
}

/**
 * 나눈 몫이 범주 수보다 적은가 (`ml/split.ts`의 `SPLIT_STRATIFY_SHARE_TOO_SMALL`과 같은 판정).
 *
 * **분할 안에만 있던 판정을 여기로 옮겼다** (2026-09-23, 결정문 55). 거기만 있으면 화면이
 * 몰라서 체크박스를 못 잠그고, 학습은 무시하는데 화면은 켜진 것처럼 말한다. **시험 비율은
 * 학생이 고르는 옵션이다** — 그것이 층화를 무의미하게 만드는 A다.
 *
 * **센 행 수는 분할이 받는 수다** — 뽑기가 줄였으면 `nSamples`, 아니면 쓸 수 있는 행 전부.
 * 층화 뽑기는 라벨마다 바닥을 남기므로(`ml/sample.ts`) 범주 수는 뽑은 뒤에도 같다.
 * **`holdout`일 때만 불린다** — `provided`는 나누지 않는다(`stratifyBlockFor`가 먼저 거른다).
 */
function shareStratifyBlock(
  labels: readonly string[],
  nSamples: number | undefined,
  split: StratifySplit,
): StratifyBlock | null {
  const kinds = new Set(labels).size
  const total = nSamples !== undefined && nSamples < labels.length ? nSamples : labels.length
  // 행이 모자라면 분할이 먼저 `SPLIT_TOO_FEW_ROWS`로 선다 — 층화까지 안 온다.
  if (kinds === 0 || total < MIN_SPLIT_ROWS) return null
  const testRows = testCountFor(total, split.testSize)
  const trainRows = total - testRows
  if (testRows >= kinds && trainRows >= kinds) return null
  return { code: 'SPLIT_STRATIFY_SHARE_TOO_SMALL', params: { labels: kinds, testRows, trainRows } }
}

/**
 * 표의 타깃 열에서 라벨을 뽑아 위 판정에 넘긴다. **표 전용 어댑터다.**
 *
 * **학습이 보는 것과 같은 행을 센다** (`usableRows`). 결측 처리에서 빠질 행을 함께 세면
 * 화면은 멀쩡한데 학습이 거부한다.
 *
 * **라벨을 뽑는 것도 학습과 같은 함수여야 한다** (`targetValues`). 예전에는 여기서
 * `String(cell)`로 직접 뽑았는데 그쪽은 다듬지 않아서 `" a"`와 `"a"`가 **화면에서는 두
 * 라벨, 학습에서는 한 라벨**이었다 — CSV는 셀을 안 다듬는다. 그러면 화면이 *"' a' 값이
 * 1개뿐이라 비율을 맞춰 나눌 수 없습니다"*라고 말하는데 학습은 멀쩡히 돈다. 이 파일
 * 머리말이 금지한 상태 그대로다(**학습이 안 막는 것을 에러처럼 보여주면 도구가 거짓말을
 * 한다**). 게다가 그때의 잠금 규칙에서는 그 거짓말을 따라 층화를 끄면 `stratifyLocked`가 참이
 * 되어 **다시 켤 수도 없었다.** (V11 R2 감사 B-9 — 지금은 결정문 55로 끄지 않고 잠근다)
 *
 * 같은 줄에 `String(undefined)`가 `"undefined"`라는 라벨을 만드는 길도 있었는데 그쪽은
 * `usableRows`가 앞에서 막고 있었다 — **도달하지 않는 것을 검사로 만들지 않는다.**
 */
export function stratifyBlock(input: StratifyInput): StratifyBlock | null {
  const { dataset, target } = input
  // 유형 판정은 데이터가 없어도 성립한다 - 회귀를 고른 순간 층화는 뜻을 잃는다.
  if (!dataset || target === undefined) {
    return stratifyBlockFor(input.taskType, [], input.nSamples, input.split)
  }

  const column = dataset.columns.indexOf(target)
  if (column < 0) return stratifyBlockFor(input.taskType, [], input.nSamples, input.split)

  const rows = usableRows(dataset, input.features, target, input.preprocessing.missing)
  return stratifyBlockFor(
    input.taskType,
    targetValues(dataset, rows, target),
    input.nSamples,
    input.split,
  )
}

/** 1개뿐인 값들을 어떤 이유로 말할지. **위 판정이 걸린 뒤에만 부른다.** */
function blockFor(
  lonely: readonly { label: string; count: number }[],
  kinds: number,
): StratifyBlock {
  const only = lonely[0]
  // 값 하나만 부족한 것과 값이 거의 다 다른 것은 학생이 할 일이 정반대다.
  return lonely.length === 1 && only
    ? {
        code: 'SPLIT_STRATIFY_IMPOSSIBLE',
        // **센 값을 그대로 싣는다.** 박아 넣으면 MIN_SPLIT_ROWS가 움직이는 날 거짓말이 된다.
        params: { label: only.label, count: only.count, minRows: MIN_SPLIT_ROWS },
      }
    : {
        code: 'SPLIT_STRATIFY_TARGET_CONTINUOUS',
        params: { kinds, lonely: lonely.length },
      }
}

/**
 * 상한 판정이 세어야 하는 행 수 — **학습에 실제로 들어가는 행이다.**
 *
 * 파일의 행 수가 아니다. `ml/experiment.ts`는 `usableRows`로 거른 뒤에 학습을 시작하므로,
 * 3276행짜리 파일에서 결측으로 1265행이 빠지면 모델이 보는 것은 2011행이다. `limits.ts`의
 * `MLJS_*_ROW_LIMIT`을 정한 실측도 그 걸러진 행에 대한 값이다 — SVM의 커널 행렬 N×N에서
 * N이 이것이지 파일의 행 수가 아니다. 파일의 행 수로 재면 **학습은 받아들일 데이터를
 * 화면이 거부한다.** 층화 판정(`stratifyBlock`)이 `usableRows`를 보는 것과 같은 이유이고,
 * 여기서 어긋나면 방향만 반대일 뿐 같은 종류의 거짓말이다.
 *
 * **업로드 상한(`MAX_DATASET_ROWS`)은 여기 해당하지 않는다.** 그것은 "이 앱이 다루는 표의
 * 크기"라 파일의 행 수가 맞다 (limits.ts가 두 값을 갈라 둔 이유).
 *
 * **분할은 빼지 않는다.** `test_size`만큼 빼면 `fit`에 들어가는 행은 더 적지만, 그러면
 * 학생이 비율 슬라이더를 끌 때마다 고를 수 있는 모델 목록이 바뀐다. 보수적인 쪽으로 둔다.
 *
 * **`nSamples`는 뺀다** (open-decisions.md #22). 분할과 반대인 이유는 **이 손잡이의 목적
 * 자체가 고를 수 있는 모델 목록을 바꾸는 것**이기 때문이다 — 잠긴 카드를 여는 유일한
 * 수단이라 여기 반영되지 않으면 손잡이가 아무 일도 안 한다. 그리고 분할과 달리
 * **`fit`이 보는 행의 상한이 정확히 이 값이다**(`ml/sample.ts`가 딱 그만큼 돌려준다).
 *
 * **인자에서 뺄 수 있게 만들지 마라.** 선택 인자로 두면 빠뜨린 자리가 조용히 옛 동작이
 * 되고, 이 함수에서 그건 **화면과 학습이 다른 행을 세는 상태**다. 세지 않겠다는 판단도
 * `undefined`를 적어서 남긴다 (`rowUsage`가 그렇게 부른다).
 *
 * **타깃을 안 골랐으면 파일의 행 수다.** 무엇이 빠질지 아직 정해지지 않았고, 그때 적게
 * 세면 나중에 잠길 모델을 지금 열어 주게 된다. `nSamples`는 그때도 뺀다 — 타깃과 무관하게
 * `fit`이 그보다 많이 볼 수 없다.
 */
export function trainableRowCount(
  dataset: Dataset | null,
  features: readonly string[],
  target: string | undefined,
  missing: Preprocessing['missing'],
  nSamples: number | undefined,
): number {
  if (!dataset) return 0
  const usable =
    target === undefined
      ? dataset.rows.length
      : usableRows(dataset, features, target, missing).length
  return nSamples === undefined ? usable : Math.min(usable, nSamples)
}

export type RowUsage = {
  readonly total: number
  readonly usable: number
  readonly dropped: number
}

/**
 * 올린 행 중 몇 행을 실제로 쓰는지. **빠진 행이 0이면 null이다** - 할 말이 없을 때
 * 굳이 하지 않는다
 * (open-decisions.md "몇 행으로 학습하고 몇 행으로 채점하는지 말한다").
 *
 * **훈련 데이터와 테스트 데이터가 같은 함수를 본다.** `usableRows` 하나이므로 두 화면이
 * 어긋나지 않는다 - 따로 세면 반드시 어긋난다.
 *
 * **`nSamples`는 일부러 안 센다.** 이 줄이 답하는 질문은 "올린 것 중 몇 행이 **쓸 수
 * 있는** 행인가"이고, 빠진 이유는 결측 하나다. 뽑기는 학생이 그 뒤에 스스로 건 것이라
 * 다른 사실이고, **화면에서도 다른 줄이 말한다**(`architecture.md` §8.9). 둘을 한 숫자로
 * 뭉치면 "50행이 빠졌습니다"가 결측인지 안 뽑힌 것인지 구분이 안 된다.
 */
export function rowUsage(
  dataset: Dataset | null,
  features: readonly string[],
  target: string | undefined,
  missing: Preprocessing['missing'],
): RowUsage | null {
  if (!dataset || target === undefined) return null
  const usable = trainableRowCount(dataset, features, target, missing, undefined)
  const dropped = dataset.rows.length - usable
  return dropped > 0 ? { total: dataset.rows.length, usable, dropped } : null
}
