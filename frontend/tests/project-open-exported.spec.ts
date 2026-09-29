// @vitest-environment jsdom
/**
 * **내보낸 시각을 못 읽어도 여는 길은 막히지 않는다** (2026-09-29 감사 H A-2).
 *
 * `open()`은 파일을 앉힌 **뒤에** 내보낸 시각을 읽는다(`stores/project.ts`). 전에는 그 읽기가
 * 던지면 라우터 가드가 던져 이동이 취소됐다 — 학생은 알림 없이 목록에 남고, 스토어는 그
 * 프로젝트를 쥔 채였다(탭 잠금까지). 아이패드 사파리가 연결을 끊는 모양(`UnknownError`)으로
 * 그 한 읽기만 던지게 하고 **진짜 라우터로** 들어간다.
 */

import 'fake-indexeddb/auto'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const control = vi.hoisted(() => ({ failExportedAt: false }))

vi.mock('../src/project/storage', async (original) => {
  const real = await original<typeof import('../src/project/storage')>()
  return {
    ...real,
    readExportedAt: async (id: string) => {
      if (control.failExportedAt) {
        const error = new Error('Connection to Indexed Database server lost')
        error.name = 'UnknownError'
        throw error
      }
      return await real.readExportedAt(id)
    },
  }
})

import { ROUTE_PROJECT_HOME, router } from '../src/router'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import { manifest, projectFile } from './fixtures/project'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

beforeEach(async () => {
  window.scrollTo = () => {}
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  control.failExportedAt = false
  await router.replace('/')
  await router.isReady()
})

afterEach(async () => {
  control.failExportedAt = false
  useProjectStore().close()
  closeStorage()
  await deleteDatabase()
})

/** 라우터를 실제로 태우므로 화면 청크를 동적으로 읽는다 — `router.spec.ts`와 같은 여유다. */
describe('A-2: reading the export time fails while opening', { timeout: 20_000 }, () => {
  it('내보낸 시각을 못 읽어도 프로젝트로 간다', async () => {
    await saveProject(projectFile())
    control.failExportedAt = true
    const project = useProjectStore()

    await router.push({ name: ROUTE_PROJECT_HOME, params: { projectId: manifest.projectId } })

    expect(router.currentRoute.value.name).toBe(ROUTE_PROJECT_HOME)
    expect(project.projectId).toBe(manifest.projectId)
    // 곁가지 정보라 "안 내보냄"으로 선다. 학생에게 알릴 일이 아니다.
    expect(project.exportedAt).toBeNull()
    expect(useToastStore().items).toEqual([])
  })
})
