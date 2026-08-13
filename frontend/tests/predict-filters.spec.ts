// @vitest-environment jsdom
// 실제로 mount해서 그려진 것을 본다 - 여기 있는 결함은 눈으로만 보인다.
/**
 * 예측 화면의 필터 칸 (`views/predict/PredictFilters.vue`).
 *
 * **빈 카드가 실제로 떴다.** 학습이 한 번뿐이고 알고리즘도 하나뿐인 프로젝트에서,
 * 두 축이 다 안 그려졌는데 바깥 칸만 남아 아무것도 안 든 테두리가 화면에 섰다.
 * 학생에게 그것은 필터가 아니라 **무언가 안 뜬 고장**으로 보인다.
 *
 * **전체 버튼의 이름이 동작과 같은 판정을 보는지도 여기서 본다** — [전체 해제]라고
 * 적힌 버튼이 전부 켜면 학생은 화면을 못 믿는다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { PredictFilter } from '../src/ml/predict'
import PredictFilters, { type FilterAxis } from '../src/views/predict/PredictFilters.vue'

const ONE = [{ id: 'a', label: '1번째 실험' }]
const TWO = [
  { id: 'a', label: '1번째 실험' },
  { id: 'b', label: '2번째 실험' },
]

function axesOf(experiments: typeof ONE, algorithms: typeof ONE): FilterAxis[] {
  return [
    { id: 'experiment', label: '실험(Experiment)', options: experiments },
    { id: 'algorithm', label: '모델', options: algorithms },
  ]
}

function render(experiments: typeof ONE, algorithms: typeof ONE, filter?: PredictFilter) {
  const axes = axesOf(experiments, algorithms)
  return mount(PredictFilters, {
    props: {
      axes,
      filter: filter ?? {
        experimentIds: new Set(experiments.map((option) => option.id)),
        algorithms: new Set(algorithms.map((option) => option.id)),
      },
      count: '모델 2개 중 2개',
      disabled: false,
    },
    global: { plugins: [i18n] },
  })
}

/** 켜고 끄는 칩만. 전체 버튼도 `<button>`이라 전부 세면 자리가 밀린다. */
function chipsOf(wrapper: ReturnType<typeof render>) {
  return wrapper.findAll('button[aria-pressed]')
}

beforeEach(async () => {
  await setLocale('ko')
})

describe('거를 것이 없으면 자리를 안 차지한다', () => {
  it('두 축이 다 하나뿐이면 아무것도 안 그린다', () => {
    expect(render(ONE, ONE).html()).toBe('<!--v-if-->')
  })

  it('한 축만 둘 이상이어도 칸은 선다', () => {
    const html = render(ONE, TWO).html()
    expect(html).toContain('모델')
    // 하나뿐인 축은 그 안에서도 안 그려진다.
    expect(html).not.toContain('실험(Experiment)')
  })
})

describe('고른 것을 표시한다', () => {
  it('켜진 칩은 aria-pressed가 참이다', () => {
    const chips = chipsOf(render(TWO, TWO))
    expect(chips.every((chip) => chip.attributes('aria-pressed') === 'true')).toBe(true)
  })

  it('누르면 어느 축의 무엇인지를 함께 올린다', async () => {
    const wrapper = render(TWO, TWO)
    await chipsOf(wrapper)[1]?.trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([['experiment', 'b']])
  })
})

describe('전체 버튼은 이름과 동작이 같은 판정을 본다', () => {
  it('전부 켜져 있으면 [전체 해제]라고 적힌다', () => {
    expect(render(TWO, TWO).html()).toContain('전체 해제')
  })

  it('하나라도 꺼져 있으면 [전체 선택]이 된다', () => {
    const html = render(TWO, TWO, {
      experimentIds: new Set(['a']),
      algorithms: new Set(['a', 'b']),
    }).html()

    expect(html).toContain('전체 선택')
  })

  it('누르면 그 축만 올린다', async () => {
    const wrapper = render(TWO, TWO)
    await wrapper.findAll('button:not([aria-pressed])')[0]?.trigger('click')
    expect(wrapper.emitted('toggleAll')).toEqual([['experiment']])
  })
})
