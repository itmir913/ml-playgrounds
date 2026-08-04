import { describe, expect, it } from 'vitest'

import { parseCsvText } from '../src/data/csv'
import { isClientError } from '../src/errors'

describe('parseCsvText', () => {
  it('기본적인 헤더+데이터 행을 격자로 만든다', () => {
    expect(parseCsvText('name,age\nkim,10\nlee,11\n')).toEqual([
      ['name', 'age'],
      ['kim', '10'],
      ['lee', '11'],
    ])
  })

  it('따옴표 안의 콤마와 줄바꿈을 하나의 셀로 취급한다', () => {
    expect(parseCsvText('name,note\nkim,"a, b\nc"\n')).toEqual([
      ['name', 'note'],
      ['kim', 'a, b\nc'],
    ])
  })

  it('빈 셀도 자리를 지킨다', () => {
    expect(parseCsvText('a,b,c\n1,,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ])
  })

  it('빈 줄은 버린다', () => {
    expect(parseCsvText('a,b\n\n1,2\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('짧은 행을 가장 긴 행에 맞춰 채운다', () => {
    // 마지막 필드가 없는 줄이 그대로 남으면 컬럼 인덱스가 행마다 어긋난다.
    expect(parseCsvText('a,b,c\n1,2\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ])
  })

  it('세미콜론으로 구분된 파일도 읽는다', () => {
    // 구분자를 콤마로 고정하면 이런 파일이 통째로 한 컬럼이 된다.
    expect(parseCsvText('a;b\n1;2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('탭으로 구분된 파일도 읽는다', () => {
    expect(parseCsvText('a\tb\n1\t2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('maxRows를 주면 그만큼만 읽는다', () => {
    const lines = Array.from({ length: 50 }, (_, index) => `row${index},${index}`).join('\n')
    const grid = parseCsvText(`a,b\n${lines}\n`, 5)
    expect(grid).toHaveLength(5)
    expect(grid[0]).toEqual(['a', 'b'])
  })
})

describe('실패', () => {
  it('닫히지 않은 따옴표는 DATASET_PARSE_FAILED로 실패한다', () => {
    try {
      parseCsvText('a,b\n"unterminated,x')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_PARSE_FAILED')
    }
  })
})
