/**
 * 화면을 보는 방식.
 *
 * **프로젝트가 아니다** — `.mlpx`에도 IndexedDB에도 안 들어간다 (architecture.md §8.13.3).
 * 파일에 넣으면 교사가 연 화면이 학생이 접어 둔 모양으로 뜨고, 왕복 검사가 지켜야 할
 * 것이 하나 는다. IndexedDB에 넣으면 프로젝트를 옮길 때 따라간다 — 따라갈 이유가 없다.
 *
 * **`theme.ts`는 여기 안 온다.** 그쪽은 **첫 그림 전에** 답이 나와야 해서(안 그러면 어두운
 * 배색을 고른 학생이 새로 고칠 때마다 흰 화면을 본다) 자기 열쇠를 직접 들고 있다. 그
 * 제약이 없는 것들만 여기 모은다 — 열쇠 문자열이 화면 코드에 흩어지면 **무엇이 이 기기에
 * 남는지 세어 볼 자리**가 없어진다.
 */

/** 열쇠의 앞가지. `theme.ts`가 쓰는 것과 같다. */
const PREFIX = 'ml-playgrounds:'

/**
 * 이 기기에 남는 화면 설정. **늘어날 때마다 줄이 는다.**
 *
 * 값이 `true`/`false` 둘뿐인 것만 여기 있다. 그보다 복잡한 것이 필요해지면 그건 화면
 * 설정이 아니라 프로젝트 상태일 가능성이 높으니 그때 다시 본다.
 */
export const VIEW_FLAGS = {
  /** 결과 화면의 `실험 기록`이 펼쳐져 있는가 (architecture.md §8.13.3). */
  resultsHistoryOpen: 'results-history-open',
} as const

export type ViewFlag = keyof typeof VIEW_FLAGS

/**
 * 저장된 값. **못 읽으면 기본값이다.**
 *
 * 사파리의 사생활 보호 모드처럼 `localStorage` 접근 자체가 던지는 환경이 있다. 보는
 * 방식 하나 때문에 화면이 안 뜨면 안 되므로 삼킨다 (`theme.ts`와 같은 이유).
 *
 * **`true`/`false`가 아니면 기본값이다.** 손으로 넣어 둔 값이나 옛 형식을 참으로 읽으면
 * 학생이 고른 적 없는 화면이 뜬다.
 */
export function readFlag(flag: ViewFlag, fallback: boolean): boolean {
  let stored: string | null = null
  try {
    stored = window.localStorage.getItem(PREFIX + VIEW_FLAGS[flag])
  } catch {
    return fallback
  }
  if (stored === 'true') return true
  if (stored === 'false') return false
  return fallback
}

export function writeFlag(flag: ViewFlag, value: boolean): void {
  try {
    window.localStorage.setItem(PREFIX + VIEW_FLAGS[flag], value ? 'true' : 'false')
  } catch {
    // 저장에 실패해도 이번 세션의 선택은 이미 화면에 반영돼 있다 (`theme.ts`와 같다).
  }
}
