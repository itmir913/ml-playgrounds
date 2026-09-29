import { describe, expect, it } from 'vitest'

import { openCsvText, parseCsvText } from '../src/data/csv'
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

/**
 * **줄 끝이 섞인 파일** (2026-09-28 감사 E A2, `openCsvText`).
 *
 * papaparse는 줄 끝을 한 가지로 정한다 — 앞 1MB에서 따옴표 속을 지우고 `\r` 뒤에 `\n`이 오는
 * 경우의 다수결이다(`guessLineEndings`, 자세한 규칙은 `data/csv.ts`의 `openCsvText` 머리말).
 * 아래 파일은 `\r\n`이 이겨서 단독 `\n`·`\r`이 칸 안의 글자가 됐다 — 네 줄이 머리글 + 한 줄이
 * 되고 칸에 `170\n이`가 앉았다. 업로드 입구는 줄 끝을 `\n` 하나로 맞춘 뒤 읽는다.
 */
describe('줄 끝이 섞인 파일', () => {
  const MIXED = '이름,키\r\n김,170\n이,160\r박,150\r\n'
  const EXPECTED = [
    ['이름', '키'],
    ['김', '170'],
    ['이', '160'],
    ['박', '150'],
  ]

  it('업로드 입구는 셋을 모두 줄 끝으로 읽는다', () => {
    expect(openCsvText(MIXED)()).toEqual(EXPECTED)
  })

  it('맞추지 않은 추정은 틀린 표를 낸다 — 고침이 무엇을 막는지 못 박는다', () => {
    expect(parseCsvText(MIXED)).not.toEqual(EXPECTED)
  })

  /**
   * **정상 파일은 한 글자도 안 바뀐다** — 코드 소유자의 제약. 줄 끝이 한 가지인 파일은 맞추기
   * 전과 뒤가 같은 표여야 한다. 따옴표 안의 CRLF만 예외이고 아래 "대가"가 밝힌다.
   */
  it.each([
    ['LF', 'a,b\n1,"x, y"\n2,3\n'],
    ['CRLF', 'a,b\r\n1,"x, y"\r\n2,3\r\n'],
    ['CR', 'a,b\r1,"x, y"\r2,3\r'],
    ['세미콜론', 'a;b\r\n1;2\r\n'],
    ['탭', 'a\tb\n1\t2\n'],
    ['끝 줄바꿈 없음', 'a,b\r\n1,2'],
    ['따옴표 안 LF', 'a,b\n1,"x\ny"\n'],
    ['빈 줄', 'a,b\r\n\r\n1,2\r\n'],
  ])('줄 끝이 한 가지인 %s 파일은 추정한 결과와 같다', (_name, text) => {
    expect(openCsvText(text)()).toEqual(parseCsvText(text))
  })

  it('대가: 따옴표 안의 CRLF는 LF가 된다', () => {
    expect(openCsvText('a,b\r\n1,"x\r\ny"\r\n')()).toEqual([
      ['a', 'b'],
      ['1', 'x\ny'],
    ])
  })

  it('maxRows는 맞춘 뒤에도 남긴 행을 센다', () => {
    expect(openCsvText(MIXED)(2)).toEqual(EXPECTED.slice(0, 2))
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
