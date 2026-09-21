// @vitest-environment jsdom
// **왜 jsdom인가.** 등록부가 지연 로딩으로 그림 부품을 가리키고, 그 부품이 배색
// 토큰을 읽는다(`useChartTokens`). **여기서 `document`에 닿지는 않는다** — 지연
// 로딩이라 평가되지 않는다. 다만 `ui-rules`의 그물이 임포트를 따라가므로, 안 밝히면
// 그 그물이 운다. 밝히는 값이 그물을 무르게 하는 것보다 싸다 (2026-09-21).
/**
 * 시각화 도구 등록부 (`data/charts.ts`, `architecture.md` §9).
 *
 * **여기서 무는 것은 잠금이다.** 그림이 그려지는지는 눈이 보고, 검사가 봐야 하는 것은
 * **못 그리는 자리에서 잠기는가**와 **잠긴 이유를 말하는가**다 — 그 둘이 어긋나면
 * 학생은 회색 버튼만 보고 고장으로 읽는다 (§8.2).
 *
 * **`false`가 아니라 이유 목록이라는 것 자체가 계약이다** (`CLAUDE.md` §2).
 */

import { describe, expect, it } from 'vitest'

import {
  CHART_BLOCKS,
  CHART_TOOLS,
  categoricalColumns,
  chartToolsFor,
  defaultChartTool,
  numericColumns,
} from '../src/data/charts'
import type { ColumnSummary } from '../src/data/columns'
import { DATA_TYPES } from '../src/project/schema'

function column(name: string, kind: ColumnSummary['kind']): ColumnSummary {
  return { name, kind, missing: 0, unique: 3, samples: [] }
}

/** 수치 둘과 범주 하나. 네 도구가 전부 성립하는 표다. */
const COLUMNS: readonly ColumnSummary[] = [
  column('키', 'numeric'),
  column('몸무게', 'numeric'),
  column('성별', 'categorical'),
]

const tool = (id: string) => CHART_TOOLS.find((one) => one.id === id)!

describe('등록부의 모양', () => {
  it('도구마다 `id`가 서로 다르다', () => {
    const ids = CHART_TOOLS.map((one) => one.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * **축은 값마다 칸이 있어야 한다** (`ml/axes.ts`). 타입이 이미 강제하지만, 값 목록이
   * 실행 중에 늘어나는 날 **칸이 빈 것을 여기서도 잡는다.**
   */
  it('모든 데이터 종류에 칸이 있다', () => {
    for (const one of CHART_TOOLS) {
      for (const dataType of DATA_TYPES) {
        expect(typeof one.dataTypes[dataType], `${one.id}.${dataType}`).toBe('boolean')
      }
    }
  })

  /**
   * **사진에는 어느 도구도 안 선다.** 사진에는 열이라는 것이 없다 — 이 사실이 화면이
   * 아니라 등록부에 있다는 것이 §9.1의 요점이고, 그것을 여기서 못 박는다.
   */
  it('표에서만 성립한다', () => {
    expect(chartToolsFor('tabular').length).toBe(CHART_TOOLS.length)
    expect(chartToolsFor('image')).toEqual([])
  })

  it('돌려주는 이유가 전부 선언된 목록 안에 있다', () => {
    const declared = new Set<string>(CHART_BLOCKS)
    for (const one of CHART_TOOLS) {
      for (const pick of ['키', '성별', '없는 열']) {
        for (const block of one.blockedBy({ columns: COLUMNS, column: pick })) {
          expect(declared.has(block), `${one.id}: ${block}`).toBe(true)
        }
      }
    }
  })
})

describe('열의 자료형이 도구를 가른다', () => {
  it('수치 열에서는 히스토그램·상자그림·산점도가 열린다', () => {
    for (const id of ['histogram', 'box', 'scatter']) {
      expect(tool(id).blockedBy({ columns: COLUMNS, column: '키' }), id).toEqual([])
    }
  })

  it('수치 열에서 막대그래프는 잠긴다 — 분포는 히스토그램이 말한다', () => {
    expect(tool('bar').blockedBy({ columns: COLUMNS, column: '키' })).toEqual(['needsCategorical'])
  })

  it('범주 열에서는 막대그래프만 열린다', () => {
    expect(tool('bar').blockedBy({ columns: COLUMNS, column: '성별' })).toEqual([])
    expect(tool('histogram').blockedBy({ columns: COLUMNS, column: '성별' })).toEqual([
      'needsNumeric',
    ])
    expect(tool('box').blockedBy({ columns: COLUMNS, column: '성별' })).toEqual(['needsNumeric'])
  })

  /** 표에 없는 열은 자료형이 없다. **던지지 않고 잠근다** — 그림 하나가 화면을 데려가면 안 된다. */
  it('표에 없는 열이면 전부 잠긴다', () => {
    for (const one of CHART_TOOLS) {
      expect(one.blockedBy({ columns: COLUMNS, column: '없는 열' }).length, one.id).toBeGreaterThan(
        0,
      )
    }
  })
})

describe('산점도는 둘째 열을 요구한다', () => {
  const alone: readonly ColumnSummary[] = [column('키', 'numeric'), column('성별', 'categorical')]

  /** **자기 자신과의 산점도는 대각선일 뿐이다.** 고른 열은 후보에서 빠진다. */
  it('수치 열이 그 열 하나뿐이면 잠긴다', () => {
    expect(tool('scatter').blockedBy({ columns: alone, column: '키' })).toEqual([
      'needsAnotherNumeric',
    ])
  })

  /**
   * **이유가 둘일 수 있다.** 범주 열을 고른 채 수치 열이 하나뿐이면 둘 다 참이고,
   * 하나만 말하면 학생이 하나를 고치고 다시 막힌다.
   */
  it('이유가 둘이면 둘 다 말한다', () => {
    expect(tool('scatter').blockedBy({ columns: alone, column: '성별' })).toEqual([
      'needsNumeric',
      'needsAnotherNumeric',
    ])
  })

  it('수치 열이 둘이면 열린다', () => {
    expect(tool('scatter').blockedBy({ columns: COLUMNS, column: '키' })).toEqual([])
  })
})

describe('열에 맞는 첫 도구', () => {
  /**
   * **창을 열자마자 그림이 보여야 한다.** 빈 판을 띄우고 도구를 고르게 하면, 자료형에
   * 따라 도구가 갈린다는 사실이 화면에서 안 보인다.
   */
  it('고른 열에서 그릴 수 있는 도구를 준다', () => {
    expect(defaultChartTool('tabular', { columns: COLUMNS, column: '키' })?.id).toBe('histogram')
    expect(defaultChartTool('tabular', { columns: COLUMNS, column: '성별' })?.id).toBe('bar')
  })

  it('그릴 수 있는 것이 없으면 `undefined`다', () => {
    expect(defaultChartTool('tabular', { columns: COLUMNS, column: '없는 열' })).toBeUndefined()
    expect(defaultChartTool('image', { columns: COLUMNS, column: '키' })).toBeUndefined()
  })
})

describe('열 고르기', () => {
  it('자료형으로 나눈다', () => {
    expect(numericColumns(COLUMNS)).toEqual(['키', '몸무게'])
    expect(categoricalColumns(COLUMNS)).toEqual(['성별'])
  })

  it('표의 순서를 지킨다 — 화면의 드롭다운이 이 순서로 선다', () => {
    const mixed = [column('a', 'categorical'), column('b', 'numeric'), column('c', 'categorical')]
    expect(categoricalColumns(mixed)).toEqual(['a', 'c'])
  })
})
