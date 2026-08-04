import { describe, expect, it } from 'vitest'

import { parseCsvText } from '../src/data/csv'
import { decodeText, detectEncoding } from '../src/data/encoding'
import { toCanonicalCsv, toCsvText } from '../src/data/serialize'

function roundTrip(grid: string[][]): string[][] {
  const bytes = toCanonicalCsv(grid)
  return parseCsvText(decodeText(bytes, detectEncoding(bytes)))
}

describe('toCsvText', () => {
  it('평범한 값은 감싸지 않는다', () => {
    expect(
      toCsvText([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\n1,2')
  })

  it('구분자·따옴표·줄바꿈이 든 값만 감싼다', () => {
    expect(toCsvText([['a,b', 'c"d', 'e\nf', 'plain']])).toBe('"a,b","c""d","e\nf",plain')
  })
})

describe('toCanonicalCsv', () => {
  it('UTF-8 BOM으로 시작한다', () => {
    // BOM이 없으면 교사가 압축을 풀어 엑셀로 열었을 때 한글이 전부 깨진다.
    const bytes = toCanonicalCsv([['이름']])
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('스스로 만든 바이트를 utf-8로 판정한다', () => {
    expect(detectEncoding(toCanonicalCsv([['이름', '나이']]))).toBe('utf-8')
  })
})

describe('왕복 무손실', () => {
  it('평범한 표', () => {
    const grid = [
      ['이름', '나이'],
      ['가나다', '10'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })

  it('구분자·따옴표·줄바꿈이 든 값', () => {
    const grid = [
      ['note', 'value'],
      ['a, b', 'say "hi"'],
      ['two\nlines', 'plain'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })

  it('빈 셀이 섞인 표', () => {
    const grid = [
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })
})
