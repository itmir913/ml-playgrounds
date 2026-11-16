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
const behaviour = vi.hoisted(() => ({ explode: false, file: null as unknown }))

vi.mock('@/components/flow/FlowDialog.vue', async () => {
  const vue = await import('vue')
  // 지연 로더가 모듈로 알아보고 `default`를 꺼내게 한다.
  return {
    __esModule: true,
    default: vue.defineComponent({
      props: ['file', 'lite', 'open'],
      emits: ['close'],
      setup(props, { emit }) {
        if (behaviour.explode) throw new Error('dialog exploded')
        return () => {
          // 창이 받은 파일을 남긴다 — 어느 파일을 그리는지를 본다.
          behaviour.file = props.file
          return vue.h('button', { class: 'stub-close', onClick: () => emit('close') }, 'close')
        }
      },
    }),
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
  behaviour.file = null
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
})
