// @vitest-environment jsdom
/**
 * **흐름도 창이 사는 자리** (`components/FlowHost.vue`, `architecture.md` §8.22).
 *
 * 창 본체는 대역으로 바꾼다 — 여기서 보는 것은 창을 언제 세우고 언제 거두는가다. 라우트가 바뀌면 닫고, 닫으면
 * 연 단추로 초점을 돌려주고, 경계가 `failed`를 올리면 요청을 지운다.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, toRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import FlowHost from '../src/components/FlowHost.vue'
import { useFlowDialog } from '../src/composables/useFlowDialog'
import type { ProjectFile } from '../src/project/format'
import { useProjectStore } from '../src/stores/project'
import { projectFile } from './fixtures/project'

/** 창 대역의 행동. 검사마다 바꾼다. */
const behaviour = vi.hoisted(() => ({
  explode: false,
  /** 남은 청크 실패 수. 지연 로더가 `default`를 꺼낼 때마다 하나씩 쓴다. */
  loadFailures: 0,
  file: null as unknown,
  /** 창이 받은 `lite`. 점검이 행 수 없이 그리는 배선의 가운데 고리다(`flow-lite-wiring.spec.ts`가 끝까지 잇는다). */
  lite: null as unknown,
}))

vi.mock('@/components/flow/FlowDialog.vue', async () => {
  const vue = await import('vue')
  const Stub = vue.defineComponent({
    props: ['file', 'lite', 'open'],
    emits: ['close'],
    setup(props, { emit }) {
      if (behaviour.explode) throw new Error('dialog exploded')
      return () => {
        // 창이 받은 파일을 남긴다 — 어느 파일을 그리는지를 본다.
        behaviour.file = props.file
        behaviour.lite = props.lite
        return vue.h('button', { class: 'stub-close', onClick: () => emit('close') }, 'close')
      }
    },
  })
  // 지연 로더가 모듈로 알아보고 `default`를 꺼내게 한다. 꺼낼 때 던지면 청크를 못 받은 것과 같다.
  return {
    __esModule: true,
    get default() {
      if (behaviour.loadFailures > 0) {
        behaviour.loadFailures -= 1
        throw new TypeError('Failed to fetch dynamically imported module: /assets/FlowDialog.js')
      }
      return Stub
    },
  }
})

function makeRouter() {
  const Blank = defineComponent({ render: () => h('div') })
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: Blank },
      { path: '/other', component: Blank },
    ],
  })
}

let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setActivePinia(createPinia())
  behaviour.explode = false
  behaviour.loadFailures = 0
  behaviour.file = null
  behaviour.lite = null
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  useFlowDialog().close()
  errors.mockRestore()
  document.body.innerHTML = ''
})

async function mountHost() {
  const router = makeRouter()
  await router.push('/')
  await router.isReady()
  const host = mount(FlowHost, { global: { plugins: [router] }, attachTo: document.body })
  return { host, router }
}

describe('흐름도 창의 자리', () => {
  it('요청이 없으면 아무것도 그리지 않는다', async () => {
    const { host } = await mountHost()
    expect(host.find('.stub-close').exists()).toBe(false)
    host.unmount()
  })

  it('라우트가 바뀌면 창을 닫는다', async () => {
    const { host, router } = await mountHost()
    useFlowDialog().open(projectFile())
    await flushPromises()
    expect(host.find('.stub-close').exists()).toBe(true)
    await router.push('/other')
    await flushPromises()
    expect(useFlowDialog().request.value).toBeNull()
    expect(host.find('.stub-close').exists()).toBe(false)
    host.unmount()
  })

  it('닫으면 연 단추로 초점을 돌려준다', async () => {
    const { host } = await mountHost()
    const opener = document.createElement('button')
    document.body.append(opener)
    useFlowDialog().open(projectFile(), { opener })
    await flushPromises()
    await host.find('.stub-close').trigger('click')
    await flushPromises()
    expect(useFlowDialog().request.value).toBeNull()
    expect(document.activeElement).toBe(opener)
    host.unmount()
  })

  /** 같은 프로젝트의 다른 판(학습이 끝나 바뀐 파일)을 만든다. id만 바꾸면 다른 프로젝트다. */
  function variant(base: ProjectFile, projectId: string): ProjectFile {
    return {
      ...base,
      document: { ...base.document, manifest: { ...base.document.manifest, projectId } },
    }
  }

  it('열린 프로젝트의 창이면 스토어의 최신 파일을 그린다', async () => {
    const opened = projectFile()
    const live = variant(opened, opened.document.manifest.projectId)
    useProjectStore().file = live
    const { host } = await mountHost()
    useFlowDialog().open(opened)
    await flushPromises()
    expect(toRaw(behaviour.file)).toBe(toRaw(live))
    host.unmount()
  })

  it('다른 프로젝트의 창이면 연 파일 그대로다', async () => {
    const opened = projectFile()
    useProjectStore().file = variant(opened, 'someone-else')
    const { host } = await mountHost()
    useFlowDialog().open(opened)
    await flushPromises()
    expect(toRaw(behaviour.file)).toBe(toRaw(opened))
    host.unmount()
  })

  it('점검(lite)은 같은 프로젝트라도 연 순간의 파일 그대로다', async () => {
    const opened = projectFile()
    useProjectStore().file = variant(opened, opened.document.manifest.projectId)
    const { host } = await mountHost()
    useFlowDialog().open(opened, { lite: true })
    await flushPromises()
    expect(toRaw(behaviour.file)).toBe(toRaw(opened))
    host.unmount()
  })

  it('요청의 lite를 창에 그대로 넘긴다 — 점검은 true, 보통은 false', async () => {
    const { host } = await mountHost()
    useFlowDialog().open(projectFile(), { lite: true })
    await flushPromises()
    expect(behaviour.lite, 'inspection request must reach the dialog as lite').toBe(true)
    useFlowDialog().close()
    await flushPromises()
    useFlowDialog().open(projectFile())
    await flushPromises()
    expect(behaviour.lite, 'normal request must reach the dialog as not lite').toBe(false)
    host.unmount()
  })

  it('창이 던지면 경계의 failed로 요청을 지운다', async () => {
    behaviour.explode = true
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const { createApp } = await import('vue')
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(FlowHost)
    app.use(createPinia())
    app.use(router)
    // 경계가 오류를 위로 올린다 — `mount`는 그 오류를 다시 던지므로 처리기를 단 앱으로 띄운다.
    const handler = vi.fn()
    app.config.errorHandler = handler
    app.mount(root)
    useFlowDialog().open(projectFile())
    await flushPromises()
    expect(useFlowDialog().request.value, 'failed must clear the request').toBeNull()
    expect(handler).toHaveBeenCalledTimes(1)
    expect(root.textContent).toBe('')
    app.unmount()
  })

  it('청크를 한 번 못 받아도 다음에 열면 다시 받는다', async () => {
    behaviour.loadFailures = 1
    // 교실 와이파이가 잠깐 끊겨 창의 청크를 못 받아도, 다시 열면 다시 받아야 한다. Vue의 지연 부품이 실패한 요청을
    // 버리는 것(`defineAsyncComponent`의 `onError`가 쥔 요청을 비운다)에 기댄다 — Vue가 바뀌어 실패를 쥐고 있게 되면 여기서 운다.
    // 창의 지연 부품은 모듈에 산다 — 앞 검사가 이미 받아 두었으면 실패가 안 닿는다. 모듈을 새로 들인다.
    vi.resetModules()
    const { default: FreshHost } = await import('../src/components/FlowHost.vue')
    const { useFlowDialog: freshDialog } = await import('../src/composables/useFlowDialog')
    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const { createApp } = await import('vue')
    const root = document.createElement('div')
    document.body.append(root)
    const app = createApp(FreshHost)
    app.use(createPinia())
    app.use(router)
    app.config.errorHandler = vi.fn()
    app.mount(root)
    freshDialog().open(projectFile())
    await flushPromises()
    expect(freshDialog().request.value, 'first open fails and closes').toBeNull()
    freshDialog().open(projectFile())
    await flushPromises()
    expect(root.querySelector('.stub-close'), 'second open loads the dialog').not.toBeNull()
    app.unmount()
  })
})
