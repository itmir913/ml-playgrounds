/**
 * 워크플로 단계와 그 진입 조건.
 *
 * **단계는 컴포넌트 안의 상태가 아니라 라우트다** (architecture.md §8.2). 그리고
 * "여기 들어가도 되는가"는 **컴포넌트 밖의 순수 함수여야 한다** (§8.3) — 조건 하나를
 * 확인하려고 화면 전체를 마운트해야 하면 아무도 그 조건을 테스트하지 않는다.
 *
 * 이 순서는 **학생이 프로젝트를 만들어 가는 워크플로**다. 수행평가 진행 순서가 아니다.
 */

/** 화면에 나오는 순서 그대로다. 이 배열이 탭바의 순서이자 되돌아갈 순서다. */
export const STEP_IDS = ['data', 'preprocess', 'train', 'results', 'predict', 'portfolio'] as const

export type StepId = (typeof STEP_IDS)[number]

/** 프로젝트를 처음 열었을 때 학생이 시작하는 곳. */
export const FIRST_STEP: StepId = 'data'

/**
 * 단계 잠금을 푸는 데 필요한 사실들. **프로젝트 문서가 아니라 이 네 개만 본다.**
 *
 * 문서 전체를 넘기면 이 파일이 스키마를 알게 되고, 스키마가 바뀔 때마다 진입 조건이
 * 함께 흔들린다. 여기가 알아야 하는 것은 "데이터가 있는가" 수준이다.
 */
export interface ProjectProgress {
  /** 표가 올라와 있는가. */
  readonly hasDataset: boolean
  /** 무엇을 무엇으로 예측할지, 어떤 알고리즘을 쓸지가 정해졌는가. */
  readonly hasSettings: boolean
  /** 학습을 한 번이라도 끝냈는가. 실패한 것도 결과다. */
  readonly hasRuns: boolean
  /** 예측에 쓸 수 있는 모델이 실제로 담겨 있는가. 예산에서 밀리면 지표만 남는다. */
  readonly hasModels: boolean
}

/** 아직 아무것도 없는 상태. 프로젝트가 열리기 전에도 판정은 돌아야 한다. */
export const NO_PROGRESS: ProjectProgress = {
  hasDataset: false,
  hasSettings: false,
  hasRuns: false,
  hasModels: false,
}

/**
 * 단계별 잠금 해제 조건.
 *
 * `data`와 `portfolio`는 언제나 열려 있다. 데이터는 시작점이고, **포트폴리오는 학생이
 * 하는 도중에 쓰는 것**이라 결과가 나올 때까지 막으면 쓰던 글을 잃는다.
 */
const UNLOCKED: Readonly<Record<StepId, (progress: ProjectProgress) => boolean>> = {
  data: () => true,
  preprocess: (progress) => progress.hasDataset,
  train: (progress) => progress.hasDataset && progress.hasSettings,
  results: (progress) => progress.hasRuns,
  predict: (progress) => progress.hasModels,
  portfolio: () => true,
}

export function isStepId(value: unknown): value is StepId {
  return typeof value === 'string' && (STEP_IDS as readonly string[]).includes(value)
}

export function isStepUnlocked(step: StepId, progress: ProjectProgress): boolean {
  return UNLOCKED[step](progress)
}

/**
 * 요청한 단계가 잠겨 있으면 **그 앞에서 가장 가까운 열린 단계**를 돌려준다.
 *
 * 프로젝트 목록으로 쫓아내지 않는 이유는, 학생이 주소를 직접 치는 경우보다 **아직
 * 안 되는 탭을 누르는 경우**가 훨씬 흔하기 때문이다. 그때 필요한 것은 "여기까지는
 * 됐고 다음은 이것"이라는 자리이지 처음으로 돌아가는 것이 아니다.
 *
 * `data`가 언제나 열려 있으므로 돌려줄 것이 없는 경우는 생기지 않는다.
 */
export function resolveStep(requested: StepId, progress: ProjectProgress): StepId {
  for (let index = STEP_IDS.indexOf(requested); index >= 0; index -= 1) {
    const step = STEP_IDS[index]
    if (step !== undefined && isStepUnlocked(step, progress)) {
      return step
    }
  }
  return FIRST_STEP
}
