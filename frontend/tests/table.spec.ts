import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { parseCsvText } from '../src/data/csv'
import { decodeText, detectEncoding } from '../src/data/encoding'
import { importTable, openTable, previewTable, sourceFromFileName } from '../src/data/table'
import { isClientError } from '../src/errors'
import { hashBytes } from '../src/hash'
import { MAX_DATASET_COLUMNS, MAX_DATASET_ROWS } from '../src/limits'

/** '이름,나이\n가나다,10'을 CP949로 인코딩한 바이트. */
const CP949_CSV = new Uint8Array([
  192, 204, 184, 167, 44, 179, 170, 192, 204, 10, 176, 161, 179, 170, 180, 217, 44, 49, 48,
])

async function xlsxBytes(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.addWorksheet(name).addRows(rows)
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

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

describe('openTable - csv', () => {
  it('시트 개념이 없다', async () => {
    const document = await openTable(new TextEncoder().encode('a,b\n1,2\n'), 'data.csv')
    expect(document.source).toBe('csv')
    expect(document.sheetNames).toEqual([])
  })

  it('CP949 파일의 인코딩을 판정해서 들고 있는다', async () => {
    const document = await openTable(CP949_CSV, 'data.csv')
    expect(document.sourceEncoding).toBe('cp949')
    expect(document.read()).toEqual([
      ['이름', '나이'],
      ['가나다', '10'],
    ])
  })
})

// 여기도 진짜 xlsx를 만들어 진짜 파서로 읽으므로 부하에서 늘어난다.
// 왜 5초로 모자란지는 `xlsx.spec.ts` 맨 위에 실측과 함께 적어 두었다.
describe('openTable - xlsx', { timeout: 20_000 }, () => {
  it('시트 이름을 준다', async () => {
    const document = await openTable(await xlsxBytes({ 데이터: [['a']], 메모: [['x']] }), 'd.xlsx')
    expect(document.sheetNames).toEqual(['데이터', '메모'])
    expect(document.sourceEncoding).toBeNull()
  })

  it('시트를 고르지 않으면 첫 시트를 읽는다', async () => {
    const document = await openTable(await xlsxBytes({ 데이터: [['a', 'b']] }), 'd.xlsx')
    expect(document.read()).toEqual([['a', 'b']])
  })
})

// xlsx를 만들어 읽는 줄이 섞여 있다 — 이유는 위와 같다.
describe('previewTable', { timeout: 20_000 }, () => {
  it('csv는 항목 하나를 낸다', async () => {
    const document = await openTable(new TextEncoder().encode('a,b\n1,2\n'), 'data.csv')
    const preview = previewTable(document, 10)
    expect(preview).toHaveLength(1)
    expect(preview[0]?.sheetName).toBeUndefined()
    expect(preview[0]?.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('엑셀은 시트마다 하나씩 낸다', async () => {
    const document = await openTable(
      await xlsxBytes({
        데이터: [
          ['a', 'b'],
          [1, 2],
        ],
        메모: [['x']],
      }),
      'd.xlsx',
    )
    const preview = previewTable(document, 10)
    expect(preview.map((sheet) => sheet.sheetName)).toEqual(['데이터', '메모'])
    expect(preview[0]?.rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
})

// xlsx를 만들어 읽는 줄이 섞여 있다 — 이유는 위와 같다.
describe('importTable - 정규화', { timeout: 20_000 }, () => {
  it('CP949 CSV를 UTF-8 정본으로 바꾼다', async () => {
    const document = await openTable(CP949_CSV, 'data.csv')
    const imported = importTable(document)

    // 업로드 파일이 무엇이었는지는 기록으로 남고,
    expect(imported.sourceEncoding).toBe('cp949')
    // 정본 바이트는 UTF-8이다.
    expect(detectEncoding(imported.bytes)).toBe('utf-8')
    expect(parseCsvText(decodeText(imported.bytes, 'utf-8'))).toEqual(imported.grid)
  })

  it('엑셀도 같은 정본 모양이 된다 - 아래로는 CSV 하나만 안다', async () => {
    const document = await openTable(
      await xlsxBytes({
        데이터: [
          ['이름', '나이'],
          ['가나다', 10],
        ],
      }),
      'd.xlsx',
    )
    const imported = importTable(document, '데이터')

    expect(imported.source).toBe('xlsx')
    expect(imported.sheetName).toBe('데이터')
    expect(detectEncoding(imported.bytes)).toBe('utf-8')
    expect(parseCsvText(decodeText(imported.bytes, 'utf-8'))).toEqual([
      ['이름', '나이'],
      ['가나다', '10'],
    ])
  })

  it('정본 바이트를 다시 열면 같은 격자가 나온다', async () => {
    const document = await openTable(CP949_CSV, 'data.csv')
    const imported = importTable(document)

    const reopened = await openTable(imported.bytes, 'data.csv')
    expect(reopened.read()).toEqual(imported.grid)
  })

  it('정본을 확정하면서 해시도 함께 나온다 - 데이터셋을 해싱하는 유일한 지점이다', async () => {
    const document = await openTable(CP949_CSV, 'data.csv')
    const imported = importTable(document)

    expect(imported.hash).toBe(hashBytes(imported.bytes))
  })

  it('업로드 형식이 달라도 정본이 같으면 해시가 같다', async () => {
    const rows = [
      ['이름', '나이'],
      ['가나다', '10'],
    ]
    const fromCsv = importTable(
      await openTable(new TextEncoder().encode('이름,나이\n가나다,10\n'), 'd.csv'),
    )
    const fromXlsx = importTable(
      await openTable(await xlsxBytes({ 데이터: rows }), 'd.xlsx'),
      '데이터',
    )

    expect(fromXlsx.hash).toBe(fromCsv.hash)
  })
})

describe('importTable - 상한', () => {
  it('빈 표는 DATASET_EMPTY로 거부한다', async () => {
    const document = await openTable(new TextEncoder().encode(''), 'data.csv')
    try {
      importTable(document)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_EMPTY')
    }
  })

  /**
   * **행 상한에 검사가 하나도 없었다.** rule-coverage.md는 §1.5를 table.spec.ts가
   * 막는다고 적어 두었는데, 여기 있는 것은 열과 빈 표뿐이었다.
   */
  it('행이 상한을 넘으면 DATASET_TOO_MANY_ROWS로 거부한다', async () => {
    const rows = ['a', ...Array.from({ length: MAX_DATASET_ROWS }, (_, i) => String(i))]
    const document = await openTable(new TextEncoder().encode(rows.join('\n')), 'data.csv')
    try {
      importTable(document)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('DATASET_TOO_MANY_ROWS')
        expect(error.params.limitRows).toBe(MAX_DATASET_ROWS)
      }
    }
  })

  it('상한과 같으면 받는다 - 경계에서 한 줄 차이로 거부하면 안 된다', async () => {
    const rows = ['a', ...Array.from({ length: MAX_DATASET_ROWS - 1 }, (_, i) => String(i))]
    const document = await openTable(new TextEncoder().encode(rows.join('\n')), 'data.csv')
    expect(importTable(document).grid).toHaveLength(MAX_DATASET_ROWS)
  })

  it('컬럼이 상한을 넘으면 DATASET_TOO_MANY_COLUMNS로 거부한다', async () => {
    const header = Array.from({ length: MAX_DATASET_COLUMNS + 1 }, (_, i) => `c${i}`).join(',')
    const document = await openTable(new TextEncoder().encode(header), 'data.csv')
    try {
      importTable(document)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('DATASET_TOO_MANY_COLUMNS')
        expect(error.params.limitColumns).toBe(MAX_DATASET_COLUMNS)
      }
    }
  })
})
