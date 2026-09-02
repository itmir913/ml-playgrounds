// @vitest-environment jsdom
/**
 * **표 데이터 화면과 파일 예측 판의 실패 경로.** 학생이 눌렀는데 **아무 일도 안 일어나거나, 화면이 잠긴 채
 * 안 풀리는** 것을 잡는다.
 *
 * **스물세 라운드가 전부 성공 경로를 겨눴다** (2026-09-02 R23). 그동안 실패 쪽은
 * `catch`의 알림을 지우거나 `finally`의 `done()`을 지워도 **관문이 초록이었다** —
 * 열한 자리에서 그랬고, 그중 하나는 학생을 화면에 가두는 모양이었다.
 *
 * **여기서 재는 것은 셋이다**: 잠금이 풀리는가 · 학생에게 말하는가 · 잃은 것이 없는가.
 *
 * 씨앗: 파일 읽기 실패 · 깨진 바이트 · 저장 쿼터 거절.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientError } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'

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

interface PanelInternals {
  busy: boolean
  opened: { fileName: string } | null
  apply: () => Promise<void>
}

function csv(name: string): File {
  return new File([`a,b\n1,2\n3,4\n`], name, { type: 'text/csv' })
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
  gate.failSave = false
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')

describe('R23: TabularPanel', () => {
  it('reading fails: unlocks and tells', async () => {
    const project = useProjectStore()
    await project.save(emptyTabularProject())
    const wrapper = mount(TabularPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    const bad = csv('bad.csv')
    Object.defineProperty(bad, 'arrayBuffer', {
      value: async () => {
        throw new DOMException('read failed', 'NotReadableError')
      },
    })
    wrapper.find('[class*="min-h-full"]').element.dispatchEvent(dropEvent([bad]))
    await settle()
    expect(panel.busy).toBe(false)
    expect(panel.opened).toBeNull()
    expect(dangers()).toHaveLength(1)
  })

  it('garbage file: unlocks and tells', async () => {
    const project = useProjectStore()
    await project.save(emptyTabularProject())
    const wrapper = mount(TabularPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    wrapper
      .find('[class*="min-h-full"]')
      .element.dispatchEvent(dropEvent([new File([new Uint8Array([0, 255, 1])], 'x.xlsx')]))
    await settle()
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
  })
})

/**
 * **저장이 거절돼도 판은 접힌다** (2026-09-02 R23 B-1).
 *
 * 스토어는 쓰기가 던져도 `file.value`를 **먼저** 바꾼다(`stores/project.ts`). 그래서
 * 성공 뒤에만 판을 비우던 때는 정본이 이미 앉았는데 판도 서 있었고, 다시 누르면 같은
 * 일이 한 번 더 돌고 같은 알림은 `same()`이 합쳐 **아무것도 안 바뀐 것처럼 보였다.**
 */
describe('R23: the save is refused by quota', () => {
  it('takes the draft off the bar and tells the student', async () => {
    const project = useProjectStore()
    await project.save(emptyTabularProject())
    const wrapper = mount(TabularPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as PanelInternals
    wrapper.find('[class*="min-h-full"]').element.dispatchEvent(dropEvent([csv('first.csv')]))
    await settle()
    expect(panel.opened?.fileName).toBe('first.csv')

    gate.failSave = true
    await panel.apply()
    await settle()

    expect(panel.opened).toBeNull()
    expect(panel.busy).toBe(false)
    expect(dangers()).toHaveLength(1)
  })
})
