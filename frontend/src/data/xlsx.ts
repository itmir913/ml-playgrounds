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
 * **두 경로가 같은 파일에서 다른 표를 내던 자리가 넷이었다** (2026-09-28 감사 E B1에서 쟀다).
 * 폴백이 도는 드문 경우에만 갈리지만, 갈리면 같은 파일이 파서에 따라 다른 데이터가 된다.
 * 셋은 코드 소유자가 정해 맞췄고(open-decisions.md 71), **남은 갈림은 날짜 하나다.**
 *
 *   | 칸 | ExcelJS (본진) | SheetJS (폴백) |
 *   |---|---|---|
 *   | 날짜 | 직렬값을 UTC로 | 로컬 시간대로 (open-decisions.md #18) |
 *   | 오류 칸 `#DIV/0!` | 빈 칸 (pandas의 NaN) | 같다 |
 *   | 병합 셀 | 병합 범위 전체에 첫 칸의 값 | 같다 (`fillMerges`) |
 *   | 모든 행에서 빈 끝 열 (서식만 있는 열) | 없다 (`fitWidth`) | 같다 |
 *   | 모르는 칸 타입 (`t="z"`·`t="x"` 등, 비표준) | 수 (`parseFloat`, 수가 아니면 NaN) | 같다 (`valueCells`) — 날짜 서식이 붙은 칸만 폴백은 직렬 수 그대로 |
 *
 * **날짜 말고 나머지는 정본에 적히는 값이다** — 그래도 formatVersion은 안 움직인다. 정본은 CSV이고
 * 저장된 프로젝트는 xlsx를 다시 읽지 않으므로, 바뀌는 것은 이제 올리는 파일뿐이다.
 * 날짜 말고 나머지는 무는 검사가 있다: xlsx-parsers-diverge.spec.ts "두 파서가 같게 읽는 자리".
 * 갈림이 다시 생기면 그 검사와 이 표를 함께 고친다.
 *
 * **maxRows는 두 경로 모두 남긴 행을 센다** (open-decisions.md "미리보기 N행은 훑은
 * 행이 아니라 남긴 행이다"). 2026-08-30까지 그렇지 않았다 - ExcelJS 쪽만 훑은 행을
 * 셌고, **그때 위 문장이 "남은 차이는 시간대 하나"라고 적혀 있어 그 두 번째 차이를
 * 덮고 있었다.** 실측 문장은 새 차이가 생기면 함께 늙는다.
 */

// 타입만 가져온다 — SheetJS 본체는 아래 폴백이 쓸 때 지연 로딩한다.
import type * as SheetJs from 'xlsx'
import type { CellObject, WorkSheet } from 'xlsx'

import { ClientError, failureDetail, isChunkLoadError } from '../errors'
import { TABLE_PREVIEW_ROW_COUNT } from '../limits'
import { isEmptyRow, type TableGrid } from './grid'

/** 열린 워크북. 파서가 무엇이었는지는 이 뒤로 드러나지 않는다. */
export interface XlsxDocument {
  sheetNames: string[]
  /**
   * maxRows를 주면 그만큼만 읽는다. 미리보기가 큰 시트를 다 훑지 않게 한다.
   *
   * **값이 든 가장 오른쪽 열이 `maxColumns`를 넘으면 빈칸을 채우지 않는다** (0.34.2 diff 감사 A-1) — 행마다 값이 있는 데까지만
   * 담는다. 그 표는 곧 열 상한으로 거절되는데(`table.ts`의 `checkLimits`는 가장 넓은 행을 센다), 채우면 행 × 폭만큼 문자열이
   * 서서 170KB 파일 한 장이 거절되기 전에 탭을 죽였다. CSV의 `padGrid`와 같은 규칙이다. 무는 검사: `table.spec.ts`의
   * *"열 상한을 넘는 엑셀도 채우기 전에 거절한다"*.
   */
  readSheet(sheetName: string, maxRows?: number, maxColumns?: number): TableGrid
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
    // **오류 칸은 빈 칸이다** (open-decisions.md 71). pandas는 NaN으로 읽는다. 오류 글자를
    // 넣으면 그 열이 통째로 범주형이 된다 — 평균 열의 `#DIV/0!` 한 칸이 수치 열 하나를
    // 모델에서 다른 것으로 바꿨다. 무는 검사: xlsx.spec.ts "오류 셀은 빈 칸이 된다".
    return ''
  }
  return String(value)
}

/**
 * **모든 행에서 빈 끝 열을 자른다** (open-decisions.md 71). 두 파서가 함께 쓴다.
 *
 * 서식(테두리·배경)만 칠한 열은 파일에 칸으로 남아 ExcelJS의 `columnCount`에 든다. pandas는
 * 그런 열을 안 만든다. **머리글만 있는 열은 빈 열이 아니다** — 값이 없어도 열이고, pandas도
 * 그 열을 NaN으로 남긴다. 빈 칸의 잣대는 빈 행과 같다(`isEmptyRow`, 공백만 있어도 빈 칸).
 * 가운데의 빈 열은 자리를 지킨다 — 자르는 것은 끝뿐이다.
 *
 * **폭은 시트 전체로 센다 — 읽은 행으로 세지 않는다.** 미리보기는 앞 몇 행만 읽으므로, 그 행으로
 * 폭을 정하면 뒤쪽 행에만 값이 있는 끝 열이 미리보기에는 없고 확정 표에는 생긴다. 셈은 값이
 * 든 칸만 훑어서 시트를 적재하는 비용에 비하면 작다(5만 행 × 10열에서 적재 5.3초, 훑기 51ms —
 * 2026-09-29 node, 사람 확인). 파서마다 시트 하나에 한 번만 센다(본진 `contentWidths`, 폴백 `scanOf`).
 * 무는 검사: xlsx-parsers-diverge.spec.ts "미리보기와 확정 표의 폭이 같다".
 *
 * **짧은 행은 폭까지 채운다** — 본진(ExcelJS)은 행마다 값이 있는 데까지만 담으므로(0.34.2 diff 세 번째 감사) 이 채우기가 주된
 * 길이다. 폴백은 값이 든 폭까지만 읽고(`sheet_to_json`의 범위 끝이 그 폭이다) `defval`로 빈 칸을 채우므로 행이 폭 그대로 온다 —
 * `sheet_to_json`이 건너뛰는 칸(값이 든 `t: 'z'`)은 `valueCells`가 먼저 수 칸으로 고친다(0.34.2 diff 여섯·일곱 번째 감사 C-20·C-23). 그래서 폴백의 호출은
 * SheetJS가 바뀔 때를 위한 방어다. 직접 무는 검사는 xlsx-parsers-diverge.spec.ts
 * "fitWidth"이고, 실제 입구로는 xlsx.spec.ts의 "후행 빈 셀이 있어도 모든 행의 길이가 같다" 등이 운다.
 */
export function fitWidth(grid: TableGrid, width: number): TableGrid {
  for (const row of grid) {
    if (row.length > width) row.length = width
    while (row.length < width) row.push('')
  }
  return grid
}

/** 값이 있는 칸인가 — `fitWidth`의 잣대. 오류 칸은 빈 칸으로 읽으므로 여기서도 빈 칸이다. */
function holdsValue(value: unknown): boolean {
  return cellToString(value).trim() !== ''
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

  /** 시트마다 값이 든 가장 오른쪽 열 (`fitWidth`). 미리보기와 본 읽기가 같은 값을 쓴다. */
  const contentWidths = new Map<string, number>()

  return {
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    readSheet(sheetName, maxRows, maxColumns = Infinity) {
      const sheet = workbook.getWorksheet(sheetName)
      if (!sheet) throw new ClientError('DATASET_SHEET_NOT_FOUND', { sheetName })

      // 시트 전체에서 값이 든 가장 오른쪽 열이 폭이다. 이걸 폭으로 고정하면 엑셀이 저장하지
      // 않은 후행 빈 셀이 처음부터 자리를 갖고, 서식만 있는 끝 열은 자리가 없다.
      let width = contentWidths.get(sheetName)
      if (width === undefined) {
        let widest = 0
        sheet.eachRow((row) => {
          row.eachCell((cell, column) => {
            if (column > widest && holdsValue(cell.value)) widest = column
          })
        })
        width = widest
        contentWidths.set(sheetName, width)
      }

      // 상한을 넘는 폭이면 채우지 않는다(위 `XlsxDocument.readSheet`의 설명).
      const overflowing = width > maxColumns
      const grid: TableGrid = []
      for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
        // **maxRows는 남긴 행을 센다** (open-decisions.md "미리보기 N행은 훑은 행이
        // 아니라 남긴 행이다"). 예전에는 `min(maxRows, rowCount)`까지 훑고 **그다음에**
        // 빈 행을 버려서, 빈 행이 낀 시트에서 세 줄을 청하면 두 줄이 왔다. CSV와 폴백은
        // 처음부터 남긴 행을 셌으므로 셋 중 이쪽만 갈려 있었다.
        if (maxRows !== undefined && grid.length >= maxRows) break
        // **`getCell`을 부르지 않는다** (R43-2 감사 A-1). ExcelJS의 `row.getCell(n)`은 없는 칸에 Cell 객체를 새로
        // 만들어서, 한 행의 먼 열에 값 하나만 있어도 행 × 폭만큼 객체가 섰다 — 상한 안의 90KB 파일 한 장이 탭을
        // 메모리 부족으로 죽였다. `row.values`는 있는 칸만 담은 희소 배열이고 칸마다 `cell.value`를 쓰므로 병합된
        // 칸도 첫 칸의 값을 준다(`node_modules/exceljs/lib/doc/row.js`의 `get values`). 무는 검사:
        // `xlsx.spec.ts`의 *"먼 열에 값 하나만 있는 긴 시트도 곧 읽는다"*.
        //
        // **없는 행은 만들지 않고, 행마다 값이 있는 데까지만 읽는다** (0.34.2 diff 세 번째 감사 A-3의 이웃). `getRow`는 없는 행을
        // 새로 만들고, 폭까지 읽으면 빈 행마다 폭만큼 칸이 선다 — 먼 열에 값 하나와 빈 행 수천 개인 시트가 그만큼 느렸다. 채우기는
        // 아래 `fitWidth`가 남긴 행에만 한다.
        const row = sheet.findRow(rowNumber)
        if (row === undefined) continue
        const values = row.values as readonly unknown[]
        const last = Math.min(width, values.length - 1)
        const cells: string[] = []
        for (let column = 1; column <= last; column += 1) {
          cells.push(cellToString(values[column]))
        }
        if (!isEmptyRow(cells)) grid.push(cells)
      }
      return overflowing ? grid : fitWidth(grid, width)
    },
  }
}

/**
 * **병합 범위 전체에 첫 칸의 값을 채운다** (open-decisions.md 71). 본진(ExcelJS)은 병합된
 * 칸마다 첫 칸의 값을 주는데 SheetJS는 첫 칸에만 값을 두고 나머지를 빈 칸으로 준다.
 * 세로로 병합한 학년·반 열이 폴백에서만 한 줄 걸러 비었다.
 *
 * **시트를 제자리에서 고친다.** 한 번 채운 뒤에는 다시 채워도 같은 값이라 미리보기와 본
 * 읽기가 같은 시트를 두 번 지나도 된다. 채운 칸이 시트 범위(`!ref`) 밖이면 범위를 넓힌다 —
 * `sheet_to_json`은 범위 안만 읽는다. 무는 검사: xlsx-parsers-diverge.spec.ts "병합 셀"
 * (범위 넓히기는 그중 "시트 범위 밖으로 나간 병합도 둘이 같다").
 */
function fillMerges(XLSX: typeof SheetJs, sheet: WorkSheet): void {
  const merges = sheet['!merges']
  if (!merges || merges.length === 0) return
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
  for (const merge of merges) {
    const master = sheet[XLSX.utils.encode_cell(merge.s)] as CellObject | undefined
    if (master === undefined) continue
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (row === merge.s.r && column === merge.s.c) continue
        sheet[XLSX.utils.encode_cell({ r: row, c: column })] = { ...master }
      }
    }
    range.s.r = Math.min(range.s.r, merge.s.r)
    range.s.c = Math.min(range.s.c, merge.s.c)
    range.e.r = Math.max(range.e.r, merge.e.r)
    range.e.c = Math.max(range.e.c, merge.e.c)
  }
  sheet['!ref'] = XLSX.utils.encode_range(range)
}

/** `sheet_to_json`이 아는 칸 타입. `z`(빈 칸)는 값이 있으면 건너뛰고, 나머지 모르는 타입에서는 던진다. */
const SHEET_TO_JSON_TYPES: ReadonlySet<string> = new Set(['b', 'n', 'e', 's', 'd'])

/**
 * **모르는 칸 타입을 본진처럼 수 칸으로 고친다** (0.34.2 diff 여섯·일곱 번째 감사 C-20·C-22·C-23). `t="z"`·`t="x"`처럼 OOXML의 칸 타입이
 * 아닌 것이 비표준 파일에 나오면 SheetJS는 그 타입을 그대로 둔다(값은 적힌 글자). 그러면 `sheet_to_json`은 `z` 칸을 `defval`도 없이
 * 건너뛰고(본진은 값을 읽는데 폴백만 구멍이었다) 모르는 타입에서는 `unrecognized type`으로 던졌다. 본진(ExcelJS)은 모르는 타입을
 * `parseFloat`로 읽으므로(수가 아니면 NaN) 여기서도 그렇게 한다 — 값이 없는 칸은 수 칸이어도 빈 칸이다. **칸을 제자리에서 고친다** —
 * 다시 고쳐도 같다. 무는 검사: xlsx-parsers-diverge.spec.ts "모르는 칸 타입".
 */
function fixUnknownType(cell: CellObject): void {
  if (SHEET_TO_JSON_TYPES.has(cell.t)) return
  const value: unknown = cell.v
  cell.t = 'n'
  if (value !== undefined && value !== null) cell.v = Number.parseFloat(String(value))
}

/** 파서 2 - SheetJS. 한셀 등 비표준 xlsx를 위한 폴백이다. */
const parseWithSheetJs: XlsxParser = async (bytes) => {
  const XLSX = await import('xlsx')
  // 날짜 셀을 Date로 받는다. 아래 raw와 짝이다 - raw만 켜면 날짜가 직렬 숫자로 온다.
  const workbook = XLSX.read(bytes, { type: 'array', cellDates: true })

  if (workbook.SheetNames.length === 0) throw new Error('no worksheets')

  /** 시트마다 값이 든 폭과 행. `scanOf`가 한 번 훑어 채운다. */
  const sheetScans = new Map<string, { width: number; rows: readonly number[] }>()

  return {
    sheetNames: [...workbook.SheetNames],
    readSheet(sheetName, maxRows, maxColumns = Infinity) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) throw new ClientError('DATASET_SHEET_NOT_FOUND', { sheetName })

      fillMerges(XLSX, sheet)
      const width = widthOf(sheetName, sheet)
      if (width === 0) return []
      // 상한을 넘는 폭이면 채우지 않는다(`XlsxDocument.readSheet`의 설명).
      if (width > maxColumns) return valueRows(sheet, maxRows)

      /**
       * **값이 든 행만 훑는다** (0.34.2 diff 재감사 A-2, 세 번째 감사 A-3). `sheet_to_json`은 범위(`!ref`) 안의 모든 행 × 범위의 폭을
       * 훑는다 — 한셀이 쓴 범위가 넓으면(먼 열에 값 하나) 20KB 파일의 미리보기가 21초, 130KB의 확정이 3분 넘게 화면을 멈췄다. 행 창을
       * 넓혀 가는 것으로는 모자랐다 — 값이 든 행이 미리보기 줄 수보다 적으면 창이 범위 끝까지 넓어졌다. 그래서 열은 **값이 든 폭까지만**
       * (그 너머는 빈 칸뿐이라 읽지 않는다), 행은 **값이 든 행의 이어진 묶음마다** 읽고 남은 줄 수에서 자른다. 빈 행은 어차피
       * 버린다. 비용은 칸 수 + 남긴 행 × 폭이다. 무는 검사: `xlsx.spec.ts`의 *"폴백은 넓은 범위를 다 훑지 않는다"* 묶음.
       */
      const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
      const lastColumn = range.s.c + width - 1
      const filled = filledRows(sheetName, sheet)
      const grid: TableGrid = []
      let at = 0
      while (at < filled.length) {
        if (maxRows !== undefined && grid.length >= maxRows) break
        const room = maxRows === undefined ? Infinity : maxRows - grid.length
        let end = at
        while (
          end + 1 < filled.length &&
          (filled[end + 1] as number) === (filled[end] as number) + 1 &&
          end + 1 - at < room
        ) {
          end += 1
        }
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          range: {
            s: { r: filled[at] as number, c: range.s.c },
            e: { r: filled[end] as number, c: lastColumn },
          },
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
           * 아니다. 이것으로 수·불리언은 ExcelJS 경로와 같아졌다. **같지 않은 자리는 날짜
           * 시간대 하나가 남았다** — 목록은 이 파일 머리말의 표다.
           */
          raw: true,
        })
        for (const row of rows) {
          if (maxRows !== undefined && grid.length >= maxRows) break
          const cells = row.map(cellToString)
          if (!isEmptyRow(cells)) grid.push(cells)
        }
        at = end + 1
      }
      return fitWidth(grid, width)
    },
  }

  /**
   * 시트 전체에서 값이 든 가장 오른쪽 열 (`fitWidth`). `sheet_to_json`의 열은 범위(`!ref`)의 첫
   * 열부터 세므로 그 자리에서 뺀다(무는 검사: xlsx-parsers-diverge.spec.ts "범위가 A가 아닌 열에서
   * 시작하는 시트"). 오류 칸(`t: 'e'`)은 값이 오류 번호라 따로 뺀다 — 빈 칸으로 읽는다(같은 파일
   * "머리글 없이 오류 칸만 있는 끝 열").
   *
   * **범위 밖의 칸은 세지 않는다.** `<dimension>`이 실제 칸보다 좁은 파일에서 SheetJS는 범위 밖
   * 칸을 시트 객체에 두되 `sheet_to_json`으로는 주지 않는다 — 그 칸을 세면 머리글 없는 빈 열이
   * 생긴다(전에는 없던 열이다). 무는 검사: 같은 파일 "시트 범위가 실제 칸보다 좁으면".
   */
  function widthOf(sheetName: string, sheet: WorkSheet): number {
    return scanOf(sheetName, sheet).width
  }

  /**
   * 값이 든 칸이 하나라도 있는 행 번호(0부터, 오름차순). 칸의 잣대는 `widthOf`와 같다 — 같은 한 번의 훑기(`scanOf`)가 함께 센다.
   */
  function filledRows(sheetName: string, sheet: WorkSheet): readonly number[] {
    return scanOf(sheetName, sheet).rows
  }

  /**
   * **시트를 한 번만 훑어** 값이 든 폭과 값이 든 행을 함께 센다(0.34.2 diff 네 번째 감사 C-16 — 둘을 따로 훑던 동안 폴백 미리보기가
   * 같은 칸을 두 번 지났다). 시트 이름마다 한 번 — 미리보기와 본 읽기가 같은 시트를 여러 번 지난다. 무는 검사: `xlsx.spec.ts`의
   * *"폴백은 미리보기와 확정 읽기를 해도 시트를 한 번만 훑는다"*.
   */
  function scanOf(sheetName: string, sheet: WorkSheet): { width: number; rows: readonly number[] } {
    const seen = sheetScans.get(sheetName)
    if (seen !== undefined) return seen
    let width = 0
    const rows = new Set<number>()
    for (const { r, c } of valueCells(sheet)) {
      if (c + 1 > width) width = c + 1
      rows.add(r)
    }
    const scan = { width, rows: [...rows].sort((left, right) => left - right) }
    sheetScans.set(sheetName, scan)
    return scan
  }

  /**
   * **값이 든 칸 — 잣대는 여기 하나다**(`scanOf`·`valueRows`가 함께 쓴다, 0.34.2 diff 네 번째 감사 C-12의 이웃). 오류 칸(`t: 'e'`)과
   * 범위(`!ref`) 밖의 칸은 없는 칸이다(네 변 — 무는 검사는 xlsx-parsers-diverge.spec.ts "시트 범위가 실제 칸보다 좁으면", "실제 행보다
   * 짧으면", "2행이나 B열에서 시작하면"). `c`는 범위의 첫 열부터 센다(`sheet_to_json`과 같다), `r`은 시트의 행 번호 그대로다.
   *
   * **지나는 칸마다 모르는 타입을 고친다**(`fixUnknownType`, 0.34.2 diff 일곱 번째 감사 C-21 — 따로 훑으면 미리보기가 두 배였다).
   * `readSheet`는 `sheet_to_json`보다 이 훑기(`scanOf`)를 먼저 끝내므로 `sheet_to_json`은 고친 칸을 읽는다.
   */
  function* valueCells(sheet: WorkSheet): Generator<{ r: number; c: number; v: unknown }> {
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1')
    for (const [address, cell] of Object.entries(sheet)) {
      if (address.startsWith('!')) continue
      fixUnknownType(cell as CellObject)
      const { t, v } = cell as CellObject
      if (t === 'e' || !holdsValue(v)) continue
      const { r, c } = XLSX.utils.decode_cell(address)
      if (r < range.s.r || r > range.e.r || c < range.s.c || c > range.e.c) continue
      yield { r, c: c - range.s.c, v }
    }
  }

  /**
   * **값이 든 칸만으로 행을 세운다** — 열 상한을 넘는 시트를 거절하기 위한 격자다(0.34.2 diff 재감사 A-2·C-7). `sheet_to_json`을
   * 부르지 않으므로 칸 수에 비례하고, 행마다 값이 있는 데까지만 담아 채우지 않는다. 칸의 잣대는 `widthOf`와 같다(오류 칸과 범위 밖
   * 칸은 없는 칸) — 그래서 가장 넓은 행이 곧 `widthOf`이고 거절이 말하는 열 수가 본진(ExcelJS)과 같다. 빈 행은 없다(값이 든 칸이
   * 있는 행만 선다). 무는 검사: `xlsx.spec.ts`의 *"폴백도 열 상한을 넘는 폭이면 채우지 않는다"*.
   */
  function valueRows(sheet: WorkSheet, maxRows: number | undefined): TableGrid {
    const byRow = new Map<number, Map<number, string>>()
    for (const { r, c, v } of valueCells(sheet)) {
      const row = byRow.get(r) ?? new Map<number, string>()
      row.set(c, cellToString(v))
      byRow.set(r, row)
    }
    const grid: TableGrid = []
    for (const r of [...byRow.keys()].sort((left, right) => left - right)) {
      if (maxRows !== undefined && grid.length >= maxRows) break
      const values = byRow.get(r) as Map<number, string>
      // 펼치지 않고 센다(`spread-rules.spec.ts` — 칸이 많은 행을 인자로 펴면 스택이 넘친다).
      let last = 0
      for (const column of values.keys()) if (column > last) last = column
      const cells = new Array<string>(last + 1).fill('')
      for (const [column, text] of values) cells[column] = text
      grid.push(cells)
    }
    return grid
  }
}

/** 시도 순서. 새 파서는 여기 등록만 하면 된다. */
const PARSERS: XlsxParser[] = [parseWithExcelJs, parseWithSheetJs]

/**
 * 시도 순서의 이름. **검사가 이 순서를 못 박는다** — 뒤집으면 폴백이 본진이 되고
 * 아무도 모른다 (2026-08-30, R12 감사 C-2). 날짜 시간대가 통째로 갈리고
 * (open-decisions.md #18), 2026-08-21에 실측한 `raw`의 함정이 기본 경로로 올라온다.
 */
export const PARSER_ORDER: readonly string[] = PARSERS.map((parse) => parse.name)

/**
 * xlsx는 zip이므로 반드시 로컬 파일 헤더로 시작한다.
 *
 * **이 검사가 없으면 폴백이 위험해진다.** SheetJS는 형식을 스스로 추정해서 아무
 * 바이트나 한 칸짜리 시트로 "성공"시킨다 - 손상된 xlsx가 실패 대신 엉뚱한 표가 되고,
 * 학생은 자기 데이터가 사라진 줄도 모른 채 그걸로 학습을 돌린다.
 */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]

/**
 * **판정은 여기 하나다** — `data/table.ts`의 `openTable`도 이것으로 `.csv`라는 이름의 xlsx를
 * 알아본다. 두 벌이면 한쪽이 받는 파일을 다른 쪽이 거부한다.
 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * OLE2 복합 문서의 서명. **암호가 걸린 xlsx와 옛 .xls가 이 상자다** — 엑셀은 암호를 걸면
 * xlsx(zip)를 이 상자 안에 암호화해 담는다. 한글(.hwp)·워드(.doc)도 같은 상자라 **이 서명만으로
 * 엑셀이라고 하지 않는다** — 확장자와 함께 보는 것은 `data/table.ts`의 `openTable`이다
 * (open-decisions.md 71).
 */
const OLE2_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

export function looksLikeOle2(bytes: Uint8Array): boolean {
  return OLE2_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/**
 * xlsx 바이트를 열어 핸들을 준다. 파일당 한 번만 부르면 된다.
 *
 * 등록된 파서를 순서대로 시도하고 전부 실패하면 DATASET_PARSE_FAILED이다.
 * 어느 파서가 왜 실패했는지는 학생에게 알리지 않는다 - 어느 쪽이든 학생이 할 수
 * 있는 일은 같다(다른 이름으로 저장해서 다시 올리기).
 *
 * **파서 청크를 못 받은 것은 파일 탓이 아니다** (open-decisions.md 86). 파서는 `await import`로 받으므로
 * 배포 뒤 옛 탭이나 끊긴 연결에서는 파서가 파일을 보기도 전에 실패한다. 그때 *"파일 형식을 확인"*이라
 * 하면 학생이 멀쩡한 파일을 고친다. 어느 파서든 청크를 못 받으면 **그 자리에서 `SCREEN_LOAD_FAILED`로
 * 멈춘다 — 다음 파서로 넘기지 않는다**(코드 소유자). 본진 청크만 못 받았을 때 폴백이 대신 읽으면 날짜를
 * 다른 시간대로 읽어 조용히 틀린다(이 파일 머리말의 표). 본진을 받았는데 **파일을 못 읽어** 폴백으로 넘기는
 * 것은 그대로다. 무는 검사: `chunk-load-failure.spec.ts`의 *"엑셀 파서 청크"*.
 */
export async function openXlsx(bytes: Uint8Array): Promise<XlsxDocument> {
  if (!looksLikeZip(bytes)) throw new ClientError('DATASET_PARSE_FAILED')

  for (const parse of PARSERS) {
    try {
      return await parse(bytes)
    } catch (error) {
      // **우리가 이유를 붙인 오류는 다음 파서로 넘기지 않는다.** 오늘은 이 반복 안에서 `ClientError`가 나지 않는다 —
      // 시트를 못 찾는 `DATASET_SHEET_NOT_FOUND`는 나중에 `readSheet`가 던진다(R43-2 감사 C-7(a), 이 줄을 지워도 같은 동작이다).
      // 파서가 이유를 붙여 던지게 되는 날을 위한 방어이고 지키는 검사는 없다(사람 확인).
      if (error instanceof ClientError) throw error
      if (isChunkLoadError(error)) throw new ClientError('SCREEN_LOAD_FAILED', failureDetail(error))
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
