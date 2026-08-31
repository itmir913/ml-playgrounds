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
import { i18n } from '../src/i18n'

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
      /**
       * **문구가 빈 i18n이다.** 여기서 보는 것은 라디오가 눌리는가와 그 사실이 위로
       * 올라가는가뿐이라, 진짜 문구를 물리면 검사가 화면 글자에 매인다.
       *
       * **경고는 끈다.** 안 끄면 `t()` 한 번마다 stderr에 한 줄씩 쌓여 관문 로그가
       * 수십 줄 덮인다 — **진짜 경고가 그 사이에 묻힌다** (2026-08-31, 사용자가
       * 관문 로그에서 잡았다). 로케일 키가 실제로 있는지는 이 파일이 아니라
       * `prep-summary.spec.ts`가 본다: 거기는 진짜 `i18n`으로 띄워서, **그리는 것만으로**
       * 없는 키가 그물에 걸린다.
       */
      plugins: [
        createI18n({
          legacy: false,
          locale: 'ko',
          messages: { ko: {} },
          missingWarn: false,
          fallbackWarn: false,
        }),
      ],
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

/**
 * 사유를 문구로 바꾸는 층 (`noteOf`).
 *
 * **판정은 `ml/selection.ts`로 나갔는데 자리표시자를 채우는 갈래 셋은 화면에 남았고,
 * 그 셋을 어느 스펙도 안 지나갔다** (2026-08-31 사각 감사 A-1). 키는 물리는데 인자는
 * 안 물려서, `{feature}`를 안 넘기거나 `{target}`으로 잘못 넘겨도 저장소가 조용했다.
 *
 * **`vue-i18n`은 안 넘긴 자리표시자를 빈 문자열로 그린다.** 예외도 안 나고 로케일
 * 키도 안 뜨고, **열 이름만 조용히 사라진 채 빈 괄호가 남는다.** 이 문장이 존재하는
 * 이유가 "어느 열을 해제하라는 것인가"인데(`i18n.md` 규칙 4) 바로 그것이 없어진다.
 */
describe('줄에 붙는 사유는 어느 열인지를 말한다', () => {
  /** 진짜 문구를 쓴다 - 빈 메시지로는 자리표시자가 채워졌는지 볼 수 없다. */
  function pickerWith(features: string[], missing: 'none' | 'drop') {
    const dataset = toDataset(parseCsvText(CSV), true)
    const plan = columnPlan({
      columns: summarizeColumns(dataset).map((column) =>
        // 값이 통째로 빈 열 하나를 만든다. 특성으로 고르면 학습이 거부한다.
        column.name === '동아리' ? { ...column, missing: dataset.rows.length } : column,
      ),
      rowCount: dataset.rows.length,
      features,
      target: undefined,
      taskType: 'classification',
      preprocessing: { missing, scaling: 'none', categoricalEncoding: 'onehot' },
    })
    return mount(ColumnPicker, {
      props: { plan, scaling: 'none' as const, encoding: 'onehot' as const },
      global: { plugins: [i18n] },
    })
  }

  it('고를 수 없는 특성의 사유가 그 열 이름을 담는다', () => {
    const text = pickerWith(['동아리'], 'none').text()
    expect(text).toContain('동아리')
    // 자리표시자를 안 넘기면 여기가 빈 괄호가 된다.
    expect(text).not.toMatch(/\(\s*\)/)
  })

  it('타깃의 사유도 그 열 이름을 담는다', () => {
    const dataset = toDataset(parseCsvText(CSV), true)
    const plan = columnPlan({
      columns: summarizeColumns(dataset),
      rowCount: dataset.rows.length,
      features: [],
      target: '등급',
      taskType: 'regression',
      preprocessing: { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' },
    })
    const text = mount(ColumnPicker, {
      props: { plan, scaling: 'none' as const, encoding: 'onehot' as const },
      global: { plugins: [i18n] },
    }).text()

    expect(text).toContain('등급')
    expect(text).not.toMatch(/\(\s*\)/)
  })

  it('자리표시자가 없는 사유도 그대로 뜬다', () => {
    // 인코딩이 꺼진 문자 열 - 고르는 것은 되고 학습에서 빠진다는 주의다.
    const dataset = toDataset(parseCsvText(CSV), true)
    const plan = columnPlan({
      columns: summarizeColumns(dataset),
      rowCount: dataset.rows.length,
      features: ['지역'],
      target: undefined,
      taskType: 'classification',
      preprocessing: { missing: 'none', scaling: 'none', categoricalEncoding: 'none' },
    })
    const text = mount(ColumnPicker, {
      props: { plan, scaling: 'none' as const, encoding: 'none' as const },
      global: { plugins: [i18n] },
    }).text()

    expect(text).not.toContain('preprocess.tabular.')
    expect(text).not.toMatch(/\(\s*\)/)
  })
})
