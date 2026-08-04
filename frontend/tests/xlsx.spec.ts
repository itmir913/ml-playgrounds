import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { openXlsx, previewSheets } from '../src/data/xlsx'
import { isClientError } from '../src/errors'

async function buildWorkbook(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.addWorksheet(name).addRows(rows)
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

describe('openXlsx', () => {
  it('시트 이름을 순서대로 준다', async () => {
    const bytes = await buildWorkbook({ 데이터: [['a']], Sheet1: [['x']] })
    const document = await openXlsx(bytes)
    expect(document.sheetNames).toEqual(['데이터', 'Sheet1'])
  })

  it('고른 시트를 전부 읽는다', async () => {
    const bytes = await buildWorkbook({
      Sheet1: [
        ['a', 'b'],
        [1, 2],
        [3, 4],
      ],
    })
    const document = await openXlsx(bytes)
    expect(document.readSheet('Sheet1')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('후행 빈 셀이 있어도 모든 행의 길이가 같다', async () => {
    // 엑셀은 후행 빈 셀을 저장하지 않는다. 그대로 두면 세 번째 행이 2칸짜리가 되고
    // 전처리가 note 컬럼 자리에서 다른 값을 읽는다.
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('S')
    sheet.addRow(['name', 'age', 'note'])
    sheet.addRow(['kim', 10, 'hi'])
    sheet.addRow(['lee', 11])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    const grid = (await openXlsx(bytes)).readSheet('S')

    expect(grid.map((row) => row.length)).toEqual([3, 3, 3])
    expect(grid[2]).toEqual(['lee', '11', ''])
  })

  it('중간의 빈 셀은 자리를 지킨다', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('S')
    sheet.getCell('A1').value = 'a'
    sheet.getCell('C1').value = 'c'
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    expect((await openXlsx(bytes)).readSheet('S')).toEqual([['a', '', 'c']])
  })

  it('빈 행은 버린다 - CSV의 빈 줄과 같은 취급이다', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('S')
    sheet.addRow(['a', 'b'])
    sheet.addRow([])
    sheet.addRow([1, 2])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    expect((await openXlsx(bytes)).readSheet('S')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('maxRows를 주면 그만큼만 읽는다', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`row${index}`, index])
    const bytes = await buildWorkbook({ Sheet1: [['a', 'b'], ...rows] })

    expect((await openXlsx(bytes)).readSheet('Sheet1', 5)).toHaveLength(5)
  })

  it('없는 시트를 고르면 DATASET_SHEET_NOT_FOUND로 실패한다', async () => {
    const document = await openXlsx(await buildWorkbook({ Sheet1: [['a']] }))
    try {
      document.readSheet('없는시트')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_SHEET_NOT_FOUND')
    }
  })
})

describe('폴백', () => {
  it('ExcelJS가 못 읽는 파일을 SheetJS가 읽어낸다', async () => {
    // SheetJS로 쓴 xlsx. ExcelJS가 이걸 읽지 못하더라도 폴백이 살려내야 한다.
    // 한셀 등 비표준 생성기에서 실제로 겪은 실패의 대역이다.
    const sheet = XLSX.utils.aoa_to_sheet([
      ['이름', '나이'],
      ['가나다', 10],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, '데이터')
    const bytes = new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))

    const document = await openXlsx(bytes)

    expect(document.sheetNames).toEqual(['데이터'])
    expect(document.readSheet('데이터')).toEqual([
      ['이름', '나이'],
      ['가나다', '10'],
    ])
  })

  it('zip이 아닌 바이트는 파서에 넘기지도 않는다', async () => {
    // SheetJS는 형식을 추정해서 이런 바이트도 한 칸짜리 시트로 "성공"시킨다.
    // 그대로 두면 손상된 파일이 실패 대신 엉뚱한 표가 된다.
    await expect(openXlsx(new TextEncoder().encode('this is not an xlsx file'))).rejects.toThrow()

    try {
      await openXlsx(new TextEncoder().encode('this is not an xlsx file'))
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_PARSE_FAILED')
    }
  })

  it('zip이지만 xlsx가 아니면 두 파서가 모두 실패한다', async () => {
    // zip 서명만 갖춘 쓰레기. 서명 검사를 통과하므로 파서까지 내려간다.
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0)])
    try {
      await openXlsx(bytes)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_PARSE_FAILED')
    }
  })
})

describe('previewSheets', () => {
  it('모든 시트의 앞 몇 행을 함께 낸다', async () => {
    const bytes = await buildWorkbook({
      데이터: [
        ['이름', '나이'],
        ['가나다', 10],
        ['라마바', 11],
      ],
      Sheet1: [['x']],
    })

    const sheets = previewSheets(await openXlsx(bytes), 2)

    expect(sheets.map((sheet) => sheet.name)).toEqual(['데이터', 'Sheet1'])
    expect(sheets[0]?.rows).toEqual([
      ['이름', '나이'],
      ['가나다', '10'],
    ])
  })
})
