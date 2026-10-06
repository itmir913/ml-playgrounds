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
  LOCALE_FONTS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  resolveLocale,
  splitLabel,
  splitTerm,
} from '../src/i18n'
import { LOCALE_TAGS } from './fixtures/locales'

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
    expect(resolveLocale(null, ['ja-JP'])).toBe('ja')
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

/**
 * **언어마다 더 싣는 글꼴** (`LOCALE_FONTS`). 한국어·영어 화면이 일본어 글꼴을 받으면
 * 쓰지도 않을 파일을 저사양 PC가 받는다 — 그 둘은 `null`이어야 한다.
 */
describe('언어마다 더 싣는 글꼴', () => {
  it('지원 언어마다 자리가 있다', () => {
    expect(Object.keys(LOCALE_FONTS).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('한국어·영어는 아무것도 더 싣지 않는다', () => {
    expect(LOCALE_FONTS.ko).toBeNull()
    expect(LOCALE_FONTS.en).toBeNull()
  })

  it('일본어는 Pretendard JP를 불러온다', () => {
    expect(LOCALE_FONTS.ja.toString()).toContain('pretendard-jp')
  })
})

describe('isSupportedLocale', () => {
  it('지원 언어 목록과 일치한다', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(isSupportedLocale(locale)).toBe(true)
    }
    expect(isSupportedLocale('fr')).toBe(false)
    expect(isSupportedLocale('ja-JP')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
    expect(isSupportedLocale(42)).toBe(false)
  })

  it('대체 언어는 반드시 지원 목록 안에 있다', () => {
    expect(isSupportedLocale(FALLBACK_LOCALE)).toBe(true)
  })

  /**
   * **로케일 파일과 지원 목록이 같다.** 로케일 계약 검사들은 파일 목록을 돈다
   * (`fixtures/locales.ts`) — 지원 목록에만 있고 파일이 없거나, 파일만 있고 목록에 없으면
   * 검사가 보는 언어와 학생이 고르는 언어가 갈린다.
   */
  it('로케일 파일 목록이 지원 목록과 같다', () => {
    expect([...LOCALE_TAGS]).toEqual([...SUPPORTED_LOCALES].sort())
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

describe('splitLabel', () => {
  /** 조각을 차례로 이은 글자. 원래 라벨과 같아야 한다 — 공백 하나도 새거나 빠지면 안 된다. */
  function rejoin(label: string): string {
    return splitLabel(label)
      .map((part) => `${part.head}${part.term ?? ''}${part.tail}${part.gap}`)
      .join('')
  }

  it('쉼표 뒤에서 가르고 쉼표는 앞 조각에, 공백은 따로 둔다', () => {
    expect(splitLabel('13번째 실험, 의사결정트리(Decision Tree)')).toEqual([
      { head: '13번째 실험', term: null, tail: ',', gap: ' ' },
      { head: '의사결정트리', term: '(Decision Tree)', tail: '', gap: '' },
    ])
  })

  /** 일본어는 `、`로 잇고 뒤에 공백이 없다 (`docs/copy.md` §7.1). */
  it('일본어 `、` 뒤에서도 가르고 없던 공백을 만들지 않는다', () => {
    expect(splitLabel('決定木(Decision Tree)、ml.js · このコンピュータ')).toEqual([
      { head: '決定木', term: '(Decision Tree)', tail: '、', gap: '' },
      { head: 'ml.js · このコンピュータ', term: null, tail: '', gap: '' },
    ])
  })

  it('가운뎃점으로는 가르지 않는다 - 학습 환경 이름은 한 이름이다', () => {
    expect(splitLabel('ml.js · 내 컴퓨터')).toHaveLength(1)
  })

  it.each([
    '13번째 실험, K-평균(K-Means), ml.js · 내 컴퓨터',
    'Experiment 13, k-means, ml.js · This computer',
    '13回目の実験、k-means法(K-Means)、ml.js · このコンピュータ',
    '군집화',
  ])('이어 붙이면 원래 라벨이다 (%s)', (label) => {
    expect(rejoin(label)).toBe(label)
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

/**
 * **언어를 고를 때 그 언어의 글꼴만 부른다** (`LOCALE_FONTS`). 위의 "언어마다 더 싣는 글꼴"은
 * 표만 본다 — 부르는 자리가 언어와 무관하게 일본어 글꼴을 받아도 초록이었다(2026-10-06 감사).
 */
describe('고른 언어의 글꼴만 부른다', () => {
  afterEach(() => {
    vi.doUnmock('../src/project/storage')
    vi.restoreAllMocks()
    vi.resetModules()
  })

  async function freshI18n(): Promise<typeof import('../src/i18n')> {
    vi.resetModules()
    vi.doMock('../src/project/storage', () => ({
      readPreferredLocale: () => Promise.resolve(null),
      writePreferredLocale: () => Promise.resolve(),
    }))
    return import('../src/i18n')
  }

  it('한국어·영어를 고르면 일본어 글꼴을 부르지 않는다', async () => {
    const module = await freshI18n()
    const load = vi.spyOn(module.LOCALE_FONTS, 'ja').mockResolvedValue({ default: '' })
    await module.setLocale('ko')
    await module.setLocale('en')
    expect(load).not.toHaveBeenCalled()
    await module.setLocale('ja')
    expect(load).toHaveBeenCalledTimes(1)
  })

  /**
   * **못 받아도 화면은 선다 — 그리고 거절을 받는 손이 있다.** 처리 안 된 거절은 이 환경에서
   * 관측되지 않아(실측 — 받는 손을 떼도 초록이었다) 로더가 돌려준 것에 `catch`가 붙는지를 본다.
   */
  it('글꼴을 못 받아도 언어는 바뀌고 거절을 받는다', async () => {
    const module = await freshI18n()
    const caught = vi.fn()
    const failing = {
      catch(handler: (reason: unknown) => unknown) {
        caught()
        return Promise.resolve(handler(new Error('offline')))
      },
    }
    vi.spyOn(module.LOCALE_FONTS, 'ja').mockReturnValue(failing as unknown as Promise<never>)
    await module.setLocale('ja')
    expect(module.i18n.global.locale.value).toBe('ja')
    expect(caught).toHaveBeenCalledTimes(1)
  })
})
