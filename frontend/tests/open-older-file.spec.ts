// @vitest-environment jsdom
/**
 * **옛 `.mlpx`를 열 때 이 컴퓨터의 더 새 판을 묻지 않고 덮지 않는다** (open-decisions.md 75).
 *
 * 목록의 [파일 불러오기]는 같은 `projectId`가 있으면 묻지 않고 덮었다 — 집에서 이어 한 학생이
 * 학교에서 저번 차시의 파일을 열면 집의 작업이 사라졌다(2026-09-28 감사 C/A-3 · B/A-1, 두 감사자가
 * 따로 재현). 이제 (A) 이 컴퓨터의 판이 더 새거나 (B) 파일로 안 나간 편집이 있으면 묻는다.
 * 선택지는 [이 컴퓨터의 것 열기] / [파일로 바꾸기] 둘뿐이고 **id는 그대로다.**
 *
 * **진짜 입구로 잰다** — 화면의 파일 칸에 파일을 넣고, 저장소는 fake-indexeddb다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { openDB } from 'idb'

import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { asksBeforeReplacing } from '../src/project/replace'
import {
  closeStorage,
  DB_NAME,
  DB_VERSION,
  loadProject,
  markExported,
  readLocalVersion,
  saveProject,
} from '../src/project/storage'
import { releaseTabLock } from '../src/project/tab-lock'
import { ROUTE_PROJECTS, router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import WelcomeView from '../src/views/WelcomeView.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { manifest, projectFile } from './fixtures/project'
import { writeProjectBytes } from './fixtures/write'

const OPEN_WAIT_MS = 10_000
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

/** 이 자물쇠들을 이 탭이 쥐고 있다 — 콜백의 약속이 끝나면 빠진다(`welcome-fail.spec.ts`와 같다). */
function stubLocksTracked(): Set<string> {
  const mine = new Set<string>()
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (
        name: string,
        _options: unknown,
        callback: (lock: { name: string } | null) => unknown,
      ) => {
        if (mine.has(name)) return callback(null)
        mine.add(name)
        try {
          return await callback({ name })
        } finally {
          mine.delete(name)
        }
      },
    },
  })
  return mine
}

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  useProjectStore().close()
  await router.replace('/')
  releaseTabLock()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

/** 이름·시각·답을 바꾼 판. 학번과 이름도 넣을 수 있다 — 창에 안 보여야 한다. */
function version(
  updatedAt: string,
  answer: string,
  student?: { studentId: string; name: string },
): ProjectFile {
  const base = projectFile()
  return {
    ...base,
    document: {
      ...base.document,
      manifest: { ...base.document.manifest, updatedAt, ...(student ? { student } : {}) },
      portfolio: {
        ...base.document.portfolio,
        answers: { ...base.document.portfolio.answers, motivation: answer },
      },
    },
  }
}

const OLD = '2026-09-01T09:00:00.000Z'
const NEW = '2026-09-20T09:00:00.000Z'

async function welcome() {
  const wrapper = mount(WelcomeView, { global: { plugins: [router, i18n] } })
  await settle()
  const view = wrapper.vm as unknown as { busy: boolean }
  /** 파일을 넣는다. **창이 뜨면 열기가 기다리는 중이므로** 창이 뜨거나 열기가 끝날 때까지 본다. */
  const pick = async (file: File): Promise<void> => {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await vi.waitFor(() => {
      if (view.busy && dialog() === undefined) throw new Error('still opening')
    }, OPEN_WAIT_MS)
    await settle()
  }
  const dialog = () =>
    wrapper
      .findAll('dialog')
      .find(
        (one) =>
          one.attributes('open') !== undefined &&
          one.text().includes(i18n.global.t('project.openNewerTitle')),
      )
  const press = async (key: string): Promise<void> => {
    const found = dialog()
      ?.findAll('button')
      .find((one) => one.text() === i18n.global.t(key))
    expect(found, key).toBeDefined()
    await found?.trigger('click')
    await vi.waitFor(() => {
      if (view.busy) throw new Error('still opening')
    }, OPEN_WAIT_MS)
    await settle()
  }
  return { wrapper, view, pick, dialog, press }
}

async function fileOf(project: ProjectFile): Promise<File> {
  const { bytes } = await writeProjectBytes(project, '')
  return new File([bytes.slice()], 'old.mlpx')
}

const storedAnswer = async (): Promise<string | undefined> =>
  (await loadProject(manifest.projectId))?.document.portfolio.answers.motivation

describe('결정 75: 이 컴퓨터의 판이 더 새면 묻는다', { timeout: 20_000 }, () => {
  it('(A) 더 새 판이 있으면 창이 뜨고, 기다리는 동안 덮지 않는다', async () => {
    await saveProject(version(NEW, '집에서 이어 쓴 답'), { imported: true })
    const { pick, dialog } = await welcome()

    await pick(await fileOf(version(OLD, '저번 차시의 답')))

    expect(dialog(), 'the question must be asked').toBeDefined()
    expect(await storedAnswer()).toBe('집에서 이어 쓴 답')
  })

  it('[이 컴퓨터의 것 열기]는 파일을 버리고 같은 id로 연다', async () => {
    await saveProject(version(NEW, '집에서 이어 쓴 답'), { imported: true })
    const { pick, press } = await welcome()
    await pick(await fileOf(version(OLD, '저번 차시의 답')))

    await press('project.openNewerKeep')
    await vi.waitFor(() => expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS))

    expect(router.currentRoute.value.params.projectId).toBe(manifest.projectId)
    expect(useProjectStore().file?.document.portfolio.answers.motivation).toBe('집에서 이어 쓴 답')
    expect(await storedAnswer()).toBe('집에서 이어 쓴 답')
  })

  it('[파일로 바꾸기]는 덮고 연다 — 가져온 판이라 "안 나간 편집"이 아니다', async () => {
    await saveProject(version(NEW, '집에서 이어 쓴 답'), { imported: true })
    const { pick, press } = await welcome()
    await pick(await fileOf(version(OLD, '저번 차시의 답')))

    await press('project.openNewerReplace')
    await vi.waitFor(() => expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS))

    expect(await storedAnswer()).toBe('저번 차시의 답')
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(false)
  })

  it('창을 닫으면 아무것도 안 하고, 잡은 자물쇠를 놓는다', async () => {
    const locks = stubLocksTracked()
    await saveProject(version(NEW, '집에서 이어 쓴 답'), { imported: true })
    const { pick, dialog, view } = await welcome()
    await pick(await fileOf(version(OLD, '저번 차시의 답')))
    expect([...locks]).toHaveLength(1)

    // Esc·바깥 누르기 — `<dialog>`가 `close`를 올린다.
    dialog()?.element.dispatchEvent(new Event('close'))
    await vi.waitFor(() => {
      if (view.busy) throw new Error('still opening')
    }, OPEN_WAIT_MS)
    await settle()

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECTS)
    expect(await storedAnswer()).toBe('집에서 이어 쓴 답')
    expect([...locks], 'the lock taken for the question must be released').toEqual([])
  })

  it('(B) 파일로 안 나간 편집이 있으면 파일이 더 새도 묻는다', async () => {
    // 편집 저장(기본)은 표지를 세운다. 파일의 시각이 더 뒤다 — 다른 기기의 시계가 앞선 경우다.
    await saveProject(version(OLD, '이 컴퓨터에서 쓴 답'))
    const { pick, dialog } = await welcome()

    await pick(await fileOf(version(NEW, '다른 기기의 답')))

    expect(dialog()).toBeDefined()
    expect(await storedAnswer()).toBe('이 컴퓨터에서 쓴 답')
  })

  it('파일이 더 새고 안 나간 편집이 없으면 묻지 않고 덮는다 (대조)', async () => {
    await saveProject(version(OLD, '가져온 채 그대로인 답'), { imported: true })
    const { pick, dialog } = await welcome()

    await pick(await fileOf(version(NEW, '새로 가져온 답')))
    await vi.waitFor(() => expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS))

    expect(dialog()).toBeUndefined()
    expect(await storedAnswer()).toBe('새로 가져온 답')
  })

  it('창에는 이름과 시각만 — 학번·이름은 보이지 않는다', async () => {
    await saveProject(version(NEW, '집에서 이어 쓴 답', { studentId: '10203', name: '홍길동' }), {
      imported: true,
    })
    const { pick, dialog } = await welcome()
    await pick(await fileOf(version(OLD, '저번 차시의 답', { studentId: '10203', name: '홍길동' })))

    const text = dialog()?.text() ?? ''
    expect(text).toContain(manifest.name)
    expect(text).not.toContain('10203')
    expect(text).not.toContain('홍길동')
  })
})

/**
 * **창이 뜬 채 화면을 떠나면 자물쇠는 라우터가 맡는다** (2026-09-29 P 검토 A-1).
 *
 * `<dialog>`는 브라우저의 뒤로 가기를 막지 않는다. 창이 뜬 채 프로젝트로 가면 라우터의 `open()`이
 * 묻던 자물쇠를 놓고 그 프로젝트의 것을 쥔다. 그 뒤 화면이 내려가며 "취소"로 답해 전역
 * `releaseTabLock()`을 부르면 **방금 연 프로젝트의 자물쇠가 풀려** 다른 탭이 같은 프로젝트를 연다.
 * 프로젝트 밖(점검)으로 가면 라우터의 `close()`가 이미 놓는다 — 새는 것이 없어야 한다.
 */
describe('결정 75: 창이 뜬 채 화면을 떠나면', { timeout: 20_000 }, () => {
  const OTHER = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
  const lockOf = (id: string): string => `ml-playgrounds:project:${id}`

  async function asking() {
    const locks = stubLocksTracked()
    await saveProject(version(NEW, '집에서 이어 쓴 답'), { imported: true })
    const other = projectFile()
    await saveProject({
      ...other,
      document: {
        ...other.document,
        manifest: { ...other.document.manifest, projectId: OTHER, name: '다른 프로젝트' },
      },
    })
    const view = await welcome()
    await view.pick(await fileOf(version(OLD, '저번 차시의 답')))
    expect(view.dialog()).toBeDefined()
    expect([...locks]).toEqual([lockOf(manifest.projectId)])
    return { ...view, locks }
  }

  for (const [label, id] of [
    ['다른 프로젝트', OTHER],
    ['묻던 그 프로젝트', manifest.projectId],
  ] as const) {
    it(`${label}로 가면 새로 연 프로젝트의 자물쇠가 남는다`, async () => {
      const { wrapper, locks } = await asking()

      await router.push(`/project/${id}`)
      expect(useProjectStore().projectId).toBe(id)
      wrapper.unmount()
      await settle()

      expect([...locks], 'the opened project must keep its lock').toEqual([lockOf(id)])
      expect(await storedAnswer(), 'nothing is written').toBe('집에서 이어 쓴 답')
    })
  }

  it('프로젝트 밖(점검)으로 가면 자물쇠가 풀린다', async () => {
    const { wrapper, locks } = await asking()

    await router.push('/inspect')
    wrapper.unmount()
    await settle()

    expect([...locks], 'no lock may leak').toEqual([])
    expect(await storedAnswer()).toBe('집에서 이어 쓴 답')
  })
})

describe('결정 75: 못 읽는 레코드와 옛 레코드', { timeout: 20_000 }, () => {
  /** 레코드를 날것으로 심는다(`welcome-fail.spec.ts`의 `plantUnreadable`과 같은 방법). */
  async function plant(record: Record<string, unknown>): Promise<void> {
    await saveProject(projectFile())
    closeStorage()
    const database = await openDB(DB_NAME, DB_VERSION)
    await database.put('projects', record)
    database.close()
    closeStorage()
  }

  it('못 읽는 레코드는 묻지 않고 파일로 바꾼다 — 그것이 복구 길이다', async () => {
    await plant({
      projectId: manifest.projectId,
      document: { runs: {} },
      updatedAt: NEW,
      sizeBytes: 0,
      unexportedEdits: true,
    })
    expect(await readLocalVersion(manifest.projectId)).toBeNull()
    const { pick, dialog } = await welcome()

    await pick(await fileOf(version(OLD, '파일의 답')))
    await vi.waitFor(() => expect(router.currentRoute.value.name).not.toBe(ROUTE_PROJECTS))

    expect(dialog()).toBeUndefined()
    expect(await storedAnswer()).toBe('파일의 답')
  })

  it('표지 없는 옛 레코드는 상태 표시줄의 판정을 쓴다', async () => {
    const document = version(OLD, '옛 답').document
    const legacy = { projectId: manifest.projectId, document, updatedAt: OLD, sizeBytes: 0 }

    await plant({ ...legacy })
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits, 'never exported').toBe(
      true,
    )

    await plant({ ...legacy, exportedAt: NEW })
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits, 'exported after').toBe(
      false,
    )
  })
})

describe('결정 75: 표지를 내리는 자리', () => {
  it('내보낸 판이 레코드에 그대로면 내린다', async () => {
    await saveProject(projectFile())
    await markExported(manifest.projectId, NEW, manifest.updatedAt)
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(false)
  })

  it('레코드가 다른 판이면(쥔 뒤의 편집이 먼저 저장됐다) 내리지 않는다', async () => {
    await saveProject(version(NEW, '쥔 뒤에 쓴 답'))
    await markExported(manifest.projectId, NEW, OLD)
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(true)
  })

  it('판을 모르면(null) 내리지 않는다', async () => {
    await saveProject(projectFile())
    await markExported(manifest.projectId, NEW, null)
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(true)
  })

  it('편집 저장은 다시 세운다', async () => {
    await saveProject(projectFile(), { imported: true })
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(false)
    await saveProject(projectFile())
    expect((await readLocalVersion(manifest.projectId))?.unexportedEdits).toBe(true)
  })
})

describe('결정 75: 판정', () => {
  const local = (updatedAt: string, unexportedEdits: boolean) => ({
    name: '프로젝트',
    updatedAt,
    unexportedEdits,
  })

  it('판이 없으면 묻지 않는다', () => {
    expect(asksBeforeReplacing(null, OLD)).toBe(false)
  })

  it('(A) 이 컴퓨터가 더 새면 묻는다 — 같으면 안 묻는다', () => {
    expect(asksBeforeReplacing(local(NEW, false), OLD)).toBe(true)
    expect(asksBeforeReplacing(local(OLD, false), OLD)).toBe(false)
    expect(asksBeforeReplacing(local(OLD, false), NEW)).toBe(false)
  })

  it('(A)는 시각으로 잰다 — 사전순이 아니다', () => {
    // 사전순으로는 앞이지만 실제로는 30분 뒤다(`export-state.ts`의 같은 쌍).
    expect(
      asksBeforeReplacing(local('2026-09-23T00:30:00+09:00', false), '2026-09-22T15:00:00Z'),
    ).toBe(true)
  })

  it('(B) 안 나간 편집이 있으면 시각과 무관하게 묻는다', () => {
    expect(asksBeforeReplacing(local(OLD, true), NEW)).toBe(true)
  })

  it('시각을 못 읽으면 (A)는 거짓이고 (B)만 본다', () => {
    expect(asksBeforeReplacing(local('not a time', false), OLD)).toBe(false)
    expect(asksBeforeReplacing(local('not a time', true), OLD)).toBe(true)
  })
})
