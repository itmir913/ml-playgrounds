// @vitest-environment jsdom
// 지금 쓰는 것은 순수 함수뿐이지만 i18n.ts에 DOM 부재 분기가 있다. node로 두면
// setLocale 검사를 하나 더하는 순간 죽지 않고 조용히 대체 경로를 보게 된다.
/**
 * 초기 언어 결정 규칙.
 * 저장된 선택 > navigator 선호 목록 > 대체 언어 순이다.
 */

import { describe, expect, it } from 'vitest'

import { FALLBACK_LOCALE, SUPPORTED_LOCALES, isSupportedLocale, resolveLocale } from '../src/i18n'

describe('resolveLocale', () => {
  it('저장된 선택이 있으면 브라우저 설정보다 우선한다', () => {
    expect(resolveLocale('en', ['ko-KR', 'ko'])).toBe('en')
    expect(resolveLocale('ko', ['en-US'])).toBe('ko')
  })

  it('저장된 값이 지원하지 않는 언어면 무시한다', () => {
    expect(resolveLocale('fr', ['ko-KR'])).toBe('ko')
  })

  it('지역 태그를 기본 태그로 떨어뜨린다', () => {
    expect(resolveLocale(null, ['ko-KR'])).toBe('ko')
    expect(resolveLocale(null, ['en-GB'])).toBe('en')
  })

  it('선호 목록의 앞쪽을 먼저 쓴다', () => {
    expect(resolveLocale(null, ['ko', 'en'])).toBe('ko')
    expect(resolveLocale(null, ['en', 'ko'])).toBe('en')
  })

  it('지원하지 않는 언어는 건너뛰고 다음 후보를 본다', () => {
    expect(resolveLocale(null, ['fr-FR', 'de', 'ko-KR'])).toBe('ko')
  })

  it('아무것도 맞지 않으면 대체 언어를 쓴다', () => {
    expect(resolveLocale(null, [])).toBe(FALLBACK_LOCALE)
    expect(resolveLocale(undefined, ['fr', 'de'])).toBe(FALLBACK_LOCALE)
  })
})

describe('isSupportedLocale', () => {
  it('지원 언어 목록과 일치한다', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true)
    }
    expect(isSupportedLocale('ja')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
    expect(isSupportedLocale(42)).toBe(false)
  })

  it('대체 언어는 반드시 지원 목록 안에 있다', () => {
    expect(isSupportedLocale(FALLBACK_LOCALE)).toBe(true)
  })
})
