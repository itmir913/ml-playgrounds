// @vitest-environment jsdom
/**
 * **흐름도 쪽 오류도 앱의 오류 알림에 닿는다** (`architecture.md` §8.22, open-decisions.md 85·86).
 *
 * 흐름도의 오류 경계(`FlowGuard`)는 자리를 비우되 오류를 삼키지 않는다. 그래서 진짜 처리기(`installErrorNotice`)를
 * 단 앱에서 — 창의 청크를 못 받으면 `SCREEN_LOAD_FAILED`가, 대시보드 카드가 렌더에서 던지면 알림이 뜨고
 * 대시보드의 할 일·요약은 남는다. `app-error-notice.spec.ts`와 같은 꼴이다.
 */
import 'fake-indexeddb/auto'

import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, type Component, type Plugin } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter, createWebHashHistory } from 'vue-router'

import { installErrorNotice } from '../src/app-errors'
import FlowHost from '../src/components/FlowHost.vue'
import { useFlowDialog } from '../src/composables/useFlowDialog'
import { errorMessageKey } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import { FLOW_GEOMETRY } from '../src/ml/flow-layout'
import { ROUTE_PROJECT_HOME } from '../src/router'
import { STEP_IDS } from '../src/router/steps'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ProjectHomeView from '../src/views/ProjectHomeView.vue'
import { projectFile } from './fixtures/project'

/**
 * 창의 청크를 못 받는다 — 지연 로더가 브라우저 원문으로 거절된다. 모의 공장에서 던지면 vitest가 제 문장으로
 * 감싸므로, 로더가 `default`를 꺼내는 순간 던지게 한다.
 */
vi.mock('@/components/flow/FlowDialog.vue', () => ({
  __esModule: true,
  get default(): never {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/FlowDialog.js')
  },
}))

/** 대시보드 카드가 그리다 던진다. */
vi.mock('@/ml/flow', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ml/flow')>()
  return {
    ...original,
    flowModelOf: vi.fn(() => {
      throw new Error('flow model exploded')
    }),
  }
})

beforeEach(async () => {
  await setLocale('ko')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => FLOW_GEOMETRY.width,
  })
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  useFlowDialog().close()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

/** 진짜 처리기를 단 새 앱에 그 부품을 띄운다. */
function mountWithNotice(root: Component, plugins: Plugin[]) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(root)
  app.use(pinia)
  for (const plugin of plugins) app.use(plugin)
  installErrorNotice(app)
  return { app, host, pinia }
}

describe('흐름도의 오류 알림', () => {
  it('흐름도 창의 청크를 못 받으면 SCREEN_LOAD_FAILED 알림이 뜬다', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { render: () => null } }],
    })
    await router.push('/')
    await router.isReady()
    const { app } = mountWithNotice(FlowHost, [router])
    app.mount(document.body.lastElementChild as HTMLElement)
    useFlowDialog().open(projectFile())
    await flushPromises()
    const toasts = useToastStore()
    expect(toasts.items.map((one) => one.key)).toEqual([errorMessageKey('SCREEN_LOAD_FAILED')])
    expect(String(toasts.items[0]?.params?.detail)).toContain('dynamically imported module')
    // 창만 거두고 앱은 그대로다.
    expect(useFlowDialog().request.value).toBeNull()
    app.unmount()
  })

  it('대시보드 카드가 렌더에서 던지면 알림이 뜨고 할 일과 요약은 남는다', async () => {
    const router = createRouter({
      history: createWebHashHistory(),
      routes: [
        { path: '/', component: { render: () => null } },
        {
          path: '/project/:projectId',
          name: ROUTE_PROJECT_HOME,
          component: { render: () => null },
        },
        ...STEP_IDS.map((step) => ({
          path: `/project/:projectId/${step}`,
          name: step,
          component: { render: () => null },
        })),
      ],
    })
    await router.push({ name: ROUTE_PROJECT_HOME, params: { projectId: 'p1' } })
    await router.isReady()
    const { app, host } = mountWithNotice(ProjectHomeView, [router, i18n])
    useProjectStore().file = projectFile()
    app.mount(host)
    await flushPromises()

    expect(useToastStore().items.map(({ key, params }) => ({ key, params }))).toEqual([
      { key: errorMessageKey('UNEXPECTED_ERROR'), params: { detail: 'flow model exploded' } },
    ])
    for (const step of STEP_IDS)
      expect(host.textContent, step).toContain(i18n.global.t(`steps.${step}.label`))
    expect(host.textContent).toContain(i18n.global.t('meta.title'))
    expect(host.textContent).not.toContain(i18n.global.t('flow.title'))
    app.unmount()
  })
})
