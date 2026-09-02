// @vitest-environment jsdom
// 지금 쓰는 것은 순수 함수뿐이지만 i18n.ts에 DOM 부재 분기가 있다. node로 두면
// setLocale 검사를 하나 더하는 순간 죽지 않고 조용히 대체 경로를 보게 된다.
/**
 * 초기 언어 결정 규칙.
 * 저장된 선택 > navigator 선호 목록 > 대체 언어 순이다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  FALLBACK_LOCALE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
  splitTerm,
} from '../src/i18n'

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

describe('splitTerm', () => {
  it('끝에 붙은 병기 괄호를 뗀다', () => {
    expect(splitTerm('의사결정트리(Decision Tree)')).toEqual({
      head: '의사결정트리',
      term: '(Decision Tree)',
    })
  })

  it('괄호가 없으면 그대로 둔다', () => {
    expect(splitTerm('ml.js · 내 컴퓨터')).toEqual({ head: 'ml.js · 내 컴퓨터', term: null })
  })

  it('문장 중간의 괄호는 병기가 아니다', () => {
    const sentence = '이 파일은 프로젝트 파일이 아닙니다. (a.csv) 다시 골라 주세요.'
    expect(splitTerm(sentence)).toEqual({ head: sentence, term: null })
  })

  it('괄호만 있는 라벨은 쪼개지 않는다 - 뗄 본체가 없다', () => {
    expect(splitTerm('(Decision Tree)')).toEqual({ head: '(Decision Tree)', term: null })
  })

  it('영어 라벨에는 아무 일도 하지 않는다 - 병기가 없다', () => {
    expect(splitTerm('Decision tree')).toEqual({ head: 'Decision tree', term: null })
  })
})

/**
 * **나중에 온 것이 아니라 사람이 고른 것이 이긴다** (`i18n.ts`의 `chosenByUser`).
 *
 * 시작할 때 저장된 언어를 읽는 것은 비동기다. IndexedDB가 느린 기기에서는 그 사이에
 * 학생이 언어를 바꿀 수 있고, 뒤늦게 도착한 옛 값이 그 선택을 되돌리면 **화면이 혼자
 * 되돌아간 것처럼 보인다.**
 *
 * **가드는 있었는데 무검사였다** (2026-09-02 R20 B-1). `limits-switch.ts`가 같은 가드를
 * 베끼며 검사를 얻었고 원본만 비어 있었다 — 지우고 전체 2,749개를 돌려도 아무도 안 울었다.
 * 이 검사는 그 라운드가 처방으로 재 본 것을 그대로 옮긴 것이다.
 */
describe('언어 선택의 경합', () => {
  afterEach(() => {
    vi.doUnmock('../src/project/storage')
    vi.resetModules()
  })

  it('읽는 중에 학생이 고르면 그 선택이 이긴다', async () => {
    let deliver: (value: string | null) => void = () => {}
    vi.resetModules()
    vi.doMock('../src/project/storage', () => ({
      readPreferredLocale: () =>
        new Promise<string | null>((resolve) => {
          deliver = resolve
        }),
      writePreferredLocale: () => Promise.resolve(),
    }))
    // **다시 가져온다.** 위의 정적 import는 진짜 저장소를 물고 있는 옛 모듈이다.
    const module = await import('../src/i18n')

    const arriving = module.initLocale()
    await module.setLocale('ko')
    // 저장소가 이제야 옛 값을 들고 도착한다.
    deliver('en')
    await arriving

    expect(module.i18n.global.locale.value).toBe('ko')
  })
})
