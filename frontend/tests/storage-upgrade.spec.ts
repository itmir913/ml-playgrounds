/**
 * **다른 탭이 더 새 버전으로 열 때** (2026-09-23, open-decisions.md 50 · R37 B-2).
 *
 * 앱이 IndexedDB 연결을 한 번 열면 닫을 일이 없어서, **옛 탭을 열어 둔 학생의 새 탭은
 * `DB_VERSION`이 오른 날 영영 안 떴다.** 새 탭의 업그레이드가 옛 탭의 연결에 막히기
 * 때문이다. 결정은 *"알림 없이, 옛 탭이 스스로 놓는다"*이고 여기가 두 끝을 문다.
 *
 * 1. **새 탭이 열린다** — 옛 탭이 `blocking`을 받아 연결을 놓는다.
 * 2. **옛 탭은 거짓말을 안 한다** — 놓은 뒤 저장소를 쓰려 하면 이미 있는
 *    `STORAGE_VERSION_TOO_NEW`로 선다. 조용히 옛 연결에 쓰지 않는다.
 *
 * **새 탭은 여기서 날 IndexedDB로 흉내 낸다.** 다음 판의 앱 코드는 아직 없으므로
 * *"더 높은 버전으로 여는 누군가"*가 곧 새 탭이다 — 재려는 것은 옛 탭의 반응이다.
 *
 * **못 보는 것: 진짜 브라우저의 두 탭.** `fake-indexeddb`의 `versionchange` 흉내가
 * 브라우저와 같다고 가정한다 — 사람 확인이다.
 */

import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { closeStorage, DB_NAME, DB_VERSION, listProjects } from '../src/project/storage'

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

/**
 * 새 탭이 한 칸 높은 버전으로 연다. **막히면 `'blocked'`로 끝난다** — 기다림에 끝을 두지
 * 않으면 고침이 없을 때 이 검사는 실패가 아니라 시간 초과로 서고, 그러면 왜 섰는지가
 * 안 보인다.
 */
function openAsNewerTab(): Promise<'opened' | 'blocked'> {
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION + 1)
    const timer = setTimeout(() => resolve('blocked'), 1_000)
    request.onsuccess = () => {
      clearTimeout(timer)
      request.result.close()
      resolve('opened')
    }
    request.onerror = () => {
      clearTimeout(timer)
      resolve('blocked')
    }
  })
}

beforeEach(async () => {
  closeStorage()
  await deleteDatabase()
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

describe('더 새 버전의 탭이 오면', () => {
  it('옛 탭이 연결을 놓아 새 탭이 열린다', async () => {
    // 옛 탭이 저장소를 한 번 써서 연결을 쥔다.
    await listProjects()

    expect(await openAsNewerTab()).toBe('opened')
  })

  /**
   * **놓은 뒤에는 옛 탭이 스스로 선다.** 조용히 옛 연결을 되살려 쓰면 새 탭이 올린 저장소
   * 위에 옛 모양을 쓰게 된다 — 그래서 이미 있는 오류가 *"앱을 최신으로 바꾼 뒤 다시
   * 열어 주세요"*라고 말하는 것이 맞다.
   */
  it('놓은 뒤 옛 탭이 쓰려 하면 저장소가 더 새것이라고 말한다', async () => {
    await listProjects()
    expect(await openAsNewerTab()).toBe('opened')

    let code = 'RESOLVED'
    try {
      await listProjects()
    } catch (error) {
      code = isClientError(error) ? error.code : 'NOT_A_CLIENT_ERROR'
    }
    expect(code).toBe('STORAGE_VERSION_TOO_NEW')
  })
})
