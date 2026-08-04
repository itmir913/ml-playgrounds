import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { parseTable, previewTable, sourceFromFileName } from '../src/data/table'

describe('sourceFromFileName', () => {
  it('.csv와 .xlsx를 대소문자 무관하게 구분한다', () => {
    expect(sourceFromFileName('iris.csv')).toBe('csv')
    expect(sourceFromFileName('IRIS.CSV')).toBe('csv')
    expect(sourceFromFileName('iris.xlsx')).toBe('xlsx')
  })

  it('지원하지 않는 확장자는 DATASET_FILE_TYPE_UNSUPPORTED로 실패한다', () => {
    try {
      sourceFromFileName('iris.xls')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_FILE_TYPE_UNSUPPORTED')
    }
  })
})

describe('previewTable / parseTable - csv', () => {
  it('csv는 시트 개념 없이 바로 격자를 낸다', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2\n')

    const preview = await previewTable(bytes, 'data.csv', 10)
    expect(preview.source).toBe('csv')
    if (preview.source === 'csv')
      expect(preview.rows).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ])

    const parsed = await parseTable(bytes, 'data.csv')
    expect(parsed.source).toBe('csv')
    if (parsed.source === 'csv')
      expect(parsed.grid).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ])
  })
})

describe('previewTable / parseTable - xlsx', () => {
  it('시트 목록을 훑어본 뒤 고른 시트를 파싱한다', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('데이터').addRows([
      ['a', 'b'],
      [1, 2],
    ])
    workbook.addWorksheet('메모').addRows([['x']])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    const preview = await previewTable(bytes, 'data.xlsx', 10)
    expect(preview.source).toBe('xlsx')
    if (preview.source === 'xlsx') {
      expect(preview.sheets.map((sheet) => sheet.name)).toEqual(['데이터', '메모'])
    }

    const parsed = await parseTable(bytes, 'data.xlsx', '데이터')
    expect(parsed.source).toBe('xlsx')
    if (parsed.source === 'xlsx')
      expect(parsed.grid).toEqual([
        ['a', 'b'],
        ['1', '2'],
      ])
  })

  it('시트를 고르지 않고 파싱을 시도하면 실패한다', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Sheet1').addRows([['a']])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    try {
      await parseTable(bytes, 'data.xlsx')
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
    }
  })
})
