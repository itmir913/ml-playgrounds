/**
 * **문장 안의 수를 그 언어로 찍는다** (open-decisions.md "119. 화면의 세는 수를 어디서 포맷하는가").
 *
 * 숫자를 받는 `t()` 호출이 백수십 곳이라 자리마다 고치면 다음 자리가 또 빠진다. 그래서 **메시지 함수 하나를
 * 감싼다** — vue-i18n의 기본 컴파일러가 만든 함수는 자리표시자를 언제나 `ctx.named(key)`로 읽으므로, 그 함수만
 * 바꿔 끼우면 화면·알림·오류 문장이 한꺼번에 덮인다. 호출부는 숫자를 그대로 넘긴다.
 *
 * **이름으로 가른다 — 목록은 닫혀 있다.** 로케일의 자리표시자는 아래 셋 중 정확히 하나에 있어야 하고,
 * `i18n-numbers.spec.ts`가 로케일 파일 전부를 대조한다. 새 자리표시자를 더하면 여기서 분류를 강제당한다.
 *
 * **값이 문자열이면 이름이 무엇이든 손대지 않는다** — 같은 `used`가 어떤 문장에서는 행 수(숫자), 어떤 문장에서는
 * 버전·포맷된 MB(문자열)다. 포맷된 것을 다시 포맷하지 않는다.
 *
 * **복수 선택은 건드리지 않는다.** vue-i18n은 복수 인덱스를 ctx를 만들기 **전에** 숫자로 정하고, 여기서 바꾸는 것은
 * 자리표시자에 들어갈 글자뿐이다. 무는 검사: `i18n-numbers.spec.ts`(진짜 입구 `i18n.global.t`로 돈다 — 컴파일러를
 * 건너뛰는 사전 컴파일 플러그인이 들어오는 날 빨개진다).
 */

import { compile, type MessageCompiler, type MessageContext } from '@intlify/core-base'

import { formatCount, formatMegabytes } from './composables/useFormat'

/**
 * **세는 수.** 정수가 오면 그 언어의 자리 구분 기호를 넣는다.
 *
 * `index`는 행 번호도 들어와 10만을 넘는다(`fromDataDone`·`SPLIT_INDEX_OUT_OF_RANGE`). 군집·실험 번호는 작아 결과가 같다.
 * `minutes`·`seconds`(예상 시간)는 1,000을 넘지 않지만 정수라 같은 갈래다. `limit`은 사진 장수이고, 포트폴리오의 `limit`은
 * 포맷된 문자열로 와서 손대지 않는다.
 */
export const COUNT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'actualClasses',
  'actualColumns',
  'actualRows',
  'chosen',
  'clusters',
  'completed',
  'count',
  'current',
  'distinct',
  'done',
  'dropped',
  'epochs',
  'files',
  'from',
  'idleMinutes',
  'incoming',
  'index',
  'kinds',
  'labels',
  'last',
  'limit',
  'limitClasses',
  'limitColumns',
  'limitRows',
  'limitSeconds',
  'lonely',
  'minRows',
  'minutes',
  'nSamples',
  'read',
  'rest',
  'rows',
  'seconds',
  'shown',
  'testRows',
  'to',
  'total',
  'trainRows',
  'usable',
  'used',
])

/**
 * **메가바이트 수.** 소수가 올 수 있다(`limit / BYTES_PER_MB`, 백엔드 float). 단위는 문장이 붙인다.
 *
 * **반올림이 값을 바꾼다** — 상한을 간신히 넘긴 값이 상한과 같은 글자로 찍힐 수 있다. 백엔드가 MB 파라미터를 정수로
 * 주는 지금은 생기지 않는다. 그 전제가 깨지면 던지는 쪽이 올림·내림을 정한다(`SizeMeter`의 올림과 같은 판단).
 */
export const MEGABYTE_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'actualMb',
  'availableMb',
  'limitMb',
  'requiredMb',
])

/**
 * **손대지 않는 것.** 학생 데이터의 값(연도 `2001`이 `2,001`이 된다 — `formatRawCell`), 하이퍼파라미터 범위(`min`·`max`·
 * `actual` — 입력 칸에 치는 값과 같은 모양이어야 한다, 코드 소유자), 버전, 픽셀 크기, 이름·경로, 이미 포맷된 통계·시각.
 */
export const RAW_PLACEHOLDERS: ReadonlySet<string> = new Set([
  'actual',
  'algorithm',
  'answer',
  'app',
  'appVersion',
  'at',
  'categories',
  'center',
  'column',
  'columns',
  'encoding',
  'entry',
  'expected',
  'experiment',
  'feature',
  'fields',
  'file',
  'fileName',
  'fileVersion',
  'format',
  'found',
  'label',
  'loss',
  'max',
  'mean',
  'median',
  'metric',
  'min',
  'model',
  'name',
  'names',
  'overall',
  'path',
  'percent',
  'q1',
  'q3',
  'range',
  'runtime',
  'score',
  'shared',
  'sheetName',
  'size',
  'spread',
  'std',
  'stored',
  'target',
  'task',
  'value',
  'values',
  'version',
  'x',
  'y',
])

/**
 * 자리표시자 하나에 들어갈 값. **세는 수 자리에 소수가 오면** 값을 바꾸지 않고 시끄럽게 실패한다 — 검사에서는 던지고
 * 그 밖에서는 콘솔에 남긴다(`i18n.ts`의 `onMissing`과 같은 판단).
 */
export function placeholderValue(locale: string, key: string, value: unknown): unknown {
  if (typeof value !== 'number') return value
  if (MEGABYTE_PLACEHOLDERS.has(key)) return formatMegabytes(locale, value)
  if (!COUNT_PLACEHOLDERS.has(key)) return value
  if (!Number.isInteger(value)) {
    const message = `count placeholder got a non-integer: {${key}} = ${value} (${locale})`
    if (import.meta.env.MODE === 'test') throw new Error(message)
    console.error(message)
    return value
  }
  return formatCount(locale, value)
}

/**
 * vue-i18n의 `messageCompiler`. 기본 컴파일러가 만든 함수에 **새 ctx**를 넘긴다 — 받은 ctx는 바꾸지 않는다.
 */
export const numberAwareCompiler: MessageCompiler = (message, context) => {
  const inner = compile(message, context)
  const locale = context.locale
  const wrapped = (ctx: MessageContext) =>
    inner({ ...ctx, named: (key: string) => placeholderValue(locale, key, ctx.named(key)) })
  return Object.assign(wrapped, inner)
}
