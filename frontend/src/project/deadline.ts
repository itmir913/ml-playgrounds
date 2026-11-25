/**
 * **점검 화면의 마감** (open-decisions.md 121).
 *
 * 교사가 정한 마감과 파일의 `manifest.updatedAt`을 **시점끼리** 견준다. 그 값은 늘 시간대가
 * 붙어 있으므로(`schema.ts`의 `TIMESTAMP`) 교사와 학생의 시간대가 달라도 안 어긋난다.
 *
 * **경계는 이 파일 한 곳에 있다.** 화면은 `deadlineVerdict`만 부른다.
 */

/**
 * 한 분. **입력이 분 단위라는 사실의 정의**이지 상한·분량이 아니라서 `limits.ts`에 두지 않는다.
 * 무는 검사: `deadline.spec.ts`의 경계 표본.
 */
const MINUTE_MS = 60_000

/** `<input type="datetime-local">`이 분 단위로 내는 값. 초가 붙은 값은 받지 않는다. */
const INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/**
 * 입력값을 **교사 브라우저의 시간대로** 읽어 그 분의 시작 시점(epoch ms)으로.
 *
 * `Date.parse`에 맡기지 않는다 — 없는 날짜(`2026-02-31`)를 다루는 방식이 엔진마다 다르다.
 * 성분으로 짓고 되읽어서, 넘쳐 다른 날이 된 값은 버린다.
 */
export function deadlineFromInput(value: string): number | null {
  const match = INPUT.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ]
  const at = new Date(year, month - 1, day, hour, minute)
  const same =
    at.getFullYear() === year &&
    at.getMonth() === month - 1 &&
    at.getDate() === day &&
    at.getHours() === hour &&
    at.getMinutes() === minute
  return same ? at.getTime() : null
}

/** 시점을 입력 칸에 되돌려 놓을 값으로. `deadlineFromInput`의 역이다. */
export function deadlineToInput(deadline: number): string {
  const at = new Date(deadline)
  const two = (n: number) => String(n).padStart(2, '0')
  return (
    `${String(at.getFullYear()).padStart(4, '0')}-${two(at.getMonth() + 1)}-${two(at.getDate())}` +
    `T${two(at.getHours())}:${two(at.getMinutes())}`
  )
}

export const DEADLINE_VERDICTS = ['onTime', 'late'] as const
export type DeadlineVerdict = (typeof DEADLINE_VERDICTS)[number]

/**
 * 판정. **마감을 안 정했거나 수정한 날짜를 못 읽으면 판정하지 않는다** (`null`).
 *
 * **그 분까지는 이내다** (코드 소유자, 2026-11-17). 23:59로 정하면 23:59:59.999까지 이내이고
 * 다음 분 0초부터 경과다.
 */
export function deadlineVerdict(
  updatedAt: string,
  deadline: number | null,
): DeadlineVerdict | null {
  if (deadline === null) return null
  const at = Date.parse(updatedAt)
  if (Number.isNaN(at)) return null
  return at >= deadlineEnd(deadline) ? 'late' : 'onTime'
}

/** 이내의 끝. **이 시점부터 경과다** — 판정을 다시 계산하는 쪽이 같은 경계를 쓰게 한다. */
export function deadlineEnd(deadline: number): number {
  return deadline + MINUTE_MS
}

/** 마감을 몇 분 넘겼는가. **경과일 때만 값이 있고 늘 1 이상이다** — 판정은 `deadlineVerdict`가 한다. */
export function minutesLate(updatedAt: string, deadline: number | null): number | null {
  if (deadline === null || deadlineVerdict(updatedAt, deadline) !== 'late') return null
  return Math.floor((Date.parse(updatedAt) - deadline) / MINUTE_MS)
}
