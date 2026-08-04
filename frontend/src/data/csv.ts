/**
 * CSV 파싱. papaparse에 맡긴다 - 인코딩 판정만 우리 몫이다.
 */

import Papa from 'papaparse'

import { ClientError } from '../errors'
import { PREVIEW_ROW_COUNT } from '../limits'
import { decodeDataset, detectEncoding, type DatasetEncoding } from './encoding'
import type { TableGrid } from './table'

export interface CsvResult {
  encoding: DatasetEncoding
  grid: TableGrid
}

function parseText(text: string, maxRows?: number): TableGrid {
  const rows: TableGrid = []
  let hasFatalError = false

  Papa.parse<string[]>(text, {
    // 구분자를 고정한다 - 자동 추정에 맡기면 짧은 미리보기에서 오검출되고,
    // "추정 실패, 콤마로 대체" 경고가 매 행 달려 나온다.
    delimiter: ',',
    // 진짜 빈 줄만 건너뛴다. 끝에 붙는 개행이 유령 행을 만들지 않게 한다.
    // "1,,3" 처럼 구분자가 있는 빈 칸은 여전히 자리를 지킨다.
    skipEmptyLines: true,
    step: (result, parser) => {
      // 따옴표가 닫히지 않는 등 복구 불가능한 경우만 실패로 본다.
      if (result.errors.some((error) => error.type === 'Quotes')) {
        hasFatalError = true
        parser.abort()
        return
      }
      rows.push(result.data)
      if (maxRows !== undefined && rows.length >= maxRows) parser.abort()
    },
  })

  if (hasFatalError) throw new ClientError('DATASET_FILE_UNREADABLE')
  return rows
}

/** ① 훑어보기. 인코딩 판정 후 앞 PREVIEW_ROW_COUNT행만 파싱한다. */
export function previewCsv(bytes: Uint8Array, maxRows: number = PREVIEW_ROW_COUNT): CsvResult {
  const encoding = detectEncoding(bytes)
  const text = decodeDataset(bytes, encoding)
  return { encoding, grid: parseText(text, maxRows) }
}

/** ② 본 파싱. 전체를 읽는다. */
export function parseCsv(bytes: Uint8Array): CsvResult {
  const encoding = detectEncoding(bytes)
  const text = decodeDataset(bytes, encoding)
  return { encoding, grid: parseText(text) }
}
