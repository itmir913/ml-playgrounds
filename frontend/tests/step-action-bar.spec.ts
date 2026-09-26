// @vitest-environment jsdom
/**
 * **동작 바가 휴대폰에서 붙는지는 `sticky` 속성이 정한다** (`open-decisions.md` 59와 그 예외).
 *
 * `ui-rules.spec.ts`의 *"동작 바는 md 이상에서만 붙고, …"*는 템플릿 표기를 센다 — 그래서 속성의
 * **기본값**이 켜지면 표기는 그대로인 채 모든 화면이 다시 붙는데도 조용했다. 여기서는 바를
 * 실제로 띄워 붙는 클래스가 속성에 따라 갈리는지를 본다. 붙어 보이는지는 레이아웃이라
 * 여기서도 못 본다(architecture.md §8.13.1, 사람 확인).
 */

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepActionBar from '../src/components/StepActionBar.vue'

/** 접두 없이 붙는 클래스 — 폭을 가리지 않고 붙는다. */
const UNPREFIXED = ['sticky', 'stick-below-shell']

function rootClasses(props: Record<string, unknown>): string[] {
  const wrapper = mount(StepActionBar, { props })
  // 템플릿이 주석으로 시작해 루트가 조각이다 — 첫 `div`가 바의 바깥 칸이다.
  const classes = wrapper.find('div').classes()
  wrapper.unmount()
  return classes
}

describe('동작 바의 붙박이', () => {
  it('속성이 없으면 휴대폰에서 통째로 붙지 않는다', () => {
    const classes = rootClasses({})
    for (const one of UNPREFIXED) {
      expect(classes, `unprefixed ${one} without the sticky prop`).not.toContain(one)
    }
    expect(classes).toContain('md:sticky')
  })

  /** 안 치우면 그 값이 문서에 남아 다음 화면의 도착 지점이 없는 바를 비켜선다. */
  it('떠날 때 자기 높이를 치운다', () => {
    const wrapper = mount(StepActionBar, { props: { sticky: true } })
    const root = document.documentElement.style
    expect(root.getPropertyValue('--step-bar-height'), 'height not published').not.toBe('')
    wrapper.unmount()
    expect(root.getPropertyValue('--step-bar-height'), 'height left behind').toBe('')
  })

  it('sticky를 주면 폭을 가리지 않고 붙는다', () => {
    const classes = rootClasses({ sticky: true })
    for (const one of UNPREFIXED) {
      expect(classes, `missing ${one} with the sticky prop`).toContain(one)
    }
  })
})
