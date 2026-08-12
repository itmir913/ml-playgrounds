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

/**
 * 로케일에 없는 키를 불렀을 때. **기본 동작은 키 문자열을 그대로 그리는 것**이고,
 * 그건 화면에서만 보이고 검사에는 안 걸린다 — 실제로 `steps.data.purpose`가 대시보드에
 * 그렇게 떴다 (2026-08-13).
 *
 * **키를 조립해 부르는 자리는 정적 검사가 구조적으로 못 본다.** 뒷부분이 실행 중 값이라
 * 코드를 돌려 봐야 안다. 그러므로 **돌 때 시끄럽게** 만드는 것이 유일한 그물이다.
 *
 * - 검사(vitest)에서는 **던진다.** 화면을 마운트하는 스펙이 그 순간 빨개진다.
 * - 그 밖에서는 콘솔에 남긴다. **학생 화면을 예외로 죽이지 않는다** — 문장 하나가
 *   없다고 프로젝트를 못 여는 쪽이 더 나쁘다.
 */
function onMissing(locale: string, key: string): void {
  const message = `로케일에 없는 키: ${key} (${locale})`
  if (import.meta.env.MODE === 'test') throw new Error(message)
  console.error(message)
}

export const i18n = createI18n({
  legacy: false,
  locale: FALLBACK_LOCALE,
  fallbackLocale: FALLBACK_LOCALE,
  messages,
  missing: onMissing,
})

function navigatorLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') {
    return []
  }
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language]
}

/**
 * 사용자가 이번 세션에서 언어를 직접 골랐는가.
 *
 * **시작할 때 저장된 값을 읽는 것은 비동기다.** IndexedDB가 느린 기기에서는 그 사이에
 * 학생이 언어를 바꿀 수 있고, 그때 뒤늦게 도착한 옛 값이 학생의 선택을 되돌리면
 * 화면이 혼자 되돌아간 것처럼 보인다. **나중에 온 것이 아니라 사람이 고른 것이 이긴다.**
 */
let chosenByUser = false

/** 앱 시작 시 한 번 호출한다. 저장된 선택과 브라우저 설정을 반영한다. */
export async function initLocale(): Promise<Locale> {
  const locale = resolveLocale(await readPreferredLocale(), navigatorLanguages())
  if (!chosenByUser) {
    applyLocale(locale)
  }
  return locale
}

/** 사용자가 언어를 바꿀 때 호출한다. 화면에 즉시 반영하고 선택을 저장한다. */
export async function setLocale(locale: Locale): Promise<void> {
  chosenByUser = true
  applyLocale(locale)
  await writePreferredLocale(locale)
}

function applyLocale(locale: Locale): void {
  i18n.global.locale.value = locale
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}
