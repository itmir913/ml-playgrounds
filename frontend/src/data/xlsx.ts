/**
 * 엑셀(.xlsx) 파싱. exceljs에 맡긴다 - 셀 타입·공유 문자열·병합 셀을 우리가
 * 직접 다루지 않는다. 유일하게 우리가 하는 일은 셀 값을 문자열 격자로 펴는 것뿐이다.
 *
 * exceljs는 동적 import로 불러온다. CSV만 쓰는 학생은 이 번들을 내려받지 않는다.
 *
 * 날짜 셀은 이번 범위 밖이다 - 시리얼/서식 변환 없이 ISO 문자열로만 낸다
 * (docs/open-decisions.md #14, 구현 시 논의로 범위를 좁힘).
 */

import type { CellValue, Workbook, Worksheet } from 'exceljs'

import { ClientError } from '../errors'
import { PREVIEW_ROW_COUNT } from '../limits'
import type { SheetPreview, TableGrid } from './table'

async function loadWorkbook(bytes: Uint8Array): Promise<Workbook> {
  const { Workbook: WorkbookClass } = await import('exceljs')
  const workbook = new WorkbookClass()
  try {
    // exceljs의 타입 선언은 Buffer만 받지만, 내부적으로 JSZip을 거쳐 어떤
    // 바이트 배열이든(Uint8Array 포함) 읽는다. 런타임은 문제없고 타입만 맞춰준다.
    await workbook.xlsx.load(bytes as unknown as Buffer)
  } catch {
    // 손상된 파일, 혹은 일부 외부 프로그램(예: 한셀)이 만든 xlsx의 호환성 문제.
    // 원인을 구분하지 않는다 - 어느 쪽이든 학생이 할 수 있는 일은 같다(다시 저장해서 올리기).
    throw new ClientError('DATASET_FILE_UNREADABLE')
  }
  return workbook
}

function cellToString(value: CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('text' in value) return value.text
    if ('result' in value) return cellToString(value.result ?? null)
    if ('error' in value) return value.error
    return ''
  }
  return String(value)
}

function sheetToGrid(sheet: Worksheet, maxRows?: number): TableGrid {
  const grid: TableGrid = []
  sheet.eachRow({ includeEmpty: true }, (row) => {
    if (maxRows !== undefined && grid.length >= maxRows) return
    const cells: string[] = []
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToString(cell.value))
    })
    grid.push(cells)
  })
  return grid
}

/**
 * ① 훑어보기. 워크북을 한 번 읽어 **모든 시트**의 이름과 앞 몇 행을 함께 낸다.
 *
 * exceljs는 워크북을 부분적으로 읽는 API를 두지 않는다 - load()가 항상 전체를 읽는다.
 * 그래서 시트 하나만 미리 보려고 다시 읽을 이유가 없다. 업로드 크기 자체가 이미
 * 상한 안에 있으므로(limits.ts) 이 비용은 감당할 만하다.
 */
export async function previewXlsx(
  bytes: Uint8Array,
  maxRows: number = PREVIEW_ROW_COUNT,
): Promise<{ sheets: SheetPreview[] }> {
  const workbook = await loadWorkbook(bytes)
  return {
    sheets: workbook.worksheets.map((sheet) => ({
      name: sheet.name,
      rows: sheetToGrid(sheet, maxRows),
    })),
  }
}

/** ② 고른 시트를 전부 파싱한다. */
export async function parseXlsxSheet(bytes: Uint8Array, sheetName: string): Promise<TableGrid> {
  const workbook = await loadWorkbook(bytes)
  const sheet = workbook.getWorksheet(sheetName)
  if (!sheet) throw new ClientError('DATASET_SHEET_NOT_FOUND', { sheetName })
  return sheetToGrid(sheet)
}
