/**
 * 긴 목록에서 **보이는 줄만 그린다** — 그릴 줄의 범위와 위아래 빈자리의 높이.
 *
 * **상한 대신 이것이다** (open-decisions.md 116, 2026-10-20 코드 소유자). 범주 순서 목록을 통째로
 * 그리면 값 종류 3,652개에서 창을 여는 데 1.5~1.8초, ↑ 한 번에 1.3~2.2초, 2만 개에서 12초와 9초였다
 * (개발 PC, 헤드리스 Chrome). 비용은 DOM이라 워커로 못 옮긴다. 보이는 줄만 그리면 값 종류 수와
 * 무관하다.
 *
 * **줄 높이는 모두 같다고 본다.** 부르는 쪽이 그린 줄 하나를 재서 넘긴다 — 글자 크기를 바꾼
 * 기기에서도 맞는다.
 */

export interface VirtualWindow {
  /** 그릴 첫 줄(포함). */
  readonly start: number
  /** 그릴 마지막 줄 다음(제외). */
  readonly end: number
  /** 위 빈자리의 높이(px). */
  readonly before: number
  /** 아래 빈자리의 높이(px). */
  readonly after: number
}

export function virtualWindow(input: {
  readonly count: number
  readonly rowHeight: number
  readonly scrollTop: number
  readonly viewportHeight: number
  /** 보이는 범위 위아래로 더 그릴 줄 수. 빨리 굴릴 때 빈칸이 비치지 않게 한다. */
  readonly overscan: number
}): VirtualWindow {
  const { count, overscan } = input
  if (count === 0) return { start: 0, end: 0, before: 0, after: 0 }
  // 잴 수 없으면(아직 안 그렸다) 첫 줄 높이를 1로 보고 위에서부터 그린다 — 다음 그리기가 바로잡는다.
  const rowHeight = input.rowHeight > 0 ? input.rowHeight : 1
  const first = Math.floor(Math.max(0, input.scrollTop) / rowHeight)
  const shown = Math.ceil(Math.max(0, input.viewportHeight) / rowHeight)
  const start = Math.min(count, Math.max(0, first - overscan))
  const end = Math.min(count, Math.max(start, first + shown + overscan))
  return { start, end, before: start * rowHeight, after: (count - end) * rowHeight }
}
