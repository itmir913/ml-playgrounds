/**
 * 숫자·날짜·용량을 화면에 쓸 문자열로 바꾼다.
 *
 * **직접 조립하지 않고 Intl에 맡긴다** (docs/i18n.md 규칙 6). 그리고 **로케일을 코드에
 * 박지 않는다** — `'ko-KR'`을 쓰면 그 자리는 영원히 한국어다. 지금 선택된 언어를 넘긴다.
 *
 * 순수 함수들은 컴포저블 밖에 두어 화면 없이 테스트한다.
 */

import { useI18n } from 'vue-i18n'

import { BYTES_PER_KB } from '../limits'

/** 올라가는 단위들. Intl에 이 단위계가 없어서 우리가 고른다. */
const UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const

/**
 * 바이트를 사람이 읽는 크기로. 단위 이름은 Intl이 언어에 맞게 붙인다.
 *
 * **십진이다** (open-decisions.md "MB는 십진 백만이다"). 배수를 `limits.ts`에서
 * 가져오는 것이 요점이다 — 여기서만 1024로 나누면 `PROJECT_FILE_WARN_BYTES`가
 * **`100MB`로 적혀 화면에서 `95.4MB`로 읽힌다.** 실제로 그렇게 갈려 있었고, 그때
 * 학생이 본 수는 상한도 LMS의 100MB도 아닌 아무 데도 없는 값이었다 (R13-4 감사 A-1).
 *
 * 이진 쪽 근거였던 "브라우저가 보고하는 저장 공간과 맞춘다"는 지금 성립하지 않는다 —
 * `estimate()`가 화면에 닿는 유일한 자리(`STORAGE_QUOTA_EXCEEDED`)가 이미 십진이다.
 */
export function formatBytes(locale: string, bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= BYTES_PER_KB && unit < UNITS.length - 1) {
    value /= BYTES_PER_KB
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
 * 지표 하나. **자릿수를 여기서 줄인다** — 계산은 반올림하지 않고 그대로 저장한다
 * (`ml/metrics.ts`의 머리말).
 *
 * 소수는 셋째 자리까지다. 교실에서 견주는 데 그 이상은 필요 없고, 자릿수가 들쭉날쭉하면
 * 표에서 눈이 소수점을 못 따라간다 — `tabular-nums`가 자릿수를 맞춰 주는 것도 자릿수가
 * 같을 때 얘기다.
 */
export function formatMetric(locale: string, value: number, format: 'percent' | 'number'): string {
  if (format === 'percent') return formatPercent(locale, value)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)
}

/**
 * 모델이 낸 수치. **회귀의 답이 여기로 온다.**
 *
 * `String(value)`로는 안 된다 — 부동소수 계산의 결과라 `3.4000000000000004`가 그대로
 * 화면에 뜬다. 학생이 보는 것은 모델의 답인데 거기에 우리 계산기의 사정이 새어 나온다.
 *
 * **자릿수를 고정하지 않는다.** 지표와 다른 점이 그것이다 — 지표는 언제나 0~1 근처지만
 * 예측값은 **학생의 데이터 단위**다. 집값이면 수백만이고 농도면 0.0001이라, 소수 셋으로
 * 자르면 한쪽은 뒤가 잘리고 다른 쪽은 0만 남는다.
 *
 * 유효숫자 12자리로 한 번 걷어내고 나머지는 그대로 둔다. 부동소수의 잡음은 마지막
 * 자리들에만 있으므로 이 한 번으로 사라지고, **사람이 넣은 값에서 나온 자릿수는 남는다.**
 */
export function formatPrediction(locale: string, value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 20 }).format(
    Number(value.toPrecision(12)),
  )
}

/**
 * 데이터에서 **계산해 낸 통계**. 평균·표준편차·중앙값·스케일링 기준이 여기로 온다.
 *
 * **유효숫자 넷에서 자른다.** 평균은 나눗셈의 결과라 원래 데이터에 없던 자릿수가
 * 딸려 온다 — 소수 한 자리로 적힌 열의 평균이 `76.9166666667`로 뜬다. **데이터가 갖지
 * 않은 정밀도를 화면이 지어내는 것**이고, 그 자릿수로 학생이 할 수 있는 일도 없다.
 *
 * **자릿수가 아니라 유효숫자인 이유**는 `formatPrediction`과 같다 — 이 값들도 학생의
 * 데이터 단위라, 집값이면 수백만이고 농도면 0.0001이다. 소수 자릿수를 고정하면 한쪽은
 * 뒤가 잘리고 다른 쪽은 0만 남는다.
 *
 * 넷인 것은 지표를 소수 셋으로 자른 것과 같은 눈금이다(`formatMetric`) — 0~1 지표에서
 * 소수 셋이 곧 유효숫자 서넛이다. 교실에서 견주는 데는 그 이상이 필요 없다.
 *
 * **모델의 답에는 쓰지 마라.** 그건 계산해 낸 통계가 아니라 그 모델이 내놓은 값이고,
 * 우리가 자를 자리가 아니다(`formatPrediction`).
 */
export function formatStat(locale: string, value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return new Intl.NumberFormat(locale, { maximumSignificantDigits: 4 }).format(value)
}

/**
 * **학생의 자료가 그대로 지나간 칸.** 전처리 미리보기에서 변환이 아무 일도 안 한 자리다
 * (`ml/preview.ts`의 `raw`).
 *
 * **자리 구분 기호를 안 넣는 것이 요점이다.** 옆 칸의 `원래 값`은 원문 그대로 그리는데
 * 이쪽만 `Intl`을 지나면 **아무것도 안 바뀐 열에서 `2001`이 `2,001`로 달라 보인다** —
 * 그 카드가 존재하는 이유가 "무엇이 어떻게 바뀌는지"인데 안 바뀐 것을 바뀐 것으로
 * 보여주게 된다 (2026-08-29 화면 실측 B-2).
 *
 * 유효숫자 12로 한 번 걷는 것은 `formatPrediction`과 같다 — 부동소수의 잡음만 사라진다.
 */
export function formatRawCell(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  return String(Number(value.toPrecision(12)))
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
    prediction: (value: number) => formatPrediction(locale.value, value),
    rawCell: (value: number) => formatRawCell(value),
    stat: (value: number) => formatStat(locale.value, value),
    metric: (value: number, format: 'percent' | 'number') =>
      formatMetric(locale.value, value, format),
  }
}
