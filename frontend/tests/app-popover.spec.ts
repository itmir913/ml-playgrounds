// @vitest-environment jsdom
// 패널이 `body`로 옮겨 떠서(Teleport) DOM을 직접 뒤진다.
/**
 * 팝오버가 닫히는 조건 (`components/AppPopover.vue`).
 *
 * **스크롤하면 닫는 것이 규칙이다** — 붙어 있던 자리가 움직이는데 패널만 떠 있으면
 * 어디서 나온 것인지 알 수 없다. **그런데 패널 자신이 스크롤한 것은 그 자리를 안
 * 움직인다.** 캡처로 듣느라 그 둘을 같은 것으로 다뤄서, 내용이 넘치는 팝오버는 읽으려고
 * 굴리는 순간 닫혔다 (2026-08-14, 군집 대표 사진).
 *
 * **눈으로만 보이는 결함이라** 여기서 못 박는다.
 */

import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import AppPopover from '../src/components/AppPopover.vue'

const PANEL = '.popover-panel'

/** 마운트한 것들. **`body`를 손으로 비우지 않는다** — 텔레포트 자리가 사라져 다음 갱신이 죽는다. */
const mounted: VueWrapper[] = []

function openPopover() {
  const wrapper = mount(AppPopover, {
    attachTo: document.body,
    slots: {
      trigger: '<button type="button">열기</button>',
      default: '<div class="content">안에 든 것</div>',
    },
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

/**
 * **안의 것이 나중에 채워지는 패널이 있다** — 군집 대표 사진은 상자가 먼저 서고 그다음
 * 찾는다. 열 때 잰 높이로 붙여 두면 **자란 만큼 화면 위로 빠져나간다**(2026-08-14,
 * 사용자가 스크린샷으로 잡았다).
 */
describe('자란 만큼 다시 잰다', () => {
  it('열리면 패널의 크기 변화를 지켜본다', async () => {
    const observed: Element[] = []
    const original = globalThis.ResizeObserver
    // jsdom에는 없다. 배선을 보는 것이지 브라우저를 보는 것이 아니다.
    globalThis.ResizeObserver = class {
      constructor(private readonly callback: () => void) {}
      observe(target: Element): void {
        observed.push(target)
        this.callback()
      }
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver

    try {
      const wrapper = openPopover()
      await wrapper.find('button').trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.vm.$nextTick()

      expect(observed).toHaveLength(1)
      expect(observed[0]).toBe(document.querySelector(PANEL))
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})

describe('스크롤과 닫힘', () => {
  it('패널 안을 굴려도 안 닫힌다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    const panel = document.querySelector(PANEL)
    expect(panel, '패널이 열려 있어야 한다').not.toBeNull()

    // **패널 안에서 난 스크롤이다.** 캡처로 문서까지 올라오지만 자리를 안 움직인다.
    panel?.dispatchEvent(new Event('scroll', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(document.querySelector(PANEL)).not.toBeNull()
  })

  it('바깥이 스크롤하면 닫힌다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    expect(document.querySelector(PANEL)).not.toBeNull()

    // 문서가 굴렀다. 트리거가 화면에서 움직였으므로 패널은 자리를 잃는다.
    document.dispatchEvent(new Event('scroll'))
    await wrapper.vm.$nextTick()

    expect(document.querySelector(PANEL)).toBeNull()
  })
})
