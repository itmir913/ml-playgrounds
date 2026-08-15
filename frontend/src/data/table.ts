/**
 * 표 파일(CSV / 엑셀) 가져오기의 진입점 (docs/open-decisions.md #14).
 *
 * **두 단계다.**
 *
 *   ① openTable()   파일을 한 번 열어 시트 목록과 미리보기를 얻는다
 *   ② importTable() 고른 시트를 정본 바이트로 확정한다
 *
 * 파일을 두 번 읽지 않는다. ①이 준 핸들을 ②에 그대로 넘긴다.
 *
 * **정본은 언제나 UTF-8 CSV다.** xlsx로 올렸든 CP949 CSV로 올렸든 ②를 지나면
 * 같은 모양이 된다(serialize.ts). 그래서 이 아래로는 아무도 형식과 인코딩을
 * 신경 쓰지 않는다 - IndexedDB도, .mlpx도, 서버도 UTF-8 CSV 하나만 안다.
 *
 * 화면이 형식별로 갈라지지 않게 하는 것이 이 모듈의 목적이다. 시트가 있느냐 없느냐는
 * sheetNames의 길이로만 드러난다.
 */

import { ClientError } from '../errors'
import { hashBytes } from '../hash'
import { MAX_DATASET_COLUMNS, MAX_DATASET_ROWS, PREVIEW_ROW_COUNT } from '../limits'
import { parseCsvText } from './csv'
import { decodeText, detectEncoding, type SourceEncoding } from './encoding'
import type { TableGrid } from './grid'
import { toCanonicalCsv } from './serialize'
import { openXlsx } from './xlsx'

export type { TableGrid } from './grid'

export type TableSource = 'csv' | 'xlsx'

/**
 * 표 파일이 받아들이는 확장자. `<input accept>`에 그대로 들어간다.
 *
 * **두 자리가 이 값을 쓴다** — 데이터 화면의 정본 받기(`data/kinds.ts`의 `accept`)와
 * 전처리 화면의 평가 데이터 받기다. 베껴 두면 한쪽만 늘어나고, 그러면 학생은 같은 앱에서
 * 어떤 파일은 되고 어떤 파일은 안 되는 자리를 만난다.
 */
export const TABULAR_ACCEPT = '.csv,.xlsx'

/** 열려 있는 표 파일. 아직 정본이 아니다 - 학생이 시트를 고르는 중일 수 있다. */
export interface TableDocument {
  source: TableSource
  /**
   * CSV는 빈 배열이다. 엑셀은 시트 이름들이고, 둘 이상이면 학생이 골라야 한다 -
   * 이름만으로는 어느 것이 데이터인지 알 수 없다(Sheet1, 데이터, 원본).
   */
  sheetNames: string[]
  /** 업로드된 파일의 인코딩. 엑셀은 null이다. 정본은 이것과 무관하게 UTF-8이다. */
  sourceEncoding: SourceEncoding | null
  /** sheetNames가 비어 있으면 sheetName은 무시된다. */
  read(sheetName?: string, maxRows?: number): TableGrid
}

/** 정본으로 확정된 데이터셋. */
export interface ImportedTable {
  /**
   * 정본 바이트. 항상 UTF-8 CSV다.
   *
   * 이 값이 IndexedDB에 들어가고, .mlpx의 dataset/이 되고, 무결성 해시의 대상이 되고,
   * 서버로 간다. **여기서부터는 누구도 손대지 않는다** (mlpx-spec.md 7).
   */
  bytes: Uint8Array
  /**
   * bytes의 해시. **데이터셋을 해싱하는 유일한 지점이다.**
   *
   * 정본은 여기서 확정된 뒤로 바뀌지 않으므로 다시 계산할 이유가 없다. 저장할 때마다
   * 계산하면 50MB 데이터셋에서 자동 저장이 265ms씩 화면을 붙든다 (mlpx-spec.md 7.2).
   */
  hash: string
  /** 정본을 파싱한 격자. 파생물이라 저장할 필요가 없다 - bytes에서 다시 만든다. */
  grid: TableGrid
  source: TableSource
  /** 업로드 파일이 무엇이었는지에 대한 기록. 정본 인코딩이 아니다. */
  sourceEncoding: SourceEncoding | null
  sheetName?: string
}

const CSV_EXTENSIONS = ['.csv']
const XLSX_EXTENSIONS = ['.xlsx']

export function sourceFromFileName(fileName: string): TableSource {
  const lower = fileName.toLowerCase()
  if (CSV_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'csv'
  if (XLSX_EXTENSIONS.some((extension) => lower.endsWith(extension))) return 'xlsx'
  throw new ClientError('DATASET_FILE_TYPE_UNSUPPORTED', { fileName })
}

/**
 * 파일을 열어 핸들을 만든다. 파일당 한 번만 부른다.
 *
 * CSV는 여기서 인코딩을 판정하고 한 번만 디코딩한다. 엑셀은 워크북을 한 번만 읽는다.
 */
export async function openTable(bytes: Uint8Array, fileName: string): Promise<TableDocument> {
  const source = sourceFromFileName(fileName)

  if (source === 'csv') {
    const sourceEncoding = detectEncoding(bytes)
    const text = decodeText(bytes, sourceEncoding)
    return {
      source,
      sheetNames: [],
      sourceEncoding,
      read: (_sheetName, maxRows) => parseCsvText(text, maxRows),
    }
  }

  const workbook = await openXlsx(bytes)
  return {
    source,
    sheetNames: workbook.sheetNames,
    sourceEncoding: null,
    read: (sheetName, maxRows) => {
      const name = sheetName ?? workbook.sheetNames[0]
      if (name === undefined) throw new ClientError('DATASET_PARSE_FAILED')
      return workbook.readSheet(name, maxRows)
    },
  }
}

/** 고르기 전에 보여줄 것. CSV는 항목 하나, 엑셀은 시트마다 하나다. */
export function previewTable(
  document: TableDocument,
  maxRows: number = PREVIEW_ROW_COUNT,
): { sheetName?: string; rows: TableGrid }[] {
  if (document.sheetNames.length === 0) {
    return [{ rows: document.read(undefined, maxRows) }]
  }
  return document.sheetNames.map((sheetName) => ({
    sheetName,
    rows: document.read(sheetName, maxRows),
  }))
}

function checkLimits(grid: TableGrid): void {
  if (grid.length > MAX_DATASET_ROWS) {
    throw new ClientError('DATASET_TOO_MANY_ROWS', {
      limitRows: MAX_DATASET_ROWS,
      actualRows: grid.length,
    })
  }
  const columns = grid[0]?.length ?? 0
  if (columns > MAX_DATASET_COLUMNS) {
    throw new ClientError('DATASET_TOO_MANY_COLUMNS', {
      limitColumns: MAX_DATASET_COLUMNS,
      actualColumns: columns,
    })
  }
  if (grid.length === 0 || columns === 0) {
    throw new ClientError('DATASET_EMPTY')
  }
}

/**
 * 고른 시트를 정본으로 확정한다. **정규화가 일어나는 유일한 지점이다.**
 *
 * 여기를 지나면 업로드 형식과 인코딩은 잊어도 된다.
 */
export function importTable(document: TableDocument, sheetName?: string): ImportedTable {
  const grid = document.read(sheetName)
  checkLimits(grid)

  const bytes = toCanonicalCsv(grid)
  const imported: ImportedTable = {
    bytes,
    hash: hashBytes(bytes),
    grid,
    source: document.source,
    sourceEncoding: document.sourceEncoding,
  }
  if (sheetName !== undefined) imported.sheetName = sheetName
  return imported
}
