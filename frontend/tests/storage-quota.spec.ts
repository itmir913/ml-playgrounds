/**
 * **저장은 여유를 미리 재지 않는다** (open-decisions.md 73).
 *
 * 쓰기 전에 `navigator.storage.estimate()`로 여유를 재던 검사(`ensureRoom`)는 두 병을 냈다.
 *
 * 1. **끝나지 않는 `estimate()`가 쓰기 줄 전체를 멈췄다** (2026-09-29 감사 H/A-1). 쓰기는 줄을
 *    서므로 그 뒤의 저장과, 저장을 기다리는 라우터 이동이 전부 영원히 섰다.
 * 2. **옛 사본을 두 번 셌다** (감사 C/C-1 · B/C-1). 실제로는 들어가는 프로젝트를 거절했다.
 *
 * 남는 것은 **실제 쓰기의 `QuotaExceededError`**뿐이고, 그것은 얼마가 모자란지 모르므로 알림이
 * 수를 말하지 않는다(감사 C/C-5 — 전에는 *"필요 0MB, 남은 공간 0MB"*).
 */

import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { closeStorage, loadProject, saveProject } from '../src/project/storage'
import { manifest, projectFile } from './fixtures/project'
import { refuseWrites } from './fixtures/storage-refusal'
import { resetDatabase } from './fixtures/database'

function stubStorage(estimate: () => Promise<StorageEstimate>): void {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate } })
}

/**
 * 저장이 끝나는가. **멈추면 `'hung'`으로 끝난다** — 기다림에 끝을 두지 않으면 고침이 없을 때
 * 이 검사는 실패가 아니라 시간 초과로 서고, 그러면 왜 섰는지가 안 보인다
 * (`storage-upgrade.spec.ts`의 `openAsNewerTab`과 같은 모양). 1초는 fake-indexeddb의 쓰기
 * 한 번보다 수백 배 길다.
 */
function settles(work: Promise<void>): Promise<'done' | 'hung'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('hung'), 1_000)
    work.then(
      () => {
        clearTimeout(timer)
        resolve('done')
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

beforeEach(async () => {
  closeStorage()
  await resetDatabase()
})

afterEach(async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await resetDatabase()
})

describe('결정 73: 쓰기 전에 여유를 재지 않는다', () => {
  it('estimate()가 영원히 안 끝나도 저장은 끝난다', async () => {
    stubStorage(() => new Promise<never>(() => {}))

    expect(await settles(saveProject(projectFile()))).toBe('done')
    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })

  it('estimate()가 자리가 없다고 해도 쓴다 — 거절은 브라우저의 몫이다', async () => {
    stubStorage(() => Promise.resolve({ quota: 1, usage: 1 }))

    await saveProject(projectFile())

    expect(await loadProject(manifest.projectId)).not.toBeNull()
  })
})

describe('결정 73: 실제 쿼터 오류', () => {
  it('우리 코드가 되고, 수를 싣지 않는다', async () => {
    const refusal = refuseWrites()
    try {
      const thrown: unknown = await saveProject(projectFile()).catch((error: unknown) => error)
      expect(isClientError(thrown) && thrown.code).toBe('STORAGE_QUOTA_EXCEEDED')
      expect(isClientError(thrown) && thrown.params).toEqual({})
    } finally {
      refusal.restore()
    }
    // 거절된 쓰기는 아무것도 남기지 않았다.
    expect(await loadProject(manifest.projectId)).toBeNull()
  })

  /** **문구도 수를 말하지 않는다.** 얼마가 모자란지 모르는 자리에서 0MB를 말하면 거짓이다. */
  it('알림 문구에 자리표시자도 숫자도 없다', () => {
    for (const message of [ko.client.STORAGE_QUOTA_EXCEEDED, en.client.STORAGE_QUOTA_EXCEEDED]) {
      expect(message, 'no placeholder').not.toMatch(/[{}]/)
      expect(message, 'no number').not.toMatch(/\d|MB/)
    }
  })
})
