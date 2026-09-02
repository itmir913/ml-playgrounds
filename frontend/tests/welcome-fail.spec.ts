// @vitest-environment jsdom
/**
 * **시작 화면의 실패 경로.** 학생이 눌렀는데 **아무 일도 안 일어나거나, 화면이 잠긴 채
 * 안 풀리는** 것을 잡는다.
 *
 * **스물세 라운드가 전부 성공 경로를 겨눴다** (2026-09-02 R23). 그동안 실패 쪽은
 * `catch`의 알림을 지우거나 `finally`의 `done()`을 지워도 **관문이 초록이었다** —
 * 열한 자리에서 그랬고, 그중 하나는 학생을 화면에 가두는 모양이었다.
 *
 * **여기서 재는 것은 셋이다**: 잠금이 풀리는가 · 학생에게 말하는가 · 잃은 것이 없는가.
 *
 * 씨앗: 손상된 `.mlpx` · 빈 파일 · `arrayBuffer` 거절 · 저장 쿼터 거절.
 * **파일 읽기 실패가 가장 먼저 오는 화면인데 읽은 사람이 없었다.**
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientError } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { ROUTE_PROJECTS, router } from '../src/router'
import { useToastStore } from '../src/stores/toasts'
import WelcomeView from '../src/views/WelcomeView.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'
import { writeProjectBytes } from './fixtures/write'

const gate = vi.hoisted(() => ({ failSave: false }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (gate.failSave) {
        throw new ClientError('STORAGE_QUOTA_EXCEEDED', { requiredMb: 9, availableMb: 1 })
      }
      return actual.saveProject(file)
    },
  }
})

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

interface ViewInternals {
  busy: boolean
  creating: boolean
  ready: boolean
}

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  gate.failSave = false
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

async function welcome() {
  const wrapper = mount(WelcomeView, { global: { plugins: [router, i18n] } })
  await settle()
  const view = wrapper.vm as unknown as ViewInternals
  expect(view.ready).toBe(true)
  const openWith = async (file: File): Promise<void> => {
    const input = wrapper.find('input[type="file"]')
    expect(input.exists()).toBe(true)
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await settle()
    await settle()
  }
  return { wrapper, view, openWith }
}

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')

describe('R23: opening a broken .mlpx', () => {
  it('corrupt bytes: tells, unlocks, stays', async () => {
    const { view, openWith } = await welcome()
    await openWith(new File([new Uint8Array([1, 2, 3, 4])], 'broken.mlpx'))
    expect(dangers()).toHaveLength(1)
    expect(view.busy).toBe(false)
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
  })

  it('empty file: tells, unlocks, stays', async () => {
    const { view, openWith } = await welcome()
    await openWith(new File([], 'empty.mlpx'))
    expect(dangers()).toHaveLength(1)
    expect(view.busy).toBe(false)
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
  })

  it('arrayBuffer rejects: tells, unlocks, stays', async () => {
    const { view, openWith } = await welcome()
    const bad = new File([new Uint8Array([1])], 'x.mlpx')
    Object.defineProperty(bad, 'arrayBuffer', {
      value: async () => {
        throw new DOMException('read failed', 'NotReadableError')
      },
    })
    await openWith(bad)
    expect(dangers()).toHaveLength(1)
    expect(view.busy).toBe(false)
  })

  it('valid file but storage refuses: tells, unlocks, stays', async () => {
    const { view, openWith } = await welcome()
    const { bytes } = await writeProjectBytes(projectFile(), '')
    gate.failSave = true
    await openWith(new File([bytes.slice()], 'ok.mlpx'))
    expect(dangers().map((one) => one.key)).toEqual(['client.STORAGE_QUOTA_EXCEEDED'])
    expect(view.busy).toBe(false)
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
  })

  it('valid file opens (control)', async () => {
    const { openWith } = await welcome()
    const { bytes } = await writeProjectBytes(projectFile(), '')
    await openWith(new File([bytes.slice()], 'ok.mlpx'))
    for (let i = 0; i < 100 && router.currentRoute.value.name === ROUTE_PROJECTS; i += 1) {
      await settle()
    }
    expect(dangers()).toHaveLength(0)
    expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS)
  })
})

describe('R23: creating when storage refuses', () => {
  it('dialog stays open, unlocks, tells', async () => {
    const { wrapper, view } = await welcome()
    const newButton = wrapper.findAll('button').find((one) => one.text().includes('새 프로젝트'))
    await newButton?.trigger('click')
    await flushPromises()
    expect(view.creating).toBe(true)
    const name = wrapper.find('input[type="text"]')
    await name.setValue('실패할 프로젝트')
    gate.failSave = true
    const create = wrapper.findAll('button').find((one) => one.text() === '만들기')
    expect(create).toBeDefined()
    await create?.trigger('click')
    await settle()
    expect(dangers().map((one) => one.key)).toEqual(['client.STORAGE_QUOTA_EXCEEDED'])
    expect(view.busy).toBe(false)
    expect(view.creating).toBe(true)
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
  })
})
