// @vitest-environment jsdom
/**
 * 축 하나의 미니 카드 (`components/AppChoices.vue`).
 *
 * **글자가 칸을 뚫고 나간 적이 있다.** 그래서 이 컴포넌트는 라벨을 조각으로 나눠
 * 그리는데(가운뎃점마다, 그리고 병기 괄호 앞), **나눠 그린 것이 원래 문장과 같은
 * 글자여야 한다.** 공백 하나가 새거나 빠지면 `의사결정트리 (Decision Tree)`나
 * `ml.js· 내 컴퓨터`가 되는데, 눈으로만 보이고 타입에도 린트에도 안 걸린다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import AppChoices, { type Choice } from '../src/components/AppChoices.vue'
import { i18n, setLocale } from '../src/i18n'
import { lockFor } from '../src/locks'

function textOf(label: string): string {
  const wrapper = mount(AppChoices, {
    props: { label: '축', items: [{ id: 'a', label, enabled: true }] },
    global: { plugins: [i18n] },
  })
  return wrapper.find('button').text()
}

beforeEach(async () => {
  await setLocale('ko')
})

describe('나눠 그려도 글자는 그대로다', () => {
  it('가운뎃점으로 이어 붙인 라벨', () => {
    expect(textOf('13번째 실험 · K-평균(K-Means) · ml.js · 내 컴퓨터')).toBe(
      '13번째 실험 · K-평균(K-Means) · ml.js · 내 컴퓨터',
    )
  })

  it('병기 괄호만 있는 라벨', () => {
    expect(textOf('의사결정트리(Decision Tree)')).toBe('의사결정트리(Decision Tree)')
  })

  it('나눌 것이 없는 라벨', () => {
    expect(textOf('군집화')).toBe('군집화')
  })
})

/**
 * **잠긴 칸에는 이유가 있다** (0.30.0 최종 승인 감사 C-12). 이유가 선택 속성이던 때는 잠겼는데 문장이
 * 없는 칸이 타입을 지났고, 누르면 조용했다. **검사가 아니라 타입이 막는다** — 아래
 * `@ts-expect-error`가 서 있다는 것이 그 증거이고, `Choice`의 갈래를 풀면 이 줄이 "쓰지 않은
 * 기대"로 `vue-tsc`에서 운다.
 */
describe('잠긴 칸에는 이유가 있다', () => {
  it('잠금은 이유 문장과 함께만 넘긴다', () => {
    const lock = lockFor('pageFirst', { page: 0 })
    // @ts-expect-error 잠금만 있고 이유가 없는 칸은 누르면 조용하다.
    const silent: Choice = { id: 'a', label: 'a', lock }
    // @ts-expect-error 이유를 `undefined`로 적어도 같다.
    const blank: Choice = { id: 'a', label: 'a', lock, reason: undefined }
    const told: Choice = { id: 'a', label: 'a', lock, reason: 'why' }
    const open: Choice = { id: 'a', label: 'a' }

    expect([silent, blank, told, open]).toHaveLength(4)
  })
})

describe('접히는 자리를 정해 둔다', () => {
  it('조각마다 덩어리로 다닌다 - 한 이름이 두 줄로 갈리지 않게', () => {
    const wrapper = mount(AppChoices, {
      props: {
        label: '축',
        items: [{ id: 'a', label: '13번째 실험 · ml.js · 내 컴퓨터', enabled: true }],
      },
      global: { plugins: [i18n] },
    })

    // 조각 셋이 각자 inline-block이다. 그 사이에서만 줄이 갈린다.
    expect(wrapper.findAll('button > span.inline-block')).toHaveLength(3)
  })

  it('가운뎃점은 앞 조각에 붙는다 - 줄 첫머리에 점이 서지 않게', () => {
    const wrapper = mount(AppChoices, {
      props: {
        label: '축',
        items: [{ id: 'a', label: 'ml.js · 내 컴퓨터', enabled: true }],
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.findAll('button > span.inline-block')[0]?.text()).toBe('ml.js ·')
  })
})
