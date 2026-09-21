// @vitest-environment jsdom
// 배색 토큰을 실제로 읽는 컴포저블이라 문서와 계산된 스타일이 있어야 한다.
/**
 * 그림이 배색을 따라가는 자리 (`composables/useChartTokens.ts`).
 *
 * **이 컴포저블에 검사가 하나도 없었다** (2026-09-22 감사가 잡았다). 여기 사는 규칙
 * (`watch(theme, read)`)은 **2026-08-29 전 경로 감사가 실제로 잡았던 결함**인데 —
 * 그때는 `data-theme` 속성을 게터로 읽어서 **감시자가 한 번도 안 깨어났고**, 배색을
 * 바꾼 학생의 산점도가 이전 배색의 값을 그대로 들고 있었다 — 새 복사본에는 그것을
 * 무는 것이 없었다.
 *
 * **색을 화면에서 볼 수는 없다.** 캔버스는 jsdom에 없다. 여기서 재는 것은 **다시
 * 읽었는가**이고, 그 판단이 그리기 앞에 선다 (`cluster-scatter.spec.ts`와 같은 방식).
 */

import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChartTokens } from '../src/composables/useChartTokens'
import { CHART_COLORS } from '../src/palette'
import { theme } from '../src/theme'

/** 토큰을 몇 번 읽었나. **다시 읽는가**가 이 파일이 재는 전부다. */
let reads = 0

function pretendTokens(color: string): void {
  vi.stubGlobal('getComputedStyle', () => ({
    getPropertyValue: (name: string) => {
      if (name.startsWith('--')) reads += 1
      return color
    },
  }))
}

/** 컴포저블을 실제로 마운트해서 쓰는 최소 부품. */
const Host = defineComponent({
  setup() {
    const tokens = useChartTokens()
    return { tokens }
  },
  render() {
    return null
  },
})

beforeEach(() => {
  reads = 0
  theme.value = 'light'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('배색을 따라간다', () => {
  it('마운트하면서 토큰을 읽는다', () => {
    pretendTokens('#123456')
    const wrapper = mount(Host)
    expect(reads).toBeGreaterThan(0)
    expect(wrapper.vm.tokens.ink).toBe('#123456')
  })

  /**
   * **배색이 바뀌면 다시 읽는다.** 이 감시자가 죽으면 화면은 이전 배색의 값을 든 채로
   * 그리고, **그림은 멀쩡해 보인다** — 밝은 화면에 어두운 배색의 선이 검게 그려진다.
   */
  it('배색이 바뀌면 다시 읽는다', async () => {
    pretendTokens('#111111')
    const wrapper = mount(Host)
    const before = reads

    pretendTokens('#eeeeee')
    theme.value = 'dark'
    await wrapper.vm.$nextTick()

    expect(reads).toBeGreaterThan(before)
    expect(wrapper.vm.tokens.ink).toBe('#eeeeee')
  })

  /**
   * **못 읽으면 대체값이고, 그 색은 서로 달라야 한다** — 전부 같으면 토큰을 못 읽는
   * 순간 모든 갈래가 한 색이 되는데 **그림은 멀쩡해 보인다**.
   */
  it('토큰이 비면 대체 팔레트로 떨어지고 색이 서로 다르다', () => {
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '' }))
    const wrapper = mount(Host)
    const palette = wrapper.vm.tokens.palette
    expect(palette).toHaveLength(CHART_COLORS)
    expect(new Set(palette).size).toBe(CHART_COLORS)
  })

  /** 진한 쪽과 옅은 쪽을 **따로** 읽는다 — 상자의 채움과 테두리가 그 둘로 갈린다. */
  it('진한 색과 옅은 색을 따로 읽는다', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (name: string) => (name.endsWith('-soft') ? '#fafafa' : '#202020'),
    }))
    const wrapper = mount(Host)
    expect(wrapper.vm.tokens.palette[0]).toBe('#202020')
    expect(wrapper.vm.tokens.softPalette[0]).toBe('#fafafa')
  })
})
