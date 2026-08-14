/**
 * 워크플로 단계, 그 안의 할 일, 그리고 진입 조건.
 *
 * **셋이 한 파일에 있는 것이 요점이다** (architecture.md §8.7). 화면에 뜨는 체크리스트와
 * 탭의 잠금은 같은 것을 다른 각도에서 보여주는 것이므로 **같은 사실에서 나와야 한다.**
 * 두 벌로 만들면 "체크는 다 됐는데 다음 단계가 잠겨 있다"가 생기고, 그건 학생이 고칠
 * 방법이 없는 고장이다.
 *
 * 그리고 전부 **컴포넌트 밖의 순수 함수다** (§8.3). 조건 하나를 확인하려고 화면 전체를
 * 마운트해야 하면 아무도 그 조건을 테스트하지 않는다.
 *
 * 단계 순서는 **학생이 프로젝트를 만들어 가는 워크플로**다. 수행평가 진행 순서가 아니다.
 */

import type { DataType, TaskType } from '@/project/schema'

/** 화면에 나오는 순서 그대로다. 이 배열이 레일의 순서이자 되돌아갈 순서다. */
export const STEP_IDS = ['data', 'preprocess', 'train', 'results', 'predict', 'portfolio'] as const

export type StepId = (typeof STEP_IDS)[number]

/** 프로젝트를 처음 열었을 때 학생이 시작하는 곳. */
export const FIRST_STEP: StepId = 'data'

/**
 * 프로젝트에서 읽어낸 사실들. **이것만으로 체크리스트와 잠금이 모두 결정된다.**
 *
 * 프로젝트 문서 전체를 넘기지 않는 이유는, 그러면 이 파일이 스키마를 알게 되고
 * 스키마가 바뀔 때마다 진입 조건이 함께 흔들리기 때문이다.
 *
 * **없는 상태를 지어내지 않는다.** "열을 확인했다" 같은 항목은 어딘가에 기록이 있어야
 * 하는데 없으므로 넣지 않았다. 체크할 수 없는 체크박스는 학생을 멈춰 세운다.
 */
export interface ProjectFacts {
  /** 표가 올라와 있는가. */
  readonly datasetReady: boolean
  /** 무엇을 예측할지 정했는가. 군집화에는 대상이 없다. */
  readonly targetChosen: boolean
  /** 무엇으로 예측할지 정했는가. */
  readonly featuresChosen: boolean
  /**
   * 분류인지 회귀인지 정했는가. **기본값이 없으므로 정말로 안 정한 상태가 있다**
   * (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
   */
  readonly taskTypeChosen: boolean
  /** 학습할 알고리즘을 하나라도 골랐는가. */
  readonly algorithmsChosen: boolean
  /** 학습을 한 번이라도 끝냈는가. 실패한 것도 결과다. */
  readonly trainingDone: boolean
  /** 예측에 쓸 수 있는 모델이 실제로 담겨 있는가. 예산에서 밀리면 지표만 남는다. */
  readonly modelReady: boolean
  /** 포트폴리오에 한 글자라도 썼는가. */
  readonly portfolioWritten: boolean
}

export type FactKey = keyof ProjectFacts

/** 아직 아무것도 없는 상태. 프로젝트가 열리기 전에도 판정은 돌아야 한다. */
export const NO_FACTS: ProjectFacts = {
  datasetReady: false,
  targetChosen: false,
  featuresChosen: false,
  taskTypeChosen: false,
  algorithmsChosen: false,
  trainingDone: false,
  modelReady: false,
  portfolioWritten: false,
}

interface Step {
  /** 이 단계에서 학생이 할 일. 체크리스트로 그대로 뜬다. */
  readonly tasks: readonly FactKey[]
  /** 이만큼이 되어야 들어갈 수 있다. **앞 단계의 사실을 가리킨다.** */
  readonly requires: readonly FactKey[]
}

/**
 * 단계표.
 *
 * `data`와 `portfolio`는 `requires`가 비어 있어 언제나 열린다. 데이터는 시작점이고,
 * **포트폴리오는 하는 도중에 쓰는 것**이라 결과가 나올 때까지 막으면 쓰던 글을 잃는다.
 *
 * **전처리와 학습의 경계는 데이터와 모델이다** (architecture.md §8.2). 전처리에서 정하는
 * 것은 전부 데이터의 성질이고(타깃·특성), 모델의 성질은 전부 학습에 있다(기계학습 유형·
 * 모델 선정). 타깃과 특성은 유형과 무관하게 정해지므로 유형이 그 앞에 설 이유가 없다 —
 * 모델을 골라야 열을 고를 수 있다면 워크플로가 거꾸로 선다.
 *
 * `train`이 `targetChosen`을 요구해도 군집화가 막히지 않는다 — **잠금 조건도 할 일과
 * 같은 필터를 지나기 때문이다**(아래 `isStepUnlocked`). 예전에는 여기서 손으로 빼 두었다.
 *
 * `results`와 `predict`에 할 일이 없는 것은 그 둘이 **보는 화면**이라서다. 빈 체크리스트는
 * 숨긴다 — 항목 없는 목록을 보여주면 무언가 빠진 것처럼 보인다.
 */
const STEPS: Readonly<Record<StepId, Step>> = {
  data: { tasks: ['datasetReady'], requires: [] },
  preprocess: {
    tasks: ['targetChosen', 'featuresChosen'],
    requires: ['datasetReady'],
  },
  train: {
    tasks: ['taskTypeChosen', 'algorithmsChosen', 'trainingDone'],
    requires: ['datasetReady', 'targetChosen', 'featuresChosen'],
  },
  results: { tasks: [], requires: ['trainingDone'] },
  predict: { tasks: [], requires: ['modelReady'] },
  portfolio: { tasks: ['portfolioWritten'], requires: [] },
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEP_IDS as readonly string[]).includes(value)
}

/**
 * 이 단계에 들어갈 수 있는가.
 *
 * **과제 유형에 해당하지 않는 사실은 요구에서도 빠진다.** 할 일 목록에서만 빼고 여기서
 * 안 빼면 "체크는 다 됐는데 잠겨 있다"가 생기고, 그건 학생이 고칠 방법이 없는 고장이다.
 * 군집화가 타깃 없이 학습에 들어가는 것이 이 필터 하나로 성립한다.
 *
 * 유형을 아직 안 골랐으면 **전부 해당한다** - 무엇이 빠질지 아직 알 수 없고, 지금
 * 등록부에 있는 유형은 둘 다 타깃이 필요하다.
 */
export function isStepUnlocked(
  step: StepId,
  facts: ProjectFacts,
  taskType?: TaskType | undefined,
  dataType?: DataType | undefined,
): boolean {
  return STEPS[step].requires.every(
    (fact) => !factAppliesTo(fact, taskType, dataType) || facts[fact],
  )
}

/** 이 단계에 들어가려면 참이어야 하는 사실들. 검사가 표를 훑는 데 쓴다. */
export function stepRequires(step: StepId): readonly FactKey[] {
  return STEPS[step].requires
}

/**
 * **학생이 직접 할 수 없는 사실.** 잠금 조건이지만 체크리스트 항목이 아니다.
 *
 * `modelReady`는 학습의 결과로 생기거나 안 생긴다 — 예산에서 밀리면 지표만 남고
 * (mlpx-spec.md §4.2) 그때 예측 단계는 **영구히 잠긴 채로 두는 것이 맞다.** 학생이
 * 할 수 있는 일이 없으므로 체크박스로 두면 못 끄는 체크박스가 된다.
 *
 * 새 잠금 조건을 넣는 사람은 그것이 **할 일인지 결과인지** 정해야 한다.
 * 여기 없고 어느 단계의 tasks에도 없으면 tests/steps.spec.ts가 막는다.
 */
export const DERIVED_FACTS: readonly FactKey[] = ['modelReady']

/**
 * **과제 유형마다 해당하지 않는 사실이 있다** (architecture.md §8.10).
 *
 * 군집화에는 타깃이 없다. 그러니 "타깃 정하기"는 문구를 바꿀 항목이 아니라
 * **애초에 항목이 아니다.** 그리고 **할 일에서 빠지면 잠금 조건에서도 빠진다** —
 * `isStepUnlocked`가 같은 필터를 지나므로 둘이 갈라질 자리가 없다.
 *
 * **여기 빠뜨리면 컴파일이 깨진다.** `Record<TaskType, …>`이므로 과제 유형을
 * 더하는 사람은 자기 칸을 채워야 한다. 비어 있는 칸은 실수가 아니라 선언이다.
 *
 * **문구를 미리 쓰지 마라.** 군집화는 V3이고(`roadmap.md`) 등록부에 알고리즘이
 * 없다. 쓸 대상이 없는 문장을 로케일에 넣으면 아무도 화면에서 못 보고 검사도
 * 못 잡는 것이 두 언어에 생긴다. 알고리즘을 넣는 사람이 문구도 함께 넣는다.
 */
const FACTS_NOT_IN_TASK: Readonly<Record<TaskType, readonly FactKey[]>> = {
  classification: [],
  regression: [],
  clustering: ['targetChosen'],
}

/**
 * 이 과제 유형에 해당하는 사실인가. 해당하지 않으면 할 일에도 잠금 조건에도 안 쓰인다.
 *
 * **유형을 아직 안 골랐으면 전부 해당한다.** 없는 것을 미리 빼면 학생이 유형을 고르기도
 * 전에 화면에서 항목이 사라지고, 그 뒤에 분류를 고르면 다시 나타난다.
 */
const FACTS_NOT_IN_DATA_TYPE: Readonly<Record<DataType, readonly FactKey[]>> = {
  tabular: [],
  // **학생이 특성을 안 고른다. 백본이 만든다** (open-decisions.md "이미지에서 체크리스트
  // 세 항목은 무엇인가"). `featuresChosen`을 `false`로 두면 학습 단계에 영원히 못
  // 들어가고, `true`로 두면 아무 뜻 없는 체크가 하나 뜬다. 답은 **항목이 아닌 것**이다.
  image: ['featuresChosen'],
}

/** 단계 문구의 자리. **빈 상태도 여기 있다** — 잠금 사유와 같은 것을 말한다. */
export type StepTextSlot = 'purpose' | 'locked' | 'emptyReason' | 'emptyNext'

/**
 * **단계 문구 중 데이터 종류를 가리는 자리** (architecture.md 8.10, docs/i18n.md 규칙 10).
 *
 * 표를 두고 쓴 문장이라 이미지에서는 참이 아니다 - "어떤 열이 있는지", "표에 새 줄을
 * 하나 넣으면", "타깃과 특성을 먼저 정해 주세요".
 *
 * **이 자리에는 기본값이 없다.** 표의 문장을 `steps.*`에 두었더니 그것이 기본값이
 * 되었고, 그러면 **다음 종류가 아무것도 안 써도 화면이 멀쩡해 보인다** - 조용히 표의
 * 말을 하면서. 그래서 표도 자기 것(`steps.data.tabular.purpose`)을 선언한다.
 *
 * **여기가 그 목록의 유일한 출처다.** `tests/kinds.spec.ts`는 "모든 종류가 이 자리들을
 * 선언했는가"를, `tests/locales.spec.ts`는 "이 자리들이 공통 자리에 되살아나지 않았는가"를
 * 이 배열 하나를 보고 판정한다 - 둘이 각자 목록을 들면 한쪽만 늘어난다.
 *
 * **여기는 화면을 모른다.** 그래서 이 파일에 있다 - `data/kinds.ts`는 Vue 컴포넌트를
 * 물고 있어서 node 환경의 검사가 못 읽는다.
 */
export const KIND_SPECIFIC_STEP_TEXT: readonly {
  readonly step: StepId
  readonly slot: StepTextSlot
}[] = [
  { step: 'data', slot: 'purpose' },
  { step: 'predict', slot: 'purpose' },
  { step: 'train', slot: 'locked' },
  // 전처리도 갈린다. 공통 자리에 있던 문장이 표의 말이었다 - 잠금 사유가 "데이터를
  // 먼저 불러와 주세요"였는데 이미지에는 불러오는 것이 없고 사진을 추가한다.
  // 설명문도 같다: 이미지에는 다듬을 것이 없고(결측치·인코딩·스케일링) 이 화면에서
  // 하는 일은 테스트 데이터를 정하는 것뿐이다.
  { step: 'preprocess', slot: 'purpose' },
  { step: 'preprocess', slot: 'locked' },
  // 빈 상태도 갈린다. 공통 자리에 있던 문장이 "파일을 불러오면 무엇을 예측할지 고를
  // 수 있습니다"였는데, 이미지에는 불러오기도 타깃 고르기도 없다. **빈 상태는 아직
  // 그 단계에 들어올 수 없다는 말이라 잠금 사유와 같은 것을 말한다** (docs/i18n.md 규칙 10).
  { step: 'preprocess', slot: 'emptyReason' },
  { step: 'preprocess', slot: 'emptyNext' },
]

/**
 * **종류마다 이름이 갈리는 사실.** 나머지 여섯은 종류를 안 가린다(유형 고르기·모델
 * 담기·학습하기…) — 갈리는 자리만 갈라야 공통 문장이 종류 수만큼 복제되지 않는다
 * (`KIND_SPECIFIC_STEP_TEXT`와 같은 판단이다).
 */
export const KIND_SPECIFIC_TASK_LABELS = ['datasetReady', 'targetChosen'] as const

type KindSpecificFact = (typeof KIND_SPECIFIC_TASK_LABELS)[number]

/**
 * 종류마다 다른 문구.
 *
 * 사실의 이름은 종류마다 안 가른다 — 가르면 같은 자리를 뜻하는 이름이 둘이 되고
 * 잠금표가 종류마다 갈린다. **갈리는 것은 문구뿐이다** (§8.10).
 *
 * **`Partial`이 아니다.** 비워 둘 수 있게 두었더니 그 자리가 조용히 공통 문장을
 * 물려받는데, 공통 문장은 표를 두고 쓴 것이다("데이터 불러오기"·"타깃(Target)
 * 선택하기"). 음성이 들어오는 날 그 둘을 안 채워도 화면이 멀쩡해 보이고 **아무것도
 * 울지 않는다** — 조립된 키라 로케일 검사도 못 본다. 그래서 **칸을 비울 수 없게
 * 타입으로 막는다.** 표가 공통 키를 가리키는 것은 빠뜨린 것이 아니라 선언이다.
 */
const TASK_LABELS: Readonly<Record<DataType, Readonly<Record<KindSpecificFact, string>>>> = {
  tabular: { datasetReady: 'tasks.datasetReady', targetChosen: 'tasks.targetChosen' },
  image: {
    datasetReady: 'tasks.image.datasetReady',
    // 이미지에는 타깃 열이 없다. 학생이 하는 일은 범주를 나누는 것이다.
    targetChosen: 'tasks.image.targetChosen',
  },
}

/**
 * 이 과제 유형과 데이터 종류에 해당하는 사실인가. 해당하지 않으면 할 일에도 잠금
 * 조건에도 안 쓰인다.
 *
 * **유형을 아직 안 골랐으면 전부 해당한다.** 없는 것을 미리 빼면 학생이 유형을 고르기도
 * 전에 화면에서 항목이 사라지고, 그 뒤에 분류를 고르면 다시 나타난다.
 *
 * **데이터 종류는 다르다 — 프로젝트를 만들 때 정해져 안 바뀐다**(open-decisions.md)
 * 그래서 처음부터 뺄 수 있고, 안 빼면 학생이 못 채우는 항목을 계속 본다.
 */
export function factAppliesTo(
  fact: FactKey,
  taskType?: TaskType | undefined,
  dataType?: DataType | undefined,
): boolean {
  if (dataType !== undefined && FACTS_NOT_IN_DATA_TYPE[dataType].includes(fact)) return false
  return taskType === undefined || !FACTS_NOT_IN_TASK[taskType].includes(fact)
}

/** 이 사실을 이 종류에서 뭐라고 부르는가. */
function isKindSpecificFact(fact: FactKey): fact is KindSpecificFact {
  return (KIND_SPECIFIC_TASK_LABELS as readonly FactKey[]).includes(fact)
}

export function factLabelKey(fact: FactKey, dataType?: DataType | undefined): string {
  if (dataType === undefined || !isKindSpecificFact(fact)) return `tasks.${fact}`
  return TASK_LABELS[dataType][fact]
}

/** 체크리스트 한 줄. 문구는 `tasks.{key}` 로케일 키에서 온다. */
export interface StepTask {
  readonly key: FactKey
  readonly done: boolean
  /** 화면이 그대로 `t()`에 넣는다. 종류마다 갈릴 수 있다 (`factLabelKey`). */
  readonly labelKey: string
}

/**
 * 이 단계의 할 일. 없으면 빈 배열이고, 화면은 그때 목록을 아예 그리지 않는다.
 *
 * **과제 유형에 해당하지 않는 사실은 빠진다** (§8.10). 군집화에서 "타깃 정하기"가
 * 사라지는 것이 여기다.
 */
export function stepTasks(
  step: StepId,
  facts: ProjectFacts,
  taskType?: TaskType | undefined,
  dataType?: DataType | undefined,
): StepTask[] {
  return STEPS[step].tasks
    .filter((key) => factAppliesTo(key, taskType, dataType))
    .map((key) => ({ key, done: facts[key], labelKey: factLabelKey(key, dataType) }))
}

/**
 * 학생이 **지금 해야 하는 일** 하나. 없으면 null.
 *
 * 앞 단계부터 훑어 열려 있는 단계의 첫 미완료 항목을 고른다. 상태 팝오버가
 * "지금 할 일 / 다음"을 보여주는 데 쓴다 (architecture.md §8.6).
 */
export function currentTask(
  facts: ProjectFacts,
  taskType?: TaskType | undefined,
  dataType?: DataType | undefined,
): { step: StepId; key: FactKey; labelKey: string } | null {
  for (const step of STEP_IDS) {
    if (!isStepUnlocked(step, facts, taskType, dataType)) continue
    const pending = STEPS[step].tasks.find(
      (key) => factAppliesTo(key, taskType, dataType) && !facts[key],
    )
    // **문구 키를 함께 준다.** 부르는 쪽이 `tasks.{key}`를 조립하면 종류마다
    // 갈리는 문구를 지나쳐 표의 말을 한다 - 대시보드의 [바로가기]가 실제로 그랬다.
    if (pending !== undefined) {
      return { step, key: pending, labelKey: factLabelKey(pending, dataType) }
    }
  }
  return null
}

/**
 * 요청한 단계가 잠겨 있으면 **그 앞에서 가장 가까운 열린 단계**를 돌려준다.
 *
 * 프로젝트 목록으로 쫓아내지 않는 이유는, 학생이 주소를 직접 치는 경우보다 **아직
 * 안 되는 곳을 누르는 경우**가 훨씬 흔하기 때문이다. 그때 필요한 것은 "여기까지는
 * 됐고 다음은 이것"이라는 자리이지 처음으로 돌아가는 것이 아니다.
 *
 * `data`가 언제나 열려 있으므로 돌려줄 것이 없는 경우는 생기지 않는다.
 */
export function resolveStep(
  requested: StepId,
  facts: ProjectFacts,
  taskType?: TaskType | undefined,
  dataType?: DataType | undefined,
): StepId {
  for (let index = STEP_IDS.indexOf(requested); index >= 0; index -= 1) {
    const step = STEP_IDS[index]
    if (step !== undefined && isStepUnlocked(step, facts, taskType, dataType)) {
      return step
    }
  }
  return FIRST_STEP
}
