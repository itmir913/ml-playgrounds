import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'

import { parseCsvText } from '../src/data/csv'
import { decodeText, detectEncoding } from '../src/data/encoding'
import {
  importTable,
  openTable,
  PREVIEW_PROBE_ROWS,
  previewNote,
  previewTable,
  probeNote,
  sourceFromFileName,
} from '../src/data/table'
import { isClientError } from '../src/errors'
import { hashBytes } from '../src/hash'
import { MAX_DATASET_COLUMNS, MAX_DATASET_ROWS, PREVIEW_ROW_COUNT } from '../src/limits'

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

  /**
   * **행에 있는 경계가 열에는 없었다.** 넘는 쪽만 보고 있어서 비교를 `>=`로 바꿔도
   * 저장소 전체가 초록이었다 (R9 감사 B-7). 위 209줄이 행에 대해 스스로 필요하다고
   * 판단한 것과 같은 검사다 — 상한과 **같은** 표는 받아야 한다.
   */
  it('컬럼이 상한과 같으면 받는다 - 행과 같은 경계 규칙이다', async () => {
    const header = Array.from({ length: MAX_DATASET_COLUMNS }, (_, i) => `c${i}`).join(',')
    const document = await openTable(new TextEncoder().encode(header), 'data.csv')
    expect(importTable(document).grid[0]).toHaveLength(MAX_DATASET_COLUMNS)
  })
})

/**
 * **화면에서 뺀 판정이다** (V11 R3 감사 C-5). 화면 안 `computed`에 있으면 이 규칙을
 * 검사가 못 잡는데, 어기면 도구가 학생에게 거짓말을 한다.
 */
describe('앞부분만 보여준다는 안내', () => {
  it('안 잘랐으면 0이다 - 10줄짜리 파일에 "처음 20줄만"이 뜨면 안 된다', () => {
    expect(previewNote(10, 10)).toBe(0)
  })

  it('정확히 상한만큼이어도 안 잘린 것이다', () => {
    expect(previewNote(PREVIEW_ROW_COUNT, PREVIEW_ROW_COUNT)).toBe(0)
  })

  it('잘랐으면 그린 줄 수를 준다 - 전체 줄 수가 아니다', () => {
    expect(previewNote(PREVIEW_ROW_COUNT, 5000)).toBe(PREVIEW_ROW_COUNT)
  })
})

/**
 * **확정 전에는 재는 것이 다르다.** 전체 행 수라는 값이 없으므로(앞부분만 파싱했다)
 * 볼 수 있는 것은 **캡을 넘겨 읽혔는가**뿐이다 (architecture.md §8.9).
 *
 * 한때 화면이 `previewNote`에 **머리글을 뺀 줄 수와 머리글을 포함한 줄 수**를 견주고
 * 있었다. 둘은 머리글을 쓰면 언제나 하나 차이라 **모든 파일에서 안내가 떴다** —
 * 다섯 줄짜리 파일이 다섯 줄을 다 보여주면서 "처음 5행만 보여 줍니다"라고 적었다
 * (2026-08-29 전 경로 감사).
 */
describe('확정 전 안내', () => {
  it('한 줄 더 읽어 둔다 - 그래야 "딱 그만큼인 파일"과 갈린다', () => {
    expect(PREVIEW_PROBE_ROWS).toBe(PREVIEW_ROW_COUNT + 1)
  })

  it('캡만큼만 읽혔으면 0이다 - 파일이 거기서 끝났다', () => {
    expect(probeNote(PREVIEW_ROW_COUNT, PREVIEW_ROW_COUNT)).toBe(0)
  })

  it('캡보다 적게 읽혔으면 0이다 - 머리글 한 줄 차이로 뜨면 안 된다', () => {
    // 다섯 줄 + 머리글을 읽어 다섯 행을 그린 자리. 전부 보여주고 있다.
    expect(probeNote(5, 6)).toBe(0)
  })

  it('캡을 넘겨 읽혔으면 그린 줄 수를 준다 - 읽은 줄 수가 아니다', () => {
    expect(probeNote(PREVIEW_ROW_COUNT, PREVIEW_PROBE_ROWS)).toBe(PREVIEW_ROW_COUNT)
    // 머리글을 쓰면 그린 줄이 하나 적고, 문장에 들어갈 것은 그 수다.
    expect(probeNote(PREVIEW_ROW_COUNT - 1, PREVIEW_PROBE_ROWS)).toBe(PREVIEW_ROW_COUNT - 1)
  })
})
