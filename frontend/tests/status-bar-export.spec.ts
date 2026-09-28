// @vitest-environment jsdom
/**
 * **상태 표시줄의 내보내기 상태가 안 쓴 편집을 보는가** (2026-09-28 감사 C, A-2).
 *
 * 판정은 `export-state.ts`의 순수 함수이고 `autosave.spec.ts`가 갈래를 문다. 여기서 보는 것은
 * **배선**이다 — 줄이 스토어의 `dirty`를 실제로 넘기는가. 넘기지 않던 때에는 내보낸 뒤 고친 것이
 * 저장에 실패해도(쿼터) 줄이 초록 "파일로 저장함"으로 남았다. 그 편집은 파일에도 브라우저에도
 * 없었다.
 *
 * **내보내기는 진짜 단추로 누른다** (`ExportButton`). 단추는 인적사항을 `update`로 넣고
 * `exportFile`을 부르는데, 그 `update`가 세운 `dirty`를 `exportFile`의 `flush`가 내려야 정상
 * 내보내기 뒤에 줄이 "파일로 저장함"이 된다 — 그 순서도 함께 문다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppStatusBar from '../src/components/AppStatusBar.vue'
import ExportButton from '../src/components/ExportButton.vue'
import { i18n, setLocale } from '../src/i18n'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { projectFile } from './fixtures/project'

const downloads: string[] = []

vi.mock('../src/project/download', () => ({
  downloadBlob: (_blob: Blob, fileName: string) => {
    downloads.push(fileName)
  },
  readFileBytes: async (file: File) => new Uint8Array(await file.arrayBuffer()),
}))

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 마운트한 것들. 끝나면 걷어낸다 — 팝오버의 `document` 리스너가 쌓이지 않게. */
const mounted: { unmount: () => void }[] = []

beforeEach(async () => {
  downloads.length = 0
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  await setLocale('ko')
})

afterEach(async () => {
  for (const view of mounted.splice(0)) view.unmount()
  document.body.innerHTML = ''
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  useProjectStore().close()
  closeStorage()
  await deleteDatabase()
})

/** 상태 표시줄을 띄우고, 줄 맨 앞의 내보내기 상태 글자를 읽는 손잡이를 돌려준다. */
function statusBar(): () => string {
  const bar = mount(AppStatusBar, { global: { plugins: [i18n] }, attachTo: document.body })
  mounted.push(bar)
  // 줄 맨 앞의 트리거 단추, 그 첫 칸이 내보내기 상태다(`AppStatusBar.vue`의 `exportTone` 칸).
  return () => bar.find('footer button span').text()
}

/** 끝 상태를 기다리는 상한. 한 검사의 상한(20초, vite.config.ts)보다 짧아 멈추면 이름대로 운다. */
const SETTLE_WAIT_MS = 10_000

/** 진짜 [파일로 저장] 단추로 내보낸다 — 팝오버를 열고 안의 단추를 누른다. */
async function exportWithButton(): Promise<void> {
  const button = mount(ExportButton, { global: { plugins: [i18n] }, attachTo: document.body })
  mounted.push(button)
  await flushPromises()
  await button.find('button').trigger('click')
  await flushPromises()
  const panel = document.querySelector('.popover-panel')
  expect(panel, 'the export popover must open').not.toBeNull()
  panel?.querySelector('button')?.dispatchEvent(new Event('click', { bubbles: true }))
  // **끝 상태를 기다린다** (`docs/workflow.md` §3). 정해진 틱 수로 기다리면 부하에서
  // `markExported`의 IndexedDB 쓰기가 그 안에 안 끝나 줄이 아직 "안 내보냄"이었다(5번에 2번).
  // 파일이 나간 것과 내보낸 시각이 앉은 것을 **둘 다** 기다린다 — 내려받기와 시각 기록의
  // 순서가 바뀌어도 견딘다.
  const project = useProjectStore()
  await vi.waitFor(() => {
    expect(downloads, 'the export must hand down one file').toHaveLength(1)
    expect(project.exportedAt, 'the export time must be recorded').not.toBeNull()
  }, SETTLE_WAIT_MS)
}

/** 줄이 `state`를 말하고 안 쓴 편집이 `dirty`인 끝 상태까지 기다린다. */
async function settlesTo(read: () => string, state: string, dirty: boolean): Promise<void> {
  const project = useProjectStore()
  await vi.waitFor(() => {
    expect(project.dirty).toBe(dirty)
    expect(read()).toBe(state)
  }, SETTLE_WAIT_MS)
}

describe('상태 표시줄의 내보내기 상태', () => {
  it('정상으로 내보낸 뒤에는 "파일로 저장함"이다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    const exportState = statusBar()
    expect(exportState()).toBe(i18n.global.t('save.notExported'))

    await exportWithButton()

    // 단추의 `update`가 세운 dirty를 `exportFile`의 flush가 내렸다.
    await settlesTo(exportState, i18n.global.t('save.exported'), false)
  })

  it('내보낸 뒤 고친 것이 저장에 실패하면 "마지막 파일 저장 후 변경됨"이다', async () => {
    const project = useProjectStore()
    await project.save(projectFile())
    const exportState = statusBar()
    await exportWithButton()
    await settlesTo(exportState, i18n.global.t('save.exported'), false)

    // 여기서부터 저장소가 모자라다 — 자동 저장이 부르는 `write`가 거절당한다.
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      value: { estimate: () => Promise.resolve({ quota: 1, usage: 1 }) },
    })
    project.update((live) => ({
      ...live,
      document: {
        ...live.document,
        portfolio: {
          ...live.document.portfolio,
          answers: { ...live.document.portfolio.answers, motivation: '내보낸 뒤 쓴 글' },
        },
      },
    }))
    await expect(project.flush()).rejects.toThrow()

    await settlesTo(exportState, i18n.global.t('save.stale'), true)
  })
})
