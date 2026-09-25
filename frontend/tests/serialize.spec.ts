import { describe, expect, it } from 'vitest'

import { parseCanonicalCsv } from '../src/data/csv'
import { detectEncoding } from '../src/data/encoding'
import { toCanonicalCsv, toCsvText } from '../src/data/serialize'
import { type ImportedTable, importTable, openTable } from '../src/data/table'
import {
  applyDataset,
  readDataset,
  readPredictDataset,
  readTestDataset,
} from '../src/project/dataset'
import {
  projectFile,
  projectFileWithPredictDataset,
  projectFileWithTestDataset,
} from './fixtures/project'

/**
 * 정본을 쓰고 **정본을 읽는 그 함수로** 다시 읽는다. 업로드용 `parseCsvText`로 읽으면
 * 구분자를 추정해서, 읽는 쪽이 실제로 하는 일과 다른 것을 잰다 (R41 B-3).
 */
function roundTrip(grid: string[][]): string[][] {
  return parseCanonicalCsv(toCanonicalCsv(grid))
}

describe('toCsvText', () => {
  it('평범한 값은 감싸지 않는다', () => {
    expect(
      toCsvText([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\n1,2')
  })

  /**
   * **줄바꿈은 두 글자다.** `NEEDS_QUOTING`은 `\r`과 `\n`을 둘 다 보는데 검사는
   * 오래도록 `\n`만 넣었고, 그래서 `\r`을 목록에서 빼도 저장소 전체가 초록이었다
   * (R9 감사 B-1).
   *
   * **감싸지 않은 홑 CR은 표를 부순다.** 우리가 쓰는 파서(papaparse)에서
   * `a\rb,c`는 `[["a"],["b","c"]]`가 된다 — 한 행이 두 행이 되고, 머리글에 있으면
   * 표 전체가 어긋난다. 원본 CSV에 `"a\rb"`처럼 감싼 홑 CR이 있으면 그 셀이 그대로
   * 정본으로 구워지므로 도달 가능하다. **정본은 한 번 굳으면 아무도 안 고치고
   * 해시까지 그 위에서 잡힌다.**
   */
  it('구분자·따옴표·줄바꿈이 든 값만 감싼다', () => {
    expect(toCsvText([['a,b', 'c"d', 'e\nf', 'g\rh', 'plain']])).toBe(
      '"a,b","c""d","e\nf","g\rh",plain',
    )
  })
})

describe('toCanonicalCsv', () => {
  it('UTF-8 BOM으로 시작한다', () => {
    // BOM이 없으면 교사가 압축을 풀어 엑셀로 열었을 때 한글이 전부 깨진다.
    const bytes = toCanonicalCsv([['이름']])
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
  })

  it('스스로 만든 바이트를 utf-8로 판정한다', () => {
    expect(detectEncoding(toCanonicalCsv([['이름', '나이']]))).toBe('utf-8')
  })
})

describe('왕복 무손실', () => {
  it('평범한 표', () => {
    const grid = [
      ['이름', '나이'],
      ['가나다', '10'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })

  it('구분자·따옴표·줄바꿈이 든 값', () => {
    const grid = [
      ['note', 'value'],
      ['a, b', 'say "hi"'],
      ['two\nlines', 'plain'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })

  it('빈 셀이 섞인 표', () => {
    const grid = [
      ['a', 'b', 'c'],
      ['1', '', '3'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })

  /**
   * **정본을 다시 읽을 때 구분자를 추측하지 않는다** (2026-09-26 R41 B-3). 정본은 `,`로
   * 쓰고 `,`·`"`·줄바꿈이 든 칸만 감싼다 — `;`·탭·`|`는 안 감싼다. 읽는 쪽이 구분자를
   * 추측하면 그런 칸이 많은 표를 `;` 구분으로 읽어 **조용히 틀린 표**가 된다.
   */
  it.each([';', '\t', '|'])('다른 구분자 후보(%j)가 든 칸', (other) => {
    const grid = [
      [`색(r${other}g${other}b)`, '이름'],
      [`255${other}0${other}0`, '빨강'],
      [`0${other}255${other}0`, '초록'],
    ]
    expect(roundTrip(grid)).toEqual(grid)
  })
})

/**
 * **진짜 입구로 잰다** (R41 B-3). 학생이 올린 CSV가 `openTable` → `importTable`로 정본이
 * 되고, 프로젝트가 그 정본을 `readDataset`·`readTestDataset`·`readPredictDataset`으로 다시
 * 읽는다. 구분자를 추측하면 업로드 때 격자는 맞아도 다시 읽은 표가
 * `[["색(r","g","b),이름"],…]`이 된다.
 */
describe('정본을 다시 읽는 세 입구', () => {
  const upload = '색(r;g;b),이름\n"255;0;0",빨강\n"0;255;0",초록\n"0;0;255",파랑\n'
  const expected = {
    columns: ['색(r;g;b)', '이름'],
    rows: [
      ['255;0;0', '빨강'],
      ['0;255;0', '초록'],
      ['0;0;255', '파랑'],
    ],
  }

  async function canonical(): Promise<ImportedTable> {
    const imported = importTable(await openTable(new TextEncoder().encode(upload), 'rgb.csv'))
    // 업로드 쪽은 추정이 맞다 — 틀리는 것은 정본을 다시 읽는 쪽뿐이다.
    expect(imported.grid).toEqual([expected.columns, ...expected.rows])
    return imported
  }

  it('readDataset', async () => {
    const imported = await canonical()
    const { project } = applyDataset(projectFile(), imported, {
      fileName: 'rgb.csv',
      hasHeader: true,
      now: '2026-09-26T00:00:00Z',
    })
    expect(readDataset(project)).toEqual(expected)
  })

  it('readTestDataset', async () => {
    const { bytes, hash } = await canonical()
    const project = { ...projectFileWithTestDataset(), testDataset: { bytes, hash } }
    expect(readTestDataset(project)).toEqual(expected)
  })

  it('readPredictDataset', async () => {
    const { bytes, hash } = await canonical()
    const project = { ...projectFileWithPredictDataset(), predictDataset: { bytes, hash } }
    expect(readPredictDataset(project)).toEqual(expected)
  })
})
