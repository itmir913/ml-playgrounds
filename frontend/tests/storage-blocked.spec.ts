// @vitest-environment jsdom
/**
 * **옛 배포판 탭이 저장소를 막고 있는 동안 알리고, 풀리면 걷는다** (open-decisions.md 77,
 * `STORAGE_BLOCKED`).
 *
 * 결정 50은 옛 탭이 스스로 놓는 것인데, 그 처리가 들어가기 전 배포판을 연 탭은 안 놓는다. 그 사이
 * 이 탭의 열기는 **실패하지 않고 멈춰 있었다** — 목록이 안 뜨고 저장이 끝나지 않는데 아무 말이
 * 없었다(2026-09-29 감사 H #6). 결정은 **실패시키지 않고** 기다리는 동안 알리기다.
 *
 * **옛 탭은 날 IndexedDB로 흉내 낸다** — 한 칸 낮은 버전으로 열고 `versionchange`를 안 받는
 * 연결이 곧 옛 배포판의 탭이다. **못 보는 것: 진짜 브라우저의 두 탭** — `fake-indexeddb`의
 * `blocked` 흉내가 브라우저와 같다고 가정한다(사람 확인, `storage-upgrade.spec.ts`와 같다).
 */
import 'fake-indexeddb/auto'

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { useStorageBlockedNotice } from '../src/composables/useStorageBlockedNotice'
import { closeStorage, DB_NAME, DB_VERSION, listProjects } from '../src/project/storage'
import { useToastStore } from '../src/stores/toasts'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/** 옛 배포판의 탭. 한 칸 낮은 버전으로 열고, 새 탭이 올리려 해도 놓지 않는다. */
function openAsOldTab(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION - 1)
    request.onsuccess = () => {
      oldTabs.push(request.result)
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('open failed'))
  })
}

const Host = defineComponent({
  setup() {
    useStorageBlockedNotice()
    return () => h('div')
  },
})

const blockedNotices = () =>
  useToastStore().items.filter((one) => one.key === 'client.STORAGE_BLOCKED')

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
})

/** 열어 둔 옛 탭들. **검사가 실패해도 닫는다** — 남으면 다음 검사의 열기까지 막혀 실패가 번진다. */
const oldTabs: IDBDatabase[] = []

afterEach(async () => {
  for (const tab of oldTabs.splice(0)) tab.close()
  closeStorage()
  await deleteDatabase()
})

describe('결정 77: 저장소가 옛 탭에 막혔을 때', () => {
  it('기다리는 동안 알리고, 옛 탭이 닫히면 이어서 끝나고 알림을 걷는다', async () => {
    const oldTab = await openAsOldTab()
    const host = mount(Host)

    let finished = false
    const listing = listProjects().then((all) => {
      finished = true
      return all
    })

    await vi.waitFor(() => expect(blockedNotices()).toHaveLength(1))
    expect(blockedNotices()[0]?.tone).toBe('caution')
    // **실패시키지 않는다** — 막힌 동안 목록 읽기는 기다리고 있다.
    expect(finished).toBe(false)

    oldTab.close()

    expect(await listing).toEqual([])
    await vi.waitFor(() => expect(blockedNotices()).toHaveLength(0))
    host.unmount()
  })

  it('화면이 뜨기 전에 막혔어도 뜨는 순간 알린다', async () => {
    const oldTab = await openAsOldTab()
    const listing = listProjects()
    // 막힘이 먼저 선다(언어 읽기가 앱보다 먼저 저장소를 연다).
    await new Promise((resolve) => setTimeout(resolve, 50))

    const host = mount(Host)
    await vi.waitFor(() => expect(blockedNotices()).toHaveLength(1))

    oldTab.close()
    await listing
    await vi.waitFor(() => expect(blockedNotices()).toHaveLength(0))
    host.unmount()
  })

  it('막히지 않으면 아무 말도 안 한다 (대조)', async () => {
    const host = mount(Host)
    await listProjects()
    expect(blockedNotices()).toHaveLength(0)
    host.unmount()
  })
})
