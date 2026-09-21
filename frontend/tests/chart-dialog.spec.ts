// @vitest-environment jsdom
// 대화상자와 그 안의 그림 부품을 실제로 마운트한다.
/**
 * 시각화 창 (`views/data/ChartDialog.vue`, `architecture.md` §8.9.1).
 *
 * **여기서 무는 것은 잇는 자리다.** 계산은 `stats.spec.ts`가, 잠금 규칙은
 * `charts.spec.ts`가 이미 본다 — 이 파일이 답하는 것은 *"그 둘이 화면에서 실제로
 * 만나는가"*다. 조각마다 초록인데 잇는 검사가 없어 길이 끊겨 있던 적이 있다
 * (2026-08-25 R10 감사).
 *
 * **못 그리는 도구가 회색으로 남아 이유를 말하는지**가 그중 가장 중요하다. 숨기면 그
 * 도구는 없는 것이 되고, 이유 없이 회색이면 학생이 고장으로 읽는다 (§8.2).
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * **그림 자체는 여기서 볼 것이 아니다.** Chart.js는 캔버스를 요구하고 jsdom에는 없다
 * (`cluster-scatter.spec.ts`가 같은 이유로 같은 일을 한다).
 */
vi.mock('vue-chartjs', () => ({
  Bar: { name: 'Bar', render: () => null },
  Scatter: { name: 'Scatter', render: () => null },
}))

import ChartDialog from '../src/views/data/ChartDialog.vue'
import { i18n } from '../src/i18n'
import { stubDialogElement } from './fixtures/image-workers'

const DATASET = {
  columns: ['키', '몸무게', '성별'],
  rows: [
    ['160', '50', '남'],
    ['170', '60', '여'],
    ['180', '70', '남'],
    ['', '80', ''],
  ],
}

const COLUMNS = [
  { name: '키', kind: 'numeric' as const, missing: 1, unique: 3, samples: ['160'] },
  { name: '몸무게', kind: 'numeric' as const, missing: 0, unique: 4, samples: ['50'] },
  { name: '성별', kind: 'categorical' as const, missing: 1, unique: 2, samples: ['남'] },
]

function open(column: string, columns = COLUMNS) {
  return mount(ChartDialog, {
    props: {
      open: true,
      kind: 'tabular' as const,
      dataset: DATASET,
      columns,
      column,
      randomState: 42,
    },
    global: { plugins: [i18n] },
  })
}

/**
 * 그림 부품이 실제로 설 때까지 기다린다.
 *
 * **`flushPromises` 하나로는 모자라다** (2026-09-21). 부품이 지연 로딩이라
 * (`data/charts.ts`) 마운트가 모듈을 불러오는 것을 기다리고, 그것은 마이크로태스크
 * 하나로 안 끝난다. **안 기다리면 `<!---->` 자리표시자를 보고 "그림이 없다"고 읽는다** —
 * 그러면 이 파일의 검사들이 전부 조용히 거짓 초록이 된다.
 */
async function drawn(wrapper: ReturnType<typeof open>): Promise<void> {
  await vi.waitFor(() => {
    if (
      !wrapper.findComponent({ name: 'Bar' }).exists() &&
      !wrapper.findComponent({ name: 'Scatter' }).exists()
    ) {
      throw new Error('chart not mounted yet')
    }
  })
}

/** 도구 단추들. 창의 첫 줄에 선다. */
function toolButtons(wrapper: ReturnType<typeof open>) {
  return wrapper.findAll('button').filter((button) => button.text() !== '')
}

beforeEach(() => {
  stubDialogElement()
  i18n.global.locale.value = 'ko'
})

describe('창이 열리는 순간', () => {
  /**
   * **창을 열자마자 그림이 보여야 한다.** 빈 판을 띄우고 도구를 고르게 하면, 자료형에
   * 따라 도구가 갈린다는 사실이 화면에서 안 보인다.
   */
  it('수치 열이면 히스토그램이 이미 서 있다', async () => {
    const wrapper = open('키')
    await drawn(wrapper)
    expect(wrapper.findComponent({ name: 'Bar' }).exists()).toBe(true)
  })

  it('범주 열이면 막대그래프가 이미 서 있다', async () => {
    const wrapper = open('성별')
    await drawn(wrapper)
    const chosen = toolButtons(wrapper).find((button) => button.classes().includes('text-brand'))
    expect(chosen?.text()).toBe('막대그래프')
  })

  it('네 도구가 전부 화면에 있다 — 못 쓰는 것도 숨기지 않는다', () => {
    const labels = toolButtons(open('키')).map((button) => button.text())
    expect(labels).toContain('히스토그램')
    expect(labels).toContain('막대그래프')
    expect(labels).toContain('상자 그림')
    expect(labels).toContain('산점도')
  })
})

describe('못 그리는 도구는 이유와 함께 잠긴다', () => {
  it('수치 열에서 막대그래프가 잠긴다', () => {
    const bar = toolButtons(open('키')).find((button) => button.text() === '막대그래프')
    expect(bar?.attributes('disabled')).toBeDefined()
    expect(bar?.attributes('title')).toBe('범주 열에서만 그릴 수 있습니다.')
  })

  it('범주 열에서 히스토그램과 상자 그림이 잠긴다', () => {
    const buttons = toolButtons(open('성별'))
    for (const name of ['히스토그램', '상자 그림']) {
      const found = buttons.find((button) => button.text() === name)
      expect(found?.attributes('disabled'), name).toBeDefined()
    }
  })

  /**
   * **이유가 둘이면 둘 다 말한다.** 하나만 말하면 학생이 하나를 고치고 다시 막힌다.
   */
  it('수치 열이 하나뿐이면 산점도가 둘째 열을 요구한다', () => {
    const alone = [COLUMNS[0]!, COLUMNS[2]!]
    const scatter = toolButtons(open('키', alone)).find((button) => button.text() === '산점도')
    expect(scatter?.attributes('disabled')).toBeDefined()
    expect(scatter?.attributes('title')).toBe('수치 열이 두 개 이상 있어야 합니다.')
  })

  /**
   * **잠긴 이유가 붙임말로만 있으면 안 된다** — `title`은 마우스를 올려야 보이고,
   * 휴대폰에는 올릴 마우스가 없다.
   */
  it('그릴 것이 하나도 없으면 글로 말한다', () => {
    const none = [
      { name: '이름', kind: 'categorical' as const, missing: 0, unique: 4, samples: [] },
    ]
    const wrapper = mount(ChartDialog, {
      props: {
        open: true,
        kind: 'image' as const,
        dataset: DATASET,
        columns: none,
        column: '이름',
        randomState: 42,
      },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('이 열로 그릴 수 있는 그림이 없습니다.')
  })
})

describe('창 안에서 계속 돌아다닌다', () => {
  /**
   * **열을 바꾸면 그 열에서 그릴 수 있는 도구로 옮긴다.** 안 옮기면 잠긴 도구가 고른
   * 채로 남아 그림이 사라진다.
   */
  it('수치 열에서 범주 열로 옮기면 막대그래프로 바뀐다', async () => {
    const wrapper = open('키')
    await wrapper.find('select').setValue('성별')
    await drawn(wrapper)

    const chosen = toolButtons(wrapper).find((button) => button.classes().includes('text-brand'))
    expect(chosen?.text()).toBe('막대그래프')
  })

  /**
   * **여전히 그릴 수 있으면 도구를 그대로 둔다.** 열을 옮겨 다니며 같은 그림을 보는
   * 것이 이 창을 쓰는 방식이다.
   */
  it('수치 열끼리 옮기면 고른 도구가 그대로다', async () => {
    const wrapper = open('키')
    const box = toolButtons(wrapper).find((button) => button.text() === '상자 그림')
    await box?.trigger('click')
    await drawn(wrapper)

    await wrapper.find('select').setValue('몸무게')
    await drawn(wrapper)

    const chosen = toolButtons(wrapper).find((button) => button.classes().includes('text-brand'))
    expect(chosen?.text()).toBe('상자 그림')
  })

  it('열 선택기가 표의 모든 열을 들고 있다', () => {
    const options = open('키').find('select').findAll('option')
    expect(options.map((option) => option.text())).toEqual(['키', '몸무게', '성별'])
  })
})

describe('보이는 숫자가 정본의 것이다', () => {
  /**
   * **결측을 말한다.** 그림에 안 들어간 행이 있으면 학생이 그것을 알아야 한다 —
   * 조용히 빼고 그리면 자기 데이터가 다 거기 있다고 믿는다.
   */
  it('빈 칸이 있는 열이면 몇 행이 빠졌는지 말한다', async () => {
    const wrapper = open('키')
    await drawn(wrapper)
    expect(wrapper.text()).toContain('빈 칸 1행은 그림에서 제외했습니다.')
  })

  it('빈 칸이 없으면 아무 말도 안 한다', async () => {
    const wrapper = open('몸무게')
    await drawn(wrapper)
    expect(wrapper.text()).not.toContain('제외했습니다')
  })
})
