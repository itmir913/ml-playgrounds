/**
 * **수로 읽는 글자** (open-decisions.md 71, 2026-09-28 감사 E C4).
 *
 * `toNumber`는 JS `Number()`에 기대고 있었다. 그 문법은 `0x1A`·`0b101`·`0o17`을 26·5·15로
 * 읽는데 **pandas `read_csv`도 파이썬 `float()`도 그 셋을 거부한다** — 같은 표가 이 앱에서는
 * 수치 열, 파이썬 수업에서는 범주 열이 됐다. 좁힌 것은 그 셋뿐이고 **pandas가 받는 것은 전부
 * 그대로 받는다**(회귀 금지). 아래 기대값은 pandas 3.0.3 · Python 3.14로 잰 값이다(사람 확인 —
 * `read_csv`에 한 칸짜리 열을 넣어 dtype을 봤다).
 */
import { describe, expect, it } from 'vitest'

import { numericRanges } from '../src/ml/predict'
import { detectKind, readsAsNumber, toNumber } from '../src/ml/preprocess'

describe('toNumber — pandas가 받는 것만 수다', () => {
  it.each([['0x1A'], ['0X1a'], ['0b101'], ['0B1'], ['0o17'], ['0O7'], [' 0x1A ']])(
    '%s는 수가 아니다 (pandas·float() 둘 다 거부)',
    (cell) => {
      expect(toNumber(cell)).toBeNull()
      expect(readsAsNumber(cell)).toBe(false)
    },
  )

  /** 전에 받던 것 가운데 pandas도 받는 것 — 하나라도 빠지면 회귀다. */
  it.each([
    ['1e3', 1000],
    ['1E3', 1000],
    ['.5', 0.5],
    ['5.', 5],
    ['+1', 1],
    ['-1', -1],
    ['  7  ', 7],
    ['\t8\t', 8],
    ['00012', 12],
    ['+.5e-2', 0.005],
    ['-2.5E-3', -0.0025],
    ['0', 0],
    ['0.0', 0],
  ])('%s는 %d다', (cell, value) => {
    expect(toNumber(cell)).toBe(value)
  })

  /**
   * **옛 판도 안 받던 것은 여전히 안 받는다.** `inf`·`nan`·`1e1000`은 pandas가 수로 읽지만
   * 이 앱은 유한한 값만 수로 보고(`stats.spec.ts`의 무한대), `1_000`은 `float()`만 받고
   * pandas는 거부한다. 넓히는 것은 이 결정의 범위가 아니다.
   */
  it.each([['1,000'], ['1 000'], ['1_000'], ['inf'], ['nan'], ['Infinity'], ['1e1000'], ['-0x1A']])(
    '%s는 지금처럼 수가 아니다',
    (cell) => {
      expect(toNumber(cell)).toBeNull()
    },
  )

  it('빈 칸과 공백만 있는 칸은 수가 아니다', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber('   ')).toBeNull()
  })
})

describe('detectKind — 진법 표기가 든 열은 범주다', () => {
  it('0x1A가 한 칸이라도 있으면 범주 열이다 (pandas의 object)', () => {
    expect(detectKind(['1', '2', '0x1A'])).toBe('categorical')
  })

  it('십진 표기뿐이면 전처럼 수치 열이다', () => {
    expect(detectKind(['1', ' 2.5 ', '-1e3', '.5'])).toBe('numeric')
  })
})

/**
 * **한 줄 예측 칸의 범위 도움말도 같은 잣대다** (`numericRanges`). 칸은 여러 표를 보고 범위를
 * 세는데, 다른 표에 `0x1A`가 있으면 `Number()`로는 26이 범위에 들어갔다.
 */
describe('numericRanges — 수로 읽는 잣대는 toNumber 하나다', () => {
  it('진법 표기는 범위에 안 든다', () => {
    const dataset = { columns: ['x'], rows: [['1'], ['0x1A'], [' 3 ']] }
    expect(numericRanges([dataset], [{ name: 'x', kind: 'numeric' }]).get('x')).toEqual({
      min: 1,
      max: 3,
    })
  })
})
