// @vitest-environment jsdom
/**
 * 요소 크기 따라가기 (`composables/useElementSize.ts`).
 *
 * **마운트할 때 없던 요소가 나중에 서도 크기를 잰다**를 문다 — 산점도를 연 순간 세로축 열이 전부
 * 빈 칸이면 그림 영역이 `v-if`에 막혀 없다. 학생이 열을 바꿔 영역이 서면 그림도 서야 한다.
 * 마운트 때만 재던 때는 영영 0×0이라 그림 자리가 비었다.
 */

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import { useElementSize } from '../src/composables/useElementSize'
import { stubElementSize } from './fixtures/layout'

afterEach(() => vi.restoreAllMocks())

const Probe = defineComponent({
  props: { shown: { type: Boolean, required: true } },
  setup(props) {
    const el = ref<HTMLElement | null>(null)
    const size = useElementSize(el)
    return () =>
      h('div', [
        props.shown ? h('div', { ref: el, class: 'area' }) : null,
        h('span', { class: 'size' }, `${size.value.width}x${size.value.height}`),
      ])
  },
})

describe('useElementSize', () => {
  it('마운트할 때 있던 요소의 크기를 잰다', async () => {
    stubElementSize(640, 400)
    const wrapper = mount(Probe, { props: { shown: true } })
    await nextTick()
    expect(wrapper.find('.size').text()).toBe('640x400')
  })

  it('나중에 선 요소도 재고, 사라지면 0으로 돌아간다', async () => {
    stubElementSize(640, 400)
    const wrapper = mount(Probe, { props: { shown: false } })
    await nextTick()
    expect(wrapper.find('.size').text()).toBe('0x0')

    await wrapper.setProps({ shown: true })
    await nextTick()
    expect(wrapper.find('.size').text()).toBe('640x400')

    await wrapper.setProps({ shown: false })
    await nextTick()
    expect(wrapper.find('.size').text()).toBe('0x0')
  })
})
