/**
 * **두 파서가 갈리는 자리** (`data/xlsx.ts` 머리말의 표, 2026-09-28 감사 E B1).
 *
 * 그 머리말은 한동안 *"남은 차이는 시간대 하나"*라고 적었다. 재 보니 셋이 더 있었다 — 오류
 * 칸·병합 셀·서식만 있는 끝의 빈 열. **어느 쪽으로 맞출지는 코드 소유자의 결정이라** 여기서는
 * 고치지 않고 **지금의 갈림을 그대로 못 박는다.** 하나를 맞추면 이 검사가 울고, 그때 머리말의
 * 표도 함께 고친다 — 실측 문장이 코드와 함께 늙게 하는 것이 이 파일의 일이다.
 *
 * 날짜의 시간대는 여기 없다 — 기기의 시간대에 따라 답이 달라 이 판에서 못 박을 수 없다
 * (open-decisions.md #18).
 *
 * **xlsx는 XML을 직접 적어 만든다.** ExcelJS로 쓰면 오류 칸의 캐시 값이나 서식만 있는 칸을
 * 원하는 모양으로 못 남긴다. **폴백은 본진의 `load`를 던지게 해서 지난다** — 한셀 실물과 같은 길이다.
 */
import { strToU8, zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { openXlsx } from '../src/data/xlsx'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'

/** 인라인 문자열 칸. 공유 문자열 표를 만들지 않으려고 쓴다. */
const text = (ref: string, value: string): string =>
  `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`
const number = (ref: string, value: number): string => `<c r="${ref}"><v>${value}</v></c>`

function workbook(rows: readonly string[], extra = ''): Uint8Array {
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
      `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetData>${sheetData}</sheetData>${extra}</worksheet>`,
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

async function readBoth(bytes: Uint8Array): Promise<{ excelJs: string[][]; sheetJs: string[][] }> {
  const excelJs = (await openXlsx(bytes)).readSheet('S')

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
  const sheetJs = (await fallback.openXlsx(bytes)).readSheet('S')
  return { excelJs, sheetJs }
}

afterEach(() => {
  vi.doUnmock('exceljs')
  vi.resetModules()
})

describe('두 파서가 갈리는 자리', { timeout: 20_000 }, () => {
  it('오류 칸 — 본진은 오류 글자, 폴백은 빈 칸', async () => {
    const { excelJs, sheetJs } = await readBoth(ERROR_CELLS)
    expect(excelJs[1]).toEqual(['150', '#DIV/0!'])
    expect(sheetJs[1]).toEqual(['150', ''])
  })

  it('병합 셀 — 본진은 범위 전체에 첫 칸의 값, 폴백은 첫 칸만', async () => {
    const { excelJs, sheetJs } = await readBoth(MERGED)
    expect(excelJs.map((row) => row[0])).toEqual(['학년', '1', '1'])
    expect(sheetJs.map((row) => row[0])).toEqual(['학년', '1', ''])
  })

  it('서식만 있는 끝의 빈 열 — 본진은 열로 남기고, 폴백은 없다', async () => {
    const { excelJs, sheetJs } = await readBoth(STYLED)
    expect(excelJs[0]).toEqual(['x', 'y', '', ''])
    expect(sheetJs[0]).toEqual(['x', 'y'])
  })
})
