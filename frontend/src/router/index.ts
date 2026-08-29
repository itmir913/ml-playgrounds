/**
 * 라우터. **해시 모드다** — GitHub Pages에는 SPA 재작성 규칙이 없어서 history 모드로
 * 두면 학생이 F5를 누르는 순간 404가 난다 (architecture.md §8.1).
 *
 * 셸은 라우트가 아니라 App.vue에 있다 (§8.6). 그래서 여기 라우트는 전부 평평하고,
 * 바뀌는 것은 작업 공간 안쪽뿐이다.
 *
 * 판단은 여기 있지 않다. 단계 진입 조건은 steps.ts의 순수 함수이고 이 파일은
 * 그것을 호출하기만 한다 (§8.3).
 */

import {
  createRouter,
  createWebHashHistory,
  type RouteRecordRaw,
  type RouteRecordSingleView,
} from 'vue-router'

import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import { isStepId, resolveStep, STEP_IDS, type StepId } from './steps'

/** 프로젝트 목록. 단계가 아니므로 STEP_IDS에 없다. */
export const ROUTE_PROJECTS = 'projects'

/**
 * 프로젝트 홈. **프로젝트를 열면 여기로 온다.**
 *
 * 예전에는 첫 단계로 곧장 리다이렉트했는데 그건 홈이 없어서 쓴 우회였고, 파라미터를
 * 잃는 버그까지 있었다. 학생이 파일을 열었을 때 보고 싶은 것은 "어디까지 했더라"다.
 */
export const ROUTE_PROJECT_HOME = 'project'

/**
 * 단계 -> 화면. **`if`로 고르지 않는다** — 이 표 하나가 라우트 목록의 출처이고,
 * 레일도 같은 STEP_IDS를 쓰므로 둘이 어긋날 수 없다.
 *
 * 전부 지연 로딩이다. 학생이 데이터만 올리고 나가는 경우에 결과 분석 화면까지
 * 받게 할 이유가 없다 — 학교 회선에서 첫 화면이 뜨는 시간이 그만큼 늘어난다.
 */
const STEP_VIEWS: Readonly<Record<StepId, RouteRecordSingleView['component']>> = {
  data: () => import('@/views/DataView.vue'),
  preprocess: () => import('@/views/PreprocessView.vue'),
  train: () => import('@/views/TrainView.vue'),
  results: () => import('@/views/ResultsView.vue'),
  predict: () => import('@/views/PredictView.vue'),
  portfolio: () => import('@/views/PortfolioView.vue'),
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: ROUTE_PROJECTS,
    component: () => import('@/views/WelcomeView.vue'),
  },
  {
    path: '/project/:projectId',
    name: ROUTE_PROJECT_HOME,
    component: () => import('@/views/ProjectHomeView.vue'),
  },
  ...STEP_IDS.map((step) => ({
    path: `/project/:projectId/${step}`,
    name: step,
    component: STEP_VIEWS[step],
  })),
  // 없는 주소는 목록으로 보낸다. 학생에게 404 화면을 보여줄 이유가 없다.
  //
  // **`params: {}`가 필요하다.** 안 주면 vue-router가 이 패턴이 잡은 `pathMatch`를
  // 목적지에도 넘기려다 버리면서 경고를 낸다. 동작은 같지만 검사 로그가 매번
  // 더러워지고, **무시할 경고가 쌓이면 진짜 경고를 같이 무시하게 된다.**
  { path: '/:pathMatch(.*)*', redirect: { name: ROUTE_PROJECTS, params: {} } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 단계를 옮기면 위에서 시작한다. 긴 화면에서 스크롤이 남아 있으면 학생이 길을 잃는다.
  scrollBehavior: () => ({ top: 0 }),
})

/**
 * 이동이 **시작될 때** 떠 있던 알림의 수위선 (2026-08-29 화면 실측 B-8). 아래
 * `afterEach`가 이것 이하를 걷는다 — 자세한 이유는 그쪽 주석에 있다.
 *
 * **가드의 맨 앞에서 잡는다.** 이 가드가 곧이어 flush 실패 알림을 밀기 때문에, 그보다
 * 뒤에서 잡으면 방금 민 것까지 걷어 갈 대상이 된다.
 *
 * **리다이렉트로 가드가 다시 돌 때는 안 잡는다.** 두 번째 통과에서 다시 잡으면 첫
 * 통과가 민 알림이 수위선 아래로 들어간다.
 */
let toastWatermark: number | null = null

router.beforeEach(async (to) => {
  if (toastWatermark === null) toastWatermark = useToastStore().highWaterMark()
  const project = useProjectStore()
  // 미뤄 둔 자동 저장을 끝내고 나간다. 화면을 옮기는 사이에 잃는 것이 없어야 한다.
  //
  // **여기서 잡지 않으면 아무 일도 안 일어난다.** flush()는 STORAGE_QUOTA_EXCEEDED를
  // 되던지는데(storage.ts의 ensureRoom, 그리고 실제 쓰기의 QuotaExceededError) 가드가
  // 던지면 vue-router는 이동을 취소하고, 우리에게는 router.onError도 전역 errorHandler도
  // 없다 - 학생은 [다음]을 눌렀는데 화면이 안 바뀌는 것만 본다.
  // storage.ts 머리말이 "저장 실패는 삼키지 않는다. 화면이 반드시 알아야 한다"고 적은
  // 자리이고, 다른 두 경로(update()의 타이머, 화면의 save())는 그 약속을 지킨다.
  //
  // **막지는 않는다.** 같은 프로젝트 안에서는 값이 메모리에 그대로 있고 dirty도 그대로라
  // 다음 저장이 다시 시도한다. 못 나가게 붙들면 저장이 안 되는 학생이 갇힌다.
  try {
    await project.flush()
  } catch (error) {
    useToastStore().pushError(error)
  }

  const { projectId } = to.params
  if (typeof projectId !== 'string') {
    // **프로젝트를 떠난다는 것을 아는 곳은 여기다.** 예전에는 목록 화면이 뜰 때
    // onMounted에서 닫았는데, 그러면 정리가 화면의 생명주기에 매인다 - 화면이 안
    // 뜨거나 순서가 어긋나면 열어 둔 프로젝트가 그대로 남아 도구 막대에 남의 이름이
    // 계속 보인다. 데이터셋 바이트도 함께 붙들려 있다.
    project.close()
    return true
  }

  if (!(await project.open(projectId))) {
    return { name: ROUTE_PROJECTS }
  }

  if (!isStepId(to.name)) {
    return true
  }
  const allowed = resolveStep(to.name, project.facts, project.taskType, project.dataType)
  return allowed === to.name ? true : { name: allowed, params: to.params }
})

/**
 * **떠나는 화면의 알림을 걷는다** (2026-08-29 화면 실측 B-8).
 *
 * 오류 알림은 스스로 사라지지 않는다(`stores/toasts.ts`의 `AUTO_DISMISS`) - 학생이
 * 읽어야 하는 것이라 그게 맞다. 그런데 **자기 화면을 벗어나서까지 남아** 다음 단계의
 * 첫 선택지를 덮고 있었다. 전처리에서 오류 둘을 내고 레일로 학습에 가면 기계학습 유형
 * 버튼 줄이 가려졌다.
 *
 * **통째로 지우지 않고 수위선 이하만 걷는다.** 이 가드가 **이동 도중에도** 알림을
 * 밀기 때문이다(위 flush 실패) - 그건 방금 일어난 일이라 새 화면에서 읽혀야 한다.
 *
 * **`beforeEach`가 아니라 `afterEach`다.** 리다이렉트가 걸리면 `beforeEach`는 다시
 * 돌지만 `afterEach`는 다 풀린 뒤 한 번만 돈다.
 */
router.afterEach(() => {
  useToastStore().dismissUpTo(toastWatermark ?? 0)
  toastWatermark = null
})
