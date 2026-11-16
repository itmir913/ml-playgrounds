// @vitest-environment jsdom
/**
 * **흐름도가 던져도 대시보드는 그대로 그려진다** (`components/flow/FlowGuard.vue`, `architecture.md` §8.22).
 *
 * 흐름도의 모델 함수가 일부러 던지게 만들고 대시보드를 마운트한다 — 할 일 줄과 요약이 서야 하고, 오류는 콘솔에
 * 남고 전역 처리기까지 올라간다(자리는 비우되 삼키지 않는다). 창의 지연 로딩이 실패하는 경우도 같다.
 *
 * **`@vue/test-utils`의 `mount`를 쓰지 않는 검사가 있다** — 그 `mount`는 마운트 중 처리기에 닿은 오류를 모아
 * 다시 던진다. 경계가 오류를 위로 올리므로 그 길에서는 `mount`가 늘 던진다. 진짜 앱처럼 `createApp`에 처리기를
 * 달아 띄운다(`app-error-notice.spec.ts`와 같은 꼴).
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createApp, defineAsyncComponent, h, type Component, type Plugin } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'

import FlowGuard from '../src/components/flow/FlowGuard.vue'
import { i18n, setLocale } from '../src/i18n'
import { FLOW_GEOMETRY } from '../src/ml/flow-layout'
import { ROUTE_PROJECT_HOME } from '../src/router'
import { STEP_IDS } from '../src/router/steps'
import { useProjectStore } from '../src/stores/project'
import ProjectHomeView from '../src/views/ProjectHomeView.vue'
import { projectFile } from './fixtures/project'

vi.mock('@/ml/flow', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ml/flow')>()
  return {
    ...original,
    flowModelOf: vi.fn(() => {
      throw new Error('flow model exploded')
    }),
  }
})

function stubRouter() {
  return createRouter({
    history: createWebHashHistory(),
    routes: [
      { path: '/', name: 'projects', component: { template: '<div />' } },
      { path: '/project/:projectId', name: ROUTE_PROJECT_HOME, component: { template: '<div />' } },
      ...STEP_IDS.map((step) => ({
        path: `/project/:projectId/${step}`,
        name: step,
        component: { template: '<div />' },
      })),
    ],
  })
}

/** 전역 오류 처리기 대역 — 경계가 오류를 삼키지 않고 위로 올리는지 본다(결정문 85·86). */
const handler = vi.fn()

let pinia: Pinia
let errors: ReturnType<typeof vi.spyOn>

/** 처리기를 단 새 앱에 그 부품을 띄운다. */
function mountWithHandler(root: Component, plugins: Plugin[] = []) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(root)
  app.use(pinia)
  for (const plugin of plugins) app.use(plugin)
  app.config.errorHandler = handler
  app.mount(host)
  return {
    host,
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}

/** 콘솔에 남긴 첫 줄 — 경계가 남기는 원문인지 본다. */
function firstLogged(): string {
  return String(errors.mock.calls[0]?.[0])
}

beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  await setLocale('ko')
  handler.mockReset()
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => FLOW_GEOMETRY.width,
  })
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  errors.mockRestore()
})

describe('흐름도 모델이 던져도 대시보드가 선다', () => {
  it('할 일 줄과 요약이 그려지고 오류는 콘솔에 남는다', async () => {
    useProjectStore().file = projectFile()
    const router = stubRouter()
    await router.push({ name: ROUTE_PROJECT_HOME, params: { projectId: 'p1' } })
    await router.isReady()
    const home = mountWithHandler(ProjectHomeView, [router, i18n])
    await flushPromises()

    // 할 일: 단계 여섯 줄. 요약: 프로젝트 요약 카드.
    for (const step of STEP_IDS)
      expect(home.host.textContent, step).toContain(i18n.global.t(`steps.${step}.label`))
    expect(home.host.textContent).toContain(i18n.global.t('meta.title'))
    // 흐름도 카드는 자리만 비었다.
    expect(home.host.textContent).not.toContain(i18n.global.t('flow.title'))
    expect(firstLogged()).toContain('project flow diagram')
    expect(handler).toHaveBeenCalled()
    home.unmount()
  })
})

describe('오류 경계', () => {
  it('안쪽이 던지면 자리를 비우고 failed를 올린다', async () => {
    const Boom = {
      setup() {
        throw new Error('boom')
      },
      render: () => h('p', 'never'),
    }
    const onFailed = vi.fn()
    const guard = mountWithHandler({
      render: () => h(FlowGuard, { onFailed }, { default: () => h(Boom) }),
    })
    await flushPromises()
    expect(guard.host.textContent).toBe('')
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(firstLogged()).toContain('project flow diagram')
    // 삼키지 않는다 — 전역 처리기(오류 알림)까지 올라간다.
    expect(handler).toHaveBeenCalledTimes(1)
    guard.unmount()
  })

  it('지연 로딩이 실패해도 같다', async () => {
    const Lazy = defineAsyncComponent(() => Promise.reject(new Error('chunk gone')))
    const onFailed = vi.fn()
    const guard = mountWithHandler({
      render: () => h(FlowGuard, { onFailed }, { default: () => h(Lazy) }),
    })
    await flushPromises()
    expect(guard.host.textContent).toBe('')
    expect(onFailed).toHaveBeenCalledTimes(1)
    expect(String(onFailed.mock.calls[0]?.[0])).toContain('chunk gone')
    expect(firstLogged()).toContain('project flow diagram')
    expect(handler).toHaveBeenCalledTimes(1)
    guard.unmount()
  })

  it('던지지 않으면 그대로 그린다', () => {
    const wrapper = mount(FlowGuard, { slots: { default: '<p>ok</p>' } })
    expect(wrapper.text()).toBe('ok')
    expect(wrapper.emitted('failed')).toBeUndefined()
  })
})
