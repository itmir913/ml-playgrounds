/**
 * 숫자·날짜·용량을 화면에 쓸 문자열로 바꾼다.
 *
 * **직접 조립하지 않고 Intl에 맡긴다** (CLAUDE.md §3 규칙 6). 그리고 **로케일을 코드에
 * 박지 않는다** — `'ko-KR'`을 쓰면 그 자리는 영원히 한국어다. 지금 선택된 언어를 넘긴다.
 *
 * 순수 함수들은 컴포저블 밖에 두어 화면 없이 테스트한다.
 */

import { useI18n } from 'vue-i18n'

/** 1024로 나눈 단위들. Intl에 이 단위계가 없어서 우리가 고른다. */
const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

/**
 * 바이트를 사람이 읽는 크기로. 단위 이름은 Intl이 언어에 맞게 붙인다.
 *
 * 1024 기준인 것을 KB로 적는 것은 흔한 관행이고, 여기서 1000으로 바꾸면 브라우저가
 * 보고하는 저장 공간과 어긋나 학생이 두 숫자를 비교할 수 없다.
 */
export function formatBytes(locale: string, bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: UNITS[unit],
    unitDisplay: 'short',
    // 바이트 단위에서는 소수점이 의미가 없다.
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value)
}

/** 날짜와 시각. 초는 빼고 분까지만 - 학생이 알고 싶은 것은 "언제쯤"이다. */
export function formatDateTime(locale: string, iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) {
    // 남의 파일에서 온 값이 깨져 있을 수 있다. 화면이 "Invalid Date"를 보이면 안 된다.
    return iso
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

/** 비율을 백분율로. 지표 표시가 이걸 쓴다. */
export function formatPercent(locale: string, ratio: number, digits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(ratio)
}

/**
 * 화면에서 쓰는 포맷터들.
 *
 * 평범한 함수를 돌려준다. 템플릿에서 부르면 그리는 동안 `locale.value`를 읽으므로
 * 언어를 바꾸면 그 자리도 함께 다시 그려진다.
 */
export function useFormat() {
  const { locale } = useI18n()

  return {
    bytes: (value: number) => formatBytes(locale.value, value),
    dateTime: (iso: string) => formatDateTime(locale.value, iso),
    percent: (ratio: number) => formatPercent(locale.value, ratio),
  }
}
