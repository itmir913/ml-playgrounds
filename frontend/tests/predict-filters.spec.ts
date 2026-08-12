// @vitest-environment jsdom
// 실제로 mount해서 그려진 것을 본다 - 여기 있는 결함은 눈으로만 보인다.
/**
 * 예측 화면의 필터 칸 (`views/predict/PredictFilters.vue`).
 *
 * **빈 카드가 실제로 떴다.** 학습이 한 번뿐이고 알고리즘도 하나뿐인 프로젝트에서,
 * 두 축이 다 안 그려졌는데 바깥 칸만 남아 아무것도 안 든 테두리가 화면에 섰다.
 * 학생에게 그것은 필터가 아니라 **무언가 안 뜬 고장**으로 보인다.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PredictFilters from '../src/views/predict/PredictFilters.vue'

const ONE = [{ id: 'a', label: '1번째 학습' }]
const TWO = [
  { id: 'a', label: '1번째 학습' },
  { id: 'b', label: '2번째 학습' },
]

function render(experiments: typeof ONE, algorithms: typeof ONE) {
  return mount(PredictFilters, {
    props: {
      experiments,
      algorithms,
      selectedExperiments: new Set(experiments.map((option) => option.id)),
      selectedAlgorithms: new Set(algorithms.map((option) => option.id)),
      experimentsLabel: '학습 차수',
      algorithmsLabel: '모델',
      disabled: false,
    },
  })
}

describe('거를 것이 없으면 자리를 안 차지한다', () => {
  it('두 축이 다 하나뿐이면 아무것도 안 그린다', () => {
    expect(render(ONE, ONE).html()).toBe('<!--v-if-->')
  })

  it('한 축만 둘 이상이어도 칸은 선다', () => {
    const html = render(ONE, TWO).html()
    expect(html).toContain('모델')
    // 하나뿐인 축은 그 안에서도 안 그려진다.
    expect(html).not.toContain('학습 차수')
  })
})

describe('고른 것을 표시한다', () => {
  it('켜진 칩은 aria-pressed가 참이다', () => {
    const wrapper = render(TWO, TWO)
    const chips = wrapper.findAll('button')
    expect(chips.every((chip) => chip.attributes('aria-pressed') === 'true')).toBe(true)
  })

  it('누르면 그 축의 id를 올린다', async () => {
    const wrapper = render(TWO, TWO)
    await wrapper.findAll('button')[1]?.trigger('click')
    expect(wrapper.emitted('toggleExperiment')).toEqual([['b']])
  })
})
