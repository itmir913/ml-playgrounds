// @vitest-environment jsdom
/**
 * 전처리 미리보기 표의 **칸 수가 줄마다 맞는가** (`views/preprocess/TabularPrepPreview.vue`).
 *
 * **머리글 첫 줄은 `colspan`으로, 나머지는 칸 하나씩으로 선다.** 그래서 한쪽에 칸을
 * 더하면 다른 쪽의 `colspan`도 같이 늘어야 하는데, **한쪽만 고쳐도 타입도 린트도 안
 * 운다** — 열 이름이 옆 열의 값 위에 서고 눈으로만 보인다. 실제로 그렇게 나갔다
 * (2026-08-31, `외 N개` 칸을 더하면서 `spanOf`를 안 고쳤다).
 *
 * **이 검사가 있으면 그 자리가 다시 갈리지 않는다.** 세는 것은 순수한 사실이다 —
 * 머리 첫 줄의 `colspan` 합, 머리 둘째 줄의 칸 수, 몸통 한 줄의 칸 수가 모두 같아야 한다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import TabularPrepPreview from '../src/views/preprocess/TabularPrepPreview.vue'
import { i18n, setLocale } from '../src/i18n'
import { fitPreprocessor, type Dataset } from '../src/ml/preprocess'
import { preprocessPreview } from '../src/ml/preview'
import type { Preprocessing } from '../src/project/schema'

const ONEHOT: Preprocessing = { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' }

/** 값 종류가 천장을 넘는 열 하나와, 안 넘는 열 하나. 두 갈래가 한 표에 함께 선다. */
function table(kinds: number): Dataset {
  return {
    columns: ['wide', 'narrow', 'label'],
    rows: Array.from({ length: kinds }, (_, row) => [
      `v-${row}`,
      row % 2 === 0 ? '가' : '나',
      row % 2 === 0 ? 'a' : 'b',
    ]),
  }
}

function mounted(kinds: number) {
  const dataset = table(kinds)
  const rows = dataset.rows.map((_, index) => index)
  const preprocessor = fitPreprocessor(dataset, rows, ['wide', 'narrow'], ONEHOT)
  const preview = preprocessPreview(dataset, preprocessor, rows, 'onehot')
  return mount(TabularPrepPreview, {
    props: { preview, emptyKey: 'preprocess.previewEmpty' },
    global: { plugins: [i18n] },
  })
}

beforeEach(async () => {
  await setLocale('ko')
})

describe('미리보기 표의 칸 수가 줄마다 맞는다', () => {
  for (const kinds of [4, 40]) {
    it(`값 종류 ${kinds}개 - 머리글과 몸통이 같은 칸 수를 센다`, () => {
      const wrapper = mounted(kinds)
      const headRows = wrapper.findAll('thead tr')
      const first = headRows[0]
      const second = headRows[1]
      expect(first, '머리글 첫 줄').toBeDefined()
      expect(second, '머리글 둘째 줄').toBeDefined()

      // 첫 줄은 행 번호 칸(rowspan)과 열마다의 colspan으로 선다.
      const spans = (first?.findAll('th') ?? []).map((cell) =>
        Number(cell.attributes('colspan') ?? '1'),
      )
      const rowNumberCell = 1
      const firstRowCells = spans.reduce((sum, span) => sum + span, 0)

      const secondRowCells = second?.findAll('th').length ?? 0
      const bodyRow = wrapper.find('tbody tr')
      const bodyCells = bodyRow.findAll('td').length

      // 첫 줄에는 행 번호가 rowspan으로 이미 들어 있고, 둘째 줄에는 없다.
      expect(secondRowCells + rowNumberCell).toBe(firstRowCells)
      expect(bodyCells).toBe(firstRowCells)
    })
  }

  it('천장을 넘으면 외 N개 칸이 실제로 선다 - 안 서면 위 검사가 아무것도 안 지킨다', () => {
    expect(mounted(40).text()).toContain('외')
    expect(mounted(4).text()).not.toContain('외')
  })
})
