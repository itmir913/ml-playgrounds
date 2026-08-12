// @vitest-environment jsdom
// 화면을 실제로 마운트한다 - 여기서 잡으려는 것은 눈으로만 보이는 결함이다.
/**
 * 대시보드(`views/ProjectHomeView.vue`)가 **모든 종류에서 문장을 갖는지.**
 *
 * **실제로 깨졌다** (2026-08-13). 이 화면이 `steps.${step}.purpose`를 손으로 조립했는데,
 * 그 셋은 종류가 갖도록 옮겨져 `steps.*`에 없다. 화면에는 `steps.data.purpose`라는
 * **키 문자열이 그대로** 떴고, 그날까지의 어떤 검사도 울지 않았다 — 조립된 키의 뒷부분은
 * 정적으로 알 수 없기 때문이다.
 *
 * **그래서 도는 것을 본다.** `i18n`이 없는 키를 만나면 검사 환경에서 던지도록 해 두었고
 * (`src/i18n.ts`의 `missing`), 여기서 화면을 띄우는 것만으로 그 그물에 걸린다.
 *
 * 종류마다 한 번씩 띄운다 — 갈리는 문장이 종류마다 다른 자리에 있다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'

import ProjectHomeView from '../src/views/ProjectHomeView.vue'
import { SUPPORTED_DATA_TYPES } from '../src/data/kinds'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { ROUTE_PROJECT_HOME } from '../src/router'
import { STEP_IDS } from '../src/router/steps'
import type { DataType } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'

function stubRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'projects', component: { template: '<div />' } },
      {
        path: '/project/:projectId',
        name: ROUTE_PROJECT_HOME,
        component: { template: '<div />' },
      },
      ...STEP_IDS.map((step) => ({
        path: `/project/:projectId/${step}`,
        name: step,
        component: { template: '<div />' },
      })),
    ],
  })
}

/** 데이터가 아직 없는 프로젝트. **대시보드가 가장 많은 말을 하는 상태다** - 전부 잠겨 있다. */
function freshProject(dataType: DataType): ProjectFile {
  const document = newProjectDocument(
    { name: '테스트', locale: 'ko', dataType },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-13T00:00:00.000Z',
      randomState: 42,
    },
  )
  return { document, models: new Map(), images: new Map(), embeddings: new Map() }
}

async function mountHome(dataType: DataType) {
  useProjectStore().file = freshProject(dataType)
  const router = stubRouter()
  await router.push({ name: ROUTE_PROJECT_HOME, params: { projectId: 'p1' } })
  await router.isReady()
  return mount(ProjectHomeView, { global: { plugins: [router, i18n] } })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

describe('대시보드는 모든 종류에서 문장을 갖는다', () => {
  for (const dataType of SUPPORTED_DATA_TYPES) {
    it(`${dataType}에서 로케일 키가 화면에 뜨지 않는다`, async () => {
      const home = await mountHome(dataType)
      const text = home.text()
      // 던지지 않고 여기까지 왔다는 것이 이미 절반이다. 나머지 절반은 눈으로 보이는 모양이다 -
      // 키가 로케일에 **있으면서** 값이 키와 같은 경우까지 막는다.
      expect(text).not.toMatch(/steps[.]\w+[.](purpose|locked)/)
      expect(text).not.toMatch(/tasks[.]\w+/)
    })
  }
})
