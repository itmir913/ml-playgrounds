/**
 * IndexedDB에 언어 선택이 남는지 확인한다.
 * 브라우저가 저장소라는 원칙(CLAUDE.md 1.2)의 첫 검증이다.
 */

import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { closeStorage, readPreferredLocale, writePreferredLocale } from '../src/project/storage'

describe('언어 선택 저장', () => {
  beforeEach(() => {
    closeStorage()
  })

  it('저장한 적이 없으면 null을 돌려준다', async () => {
    await expect(readPreferredLocale()).resolves.toBeNull()
  })

  it('저장한 값을 다시 읽을 수 있다', async () => {
    await writePreferredLocale('ko')
    await expect(readPreferredLocale()).resolves.toBe('ko')
  })

  it('나중에 저장한 값이 이긴다', async () => {
    await writePreferredLocale('ko')
    await writePreferredLocale('en')
    await expect(readPreferredLocale()).resolves.toBe('en')
  })

  it('연결을 닫았다 열어도 값이 남아 있다', async () => {
    await writePreferredLocale('ko')
    closeStorage()
    await expect(readPreferredLocale()).resolves.toBe('ko')
  })
})
