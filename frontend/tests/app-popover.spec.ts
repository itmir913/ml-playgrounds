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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/**
 * **넘칠 때는 잘리는 대신 스크롤한다.** 뒤집기는 더 넓은 쪽으로 옮기는 것이지 들어간다는
 * 보장이 아니라, 둘 다 모자란 화면에서는 천장만이 잘림을 막는다 (2026-08-14, 사용자).
 */
describe('고른 쪽에 남은 만큼이 천장이다', () => {
  it('열면 남은 자리를 패널에 적어 준다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    const panel = document.querySelector(PANEL) as HTMLElement | null
    // 값 자체는 그 화면의 것이라 여기서 숫자를 고정하지 않는다. **적혔는지**를 본다 —
    // 안 적히면 `popover-panel`의 `min()`이 화면 천장만 보고 머리가 잘린다.
    expect(panel?.style.getPropertyValue('--popover-room')).toMatch(/px$/)
  })
})

describe('스크롤과 닫힘', () => {
  it('패널 안을 굴려도 안 닫힌다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    const panel = document.querySelector(PANEL)
    expect(panel, 'the panel should be open').not.toBeNull()

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

/**
 * **여는 것과 닫는 것 자체에 검사가 없었다** (V11 R5 B-2). `onPointerDown`의 `close()`를
 * 지워도 이 파일의 검사 넷이 전부 통과했고 저장소 전체 1,917개도 통과했다.
 *
 * 이 파일의 머리말이 존재 이유를 이렇게 적어 두었다 — *"바깥 클릭과 Esc는 여기서 한 번만
 * 처리한다. 쓰는 쪽마다 다시 짜면 어딘가는 빠진다."* **여덟 자리가 이 부품을 쓴다**:
 * 상태 표시줄 · 프로젝트 요약 · 용어 설명 · 혼동 행렬의 칸 · 변경 목록 · 예측 카드 ·
 * 군집 증거 · 양식 가져오기.
 */
describe('바깥을 누르거나 Esc를 치면 닫힌다', () => {
  /** 패널이 지금 떠 있는가. body로 텔레포트되므로 문서 전체에서 찾는다. */
  function isOpen(): boolean {
    return document.querySelector('.content') !== null
  }

  it('열린다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    expect(isOpen()).toBe(true)
  })

  it('바깥을 누르면 닫힌다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    expect(isOpen()).toBe(true)

    document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(isOpen()).toBe(false)
  })

  /** 패널 안의 글자를 드래그해 고르는 동안 닫히면 안 된다 - 머리말이 든 함정이다. */
  it('패널 안을 누르면 안 닫힌다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')

    const inside = document.querySelector('.content')
    inside?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(isOpen()).toBe(true)
  })

  it('Esc를 치면 닫힌다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    expect(isOpen()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(isOpen()).toBe(false)
  })
})

/**
 * 이름 → 폭 유틸리티 표 (`WIDTHS`).
 *
 * **넷을 전부 빈 문자열로 만들어도 저장소 전체가 초록이었다** (2026-08-31 사각 감사 A-3).
 * 그러면 팝오버 여섯 자리가 전부 기본 폭으로 서고 **사진 격자는 한 줄로 눌린다.**
 *
 * **이름을 손으로 적지 않는다** — 프롭 유니온에서 뽑아 개수를 맞춘다. `AppButton`의
 * 변종 표가 같은 모양이고, 그 검사가 따옴표 열쇠 하나를 실제로 잡았다.
 */
describe('팝오버 폭은 이름이 정한다', () => {
  const SOURCE = readFileSync(join(process.cwd(), 'src', 'components', 'AppPopover.vue'), 'utf-8')

  /** `size?: 'a' | 'b' | …`의 항들. 표가 몇 줄이어야 하는지의 유일한 출처다. */
  const declared = [...(/size\?: ([^\n]+)/.exec(SOURCE)?.[1] ?? '').matchAll(/'([\w-]+)'/g)].map(
    (match) => match[1]!,
  )

  /** **마지막에 연 판이다.** 여럿이 동시에 떠 있으면 `querySelector`는 첫 판을 준다. */
  const lastPanel = () => [...document.querySelectorAll(PANEL)].at(-1)?.className ?? ''

  it('프롭이 이름 넷을 말한다', () => {
    expect(declared.length).toBeGreaterThan(1)
  })

  it('기본이 아닌 이름마다 자기 클래스가 붙는다', async () => {
    for (const size of declared) {
      const wrapper = openPopover()
      // 소스에서 뽑은 이름이라 타입이 그 유니온인 것을 모른다. 프롭 타입이 곧 그 목록이고,
      // 개수가 안 맞으면 위 검사가 먼저 운다.
      await wrapper.setProps({ size: size as 'default' })
      await wrapper.find('button').trigger('click')
      // 기본은 `popover-panel`이 이미 갖고 있어 더할 것이 없다.
      if (size === 'default') continue
      expect(lastPanel(), size).toContain(`popover-panel-${size}`)
    }
  })

  it('이름을 안 주면 기본 폭이다', async () => {
    const wrapper = openPopover()
    await wrapper.find('button').trigger('click')
    expect(lastPanel()).toContain('popover-panel')
    expect(lastPanel()).not.toMatch(/popover-panel-/)
  })
})
