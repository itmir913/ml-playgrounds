/**
 * CSV 파싱. papaparse에 맡긴다.
 *
 * 구분자는 추정하게 둔다. 한국 윈도우 엑셀은 콤마로 저장하지만 세미콜론으로
 * 저장하는 환경·도구가 실재하고, 그런 파일이 조용히 한 컬럼짜리 표가 되면
 * 학생은 이유를 알 수 없다. 추정 실패는 오류가 아니라 콤마로 되돌아가는 것뿐이다.
 */

import Papa from 'papaparse'

import { ClientError } from '../errors'
import { isEmptyRow, padGrid, type TableGrid } from './grid'

/**
 * 텍스트를 격자로 만든다.
 *
 * 빈 줄은 버린다 - 엑셀의 빈 행과 같은 취급이다(grid.ts).
 * 짧은 행은 가장 긴 행에 맞춰 채운다.
 */
export function parseCsvText(text: string, maxRows?: number): TableGrid {
  const grid: TableGrid = []
  let quotesBroken = false

  Papa.parse<string[]>(text, {
    skipEmptyLines: true,
    step: (result, parser) => {
      // 따옴표가 끝까지 닫히지 않은 파일은 무엇을 읽어도 틀린 표가 된다.
      // 나머지(구분자 추정 실패, 필드 수 불일치)는 관대하게 넘긴다.
      if (result.errors.some((error) => error.type === 'Quotes')) {
        quotesBroken = true
        parser.abort()
        return
      }
      if (!isEmptyRow(result.data)) grid.push(result.data)
      if (maxRows !== undefined && grid.length >= maxRows) parser.abort()
    },
  })

  if (quotesBroken) throw new ClientError('DATASET_PARSE_FAILED')
  return padGrid(grid)
}
