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

  /**
   * **셀이 전부 빈 줄은 papaparse가 안 버린다.** `skipEmptyLines: true`가 버리는 것은
   * 글자가 아예 없는 줄이고, `,,`는 셀 셋이 있는 줄이다 — 한국 엑셀의 "CSV로 저장"이
   * 파일 끝에 남기는 모양이 그것이다.
   *
   * 위 검사는 papaparse 옵션만으로 통과하는 입력이라 `isEmptyRow`를 무력화해도
   * 조용했다 (R14-4 감사 A-3). 그때 행이 하나 늘고 **열도 하나 는다** — `padGrid`가
   * 가장 긴 행에 맞추므로, 이름 없는 열이 결측 100%로 표에 선다.
   */
  it('셀이 전부 빈 줄도 버린다 - 엑셀이 파일 끝에 남기는 모양이다', () => {
    expect(parseCsvText(['a,b,c', '1,2,3', ',,', ''].join('\n'))).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('공백만 든 셀도 빈 것으로 본다', () => {
    expect(parseCsvText(['a,b', '1,2', '  ,  ', ''].join('\n'))).toEqual([
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
