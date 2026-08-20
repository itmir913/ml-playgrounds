import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { openXlsx, previewSheets } from '../src/data/xlsx'
import { isClientError } from '../src/errors'

/** 픽스처의 B2를 갈아 끼울 값. 엑셀의 General 서식이 지수 표기로 넘어가는 열두 자리다. */
const BIG_CELL = '<x:c r="B2"><x:v>123456789012</x:v></x:c>'

async function buildWorkbook(sheets: Record<string, (string | number)[][]>): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.addWorksheet(name).addRows(rows)
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/**
 * **기본 타임아웃(5초)으로는 모자란다.** 이 파일의 검사는 전부 진짜 xlsx를 만들어
 * 진짜 파서로 읽는다 — 붙박이 CPU 작업이라 스레드가 붐비면 그대로 늘어난다.
 *
 * 실측(2026-08-12): 순수 node로 잰 작업 자체는 쓰기 5ms + 읽기 3ms이고, 이 파일만
 * 혼자 돌리면 검사 열하나를 다 합쳐 207ms다. 그런데 전체 검사와 함께 돌면 한 줄이
 * 700ms대로 오르고, 전체를 **두 벌 동시에** 돌리면 800ms에 닿는다. 과거에 6.4초까지
 * 간 기록이 있다. **느려지는 줄이 매번 다르다** — 두 벌을 겹쳐 돌린 실측에서 한 번은
 * 첫 줄이, 한 번은 둘째 줄이 가장 느렸다. 그래서 첫 검사만 손보면 다음엔 다른 줄이
 * 운다.
 *
 * `router.spec.ts`와 같은 처방이고 같은 값이다 — 시간을 늘려 두고 진짜 멈춤은
 * 20초가 잡게 한다.
 */
describe('openXlsx', { timeout: 20_000 }, () => {
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

// 타임아웃을 늘린 이유는 위 describe에 있다.
describe('폴백', { timeout: 20_000 }, () => {
  /**
   * **한셀이 저장한 진짜 xlsx다** (2026-08-21, open-decisions.md #17이 기다리던 파일).
   * `docProps/app.xml`이 `<ep:Application>Cell</ep:Application>`이라 출처가 분명하다.
   *
   * **이 파일이 있기 전까지 이 자리의 검사는 폴백을 한 번도 안 지나갔다.** SheetJS로
   * 쓴 xlsx를 넣었는데 **ExcelJS가 그걸 잘 읽어서** 첫 파서에서 끝났다. 검사 이름은
   * 폴백을 말하는데 실제로 도는 것은 본진이었고, 그래서 폴백의 `raw` 결함이 살아남았다.
   */
  const hancell = new Uint8Array(readFileSync(join(process.cwd(), 'tests/fixtures/hancell.xlsx')))

  /**
   * 그 파일의 `money` 첫 칸만 열두 자리로 바꾼 것. **나머지는 한셀이 쓴 그대로라
   * ExcelJS는 여전히 같은 자리에서 던진다** — 폴백을 진짜로 태우면서 큰 수를 넣는
   * 유일한 방법이다. 모킹은 안 쓴다: 첫 파서를 가짜로 세우면 그 파서가 실제로
   * 실패하는지까지 같이 가짜가 된다.
   */
  function withBigNumber(bytes: Uint8Array): Uint8Array {
    const files = unzipSync(bytes)
    const path = 'xl/worksheets/sheet1.xml'
    const sheet = files[path]
    if (sheet === undefined) throw new Error(`${path}가 픽스처에 없다`)
    const xml = new TextDecoder().decode(sheet)
    const patched = xml.replace('<x:c r="B2"><x:v>100</x:v></x:c>', BIG_CELL)
    // 못 바꿨는데 통과하면 이 검사는 아무것도 안 지킨다.
    if (patched === xml) throw new Error('픽스처의 B2를 못 찾았다')
    files[path] = new TextEncoder().encode(patched)
    return zipSync(files)
  }

  it('한셀이 만든 파일은 ExcelJS가 던진다 - 폴백이 발동하는 조건이다', async () => {
    // 폴백 조건은 "예외 또는 시트 0개"뿐이다. 예외 없이 이상한 값을 주면 발동하지
    // 않으므로, 이 파일이 정말 던지는지가 아래 검사들의 전제다 (#17의 첫 물음).
    const workbook = new ExcelJS.Workbook()
    await expect(workbook.xlsx.load(hancell as never)).rejects.toThrow()
  })

  it('그 파일을 SheetJS가 읽어낸다', async () => {
    const document = await openXlsx(hancell)

    expect(document.sheetNames).toEqual(['Sheet1'])
    expect(document.readSheet('Sheet1')).toEqual([
      ['id', 'money', 'good'],
      ['1', '100', 'Bad'],
      ['2', '200', 'Bad'],
      ['3', '300', 'Good'],
    ])
  })

  /**
   * **폴백이 값을 주는가, 엑셀이 그려 준 글자를 주는가** (2026-08-21).
   *
   * `raw: false`였을 때 `123456789012`가 `"1.23457E+11"`이 됐다 — 엑셀의 General
   * 서식이 열두 자리부터 지수 표기로 넘어가기 때문이고 **예외가 안 난다.**
   *
   * **입구는 `openXlsx` 그대로다.** 한셀 실물에는 큰 수가 없어서 그 칸 하나만
   * 열두 자리로 갈아 끼운다 — 파일의 나머지는 한셀이 쓴 그대로다.
   */
  it('큰 수가 표시 문자열로 뭉개지지 않는다', async () => {
    const document = await openXlsx(withBigNumber(hancell))

    expect(document.readSheet('Sheet1')[1]).toEqual(['1', '123456789012', 'Bad'])
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

// 타임아웃을 늘린 이유는 맨 위 describe에 있다.
describe('previewSheets', { timeout: 20_000 }, () => {
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
