import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

import { PARSER_ORDER, openXlsx, previewSheets } from '../src/data/xlsx'
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

  /**
   * **셀 값이 문자열이 아니라 객체로 오는 갈래 넷.** ExcelJS는 수식·서식·날짜·오류 칸을
   * 객체로 준다(`cellToString`). 네 가지 중 어느 것도 저장소가 한 번도 안 지나가서,
   * 수식 가지를 죽여도 2,254개가 전부 초록이었다 (2026-08-30 R12 감사 A-4).
   * `formula`·`richText`라는 낱말이 `tests/` 전체에 0건이었다.
   *
   * **교실 엑셀에서 합계·평균 열은 기본값에 가깝다.** 수식 칸이 빈 문자열이 되면 그 열이
   * 통째로 비어 학습이 거부되거나(FEATURE_ALL_MISSING), 타깃이면 모든 행이 빠진다
   * (SPLIT_TOO_FEW_ROWS). **2026-08-21의 폴백 사고와 같은 병이다** — 갈래를 세어야 한다.
   */
  describe('객체로 오는 셀', () => {
    async function oneRow(value: unknown): Promise<string[][]> {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('S')
      sheet.addRow(['머리글'])
      sheet.addRow([value])
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
      return (await openXlsx(bytes)).readSheet('S')
    }

    it('수식 셀은 캐시된 결과를 읽는다', async () => {
      expect(await oneRow({ formula: 'A1+1', result: 3 })).toEqual([['머리글'], ['3']])
    })

    it('서식이 섞인 셀은 조각을 이어 붙인다', async () => {
      const rich = { richText: [{ text: '김' }, { text: '민수' }] }
      expect(await oneRow(rich)).toEqual([['머리글'], ['김민수']])
    })

    /**
     * **오류 칸은 빈 칸이다** (open-decisions.md 71). pandas는 NaN으로 읽는다. 전에는 오류
     * 글자를 그대로 줘서 **그 열이 통째로 범주형이 됐다** — 평균 열의 `#DIV/0!` 한 칸이 수치 열
     * 하나를 모델에서 다른 것으로 바꿨다. 옆 칸에 값을 두는 이유는 빈 줄이 버려지기 때문이다.
     */
    async function besideError(value: unknown): Promise<string[][]> {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('S')
      sheet.addRow(['a', 'b'])
      sheet.addRow([1, value])
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
      return (await openXlsx(bytes)).readSheet('S')
    }

    it('오류 셀은 빈 칸이 된다', async () => {
      expect(await besideError({ error: '#DIV/0!' })).toEqual([
        ['a', 'b'],
        ['1', ''],
      ])
    })

    it('수식의 캐시 결과가 오류여도 빈 칸이 된다', async () => {
      expect(await besideError({ formula: '1/0', result: { error: '#DIV/0!' } })).toEqual([
        ['a', 'b'],
        ['1', ''],
      ])
    })

    /**
     * **시간대까지는 안 못 박는다.** 두 파서가 시간대에서 갈리는 것이 이미 알려진 자리라
     * (`data/xlsx.ts` 머리말), 여기서 보는 것은 **날짜 가지가 돌았는가**다. 안 돌면
     * 빈 문자열이 되므로 ISO 모양 하나로 충분히 갈린다.
     */
    it('날짜 셀은 ISO 문자열이 된다', async () => {
      const grid = await oneRow(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)))
      expect(grid[1]?.[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  /**
   * **maxRows는 남긴 행을 센다** (`open-decisions.md` "미리보기 N행은 훑은 행이 아니라
   * 남긴 행이다").
   *
   * 2026-08-30까지 이 경로만 **훑은 행**을 셌다 — `min(maxRows, rowCount)`까지 읽고
   * **그다음에** 빈 행을 버려서, 빈 행이 하나 낀 시트에서 세 줄을 청하면 두 줄이 왔다.
   * CSV와 폴백은 처음부터 남긴 행을 셌으므로 셋 중 이쪽만 갈려 있었고, **그 사실을
   * 아무 검사도 안 봤다** (R12 감사 B-1).
   */
  it('maxRows는 훑은 행이 아니라 남긴 행을 센다', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('S')
    sheet.addRow(['a', 'b'])
    sheet.addRow(['1', '2'])
    sheet.addRow([]) // 가운데가 비었다
    sheet.addRow(['3', '4'])
    sheet.addRow(['5', '6'])
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())

    expect((await openXlsx(bytes)).readSheet('S', 3)).toEqual([
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

  /**
   * **먼 열에 값 하나만 있는 긴 시트도 곧 읽는다** (R43-2 감사 A-1). ExcelJS의 `row.getCell(n)`은 없는 칸에 Cell 객체를
   * 새로 만들어서, 칸마다 그것으로 읽으면 행 × 폭만큼 객체가 섰다 — 상한 안의 90KB 파일(10,000행 × 900열)이 힙 부족으로
   * 탭을 죽였다. 값과 자리는 그대로이면서 **없는 칸을 만들지 않는 것**을 본다.
   */
  it('먼 열에 값 하나만 있는 긴 시트도 곧 읽는다', async () => {
    const ROWS = 2_000
    const FAR = 900
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('S')
    for (let row = 1; row <= ROWS; row += 1) sheet.getCell(row, 1).value = `r${String(row)}`
    sheet.getCell(2, FAR).value = 'far'
    // 병합 칸도 첫 칸의 값을 준다 — `getCell`이 하던 것과 같다.
    sheet.getCell(3, 2).value = 'merged'
    sheet.mergeCells(3, 2, 3, 3)
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer())
    const document = await openXlsx(bytes)

    const rowPrototype = Object.getPrototypeOf(
      new ExcelJS.Workbook().addWorksheet('x').getRow(1),
    ) as {
      getCell: (...args: unknown[]) => unknown
    }
    const getCell = vi.spyOn(rowPrototype, 'getCell')
    try {
      const grid = document.readSheet('S')
      expect(grid).toHaveLength(ROWS)
      expect(grid.every((row) => row.length === FAR)).toBe(true)
      expect(grid[1]?.[FAR - 1]).toBe('far')
      expect(grid[2]?.slice(0, 4)).toEqual(['r3', 'merged', 'merged', ''])
      expect(getCell).not.toHaveBeenCalled()
    } finally {
      getCell.mockRestore()
    }
  })

  /**
   * **빈 행이 많고 먼 칸 하나뿐인 시트도 곧 읽는다** (0.34.2 diff 세 번째 감사 A-3의 이웃). 빈 행마다 폭만큼 칸을 세우고(`getRow` +
   * 폭까지 읽기) 나서 버리던 동안, A1..A5와 XFD2000 하나뿐인 시트의 미리보기가 1초였다 — 행이 늘수록 길어진다. 지금은 없는 행을
   * 건너뛰고 값이 있는 데까지만 읽는다. 한도는 고친 뒤 값의 수십 배이고 고치기 전 값보다 아래다.
   */
  it('빈 행이 많고 먼 칸 하나뿐인 시트도 곧 읽는다', async () => {
    const ROWS = 20_000
    const BUDGET_MS = 1_500
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('S')
    for (let row = 1; row <= 5; row += 1) sheet.getCell(row, 1).value = `r${String(row)}`
    // **빈 행에는 서식만 둔다** (0.34.2 diff 네 번째 감사 C-11) — 행은 있고 값은 없다. 행이 아예 없으면 없는 행 건너뛰기(`findRow`)만
    // 물고, "행마다 값이 있는 데까지만"은 안 문다.
    for (let row = 6; row < ROWS; row += 1)
      sheet.getCell(row, 1).border = { top: { style: 'thin' } }
    sheet.getCell(ROWS, 16_384).value = 'far'
    const document = await openXlsx(new Uint8Array(await workbook.xlsx.writeBuffer()))

    const started = performance.now()
    const preview = document.readSheet('S', 21)
    const elapsed = performance.now() - started

    expect(preview.map((row) => row.length)).toEqual(new Array(6).fill(16_384))
    expect(preview[5]?.[16_383]).toBe('far')
    expect(elapsed, `${String(Math.round(elapsed))} ms`).toBeLessThan(BUDGET_MS)
  }, 120_000)

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

  /**
   * **상한을 끄면 본진도 전부 읽는다** (2026-09-23, R37 C-4). 상한이 꺼진 자리에서
   * `importTable`이 넘기는 값이 `Infinity + 1`이라 `grid.length >= maxRows`가 언제나
   * 거짓이다. 위 판은 켠 쪽만 보므로 **둘을 나란히 둔다** — 폴백 쪽 짝은 아래 describe에.
   */
  it('상한을 끄면 본진이 전부 읽는다', async () => {
    const bytes = await buildWorkbook({ S: [['a'], ['b'], ['c'], ['d'], ['e']] })
    const document = await openXlsx(bytes)
    expect(document.readSheet('S', Infinity)).toHaveLength(5)
    expect(document.readSheet('S', 2)).toHaveLength(2)
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
    if (sheet === undefined) throw new Error(`${path} is not in the fixture`)
    const xml = new TextDecoder().decode(sheet)
    const patched = xml.replace('<x:c r="B2"><x:v>100</x:v></x:c>', BIG_CELL)
    // 못 바꿨는데 통과하면 이 검사는 아무것도 안 지킨다.
    if (patched === xml) throw new Error('B2 not found in the fixture')
    files[path] = new TextEncoder().encode(patched)
    return zipSync(files)
  }

  /**
   * **순서를 못 박는다.** `PARSERS`를 뒤집어도 저장소가 초록이었다 (2026-08-30, R12 감사 C-2).
   * 뒤집히면 **폴백이 본진이 되고 아무도 모른다** — 날짜 시간대가 통째로 갈리고
   * (open-decisions.md #18), 2026-08-21에 실측한 `raw`의 함정이 기본 경로로 올라온다.
   */
  it('본진이 먼저고 폴백이 나중이다', () => {
    expect(PARSER_ORDER).toEqual(['parseWithExcelJs', 'parseWithSheetJs'])
  })

  it('한셀이 만든 파일은 ExcelJS가 던진다 - 폴백이 발동하는 조건이다', async () => {
    // 폴백 조건은 "예외 또는 시트 0개"뿐이다. 예외 없이 이상한 값을 주면 발동하지
    // 않으므로, 이 파일이 정말 던지는지가 아래 검사들의 전제다 (#17의 첫 물음).
    const workbook = new ExcelJS.Workbook()
    await expect(workbook.xlsx.load(hancell as never)).rejects.toThrow()
  })

  /**
   * **폴백은 넓은 범위를 다 훑지 않는다** (0.34.2 diff 재감사 A-2). `sheet_to_json`은 범위(`!ref`) 안의 모든 행 × 범위의 폭을 훑어서,
   * A열에 행 번호 2,000줄과 XFD열 칸 하나뿐인 20KB 파일의 미리보기가 21초, 확정(열 상한 거절)이 26초였다. 고친 뒤는 미리보기가 행
   * 창만, 확정이 값이 든 칸만 본다. 한도는 고친 뒤 값의 수십 배이고 고치기 전 값보다 한참 아래다.
   */
  it('폴백은 넓은 범위를 다 훑지 않는다', async () => {
    const ROWS = 2_000
    const BUDGET_MS = 3_000
    const files = unzipSync(hancell)
    const path = 'xl/worksheets/sheet1.xml'
    const xml = new TextDecoder().decode(files[path])
    const body = Array.from({ length: ROWS }, (_, index) => {
      const r = index + 1
      const far = r === 2 ? '<x:c r="XFD2"><x:v>9</x:v></x:c>' : ''
      return `<x:row r="${String(r)}"><x:c r="A${String(r)}"><x:v>${String(r)}</x:v></x:c>${far}</x:row>`
    }).join('')
    const patched = xml
      .replace('<x:dimension ref="A1:C4"/>', `<x:dimension ref="A1:XFD${String(ROWS)}"/>`)
      .replace(/<x:sheetData>.*<\/x:sheetData>/s, `<x:sheetData>${body}</x:sheetData>`)
    expect(patched.includes(`XFD${String(ROWS)}`) && patched.includes('XFD2')).toBe(true)
    files[path] = new TextEncoder().encode(patched)
    const document = await openXlsx(zipSync(files))
    const name = document.sheetNames[0] ?? ''

    const started = performance.now()
    const preview = document.readSheet(name, 21)
    const rejected = document.readSheet(name, ROWS + 1, 1_000)
    const elapsed = performance.now() - started

    expect(preview).toHaveLength(21)
    expect(preview.every((row) => row.length === 16_384)).toBe(true)
    expect(rejected).toHaveLength(ROWS)
    expect(Math.max(...rejected.map((row) => row.length))).toBe(16_384)
    expect(elapsed, `${String(Math.round(elapsed))} ms`).toBeLessThan(BUDGET_MS)
  }, 120_000)

  /** 한셀 파일의 시트를 `<dimension>`과 칸 목록으로 바꾼다 — ExcelJS가 던지는 그대로라 폴백을 진짜로 태운다. */
  function hancellSheet(
    dimension: string,
    cells: readonly (readonly [string, number])[],
  ): Uint8Array {
    const files = unzipSync(hancell)
    const path = 'xl/worksheets/sheet1.xml'
    const xml = new TextDecoder().decode(files[path])
    const byRow = new Map<number, string[]>()
    for (const [address, value] of cells) {
      const row = Number(/\d+$/.exec(address)?.[0])
      byRow.set(row, [
        ...(byRow.get(row) ?? []),
        `<x:c r="${address}"><x:v>${String(value)}</x:v></x:c>`,
      ])
    }
    const body = [...byRow.entries()]
      .sort(([left], [right]) => left - right)
      .map(([row, xmlCells]) => `<x:row r="${String(row)}">${xmlCells.join('')}</x:row>`)
      .join('')
    const patched = xml
      .replace('<x:dimension ref="A1:C4"/>', `<x:dimension ref="${dimension}"/>`)
      .replace(/<x:sheetData>.*<\/x:sheetData>/s, `<x:sheetData>${body}</x:sheetData>`)
    if (!patched.includes(dimension)) throw new Error('the fixture did not take the dimension')
    files[path] = new TextEncoder().encode(patched)
    return zipSync(files)
  }

  /**
   * **값이 든 행이 적어도 범위 끝까지 훑지 않는다** (0.34.2 diff 세 번째 감사 A-3·C-8). 행 창을 넓혀 가던 고침은 값이 든 행이 미리보기 줄
   * 수보다 적으면 창이 범위 끝까지 넓어져, A1..A5와 XFD2000 하나뿐인 7KB 파일의 미리보기가 37초였다. 범위만 넓고 먼 칸이 없는 시트는
   * 열을 값이 든 폭까지로 자르는 것이 지킨다(그 줄을 범위 끝으로 바꾸면 23초). 한도는 고친 뒤 값의 수십 배다.
   */
  it('폴백은 값이 든 행이 적거나 범위만 넓어도 곧 읽는다', async () => {
    const BUDGET_MS = 3_000
    const few = Array.from(
      { length: 5 },
      (_, index) => [`A${String(index + 1)}`, index + 1] as const,
    )
    const sparse = await openXlsx(hancellSheet('A1:XFD2000', [...few, ['XFD2000', 9]]))
    const tall = await openXlsx(hancellSheet('A1:ALL20000', [...few, ['ALL20000', 9]]))
    const wideRange = await openXlsx(
      hancellSheet(
        'A1:XFD2000',
        Array.from({ length: 2_000 }, (_, index) => [`A${String(index + 1)}`, index + 1] as const),
      ),
    )
    const name = sparse.sheetNames[0] ?? ''

    const started = performance.now()
    const preview = sparse.readSheet(name, 21)
    const whole = tall.readSheet(name, 100_001, 1_000)
    const narrow = wideRange.readSheet(name, 100_001, 1_000)
    const elapsed = performance.now() - started

    expect(preview.map((row) => row.length)).toEqual(new Array(6).fill(16_384))
    expect(whole.map((row) => row.length)).toEqual(new Array(6).fill(1_000))
    expect(narrow).toHaveLength(2_000)
    expect(narrow.every((row) => row.length === 1)).toBe(true)
    // **행 차례가 시트의 차례다** (0.34.2 diff 네 번째 감사 C-13) — 값이 든 행 번호를 비교자 없이 정렬하면 글자 순서라 10번 행이 2번 앞에 온다.
    expect(narrow.map((row) => row[0])).toEqual(
      Array.from({ length: 2_000 }, (_, index) => String(index + 1)),
    )
    expect(elapsed, `${String(Math.round(elapsed))} ms`).toBeLessThan(BUDGET_MS)
  }, 180_000)

  /**
   * **폴백은 시트를 한 번만 훑는다** (0.34.2 diff 다섯 번째 감사 C-19, `scanOf`). 칸 주소를 푸는 횟수를 센다 — 미리보기와 확정 읽기를 다
   * 해도 칸 수만큼이다. 캐시를 끄면(읽기마다 다시 훑으면) 몇 배가 된다. 시간보다 흔들리지 않는다.
   */
  it('폴백은 미리보기와 확정 읽기를 해도 시트를 한 번만 훑는다', async () => {
    const cells = Array.from({ length: 30 }, (_, index) => [
      [`A${String(index + 1)}`, index] as const,
      [`B${String(index + 1)}`, index * 2] as const,
    ]).flat()
    const document = await openXlsx(hancellSheet('A1:B30', cells))
    const name = document.sheetNames[0] ?? ''
    const decodeCell = vi.spyOn(XLSX.utils, 'decode_cell')
    try {
      expect(document.readSheet(name, 5)).toHaveLength(5)
      expect(document.readSheet(name)).toHaveLength(30)
      expect(decodeCell).toHaveBeenCalledTimes(60)
    } finally {
      decodeCell.mockRestore()
    }
  })

  /** **폴백도 폭이 상한과 같으면 채운다** (0.34.2 diff 재감사 C-5) — ALL열이 1,000번째다. 경계를 `>=`로 바꾸면 짧은 행이 짧은 채로 온다. */
  it('폴백도 폭이 상한과 같으면 채운다', async () => {
    const files = unzipSync(hancell)
    const path = 'xl/worksheets/sheet1.xml'
    const xml = new TextDecoder().decode(files[path])
    const patched = xml
      .replace('<x:dimension ref="A1:C4"/>', '<x:dimension ref="A1:ALL4"/>')
      .replace(
        '<x:c r="C2" t="s"><x:v>1</x:v></x:c>',
        '<x:c r="C2" t="s"><x:v>1</x:v></x:c><x:c r="ALL2"><x:v>9</x:v></x:c>',
      )
    expect(patched.includes('ALL2') && patched.includes('A1:ALL4')).toBe(true)
    files[path] = new TextEncoder().encode(patched)
    const document = await openXlsx(zipSync(files))
    const name = document.sheetNames[0] ?? ''
    expect(document.readSheet(name, undefined, 1_000).map((row) => row.length)).toEqual([
      1_000, 1_000, 1_000, 1_000,
    ])
  })

  /**
   * **폴백이 거절하며 말하는 열 수는 값이 든 칸 기준이다** (0.34.2 diff 재감사 C-7). 값 너머의 공백 칸까지 세면 본진(ExcelJS)과 다른
   * 열 수를 말한다 — ALM열(1,001번째)에 값, AMB열(1,016번째)에 공백 하나를 두면 1,016을 말했다.
   */
  it('폴백이 거절하며 세는 열은 값이 든 칸까지다', async () => {
    const files = unzipSync(hancell)
    const path = 'xl/worksheets/sheet1.xml'
    const xml = new TextDecoder().decode(files[path])
    // 값 너머에 공백 칸(AMB2)과 오류 칸(AMA2), 오류 칸만 든 행(5행), 범위(`<dimension>`) 밖의 값(AMF2)을 둔다 — 셋 다 값이 든 칸이
    // 아니다(0.34.2 diff 세 번째 감사 C-10, `valueRows`의 거르기 셋).
    const patched = xml
      .replace('<x:dimension ref="A1:C4"/>', '<x:dimension ref="A1:AMB5"/>')
      .replace(
        '<x:c r="C2" t="s"><x:v>1</x:v></x:c>',
        '<x:c r="C2" t="s"><x:v>1</x:v></x:c><x:c r="ALM2"><x:v>9</x:v></x:c><x:c r="AMA2" t="e"><x:v>#N/A</x:v></x:c><x:c r="AMB2" t="str"><x:v> </x:v></x:c><x:c r="AMF2"><x:v>7</x:v></x:c>',
      )
      .replace(
        '</x:sheetData>',
        '<x:row r="5"><x:c r="B5" t="e"><x:v>#N/A</x:v></x:c></x:row></x:sheetData>',
      )
    expect(
      patched.includes('AMF2') && patched.includes('A1:AMB5') && patched.includes('r="B5"'),
    ).toBe(true)
    files[path] = new TextEncoder().encode(patched)
    const document = await openXlsx(zipSync(files))
    const name = document.sheetNames[0] ?? ''
    const rows = document.readSheet(name, undefined, 1_000)
    expect(rows.map((row) => row.length)).toEqual([3, 1_001, 3, 3])
  })

  /**
   * **폴백도 열 상한을 넘는 폭이면 채우지 않는다** (0.34.2 diff 감사 A-1의 이웃). SheetJS는 `defval: ''`이 범위 전체를 행마다
   * 채운다 — 본진과 같은 병이다. 한셀 파일에 XFD열(16,384번째) 칸 하나와 그만큼의 범위를 더해, ExcelJS가 던지는 그대로 폴백을
   * 진짜로 태운다. 상한을 주면 그 한 행만 넓고, 안 주면(상한을 끈 것과 같다) 전부 채운다.
   */
  it('폴백도 열 상한을 넘는 폭이면 채우지 않는다', async () => {
    const files = unzipSync(hancell)
    const path = 'xl/worksheets/sheet1.xml'
    const xml = new TextDecoder().decode(files[path])
    const patched = xml
      .replace('<x:dimension ref="A1:C4"/>', '<x:dimension ref="A1:XFD4"/>')
      .replace(
        '<x:c r="C2" t="s"><x:v>1</x:v></x:c>',
        '<x:c r="C2" t="s"><x:v>1</x:v></x:c><x:c r="XFD2"><x:v>9</x:v></x:c>',
      )
    // 못 바꿨는데 통과하면 이 검사는 아무것도 안 지킨다.
    expect(patched.includes('XFD2') && patched.includes('A1:XFD4')).toBe(true)
    files[path] = new TextEncoder().encode(patched)
    const document = await openXlsx(zipSync(files))
    const name = document.sheetNames[0] ?? ''

    expect(document.readSheet(name, undefined, 1_000).map((row) => row.length)).toEqual([
      3, 16_384, 3, 3,
    ])
    expect(document.readSheet(name).map((row) => row.length)).toEqual([
      16_384, 16_384, 16_384, 16_384,
    ])
  })

  /**
   * **상한을 끄면 두 파서가 전부 읽는다** (2026-09-23, R37 C-4 / 2026-09-01 C-4).
   *
   * `importTable`이 `maxDatasetRows() + 1`을 넘기고, 상한이 꺼지면 그 값이 `Infinity`다.
   * 읽는 자리가 셋인데(`csv.ts` 하나, `xlsx.ts`의 **두 파서**) **켠 상태로 지나가는 검사는
   * csv 하나뿐이었고** xlsx 두 갈래는 2026-09-01부터 소스로만 확인돼 있었다. 이 저장소가
   * 「폴백 검사가 폴백을 안 지나갔다」로 앓은 자리가 바로 이 파일이다.
   *
   * **10만 행을 굽지 않는다.** 재려는 것은 *"`>= maxRows` 비교가 `Infinity`를 통과시키는가"*
   * 이고, 그것은 다섯 행으로도 똑같이 드러난다 — 관문에 100초를 더하지 않는다.
   */
  it('상한을 끄면 SheetJS 폴백도 전부 읽는다', async () => {
    const document = await openXlsx(hancell)
    // 본진과 같은 문을 쓴다 — 상한이 꺼진 자리에서 `importTable`이 넘기는 값 그대로다.
    expect(document.readSheet('Sheet1', Infinity)).toHaveLength(4)
    // 켜져 있으면 그만큼에서 멈춘다. 둘을 나란히 두어 비교가 살아 있는 것을 못 박는다.
    expect(document.readSheet('Sheet1', 2)).toHaveLength(2)
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

  /**
   * **폴백도 maxRows를 지킨다** (2026-08-30, R12 감사 C-1). 폴백을 지나가는 검사는
   * 넷뿐이었고 **전부 `maxRows` 없이 정상 시트 하나를 읽었다** — 그래서 폴백이
   * `maxRows`를 통째로 무시해도, 빈 행을 남겨도, 시트 없음을 `ClientError` 아닌 것으로
   * 던져도 초록이었다.
   *
   * **못 보는 것 둘:** 폴백의 `padGrid`와 빈 행 버리기. 한셀 실물에는 짧은 행도 빈 행도
   * 없고, 그것을 넣으려면 픽스처의 XML을 더 깊이 손봐야 한다 — 안 했다.
   */
  it('폴백도 maxRows만큼만 준다', async () => {
    const document = await openXlsx(hancell)
    expect(document.readSheet('Sheet1', 2)).toEqual([
      ['id', 'money', 'good'],
      ['1', '100', 'Bad'],
    ])
  })

  it('폴백에서 없는 시트를 고르면 코드로 말한다', async () => {
    const document = await openXlsx(hancell)
    try {
      document.readSheet('없는시트')
      expect.unreachable()
    } catch (error) {
      // 정체 불명의 예외가 올라가면 학생은 DATASET_SHEET_NOT_FOUND 대신 그것을 본다.
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) expect(error.code).toBe('DATASET_SHEET_NOT_FOUND')
    }
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
    // **둘째 시트는 제 폭으로 읽는다** (0.34.2 diff 네 번째 감사 C-14) — 시트마다 세는 폭의 열쇠를 하나로 뭉개면 첫 시트의 폭(2)으로 읽혔다.
    expect(sheets[1]?.rows).toEqual([['x']])
  })
})
