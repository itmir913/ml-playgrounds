/**
 * 배색 결정.
 *
 * **사람이 고른 것이 기기 설정을 이긴다.** 이 순서가 뒤집히면 학생이 고른 화면이
 * 새로 고칠 때마다 되돌아가고, 그건 고장으로 보인다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FALLBACK_THEME,
  initTheme,
  isTheme,
  otherTheme,
  resolveTheme,
  setTheme,
  THEMES,
} from '../src/theme'

describe('배색을 정한다', () => {
  it('고른 값이 있으면 기기 설정과 무관하게 그것이다', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('고른 값이 없으면 기기 설정을 따른다', () => {
    expect(resolveTheme(null, true)).toBe('dark')
    expect(resolveTheme(null, false)).toBe('light')
  })

  it('모르는 값은 고른 적 없는 것으로 본다', () => {
    // 저장소에 옛 값이나 손으로 고친 값이 들어 있을 수 있다. 던지지 않고 기기 설정으로 간다.
    expect(resolveTheme('sepia', true)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe(FALLBACK_THEME)
  })

  it('어떤 조합에서도 아는 배색만 나온다', () => {
    for (const stored of ['light', 'dark', 'sepia', '', null, undefined]) {
      for (const prefersDark of [true, false]) {
        expect(THEMES, `${String(stored)}/${prefersDark}`).toContain(
          resolveTheme(stored, prefersDark),
        )
      }
    }
  })
})

describe('반대쪽 배색', () => {
  it('둘을 오간다', () => {
    expect(otherTheme('light')).toBe('dark')
    expect(otherTheme('dark')).toBe('light')
  })

  it('두 번 뒤집으면 제자리다 - 스위치를 두 번 누른 학생이 돌아와야 한다', () => {
    for (const theme of THEMES) {
      expect(otherTheme(otherTheme(theme))).toBe(theme)
    }
  })
})

/** 기기가 어두운 배색을 선호한다고 답하게 한다. jsdom에는 matchMedia가 없다. */
function pretendSystem(prefersDark: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: prefersDark && query.includes('dark'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

describe('선택이 새로 고침을 넘어 남는다', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('고른 것이 없으면 기기 설정을 따른다', () => {
    pretendSystem(true)
    expect(initTheme()).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('고르면 저장되고, 다시 시작해도 그것이다', () => {
    pretendSystem(true)
    initTheme()
    setTheme('light')

    // 새로 고침을 흉내 낸다. 기기는 여전히 어두운 배색을 선호한다.
    document.documentElement.removeAttribute('data-theme')
    expect(initTheme()).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('저장소가 막혀 있어도 앱이 뜬다', () => {
    // 사파리 사생활 보호 모드에서는 접근 자체가 던진다. 배색 때문에 앱이 죽으면 안 된다.
    pretendSystem(false)
    const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => initTheme()).not.toThrow()
    expect(THEMES).toContain(initTheme())
    blocked.mockRestore()
  })
})

describe('배색 이름을 알아본다', () => {
  it('아는 것만 참이다', () => {
    expect(THEMES.every(isTheme)).toBe(true)
    for (const value of ['sepia', '', null, undefined, 0, {}]) {
      expect(isTheme(value), String(value)).toBe(false)
    }
  })
})
