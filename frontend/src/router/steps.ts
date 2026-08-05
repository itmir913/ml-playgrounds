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
 * `train`이 `targetChosen`을 요구하지 않는 것은 **군집화에 대상이 없기 때문이다.**
 * 체크리스트에는 뜨지만(전처리 단계) 잠금 조건은 아니다.
 *
 * `results`와 `predict`에 할 일이 없는 것은 그 둘이 **보는 화면**이라서다. 빈 체크리스트는
 * 숨긴다 — 항목 없는 목록을 보여주면 무언가 빠진 것처럼 보인다.
 */
const STEPS: Readonly<Record<StepId, Step>> = {
  data: { tasks: ['datasetReady'], requires: [] },
  preprocess: {
    tasks: ['targetChosen', 'featuresChosen', 'algorithmsChosen'],
    requires: ['datasetReady'],
  },
  train: {
    tasks: ['trainingDone'],
    requires: ['datasetReady', 'featuresChosen', 'algorithmsChosen'],
  },
  results: { tasks: [], requires: ['trainingDone'] },
  predict: { tasks: [], requires: ['modelReady'] },
  portfolio: { tasks: ['portfolioWritten'], requires: [] },
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEP_IDS as readonly string[]).includes(value)
}

export function isStepUnlocked(step: StepId, facts: ProjectFacts): boolean {
  return STEPS[step].requires.every((fact) => facts[fact])
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

/** 체크리스트 한 줄. 문구는 `tasks.{key}` 로케일 키에서 온다. */
export interface StepTask {
  readonly key: FactKey
  readonly done: boolean
}

/** 이 단계의 할 일. 없으면 빈 배열이고, 화면은 그때 목록을 아예 그리지 않는다. */
export function stepTasks(step: StepId, facts: ProjectFacts): StepTask[] {
  return STEPS[step].tasks.map((key) => ({ key, done: facts[key] }))
}

/**
 * 학생이 **지금 해야 하는 일** 하나. 없으면 null.
 *
 * 앞 단계부터 훑어 열려 있는 단계의 첫 미완료 항목을 고른다. 상태 팝오버가
 * "지금 할 일 / 다음"을 보여주는 데 쓴다 (architecture.md §8.6).
 */
export function currentTask(facts: ProjectFacts): { step: StepId; key: FactKey } | null {
  for (const step of STEP_IDS) {
    if (!isStepUnlocked(step, facts)) continue
    const pending = STEPS[step].tasks.find((key) => !facts[key])
    if (pending !== undefined) return { step, key: pending }
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
export function resolveStep(requested: StepId, facts: ProjectFacts): StepId {
  for (let index = STEP_IDS.indexOf(requested); index >= 0; index -= 1) {
    const step = STEP_IDS[index]
    if (step !== undefined && isStepUnlocked(step, facts)) {
      return step
    }
  }
  return FIRST_STEP
}
