import { describe, expect, it } from 'vitest'

import { deadlineFromInput, deadlineToInput, deadlineVerdict } from '../src/project/deadline'

/**
 * 마감 판정 (open-decisions.md 121). **기대값은 같은 생성자로 짓는다** — 테스트가 도는 기기의
 * 시간대가 무엇이든 "교사 브라우저의 시간대로 읽는다"가 그대로 검사된다.
 */
describe('deadlineFromInput', () => {
  it('reads the input as local time at the start of that minute', () => {
    expect(deadlineFromInput('2026-11-20T23:59')).toBe(new Date(2026, 10, 20, 23, 59).getTime())
  })

  it('rejects dates that do not exist instead of rolling over', () => {
    expect(deadlineFromInput('2026-02-31T10:00')).toBeNull()
    expect(deadlineFromInput('2026-11-20T24:00')).toBeNull()
  })

  it('rejects anything that is not a minute-precision datetime-local value', () => {
    expect(deadlineFromInput('')).toBeNull()
    expect(deadlineFromInput('2026-11-20')).toBeNull()
    expect(deadlineFromInput('2026-11-20T23:59:30')).toBeNull()
    expect(deadlineFromInput('2026-11-20T23:59Z')).toBeNull()
  })

  it('round-trips through deadlineToInput', () => {
    const value = '2026-03-05T08:07'
    expect(deadlineToInput(deadlineFromInput(value)!)).toBe(value)
  })
})

describe('deadlineVerdict', () => {
  const deadline = new Date(2026, 10, 20, 23, 59).getTime()
  const iso = (ms: number) => new Date(ms).toISOString()

  it('gives no verdict without a deadline or with an unreadable time', () => {
    expect(deadlineVerdict(iso(deadline), null)).toBeNull()
    expect(deadlineVerdict('not a time', deadline)).toBeNull()
  })

  it('counts the whole deadline minute as on time', () => {
    expect(deadlineVerdict(iso(deadline), deadline)).toBe('onTime')
    expect(deadlineVerdict(iso(deadline + 59_999), deadline)).toBe('onTime')
    expect(deadlineVerdict(iso(deadline - 1), deadline)).toBe('onTime')
  })

  it('is late from second zero of the next minute', () => {
    expect(deadlineVerdict(iso(deadline + 60_000), deadline)).toBe('late')
  })

  it('compares instants, whatever offset the file wrote', () => {
    const utc = Date.UTC(2026, 10, 20, 15, 0)
    const at = utc - 60_000
    // 같은 시점을 `Z`, `+09:00`, 초 없는 꼴로 적어도 판정이 같다.
    expect(deadlineVerdict('2026-11-20T15:00:00.000Z', at)).toBe('late')
    expect(deadlineVerdict('2026-11-21T00:00+09:00', at)).toBe('late')
    expect(deadlineVerdict('2026-11-20T15:00Z', at)).toBe('late')
    expect(deadlineVerdict('2026-11-20T15:00Z', utc)).toBe('onTime')
  })
})
