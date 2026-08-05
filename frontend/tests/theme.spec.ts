/**
 * 배색 결정.
 *
 * **사람이 고른 것이 기기 설정을 이긴다.** 이 순서가 뒤집히면 학생이 고른 화면이
 * 새로 고칠 때마다 되돌아가고, 그건 고장으로 보인다.
 */

import { describe, expect, it } from 'vitest'

import { FALLBACK_THEME, isTheme, otherTheme, resolveTheme, THEMES } from '../src/theme'

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

describe('배색 이름을 알아본다', () => {
  it('아는 것만 참이다', () => {
    expect(THEMES.every(isTheme)).toBe(true)
    for (const value of ['sepia', '', null, undefined, 0, {}]) {
      expect(isTheme(value), String(value)).toBe(false)
    }
  })
})
