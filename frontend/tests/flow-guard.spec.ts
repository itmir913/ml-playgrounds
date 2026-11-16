// @vitest-environment jsdom
/**
 * **흐름도가 던져도 대시보드는 그대로 그려진다** (`components/flow/FlowGuard.vue`, `architecture.md` §8.22).
 *
 * 흐름도의 모델 함수가 일부러 던지게 만들고 대시보드를 마운트한다 — 할 일 줄과 요약이 서야 하고, 오류는 콘솔에
 * 남는다(삼키되 조용하지 않다). 창의 지연 로딩이 실패하는 경우도 같다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
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

/** 전역 처리기를 앱 설치 때 단다. */
const withHandler = {
  install(app: { config: { errorHandler?: unknown } }) {
    app.config.errorHandler = handler
  },
}

let errors: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  setActivePinia(createPinia())
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
  it.skip('할 일 줄과 요약이 그려지고 오류는 콘솔에 남는다', async () => {
    useProjectStore().file = projectFile()
    const router = stubRouter()
    await router.push({ name: ROUTE_PROJECT_HOME, params: { projectId: 'p1' } })
    await router.isReady()
    const home = mount(ProjectHomeView, {
      global: { plugins: [router, i18n, withHandler] },
    })
    await flushPromises()

    // 할 일: 단계 여섯 줄. 요약: 프로젝트 요약 카드.
    for (const step of STEP_IDS)
      expect(home.text(), step).toContain(i18n.global.t(`steps.${step}.label`))
    expect(home.text()).toContain(i18n.global.t('meta.title'))
    // 흐름도 카드는 자리만 비었다.
    expect(home.text()).not.toContain(i18n.global.t('flow.title'))
    expect(errors).toHaveBeenCalled()
    expect(handler).toHaveBeenCalled()
    expect(String(errors.mock.calls[0]?.[0])).toContain('project flow diagram')
    home.unmount()
  })
})

describe('오류 경계', () => {
  it.skip('안쪽이 던지면 자리를 비우고 failed를 올린다', async () => {
    const Boom = {
      setup() {
        throw new Error('boom')
      },
      template: '<p>never</p>',
    }
    const wrapper = mount(FlowGuard, {
      slots: { default: Boom },
      global: { plugins: [withHandler] },
    })
    await flushPromises()
    expect(wrapper.text()).toBe('')
    expect(wrapper.emitted('failed')).toHaveLength(1)
    expect(errors).toHaveBeenCalled()
    // 삼키지 않는다 — 전역 처리기(오류 알림)까지 올라간다.
    expect(handler).toHaveBeenCalled()
  })

  it('지연 로딩이 실패해도 같다', async () => {
    const { defineAsyncComponent, h } = await import('vue')
    const Lazy = defineAsyncComponent(() => Promise.reject(new Error('SCREEN_LOAD_FAILED')))
    const wrapper = mount(
      { render: () => h(FlowGuard, null, { default: () => h(Lazy) }) },
      { global: { plugins: [withHandler] } },
    )
    await flushPromises()
    expect(wrapper.text()).toBe('')
    expect(handler).toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
  })

  it('던지지 않으면 그대로 그린다', () => {
    const wrapper = mount(FlowGuard, { slots: { default: '<p>ok</p>' } })
    expect(wrapper.text()).toBe('ok')
    expect(wrapper.emitted('failed')).toBeUndefined()
  })
})
