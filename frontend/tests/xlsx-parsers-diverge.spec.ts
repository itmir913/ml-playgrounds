/**
 * **두 파서가 같게 읽는 자리** (`data/xlsx.ts` 머리말의 표, 2026-09-28 감사 E B1).
 *
 * 그 머리말은 한동안 *"남은 차이는 시간대 하나"*라고 적었다. 재 보니 셋이 더 있었다 — 오류
 * 칸·병합 셀·서식만 있는 끝의 빈 열. 이 파일은 그 갈림을 못 박고 있다가, 코드 소유자가 셋을
 * 정하자(open-decisions.md 71) **같게 읽는지**를 못 박는다 — 오류 칸은 빈 칸(pandas의 NaN),
 * 병합 셀은 범위 전체에 첫 칸의 값, 모든 행에서 빈 끝 열은 없다. 한쪽이 다시 갈라지면 이 검사가
 * 울고, 그때 머리말의 표도 함께 고친다 — 실측 문장이 코드와 함께 늙게 하는 것이 이 파일의 일이다.
 *
 * 날짜의 시간대는 여기 없다 — 기기의 시간대에 따라 답이 달라 이 판에서 못 박을 수 없다
 * (open-decisions.md #18).
 *
 * **xlsx는 XML을 직접 적어 만든다.** ExcelJS로 쓰면 오류 칸의 캐시 값이나 서식만 있는 칸을
 * 원하는 모양으로 못 남긴다. **폴백은 본진의 `load`를 던지게 해서 지난다** — 한셀 실물과 같은 길이다.
 */
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fitWidth, openXlsx } from '../src/data/xlsx'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** 인라인 문자열 칸. 공유 문자열 표를 만들지 않으려고 쓴다. */
const text = (ref: string, value: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
const number = (ref: string, value: number): string => `<c r="${ref}"><v>${value}</v></c>`

function workbook(rows: readonly string[], extra = '', dimension = ''): Uint8Array {
  const sheetData = rows.map((cells, index) => `<row r="${index + 1}">${cells}</row>`).join('')
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">` +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${NS}">` +
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/></cellXfs></styleSheet>',
    ),
    'xl/worksheets/sheet1.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}">${dimension}<sheetData>${sheetData}</sheetData>${extra}</worksheet>`,
    ),
  })
}

/** 평균 열에 `#DIV/0!`가 든 표 — 엑셀이 캐시한 오류 결과다. */
const ERROR_CELLS = workbook([
  text('A1', '키') + text('B1', 'BMI'),
  number('A2', 150) + '<c r="B2" t="e"><f>1/0</f><v>#DIV/0!</v></c>',
  number('A3', 160) + number('B3', 21.5),
])

/** 학년 열이 세로로 병합됐다. */
const MERGED = workbook(
  [text('A1', '학년') + text('B1', '이름'), number('A2', 1) + text('B2', '가'), text('B3', '나')],
  '<mergeCells count="1"><mergeCell ref="A2:A3"/></mergeCells>',
)

/** 표는 A·B열인데 테두리 서식이 D열까지 칠해졌다. */
const bordered = (row: number): string =>
  ['C', 'D'].map((col) => `<c r="${col}${row}" s="1"/>`).join('')
const STYLED = workbook([
  text('A1', 'x') + text('B1', 'y') + bordered(1),
  number('A2', 1) + number('B2', 2) + bordered(2),
])

/** 수식 없이 오류 값만 적힌 칸 — 다른 도구가 쓴 파일에서 이렇게 온다. */
const BARE_ERROR = workbook([
  text('A1', 'x') + text('B1', 'y'),
  number('A2', 1) + '<c r="B2" t="e"><v>#N/A</v></c>',
])

/** 둘째 줄의 A·B가 가로로 병합됐다. */
/**
 * 병합이 시트 범위(`<dimension>`) 밖으로 나간다 — 넷째 줄에는 칸이 하나도 없고 범위는 셋째
 * 줄까지다. SheetJS는 범위 안만 읽으므로, 채운 뒤 범위를 넓히지 않으면 그 줄이 사라진다.
 */
const MERGED_BEYOND_REF = workbook(
  [text('A1', '학년') + text('B1', '이름'), text('B2', '가'), number('A3', 2) + text('B3', '나')],
  '<mergeCells count="1"><mergeCell ref="A3:A4"/></mergeCells>',
  '<dimension ref="A1:B3"/>',
)

const MERGED_ACROSS = workbook(
  [text('A1', 'a') + text('B1', 'b') + text('C1', 'c'), text('A2', '합') + number('C2', 3)],
  '<mergeCells count="1"><mergeCell ref="A2:B2"/></mergeCells>',
)

/** 끝 열에 머리글만 있다 — 값이 없어도 열이다(pandas도 그 열을 NaN으로 남긴다). */
const HEADER_ONLY_TAIL = workbook([
  text('A1', 'x') + text('B1', 'y') + text('C1', 'z'),
  number('A2', 1) + number('B2', 2),
])

/**
 * 끝 열에 공백 한 칸만 적혔다. 빈 칸의 잣대는 빈 행과 같다(`isEmptyRow` — 공백만 있어도 빈 칸).
 * **SheetJS는 이 칸을 값으로 준다** — 서식만 있는 칸과 달리 폴백도 자르는 일을 해야 하는 자리다.
 */
const SPACE_TAIL = workbook([
  text('A1', 'x') +
    text('B1', 'y') +
    '<c r="C1" t="inlineStr"><is><t xml:space="preserve"> </t></is></c>',
  number('A2', 1) + number('B2', 2),
])

/**
 * 셋째 열은 머리글도 앞 줄도 비었고 **넷째 줄에만** 값이 있다. 미리보기가 앞 두 줄만 읽고 폭을
 * 정하면 그 열이 미리보기에서 사라지고 확정 표에만 생긴다.
 */
const LATE_TAIL = workbook([
  text('A1', 'x') + text('B1', 'y'),
  number('A2', 1) + number('B2', 2),
  number('A3', 3) + number('B3', 4),
  number('A4', 5) + number('B4', 6) + text('C4', '늦게'),
])

/**
 * `<dimension>`이 실제 칸보다 좁다(A열만). SheetJS는 B·C 칸을 시트에 두되 범위 밖이라 읽어 주지
 * 않는다. 본진은 칸을 그대로 읽는다 — **원래 있던 갈림이고 여기서는 고치지 않는다**(보고서의 소유자
 * 질문). 지키는 것은 폴백이 범위 밖 칸으로 머리글 없는 빈 열을 만들지 않는 것이다.
 */
const NARROW_DIMENSION = workbook(
  [
    text('A1', 'x') + text('B1', 'y') + text('C1', 'z'),
    number('A2', 1) + number('B2', 2) + number('C2', 3),
  ],
  '',
  '<dimension ref="A1:A2"/>',
)

/** 끝 열에 머리글 없이 오류 칸 하나뿐이다. 오류 칸은 빈 칸이므로 그 열은 빈 열이다. */
const ERROR_ONLY_TAIL = workbook([
  text('A1', 'x') + text('B1', 'y'),
  number('A2', 1) + number('B2', 2) + '<c r="C2" t="e"><v>#N/A</v></c>',
])

/** 표가 B열에서 시작한다. 본진은 A열부터, 폴백은 범위의 첫 열(B)부터 읽는다 — 원래 있던 갈림이다. */
const FROM_COLUMN_B = workbook(
  [text('B1', 'x') + text('C1', 'y'), number('B2', 1) + number('C2', 2)],
  '',
  '<dimension ref="B1:C2"/>',
)

async function readBoth(
  bytes: Uint8Array,
  maxRows?: number,
): Promise<{ excelJs: string[][]; sheetJs: string[][] }> {
  const excelJs = (await openXlsx(bytes)).readSheet('S', maxRows)

  vi.resetModules()
  vi.doMock('exceljs', () => ({
    Workbook: class {
      xlsx = {
        load: () => {
          throw new TypeError('force the fallback')
        },
      }
    },
  }))
  const fallback = await import('../src/data/xlsx')
  const sheetJs = (await fallback.openXlsx(bytes)).readSheet('S', maxRows)
  vi.doUnmock('exceljs')
  vi.resetModules()
  return { excelJs, sheetJs }
}

afterEach(() => {
  vi.doUnmock('exceljs')
  vi.resetModules()
})

describe('두 파서가 같게 읽는 자리', { timeout: 20_000 }, () => {
  it('오류 칸 — 둘 다 빈 칸이다 (pandas는 NaN)', async () => {
    const { excelJs, sheetJs } = await readBoth(ERROR_CELLS)
    expect(excelJs[1]).toEqual(['150', ''])
    expect(sheetJs[1]).toEqual(['150', ''])
  })

  it('오류 칸 — 수식 없이 적힌 오류 값도 빈 칸이다', async () => {
    const { excelJs, sheetJs } = await readBoth(BARE_ERROR)
    expect(excelJs[1]).toEqual(['1', ''])
    expect(sheetJs[1]).toEqual(['1', ''])
  })

  it('병합 셀 — 둘 다 범위 전체에 첫 칸의 값', async () => {
    const { excelJs, sheetJs } = await readBoth(MERGED)
    expect(excelJs.map((row) => row[0])).toEqual(['학년', '1', '1'])
    expect(sheetJs.map((row) => row[0])).toEqual(['학년', '1', '1'])
  })

  it('병합 셀 — 시트 범위 밖으로 나간 병합도 둘이 같다', async () => {
    const { excelJs, sheetJs } = await readBoth(MERGED_BEYOND_REF)
    expect(sheetJs).toEqual(excelJs)
    expect(sheetJs.map((row) => row[0])).toEqual(['학년', '', '2', '2'])
  })

  it('병합 셀 — 가로로 병합된 칸도 둘이 같다', async () => {
    const { excelJs, sheetJs } = await readBoth(MERGED_ACROSS)
    expect(excelJs).toEqual([
      ['a', 'b', 'c'],
      ['합', '합', '3'],
    ])
    expect(sheetJs).toEqual(excelJs)
  })

  it('서식만 있는 끝의 빈 열 — 둘 다 없다', async () => {
    const { excelJs, sheetJs } = await readBoth(STYLED)
    expect(excelJs[0]).toEqual(['x', 'y'])
    expect(sheetJs[0]).toEqual(['x', 'y'])
  })

  it('공백만 있는 끝 열도 둘 다 없다', async () => {
    const { excelJs, sheetJs } = await readBoth(SPACE_TAIL)
    expect(excelJs).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ])
    expect(sheetJs).toEqual(excelJs)
  })

  it('미리보기와 확정 표의 폭이 같다 — 폭은 읽은 행이 아니라 시트 전체로 센다', async () => {
    const preview = await readBoth(LATE_TAIL, 2)
    const full = await readBoth(LATE_TAIL)
    expect(full.excelJs[3]).toEqual(['5', '6', '늦게'])
    expect(preview.excelJs).toEqual([
      ['x', 'y', ''],
      ['1', '2', ''],
    ])
    expect(preview.sheetJs).toEqual(preview.excelJs)
    expect(full.sheetJs).toEqual(full.excelJs)
  })

  it('머리글 없이 오류 칸만 있는 끝 열 — 둘 다 없다', async () => {
    const { excelJs, sheetJs } = await readBoth(ERROR_ONLY_TAIL)
    expect(excelJs).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ])
    expect(sheetJs).toEqual(excelJs)
  })

  it('시트 범위가 실제 칸보다 좁으면 폴백은 범위 안만 읽고 빈 열을 만들지 않는다', async () => {
    const { excelJs, sheetJs } = await readBoth(NARROW_DIMENSION)
    expect(sheetJs).toEqual([['x'], ['1']])
    // 원래 있던 갈림 — 본진은 범위와 무관하게 칸을 읽는다.
    expect(excelJs).toEqual([
      ['x', 'y', 'z'],
      ['1', '2', '3'],
    ])
  })

  it('범위가 A가 아닌 열에서 시작하는 시트 — 폴백의 폭은 범위의 첫 열부터 센다', async () => {
    const { excelJs, sheetJs } = await readBoth(FROM_COLUMN_B)
    expect(sheetJs).toEqual([
      ['x', 'y'],
      ['1', '2'],
    ])
    // 원래 있던 갈림 — 본진은 A열부터 읽는다.
    expect(excelJs).toEqual([
      ['', 'x', 'y'],
      ['', '1', '2'],
    ])
  })

  it('머리글만 있는 끝 열은 남는다 — 모든 행에서 빈 열만 자른다', async () => {
    const { excelJs, sheetJs } = await readBoth(HEADER_ONLY_TAIL)
    expect(excelJs).toEqual([
      ['x', 'y', 'z'],
      ['1', '2', ''],
    ])
    expect(sheetJs).toEqual(excelJs)
  })
})

/**
 * **fitWidth** — 두 파서가 쓰는 폭 맞추기. 지금 파서들은 짧은 행을 주지 않아 채우기가 표에서는
 * 안 보이므로 직접 문다(`data/xlsx.ts`의 주석).
 */
describe('fitWidth', () => {
  it('긴 행은 자르고 짧은 행은 빈 칸으로 채운다', () => {
    expect(fitWidth([['a', 'b', 'c'], ['1']], 2)).toEqual([
      ['a', 'b'],
      ['1', ''],
    ])
  })
})
