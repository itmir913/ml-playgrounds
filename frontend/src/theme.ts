/**
 * 화면 배색(밝게/어둡게).
 *
 * **`i18n.ts`와 같은 모양이다.** 사람이 고른 것이 있으면 그것을 쓰고, 없으면 기기 설정을
 * 따른다. 고른 값은 화면에 즉시 반영되고 `<html data-theme>`으로 나간다.
 *
 * **시스템 설정을 읽는 일을 여기가 한다.** CSS에 `@media (prefers-color-scheme: dark)`와
 * `[data-theme='dark']`를 둘 다 두면 같은 배색이 두 벌 적히고, 한쪽만 고쳤을 때 갈린다.
 * `styles/dark.css`에는 선택자가 하나뿐이고 이 파일이 그 값을 채운다.
 *
 * **선택은 `localStorage`에 저장한다.** 언어는 IndexedDB에 두지만 배색은 다르다 —
 * IndexedDB는 비동기라 읽는 동안 화면이 이미 떠 버리고, 어두운 배색을 고른 학생이
 * 새로 고칠 때마다 흰 화면을 한 번씩 본다. 언어는 늦게 바뀌어도 글자만 바뀌지만
 * **배색은 화면 전체가 번쩍인다.** `localStorage`는 동기라 첫 그림 전에 답이 나온다.
 * (`docs/open-decisions.md` 3-2)
 */

import { ref } from 'vue'

export const THEMES = ['light', 'dark'] as const

export type Theme = (typeof THEMES)[number]

/** 어떤 설정도 읽을 수 없을 때. 밝은 쪽이 교실 프로젝터에서 안전하다. */
export const FALLBACK_THEME: Theme = 'light'

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value)
}

/**
 * 지금 화면에 적용된 배색. 스위치의 아이콘과 설명이 이것을 본다.
 *
 * 모듈 하나가 들고 있는 이유는 배색이 **앱 전체에 하나뿐**이기 때문이다. 스토어로 만들면
 * 프로젝트가 없을 때도 살아 있어야 하는 상태가 스토어에 섞인다.
 */
export const theme = ref<Theme>(FALLBACK_THEME)

/**
 * 저장된 선택과 기기 설정으로 배색을 정한다. **순수 함수라 화면 없이 테스트한다.**
 *
 * @param stored 사람이 고른 값. 있으면 언제나 이긴다.
 * @param prefersDark 기기가 어두운 화면을 선호하는가.
 */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  if (isTheme(stored)) return stored
  return prefersDark ? 'dark' : FALLBACK_THEME
}

/** 반대쪽 배색. 스위치가 무엇으로 바뀌는지 말할 때도 쓴다. */
export function otherTheme(current: Theme): Theme {
  return current === 'dark' ? 'light' : 'dark'
}

/** `localStorage` 열쇠. 언어와 달리 IndexedDB가 아니므로 여기서 관리한다. */
const STORAGE_KEY = 'ml-playgrounds:theme'

/**
 * 저장된 선택. 못 읽으면 null이다.
 *
 * 사파리의 사생활 보호 모드처럼 `localStorage` 접근 자체가 던지는 환경이 있다.
 * 배색을 못 읽는 것으로 앱이 안 뜨면 안 되므로 삼킨다.
 */
function readStoredTheme(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredTheme(next: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // 저장에 실패해도 이번 세션의 선택은 이미 화면에 반영돼 있다.
  }
}

function darkMediaQuery(): MediaQueryList | null {
  return typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)')
}

function applyTheme(next: Theme): void {
  theme.value = next
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = next
  }
}

/**
 * 사람이 배색을 직접 골랐는가. 저장된 값이 있으면 고른 것이다.
 *
 * 골랐다면 그 뒤로 **기기 설정이 바뀌어도 따라가지 않는다.** 학생이 고른 화면이 혼자
 * 뒤집히는 것은 고장으로 보인다. 되돌리는 길은 두지 않았다 — "시스템 따름"이라는
 * 세 번째 상태는 중학생에게 설명하기 어렵고, 아이콘 하나로는 표현할 수도 없다.
 */
let chosenByUser = false

/** 앱 시작 시 한 번 부른다. 기기 설정이 바뀌면 따라가도록 구독도 여기서 건다. */
export function initTheme(): Theme {
  const stored = readStoredTheme()
  chosenByUser = isTheme(stored)

  const media = darkMediaQuery()
  applyTheme(resolveTheme(stored, media?.matches ?? false))

  media?.addEventListener('change', (event) => {
    if (!chosenByUser) applyTheme(event.matches ? 'dark' : 'light')
  })

  return theme.value
}

/** 사람이 배색을 바꿀 때 부른다. */
export function setTheme(next: Theme): void {
  chosenByUser = true
  applyTheme(next)
  writeStoredTheme(next)
}
