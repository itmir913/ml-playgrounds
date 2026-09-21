/**
 * **천 단위 쉼표는 정본을 만들 때 숫자로 읽는다** (2026-09-21, `open-decisions.md`).
 *
 * **왜 필요한가.** `1,650`이 글자로 남으면 `detectKind`가 그 열을 통째로 **범주**로
 * 돌린다. 그러면 원핫 폭이 행 수만큼 늘고 **시험 행이 전부 미지 범주라 0 벡터가 되어**
 * 지표가 무너진다 — 300행에서 회귀 R²가 1.000에서 −54.0으로 떨어졌다.
 *
 * **여기서 재는 것은 둘이다** — 푸는가, 그리고 **풀어야 할 것만 푸는가.** 묻지 않고
 * 바꾸는 규칙이라 둘째가 첫째만큼 중요하다.
 */

import { describe, expect, it } from 'vitest'

import { canonicalCell, canonicalGrid } from '../src/data/serialize'
import { importTable, openTable } from '../src/data/table'
import { detectKind } from '../src/ml/preprocess'

describe('천 단위 묶음만 푼다', () => {
  /** 교실에서 실제로 나오는 모양. 한국 학교 자료의 수는 `1,650`으로 적힌다. */
  const 푼다: [string, string][] = [
    ['1,650', '1650'],
    ['1,234,567', '1234567'],
    ['-1,650', '-1650'],
    ['+1,650', '+1650'],
    ['1,650.5', '1650.5'],
    ['999,000', '999000'],
    ['  1,650  ', '  1650  '], // **공백은 안 건드린다** — 바꾸는 칸과 안 바꾸는 칸이 같은 대접
  ]
  for (const [before, after] of 푼다) {
    it(`\`${before}\` -> \`${after}\``, () => {
      expect(canonicalCell(before)).toBe(after)
    })
  }

  /**
   * **안 푸는 것이 이 파일의 절반이다.** 묶음이 셋이 아니면 유럽식 소수점일 수 있고,
   * 우리는 묻지 않고 바꾸므로 애매하면 안 건드린다.
   */
  const 안푼다 = [
    '1,65', // 묶음이 둘 — 유럽식이면 1.65다
    '12,34',
    '1,2,3',
    '1,6500', // 묶음이 넷
    '1234,567', // 첫 묶음이 넷 — 넓히는 방향도 막는다
    '12345,678',
    '0,123', // 천 단위는 0으로 시작하지 않는다. 유럽식 0.123일 수 있다
    '0,125',
    '-0,500',
    ',650', // 앞이 비었다
    '1,', // 뒤가 비었다
    '서울,강남',
    '1,650원', // 단위가 붙었다
    'A,650',
    '1650', // 이미 수다 — 손대지 않는다
    '',
  ]
  for (const cell of 안푼다) {
    it(`\`${cell}\`는 그대로 둔다`, () => {
      expect(canonicalCell(cell)).toBe(cell)
    })
  }
})

describe('멱등이다 — 두 번 지나도 같다', () => {
  for (const cell of ['1,650', '1,234,567', '  1,650  ', '0,123', '서울,강남', '1650']) {
    it(`\`${cell}\``, () => {
      expect(canonicalCell(canonicalCell(cell))).toBe(canonicalCell(cell))
    })
  }
})

describe('격자 전체', () => {
  it('머리글 줄도 같은 규칙을 지난다 — 세 표의 열 이름이 맞아야 한다', () => {
    expect(
      canonicalGrid([
        ['1,650', '등급'],
        ['1,650', '가'],
      ]),
    ).toEqual([
      ['1650', '등급'],
      ['1650', '가'],
    ])
  })
})

describe('진짜 입구 — 올린 CSV가 정본이 될 때', () => {
  async function importCsv(text: string) {
    const bytes = new TextEncoder().encode(text)
    return importTable(await openTable(bytes, '성적.csv'))
  }

  it('정본 바이트에 쉼표가 안 남는다', async () => {
    const imported = await importCsv('점수,등급\n"1,650",가\n"1,700",나\n120,가\n')
    const text = new TextDecoder().decode(imported.bytes)
    expect(text).not.toContain('1,650')
    expect(imported.grid).toEqual([
      ['점수', '등급'],
      ['1650', '가'],
      ['1700', '나'],
      ['120', '가'],
    ])
  })

  /**
   * **이 단언이 이 고침의 이유다.** 고치기 전에는 `점수`가 `categorical`이었고, 그래서
   * 원핫 폭이 행 수만큼 늘어 시험 행이 전부 0 벡터가 됐다.
   */
  it('그 열이 수치로 판정된다', async () => {
    const imported = await importCsv('점수,등급\n"1,650",가\n"1,700",나\n120,가\n')
    const 점수 = imported.grid.slice(1).map((row) => row[0] as string)
    expect(detectKind(점수)).toBe('numeric')
  })

  it('쉼표가 든 열 이름도 세 표에서 같게 나온다', async () => {
    const a = await importCsv('"1,650",등급\n10,가\n')
    const b = await importCsv('"1,650",등급\n20,나\n')
    expect(a.grid[0]).toEqual(b.grid[0])
    expect(a.grid[0]?.[0]).toBe('1650')
  })

  it('쉼표가 뜻을 갖는 글자 열은 안 건드린다', async () => {
    const imported = await importCsv('주소,점수\n"서울,강남",100\n"부산,해운대",110\n')
    expect(imported.grid[1]?.[0]).toBe('서울,강남')
  })
})
