// @vitest-environment jsdom
/**
 * 화면 설정이 이 기기에 남는다 (`src/prefs.ts`, architecture.md §8.13.3).
 *
 * **여기서 지키는 것은 "못 읽어도 화면이 뜬다"이다.** 사파리의 사생활 보호 모드처럼
 * `localStorage` 접근 자체가 던지는 환경이 있고, 보는 방식 하나 때문에 결과 화면이
 * 안 뜨면 그건 학생이 고칠 수 없는 고장이다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { readFlag, VIEW_FLAGS, writeFlag } from '../src/prefs'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('화면 설정', () => {
  it('쓴 것을 그대로 읽는다', () => {
    writeFlag('resultsHistoryOpen', false)
    expect(readFlag('resultsHistoryOpen', true)).toBe(false)

    writeFlag('resultsHistoryOpen', true)
    expect(readFlag('resultsHistoryOpen', false)).toBe(true)
  })

  it('저장된 것이 없으면 기본값이다', () => {
    expect(readFlag('resultsHistoryOpen', true)).toBe(true)
    expect(readFlag('resultsHistoryOpen', false)).toBe(false)
  })

  /**
   * **`true`/`false`가 아니면 기본값이다.** 손으로 넣어 둔 값이나 옛 형식을 참으로
   * 읽으면 학생이 고른 적 없는 화면이 뜬다.
   */
  it('모르는 값은 기본값으로 떨어진다', () => {
    for (const junk of ['1', 'yes', 'TRUE', '', '{}']) {
      window.localStorage.setItem(`ml-playgrounds:${VIEW_FLAGS.resultsHistoryOpen}`, junk)
      expect(readFlag('resultsHistoryOpen', true), junk).toBe(true)
      expect(readFlag('resultsHistoryOpen', false), junk).toBe(false)
    }
  })

  it('읽기가 던져도 기본값을 준다 - 사생활 보호 모드', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readFlag('resultsHistoryOpen', true)).toBe(true)
  })

  it('쓰기가 던져도 그냥 넘어간다 - 이번 세션의 선택은 이미 화면에 있다', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => writeFlag('resultsHistoryOpen', false)).not.toThrow()
  })

  /**
   * **앞가지가 없으면 배색과 같은 자리를 쓸 수 있다.** `theme.ts`가 이미
   * `ml-playgrounds:theme`을 쓰고 있고, 같은 이름 공간에 사는 것이 그 뜻이다.
   */
  it('열쇠에 앞가지가 붙는다', () => {
    writeFlag('resultsHistoryOpen', false)
    expect(window.localStorage.getItem('ml-playgrounds:results-history-open')).toBe('false')
    expect(window.localStorage.getItem(VIEW_FLAGS.resultsHistoryOpen)).toBeNull()
  })
})
