/**
 * vue-i18n 설정.
 *
 * 지원 언어는 배열 하나로 관리한다. en/ko 두 개를 가정한 분기를 만들지 마라 - ja가 추가된다.
 * 언어를 늘릴 때 고쳐야 하는 곳은 SUPPORTED_LOCALES와 messages 두 줄뿐이어야 한다.
 *
 * 초기값은 저장된 선택 > navigator 언어 > 대체 언어 순으로 결정한다.
 * 선택은 IndexedDB에 저장한다 (CLAUDE.md 1.2).
 */

import { createI18n } from 'vue-i18n'

import en from './locales/en.json'
import ko from './locales/ko.json'
import { readPreferredLocale, writePreferredLocale } from './project/storage'

export const SUPPORTED_LOCALES = ['en', 'ko'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

/** 어떤 언어로도 해석되지 않을 때 쓰는 언어. */
export const FALLBACK_LOCALE: Locale = 'en'

// satisfies를 쓰는 이유: 메시지 내용의 타입 추론은 살리면서,
// SUPPORTED_LOCALES에 언어를 추가하고 여기를 빠뜨리면 컴파일이 깨지게 하려는 것이다.
const messages = { en, ko } satisfies Record<Locale, unknown>

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * 초기 언어를 결정한다. 순수 함수이므로 단위 테스트로 덮는다.
 *
 * @param stored   저장된 선택. 사용자가 명시적으로 고른 값이므로 최우선이다.
 * @param preferred navigator.languages 같은 선호 목록. 앞쪽이 더 선호된다.
 *
 * 'ko-KR'처럼 지역이 붙은 태그는 기본 태그('ko')로 떨어뜨려 본다.
 * 정확히 일치하는 후보가 있으면 그쪽을 먼저 쓴다.
 */
export function resolveLocale(
  stored: string | null | undefined,
  preferred: readonly string[],
): Locale {
  if (isSupportedLocale(stored)) {
    return stored
  }

  for (const tag of preferred) {
    if (isSupportedLocale(tag)) {
      return tag
    }
    const base = tag.split('-')[0]
    if (isSupportedLocale(base)) {
      return base
    }
  }

  return FALLBACK_LOCALE
}

export const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: FALLBACK_LOCALE,
  messages,
})

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return []
  }
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language]
}

/** 앱 시작 시 한 번 호출한다. 저장된 선택과 브라우저 설정을 반영한다. */
export async function initLocale(): Promise<Locale> {
  const locale = resolveLocale(await readPreferredLocale(), navigatorLanguages())
  applyLocale(locale)
  return locale
}

/** 사용자가 언어를 바꿀 때 호출한다. 화면에 즉시 반영하고 선택을 저장한다. */
export async function setLocale(locale: Locale): Promise<void> {
  applyLocale(locale)
  await writePreferredLocale(locale)
}

function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}
