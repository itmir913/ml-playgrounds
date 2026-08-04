/**
 * 표 파일(CSV / 엑셀) 파싱의 공통 타입과 진입점 (docs/open-decisions.md #14).
 *
 * 파싱은 라이브러리(papaparse / exceljs)에 맡긴다. 우리가 직접 구현하지 않는다 -
 * 셀 타입, 인코딩, 파일 호환성 엣지 케이스를 손으로 맞추는 비용이 이 프로젝트가
 * 감당할 시간보다 크다.
 *
 * CSV와 엑셀은 결과 타입이 같다. 화면이 형식별로 갈라지면 안 된다.
 * 헤더 추출은 여기서 하지 않는다 - hasHeader는 settings.dataset의 몫이고,
 * 파서는 있는 그대로의 격자만 돌려준다.
 */

import { ClientError } from '../errors'
import { PREVIEW_ROW_COUNT } from '../limits'
import { parseCsv, previewCsv } from './csv'
import type { DatasetEncoding } from './encoding'
import { parseXlsxSheet, previewXlsx } from './xlsx'

/** 셀 값은 전부 문자열이다. 자료형 판정은 다운스트림(전처리)의 일이다. */
export type TableGrid = string[][]

export type TableSource = 'csv' | 'xlsx'

export interface SheetPreview {
  name: string
  /** 앞 몇 행만 담는다. limits.ts의 PREVIEW_ROW_COUNT. */
  rows: TableGrid
}

/** ① 훑어보기 결과. 엑셀은 시트가 여럿일 수 있고, 고르기 전에 이걸로 미리 보여준다. */
export type TablePreview =
  | { source: 'csv'; encoding: DatasetEncoding; rows: TableGrid }
  | { source: 'xlsx'; sheets: SheetPreview[] }

/** ② 고른 뒤 본 파싱 결과. */
export type ParsedTable =
  | { source: 'csv'; encoding: DatasetEncoding; grid: TableGrid }
  | { source: 'xlsx'; sheetName: string; grid: TableGrid }

const CSV_EXTENSIONS = ['.csv']
const XLSX_EXTENSIONS = ['.xlsx']

export function sourceFromFileName(fileName: string): TableSource {
  const lower = fileName.toLowerCase()
  if (CSV_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'csv'
  if (XLSX_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'xlsx'
  throw new ClientError('DATASET_FILE_TYPE_UNSUPPORTED', { fileName })
}

/** ① 훑어보기. CSV는 시트가 없으니 그 결과를 시트 하나짜리 모양으로 감싸지 않는다. */
export async function previewTable(
  bytes: Uint8Array,
  fileName: string,
  maxRows: number = PREVIEW_ROW_COUNT,
): Promise<TablePreview> {
  const source = sourceFromFileName(fileName)
  if (source === 'csv') {
    const { encoding, grid } = previewCsv(bytes, maxRows)
    return { source, encoding, rows: grid }
  }
  const { sheets } = await previewXlsx(bytes, maxRows)
  return { source, sheets }
}

/**
 * ② 고른 뒤 본 파싱. 엑셀은 시트를 반드시 골라야 한다 - 시트가 여럿이면
 * 어느 것이 데이터인지 이름만으로 알 수 없다(mlpx-spec.md 0).
 */
export async function parseTable(
  bytes: Uint8Array,
  fileName: string,
  sheetName?: string,
): Promise<ParsedTable> {
  const source = sourceFromFileName(fileName)
  if (source === 'csv') {
    const { encoding, grid } = parseCsv(bytes)
    return { source, encoding, grid }
  }
  if (sheetName === undefined) {
    throw new ClientError('DATASET_SHEET_NOT_FOUND', { sheetName: '' })
  }
  const grid = await parseXlsxSheet(bytes, sheetName)
  return { source, sheetName, grid }
}
