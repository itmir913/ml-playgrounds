// @vitest-environment jsdom
/**
 * **점검의 "행 수 없이 그린다"는 배선 넷을 지나서야 선다** (`architecture.md` §8.22).
 *
 * `InspectView`의 `FlowOpenButton lite` → `useFlowDialog().open({ lite })` → `FlowHost`의 `:lite` →
 * `FlowDialog`의 `useFlowCounts(() => props.lite)` → `flowCountsLite`. 넷 중 하나가 끊겨도 그림은 멀쩡히 서고 점검이
 * 계획 캐시를 채울 뿐이라 눈에는 안 보인다. 이 파일은 **진짜 `FlowHost`와 진짜 `FlowDialog`를 세워** 뒤의 둘을
 * 문다. 앞의 둘은 `flow-wiring.spec.ts`("점검이면 행 수 없이 그리라고 알린다")와 `inspect-rules.spec.ts`("점검의
 * 흐름도 단추는 lite로 연다")가, 중간 대역 쪽은 `flow-host.spec.ts`가 문다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import FlowHost from '../src/components/FlowHost.vue'
import { useFlowDialog } from '../src/composables/useFlowDialog'
import { i18n, setLocale } from '../src/i18n'
import { holdsTabularPlan } from '../src/ml/plan-cache'
import { forgetTabularPlan } from '../src/ml/plan-cache-reset'
import { surveyProject } from './fixtures/prep-kind'

/** 어느 입구가 불렸는가. 진짜 구현을 그대로 부르고 횟수만 센다. */
const entries = vi.hoisted(() => ({ lite: 0, full: 0 }))

vi.mock('@/ml/flow-counts', async (original) => {
  const actual = await original<typeof import('../src/ml/flow-counts')>()
  return {
    ...actual,
    flowCountsLite: (...args: Parameters<typeof actual.flowCountsLite>) => {
      entries.lite += 1
      return actual.flowCountsLite(...args)
    },
    flowCountsOf: (...args: Parameters<typeof actual.flowCountsOf>) => {
      entries.full += 1
      return actual.flowCountsOf(...args)
    },
  }
})

/** 창과 수 모듈은 지연해서 받는다 — 처음 받는 청크가 느린 PC에서 기본 대기보다 오래 걸린다. */
const WAIT = { timeout: 15_000 }

beforeEach(async () => {
  setActivePinia(createPinia())
  // jsdom의 `<dialog>`는 열림을 모른다 — 열림만 세우는 대역이다.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
  await setLocale('ko')
  forgetTabularPlan()
  entries.lite = 0
  entries.full = 0
})

afterEach(() => {
  // 검사가 중간에 던져도 창을 거둔다 — 남으면 다음 검사의 요청을 낡은 창이 같이 받는다.
  mounted?.unmount()
  mounted = null
  useFlowDialog().close()
  document.body.innerHTML = ''
})

let mounted: ReturnType<typeof mount> | null = null

async function mountHost() {
  const Blank = defineComponent({ render: () => h('div') })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: Blank }],
  })
  await router.push('/')
  await router.isReady()
  mounted = mount(FlowHost, { global: { plugins: [router, i18n] }, attachTo: document.body })
}

describe('점검의 흐름도는 가벼운 입구로만 수를 구한다', () => {
  it('lite로 열면 flowCountsLite만 부르고 계획 캐시를 채우지 않는다', async () => {
    await mountHost()
    useFlowDialog().open(await surveyProject(true), { lite: true })
    await vi.waitFor(() => expect(entries.lite, 'lite entry must be called').toBe(1), WAIT)
    await flushPromises()
    expect(entries.full, 'full entry must stay untouched').toBe(0)
    expect(holdsTabularPlan(), 'inspection must not fill the plan cache').toBe(false)
  })

  it('lite가 아니면 flowCountsOf를 부르고 계획 캐시가 찬다 — 위 검사가 헛돌지 않는다는 짝', async () => {
    await mountHost()
    useFlowDialog().open(await surveyProject(true))
    await vi.waitFor(() => expect(entries.full, 'full entry must be called').toBe(1), WAIT)
    await flushPromises()
    expect(entries.lite).toBe(0)
    expect(holdsTabularPlan()).toBe(true)
  })
})
