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

import { unzipSync, zipSync } from 'fflate'

import { ClientError } from '../src/errors'
import { ENTRY } from '../src/project/format'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME, loadProject, saveProject } from '../src/project/storage'
import { releaseTabLock } from '../src/project/tab-lock'
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

/**
 * **잠금 밖에서 저장소를 쓰지 않는다** (2026-09-04 R27 A-1·B-1).
 *
 * 두 탭 잠금은 편집 화면에만 걸려 있었고 목록 화면의 두 동작은 잠금을 **묻지도 않고**
 * 저장소를 썼다. 가져오기는 같은 `projectId`로 `put`하므로 **덮어쓰기**이고, 그것이
 * 정확히 이 잠금이 막으려던 사고다 — 거절은 그 뒤에 왔다.
 *
 * 여기서 재는 것은 **말했는가**가 아니라 **안 썼는가**다.
 */
describe('R27: 다른 탭이 쥔 프로젝트는 목록 화면도 못 건드린다', () => {
  /** 이름 목록에 든 자물쇠는 남이 쥐고 있다. 나머지는 내준다. */
  function stubLocksHeldElsewhere(ids: readonly string[]): void {
    const taken = new Set(ids.map((id) => `ml-playgrounds:project:${id}`))
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          name: string,
          _options: unknown,
          callback: (lock: { name: string } | null) => unknown,
        ) => (taken.has(name) ? callback(null) : await callback({ name })),
      },
    })
  }

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    releaseTabLock()
  })

  it('가져오기: 거절하고 **저장소를 안 건드린다**', async () => {
    const mine = projectFile()
    const id = mine.document.manifest.projectId
    await saveProject(mine)

    // 같은 projectId인데 내용이 다른 파일 — 덮어쓰면 표시가 바뀐다.
    const incoming = projectFile()
    incoming.document.portfolio.answers.motivation = '다른 탭에서 온 답'
    const { bytes } = await writeProjectBytes(incoming, '')

    stubLocksHeldElsewhere([id])
    const { view, openWith } = await welcome()
    await openWith(new File([bytes.slice()], 'same.mlpx'))

    expect(dangers().map((one) => one.key)).toEqual(['client.PROJECT_OPEN_ELSEWHERE'])
    expect(view.busy).toBe(false)
    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)

    // **여기가 이 검사의 전부다.** 있던 것이 그대로 있어야 한다.
    const kept = await loadProject(id)
    expect(kept?.document.portfolio.answers.motivation).toBe('꽃이 좋아서')
  })

  it('가져오기: 아무도 안 쥐었으면 그대로 들어온다 (대조)', async () => {
    const incoming = projectFile()
    incoming.document.portfolio.answers.motivation = '가져온 답'
    const { bytes } = await writeProjectBytes(incoming, '')

    stubLocksHeldElsewhere([])
    const { openWith } = await welcome()
    await openWith(new File([bytes.slice()], 'new.mlpx'))

    expect(dangers()).toHaveLength(0)
    const stored = await loadProject(incoming.document.manifest.projectId)
    expect(stored?.document.portfolio.answers.motivation).toBe('가져온 답')
  })

  /** 목록의 지우기 아이콘을 누르고 확인 판의 [삭제]까지 누른다 — 학생이 밟는 길이다. */
  async function clickDelete(wrapper: Awaited<ReturnType<typeof welcome>>['wrapper']) {
    // 목록의 지우기는 아이콘 단추라 글자가 없다 — 이름표로 찾는다.
    const icon = wrapper.find('button[aria-label="삭제"]')
    expect(icon.exists()).toBe(true)
    await icon.trigger('click')
    await settle()
    const confirm = wrapper.findAll('button').find((one) => one.text() === '삭제')
    expect(confirm).toBeDefined()
    await confirm?.trigger('click')
    await settle()
    await settle()
  }

  it('삭제: 거절하고 **지우지 않는다**', async () => {
    const mine = projectFile()
    const id = mine.document.manifest.projectId
    await saveProject(mine)

    stubLocksHeldElsewhere([id])
    const { wrapper, view } = await welcome()
    await clickDelete(wrapper)

    expect(dangers().map((one) => one.key)).toEqual(['client.PROJECT_OPEN_ELSEWHERE'])
    expect(view.busy).toBe(false)
    // **여전히 있어야 한다.** 지우면 저 탭의 다음 자동 저장이 되살리거나, 저 탭이 하던
    // 것이 사라진다 — 어느 쪽인지는 타이밍이 정한다.
    expect(await loadProject(id)).not.toBeNull()
  })

  it('삭제: 아무도 안 쥐었으면 지워진다 (대조)', async () => {
    const mine = projectFile()
    const id = mine.document.manifest.projectId
    await saveProject(mine)

    stubLocksHeldElsewhere([])
    const { wrapper } = await welcome()
    await clickDelete(wrapper)

    expect(dangers()).toHaveLength(0)
    expect(await loadProject(id)).toBeNull()
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

/**
 * **손댄 흔적을 알리는 경고는 도착한 뒤까지 살아야 한다** (2026-09-19, 사용자가 잡았다).
 *
 * 열자마자 대시보드로 넘어가는데 **알림을 이동 전에 밀고 있었다.** 라우터는 이동이
 * 시작될 때의 수위선 이하를 도착 뒤에 걷으므로(`router/index.ts`, 떠나는 화면의 오류가
 * 다음 화면을 덮던 것을 막는 장치), 그 경고는 **뜨자마자 사라졌다.**
 *
 * **어조의 문제가 아니다.** 걷는 쪽은 어조를 안 본다 — `danger`로 올려도 똑같이 사라진다.
 * 자리의 문제이고, 그래서 검사도 "도착한 뒤에 남아 있는가"를 본다.
 */
describe('손댄 파일을 열면 경고가 도착한 뒤에도 남는다', () => {
  const cautions = () => useToastStore().items.filter((one) => one.tone === 'caution')

  /** 풀어서 지표를 고치고 다시 압축한 파일. 해시가 안 맞아 `MODIFIED`로 읽힌다. */
  async function tampered(): Promise<File> {
    const { bytes } = await writeProjectBytes(projectFile(), '')
    const entries = unzipSync(bytes)
    const runs = JSON.parse(new TextDecoder().decode(entries[ENTRY.runs])) as {
      experiments: { runs: { metrics: Record<string, number> }[] }[]
    }
    const target = runs.experiments[0]?.runs[0]
    if (target) target.metrics = { accuracy: 0.99 }
    entries[ENTRY.runs] = new TextEncoder().encode(JSON.stringify(runs, null, 2))
    return new File([zipSync(entries) as BlobPart], 'tampered.mlpx')
  }

  it('대시보드에 도착한 뒤에도 경고가 떠 있다', async () => {
    const { view, openWith } = await welcome()
    await openWith(await tampered())

    // 열어는 준다 - 고쳐졌다고 안 열어 줄 이유는 없다 (mlpx-spec.md §7.3).
    expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS)
    expect(
      cautions().map((one) => one.key),
      'the warning must survive the navigation',
    ).toEqual(['project.openModified'])
    expect(view.busy).toBe(false)
  })

  it('멀쩡한 파일에는 안 뜬다 - 대조군', async () => {
    const { openWith } = await welcome()
    const { bytes } = await writeProjectBytes(projectFile(), '')
    await openWith(new File([bytes.slice() as BlobPart], 'ok.mlpx'))

    expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS)
    expect(cautions()).toEqual([])
  })
})
