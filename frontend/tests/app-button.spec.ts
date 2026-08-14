// @vitest-environment jsdom
/**
 * 버튼이 도는 동안의 모양 (`components/AppButton.vue`).
 *
 * **꺼진 것만으로는 도는 중인지 모른다.** 회색 버튼은 "지금 하는 중"과 "아직 못 누름"이
 * 같은 모양이라, 오래 걸리는 자리에서 학생은 아무 일도 안 일어난 줄 알고 다시 누르러
 * 간다 — 예측 화면에서 실제로 그렇게 보였다 (2026-08-14, 사용자).
 *
 * `action`으로 준 일이 끝날 때까지 버튼이 꺼지는 것은 예전부터의 계약이고
 * (CLAUDE.md §4), 여기서는 **그 동안 글자가 바뀌는지**까지 본다.
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AppButton from '../src/components/AppButton.vue'

/** 내가 끝내 줄 때까지 안 끝나는 일. 도는 중의 화면을 붙잡아 둔다. */
function pending(): { promise: Promise<void>; finish: () => void } {
  let finish!: () => void
  const promise = new Promise<void>((resolve) => {
    finish = resolve
  })
  return { promise, finish }
}

describe('도는 동안', () => {
  it('꺼지고, 글자가 바뀌고, 끝나면 되돌아온다', async () => {
    const job = pending()
    const wrapper = mount(AppButton, {
      slots: { default: '예측하기', pending: '진행 중…' },
      props: { action: () => job.promise },
    })

    expect(wrapper.text()).toBe('예측하기')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toBe('진행 중…')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
    // 읽어 주는 쪽에도 같은 사실이 가야 한다.
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true')

    job.finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.text()).toBe('예측하기')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })

  /**
   * **안 준 버튼은 글자가 그대로다.** 짧게 끝나는 자리까지 글자가 깜빡이면 그게 더
   * 시끄럽고, 그 자리는 도는 중인지 알 필요도 없다.
   */
  it('pending을 안 주면 원래 글자를 그대로 쓴다', async () => {
    const job = pending()
    const wrapper = mount(AppButton, {
      slots: { default: '저장' },
      props: { action: () => job.promise },
    })

    await wrapper.find('button').trigger('click')
    expect(wrapper.text()).toBe('저장')
    job.finish()
  })

  /**
   * **던져도 꺼진 채로 남지 않는다.** 실패를 다루는 것은 부르는 쪽의 일이지만, 다시
   * 누를 수 없게 되는 것은 그 자리에서 학생이 할 수 있는 일이 없어진다는 뜻이다.
   */
  it('일이 실패해도 글자와 상태가 되돌아온다', async () => {
    const wrapper = mount(AppButton, {
      slots: { default: '예측하기', pending: '진행 중…' },
      props: { action: () => Promise.reject(new Error('실패')) },
      // **버튼은 실패를 삼키지 않는다** — 다루는 것은 부르는 쪽의 일이라, 여기서는
      // 그 실패가 갈 자리를 만들어 준다. 안 만들면 처리 안 된 거부로 남는다.
      global: { config: { errorHandler: () => {} } },
    })

    await wrapper.find('button').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wrapper.text()).toBe('예측하기')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })
})
