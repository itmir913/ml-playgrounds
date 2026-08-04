import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { parseCsv, previewCsv } from '../src/data/csv'

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

describe('parseCsv', () => {
  it('기본적인 헤더+데이터 행을 격자로 만든다', () => {
    const { grid, encoding } = parseCsv(bytesOf('name,age\nkim,10\nlee,11\n'))
    expect(encoding).toBe('utf-8')
    expect(grid).toEqual([
      ['name', 'age'],
      ['kim', '10'],
      ['lee', '11'],
    ])
  })

  it('따옴표 안의 콤마와 줄바꿈을 하나의 셀로 취급한다', () => {
    const { grid } = parseCsv(bytesOf('name,note\nkim,"a, b\nc"\n'))
    expect(grid).toEqual([
      ['name', 'note'],
      ['kim', 'a, b\nc'],
    ])
  })

  it('빈 셀도 자리를 지킨다', () => {
    const { grid } = parseCsv(bytesOf('a,b,c\n1,,3\n'))
    expect(grid).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ])
  })

  it('CP949로 저장된 한글 헤더를 깨지지 않게 읽는다', () => {
    const bytes = new Uint8Array([
      192, 204, 184, 167, 44, 179, 170, 192, 204, 10, 176, 161, 179, 170, 180, 217, 44, 49, 48,
    ])
    const { grid, encoding } = parseCsv(bytes)
    expect(encoding).toBe('cp949')
    expect(grid).toEqual([
      ['이름', '나이'],
      ['가나다', '10'],
    ])
  })
})

describe('previewCsv', () => {
  it('요청한 행 수만큼만 돌려준다', () => {
    const lines = Array.from({ length: 50 }, (_, index) => `row${index},${index}`).join('\n')
    const { grid } = previewCsv(bytesOf(`a,b\n${lines}\n`), 5)
    expect(grid).toHaveLength(5)
    expect(grid[0]).toEqual(['a', 'b'])
  })
})

describe('실패', () => {
  it('닫히지 않은 따옴표는 DATASET_FILE_UNREADABLE로 실패한다', () => {
    try {
      parseCsv(bytesOf('a,b\n"unterminated,x'))
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_FILE_UNREADABLE')
    }
  })
})
