// @vitest-environment jsdom
/**
 * **표 데이터 화면에서 확정하는 동안 다른 파일을 놓으면** 무슨 일이 나는가
 * (architecture.md §8.10.4).
 *
 * 이 화면은 `grep`만 보고 고쳐졌고 **재현 검사가 없었다** — 확정이 끝나며 `opened`를
 * 통째로 비우면 그 사이에 학생이 읽힌 새 파일이 말없이 사라지는데, 그 자리를 되돌려도
 * 2,797개가 초록이었다 (2026-09-02 R22 B-5). 이미지 화면의 확인 판과 같은 병이고
 * 자리만 표다.
 *
 * **저장을 검사가 붙든다.** 그래야 "확정 중"이라는 창이 생긴다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { dataSettings } from '../src/project/schema'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'

/**
 * 저장을 붙드는 손잡이. **참이면 `saveProject`가 답하지 않고** 검사가 `release()`로
 * 끝낸다 — 그 사이가 "확정 중"이다.
 */
const gate = vi.hoisted(() => ({
  hold: false,
  waiting: [] as (() => void)[],
}))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (gate.hold) {
        await new Promise<void>((resolve) => gate.waiting.push(resolve))
      }
      return actual.saveProject(file)
    },
  }
})

function release(): void {
  const waiting = [...gate.waiting]
  gate.waiting.length = 0
  for (const one of waiting) one()
}

/** 매크로태스크 한 번. 파일을 읽는 동안 비켜 준다. */
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

/** 화면 안쪽. 확정과 읽기의 순서를 검사가 정해야 해서 직접 묻는다. */
interface PanelInternals {
  busy: boolean
  opened: { fileName: string } | null
  apply: () => Promise<void>
}

/** 확정된 정본의 원래 파일 이름. **무엇이 실제로 앉았는지가 이 값이다.** */
function appliedFileName(file: ProjectFile | null): string | undefined {
  if (!file) return undefined
  return dataSettings('tabular', file.document.settings).dataset?.originalFileName
}

/** 표 하나짜리 CSV 파일. 이름이 판에 서는 것이라 검사가 그것으로 가른다. */
function csv(name: string, header: string): File {
  return new File([`${header}\n1,2\n3,4\n`], name, { type: 'text/csv' })
}

/**
 * 바이트를 검사가 줄 때까지 안 내놓는 파일. **읽는 동안의 창을 여는 데 쓴다** —
 * 진짜 CSV는 너무 빨라서 그 사이를 잴 수가 없다.
 */
function heldCsv(name: string): { file: File; release: () => void } {
  const real = csv(name, 'a,b')
  let open!: () => void
  const waiting = new Promise<void>((resolve) => {
    open = resolve
  })
  Object.defineProperty(real, 'arrayBuffer', {
    value: async () => {
      await waiting
      return new TextEncoder().encode('a,b\n1,2\n3,4\n').buffer
    },
  })
  return { file: real, release: open }
}

function emptyTabularProject(): ProjectFile {
  const document = newProjectDocument(
    { name: '표 프로젝트', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
  )
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  gate.hold = false
  gate.waiting.length = 0
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
})

afterEach(async () => {
  release()
  closeStorage()
  await deleteDatabase()
})

/** 화면을 띄우고 `first.csv`를 판에 세운다. */
async function panelWithFile() {
  const project = useProjectStore()
  await project.save(emptyTabularProject())
  const wrapper = mount(TabularPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  const panel = wrapper.vm as unknown as PanelInternals

  /**
   * **놓는 자리는 화면 전체다.** 빈 상태의 점선 상자가 아니라 판의 뿌리에 `@drop`이
   * 걸려 있어, 파일이 이미 서 있어도 그 위에 놓을 수 있다 — 둘째 묶음이 여기로 온다.
   */
  const drop = async (file: File): Promise<void> => {
    const root = wrapper.find('[class*="min-h-full"]')
    expect(root.exists()).toBe(true)
    root.element.dispatchEvent(dropEvent([file]))
    await settle()
  }

  await drop(csv('first.csv', 'a,b'))
  expect(panel.opened?.fileName).toBe('first.csv')

  return { project, wrapper, panel, drop }
}

describe('확정하는 동안 다른 파일을 놓으면', () => {
  /**
   * **읽기가 확정 중인 자물쇠를 안 연다.** `busy`가 boolean 하나였을 때는 읽기가
   * 자기 `finally`에서 남의 자물쇠를 열었다.
   */
  it('읽는 동안에도 확정 중인 자물쇠가 안 풀린다', async () => {
    const { panel, drop } = await panelWithFile()

    gate.hold = true
    const applying = panel.apply()
    await flushPromises()
    expect(panel.busy).toBe(true)

    await drop(csv('second.csv', 'a,b'))
    // 읽기가 끝나도 확정은 아직 돈다.
    expect(panel.busy).toBe(true)

    release()
    await applying
    await settle()
    expect(panel.busy).toBe(false)
  })

  /**
   * **내가 든 파일만 치운다.** 통째로 `null`을 쓰면 확정이 끝나며 학생이 방금 놓은
   * 파일이 판에서 사라진다 — 놓은 것을 보고 있다가 말없이 잃는다.
   */
  it('확정이 끝나도 그 사이에 놓은 파일은 판에 남는다', async () => {
    const { project, panel, drop } = await panelWithFile()

    gate.hold = true
    const applying = panel.apply()
    await flushPromises()

    await drop(csv('second.csv', 'a,b'))
    expect(panel.opened?.fileName).toBe('second.csv')

    release()
    await applying
    await settle()

    // 확정된 것은 첫 파일이고, 판에 선 것은 둘째 파일이다.
    expect(appliedFileName(project.file)).toBe('first.csv')
    expect(panel.opened?.fileName).toBe('second.csv')
    expect(useToastStore().items.map((one) => one.key)).toContain('data.tabular.applied')
  })

  it('아무것도 안 놓았으면 확정한 판은 치운다', async () => {
    const { panel } = await panelWithFile()

    await panel.apply()
    await settle()

    expect(panel.opened).toBeNull()
  })
})

/**
 * **읽는 것도 도는 일이다.** 파일을 읽는 동안 화면이 안 바쁜 것으로 남으면 [확정]과
 * [파일 고르기]가 열려 있어, 학생이 그 사이에 한 번 더 누를 수 있다.
 *
 * 이 자리는 검사가 **바이트를 붙들어야만** 보인다 — 진짜 CSV는 한 마이크로태스크에
 * 끝나 창이 안 생긴다. 붙들지 않고 쟀을 때는 `start({ blocks: false })`로 바꿔도
 * 아무것도 안 울었다.
 */
describe('파일을 읽는 동안', () => {
  it('화면이 바쁜 것으로 남는다', async () => {
    const project = useProjectStore()
    await project.save(emptyTabularProject())
    const wrapper = mount(TabularPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    expect(panel.busy).toBe(false)

    const held = heldCsv('slow.csv')
    wrapper.find('[class*="min-h-full"]').element.dispatchEvent(dropEvent([held.file]))
    await flushPromises()

    expect(panel.busy).toBe(true)

    held.release()
    await settle()
    expect(panel.busy).toBe(false)
    expect(panel.opened?.fileName).toBe('slow.csv')
  })
})
