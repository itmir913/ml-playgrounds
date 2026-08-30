/**
 * 엑셀(.xlsx) 읽기. 파서를 직접 구현하지 않는다.
 *
 * **두 파서를 순서대로 시도한다.**
 *
 *   1. ExcelJS      기본. npm에 있고 유지보수된다
 *   2. SheetJS      폴백. 한셀 등 비표준 xlsx가 1에서 깨질 때만 쓴다
 *   3. 둘 다 실패   DATASET_PARSE_FAILED
 *
 * 폴백이 필요한 이유는 추측이 아니라 실물이다 - 한셀로 저장한 xlsx는 ExcelJS에서
 * `TypeError`로 죽는다(2026-08-21에 재현하고 `tests/fixtures/hancell.xlsx`로 고정했다).
 * 한셀이 `docProps/app.xml`에 네임스페이스 접두사를 붙여 쓰는데 ExcelJS는 접두사 없는
 * 태그만 안다. 교실에서 한컴오피스는 드물지 않고, 파일이 안 열리면 그 학생의 45분은
 * 거기서 끝난다.
 *
 * 파서는 PARSERS 배열에 등록만 하면 늘어난다. if/else 분기를 만들지 마라.
 *
 * 시트 하나를 고르기 위해 파일을 두 번 읽지 않는다. openXlsx()가 한 번 읽어
 * 핸들을 주고, 미리보기와 본 읽기가 같은 핸들을 쓴다.
 *
 * 날짜 셀은 이번 범위 밖이다(open-decisions.md #14). 두 경로 모두 ISO 문자열을 주고,
 * 남은 차이는 시간대 하나다 - ExcelJS는 직렬값을 UTC로 읽고 SheetJS는 로컬 시간대를
 * 적용한다. 폴백이 도는 드문 경우에만 갈린다(open-decisions.md #18).
 *
 * **maxRows는 두 경로 모두 남긴 행을 센다** (open-decisions.md "미리보기 N행은 훑은
 * 행이 아니라 남긴 행이다"). 2026-08-30까지 그렇지 않았다 - ExcelJS 쪽만 훑은 행을
 * 셌고, **그때 위 문장이 "남은 차이는 시간대 하나"라고 적혀 있어 그 두 번째 차이를
 * 덮고 있었다.** 실측 문장은 새 차이가 생기면 함께 늙는다.
 */

import { ClientError } from '../errors'
import { TABLE_PREVIEW_ROW_COUNT } from '../limits'
import { isEmptyRow, padGrid, type TableGrid } from './grid'

/** 열린 워크북. 파서가 무엇이었는지는 이 뒤로 드러나지 않는다. */
export interface XlsxDocument {
  sheetNames: string[]
  /** maxRows를 주면 그만큼만 읽는다. 미리보기가 큰 시트를 다 훑지 않게 한다. */
  readSheet(sheetName: string, maxRows?: number): TableGrid
}

type XlsxParser = (bytes: Uint8Array) => Promise<XlsxDocument>

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const cell = value as Record<string, unknown>
    if (Array.isArray(cell.richText)) {
      return (cell.richText as { text?: string }[]).map((part) => part.text ?? '').join('')
    }
    // 수식 셀은 캐시된 결과를 쓴다. 결과가 없으면(엑셀이 아닌 도구가 쓴 파일에서
    // 종종 그렇다) 우리가 수식을 계산해 줄 수는 없으므로 빈 값이다.
    if ('result' in cell) return cellToString(cell.result)
    if (typeof cell.text === 'string') return cell.text
    if (typeof cell.error === 'string') return cell.error
    return ''
  }
  return String(value)
}

/** 파서 1 - ExcelJS. */
const parseWithExcelJs: XlsxParser = async (bytes) => {
  const { Workbook } = await import('exceljs')
  const workbook = new Workbook()
  // 타입 선언은 Buffer만 받지만 내부의 JSZip이 Uint8Array를 그대로 읽는다.
  // Buffer로 직접 캐스팅하지 않는다 - @types/node가 Buffer를 제네릭으로 바꾸면서
  // exceljs가 선언한 Buffer와 우리가 쓴 Buffer가 다른 타입이 됐다. 받는 쪽의
  // 파라미터 타입을 그대로 집어오면 그 어긋남에 다시 걸리지 않는다.
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0])

  if (workbook.worksheets.length === 0) {
    // 예외 없이 빈 워크북이 나오는 것도 못 읽은 것이다. 폴백으로 넘긴다.
    throw new Error('no worksheets')
  }

  return {
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    readSheet(sheetName, maxRows) {
      const sheet = workbook.getWorksheet(sheetName)
      if (!sheet) throw new ClientError('DATASET_SHEET_NOT_FOUND', { sheetName })

      // columnCount는 시트 전체에서 가장 넓은 행의 폭이다. 이걸 폭으로 고정하면
      // 엑셀이 저장하지 않은 후행 빈 셀이 처음부터 자리를 갖는다.
      const width = sheet.columnCount

      const grid: TableGrid = []
      for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        // **maxRows는 남긴 행을 센다** (open-decisions.md "미리보기 N행은 훑은 행이
        // 아니라 남긴 행이다"). 예전에는 `min(maxRows, rowCount)`까지 훑고 **그다음에**
        // 빈 행을 버려서, 빈 행이 낀 시트에서 세 줄을 청하면 두 줄이 왔다. CSV와 폴백은
        // 처음부터 남긴 행을 셌으므로 셋 중 이쪽만 갈려 있었다.
        if (maxRows !== undefined && grid.length >= maxRows) break
        const row = sheet.getRow(rowNumber)
        const cells: string[] = []
        for (let column = 1; column <= width; column += 1) {
          cells.push(cellToString(row.getCell(column).value))
        }
        if (!isEmptyRow(cells)) grid.push(cells)
      }
      return padGrid(grid)
    },
  }
}

/** 파서 2 - SheetJS. 한셀 등 비표준 xlsx를 위한 폴백이다. */
const parseWithSheetJs: XlsxParser = async (bytes) => {
  const XLSX = await import('xlsx')
  // 날짜 셀을 Date로 받는다. 아래 raw와 짝이다 - raw만 켜면 날짜가 직렬 숫자로 온다.
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })

  if (workbook.SheetNames.length === 0) throw new Error('no worksheets')

  return {
    sheetNames: [...workbook.SheetNames],
    readSheet(sheetName, maxRows) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) throw new ClientError('DATASET_SHEET_NOT_FOUND', { sheetName })

      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        // 빈 셀도 자리를 지킨다. 없으면 컬럼 인덱스가 행마다 밀린다.
        defval: '',
        /**
         * **값을 받는다. 엑셀이 그려 준 글자가 아니다** (2026-08-21).
         *
         * `false`였고, 그러면 셀의 값이 아니라 **화면에 그려질 문자열**이 온다.
         * 실측하니 `123456789012`가 `"1.23457E+11"`이 됐다 - 엑셀의 General 서식이
         * 열두 자리부터 지수 표기로 넘어가기 때문이고, **예외 없이 여섯 자리로
         * 뭉개진다.** 원화로 적은 예산·거래액이 정확히 그 대역이다.
         * 불리언은 `"TRUE"`, 날짜는 `"8/21/26"`이었다.
         *
         * 이 도구가 열에서 원하는 것은 **값**이므로 서식 문자열을 잃는 것은 손해가
         * 아니다. 이제 ExcelJS 경로와 값이 같다 - 남은 차이는 날짜의 시간대
         * 하나이고 그건 open-decisions.md #18이 갖는다.
         */
        raw: true,
      })

      const grid: TableGrid = []
      for (const row of rows) {
        if (maxRows !== undefined && grid.length >= maxRows) break
        const cells = row.map(cellToString)
        if (!isEmptyRow(cells)) grid.push(cells)
      }
      return padGrid(grid)
    },
  }
}

/** 시도 순서. 새 파서는 여기 등록만 하면 된다. */
const PARSERS: XlsxParser[] = [parseWithExcelJs, parseWithSheetJs]

/**
 * xlsx는 zip이므로 반드시 로컬 파일 헤더로 시작한다.
 *
 * **이 검사가 없으면 폴백이 위험해진다.** SheetJS는 형식을 스스로 추정해서 아무
 * 바이트나 한 칸짜리 시트로 "성공"시킨다 - 손상된 xlsx가 실패 대신 엉뚱한 표가 되고,
 * 학생은 자기 데이터가 사라진 줄도 모른 채 그걸로 학습을 돌린다.
 */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * xlsx 바이트를 열어 핸들을 준다. 파일당 한 번만 부르면 된다.
 *
 * 등록된 파서를 순서대로 시도하고 전부 실패하면 DATASET_PARSE_FAILED이다.
 * 어느 파서가 왜 실패했는지는 학생에게 알리지 않는다 - 어느 쪽이든 학생이 할 수
 * 있는 일은 같다(다른 이름으로 저장해서 다시 올리기).
 */
export async function openXlsx(bytes: Uint8Array): Promise<XlsxDocument> {
  if (!looksLikeZip(bytes)) throw new ClientError('DATASET_PARSE_FAILED')

  for (const parse of PARSERS) {
    try {
      return await parse(bytes)
    } catch (error) {
      // 시트를 못 찾은 것은 파일 문제가 아니다. 다음 파서로 넘기지 않는다.
      if (error instanceof ClientError) throw error
    }
  }
  throw new ClientError('DATASET_PARSE_FAILED')
}

/** 모든 시트의 이름과 앞 몇 행. 고르기 전에 보여주는 것이다. */
export function previewSheets(
  document: XlsxDocument,
  maxRows: number = TABLE_PREVIEW_ROW_COUNT,
): { name: string; rows: TableGrid }[] {
  return document.sheetNames.map((name) => ({
    name,
    rows: document.readSheet(name, maxRows),
  }))
}
