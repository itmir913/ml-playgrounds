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
  { path: '/:pathMatch(.*)*', redirect: { name: ROUTE_PROJECTS } },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
  // 단계를 옮기면 위에서 시작한다. 긴 화면에서 스크롤이 남아 있으면 학생이 길을 잃는다.
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach(async (to) => {
  const project = useProjectStore()
  // 미뤄 둔 자동 저장을 끝내고 나간다. 화면을 옮기는 사이에 잃는 것이 없어야 한다.
  await project.flush()

  const { projectId } = to.params
  if (typeof projectId !== 'string') {
    return true
  }

  if (!(await project.open(projectId))) {
    return { name: ROUTE_PROJECTS }
  }

  if (!isStepId(to.name)) {
    return true
  }
  const allowed = resolveStep(to.name, project.facts)
  return allowed === to.name ? true : { name: allowed, params: to.params }
})
