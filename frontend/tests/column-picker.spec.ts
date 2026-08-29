// @vitest-environment jsdom
/**
 * 열 고르기 표 — **타깃 라디오가 잠기지 않는다.**
 *
 * `targetIssue`는 **이유이지 금지가 아니다** (`open-decisions.md` "타깃의 자료형 문제는
 * 고르는 것을 막지 않고 말한다"). 잠그면 회귀로 정해진 프로젝트가 **수치 열이 하나도 없는
 * 표**를 만났을 때 학생이 갇힌다 — 타깃을 못 고르고, 타깃이 없으니 학습 화면이 안 열리고,
 * 유형을 바꿀 곳은 그 학습 화면뿐이다 (V11 R2 감사 A-1).
 *
 * **이 파일이 지키는 것은 화면의 생김새가 아니라 빠져나갈 길이다.** 그래서 확인하는 것도
 * 둘뿐이다 — 라디오가 눌리는가, 그리고 눌렀을 때 그 사실이 위로 올라가는가.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'

import ColumnPicker from '../src/views/preprocess/ColumnPicker.vue'
import { columnPlan } from '../src/ml/selection'
import { summarizeColumns, toDataset } from '../src/data/columns'
import { parseCsvText } from '../src/data/csv'

/** 세 열 전부 문자. 회귀에서는 어느 것도 타깃 자격이 없다. */
const CSV = ['등급,지역,동아리', '상,서울,축구', '중,부산,미술', '하,대구,축구'].join('\n')

function planFor(taskType: 'regression' | 'classification') {
  const dataset = toDataset(parseCsvText(CSV), true)
  return columnPlan({
    columns: summarizeColumns(dataset),
    rowCount: dataset.rows.length,
    features: ['지역'],
    target: undefined,
    taskType,
    preprocessing: { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' },
  })
}

function pickerFor(taskType: 'regression' | 'classification') {
  return mount(ColumnPicker, {
    props: { plan: planFor(taskType), scaling: 'none' as const, encoding: 'onehot' as const },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'ko', messages: { ko: {} } })],
    },
  })
}

describe('타깃 라디오', () => {
  it('자료형이 안 맞아도 잠기지 않는다 - 막다른 길을 만들지 않는다', () => {
    const radios = pickerFor('regression').findAll('input[type="radio"]')
    expect(radios).toHaveLength(3)
    expect(radios.every((radio) => radio.attributes('disabled') === undefined)).toBe(true)
  })

  it('눌리면 그 열 이름이 위로 올라간다', async () => {
    const wrapper = pickerFor('regression')
    await wrapper.findAll('input[type="radio"]')[0]?.trigger('change')
    expect(wrapper.emitted('pickTarget')?.[0]).toEqual(['등급'])
  })

  it('분류에서도 같다 - 애초에 걸릴 것이 없다', () => {
    const radios = pickerFor('classification').findAll('input[type="radio"]')
    expect(radios.every((radio) => radio.attributes('disabled') === undefined)).toBe(true)
  })
})
