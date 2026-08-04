import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { parseXlsxSheet, previewXlsx } from '../src/data/xlsx'

async function buildWorkbook(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = workbook.addWorksheet(name)
    sheet.addRows(rows)
  }
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer)
}

describe('previewXlsx', () => {
  it('모든 시트의 이름과 앞 몇 행을 함께 낸다', async () => {
    const bytes = await buildWorkbook({
      데이터: [
        ['이름', '나이'],
        ['가나다', 10],
        ['라마바', 11],
      ],
      Sheet1: [['x']],
    })

    const { sheets } = await previewXlsx(bytes, 2)

    expect(sheets.map((sheet) => sheet.name)).toEqual(['데이터', 'Sheet1'])
    expect(sheets[0]?.rows).toEqual([
      ['이름', '나이'],
      ['가나다', '10'],
    ])
  })

  it('maxRows를 넘는 행은 담지 않는다', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => [`row${index}`, index])
    const bytes = await buildWorkbook({ Sheet1: [['a', 'b'], ...rows] })

    const { sheets } = await previewXlsx(bytes, 5)

    expect(sheets[0]?.rows).toHaveLength(5)
  })
})

describe('parseXlsxSheet', () => {
  it('고른 시트를 전부 파싱한다', async () => {
    const bytes = await buildWorkbook({
      Sheet1: [
        ['a', 'b'],
        [1, 2],
        [3, 4],
      ],
    })

    const grid = await parseXlsxSheet(bytes, 'Sheet1')

    expect(grid).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ])
  })

  it('빈 셀은 건너뛰지 않고 자리를 채운다', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Sheet1')
    sheet.getCell('A1').value = 'a'
    sheet.getCell('C1').value = 'c'
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    const grid = await parseXlsxSheet(bytes, 'Sheet1')

    expect(grid).toEqual([['a', '', 'c']])
  })

  it('없는 시트를 고르면 DATASET_SHEET_NOT_FOUND로 실패한다', async () => {
    const bytes = await buildWorkbook({ Sheet1: [['a']] })

    try {
      await parseXlsxSheet(bytes, '없는시트')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_SHEET_NOT_FOUND')
    }
  })
})

describe('실패', () => {
  it('zip이 아닌 바이트는 DATASET_FILE_UNREADABLE로 실패한다', async () => {
    const bytes = new TextEncoder().encode('this is not an xlsx file')

    try {
      await parseXlsxSheet(bytes, 'Sheet1')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_FILE_UNREADABLE')
    }
  })
})
