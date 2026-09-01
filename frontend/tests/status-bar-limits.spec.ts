// @vitest-environment jsdom
/**
 * 상태 표시줄의 **상한 해제 팝오버** (`components/AppStatusBar.vue`).
 *
 * **문구가 상태를 안 보고 있었다** (2026-09-01, 사용자). 켠 뒤에도 *"해제하면 … 수
 * 있습니다"*라고 적었는데, **이미 해제한 사람에게 가정법으로 말하는 것**이라 그 줄만
 * 화면과 어긋났다. 로케일 검사는 이것을 못 본다 — 키도 문장도 멀쩡하고, 틀린 것은
 * **어느 상태에서 어느 키를 고르는가**이기 때문이다.
 *
 * 그래서 여기서는 **두 상태를 실제로 그려 견준다.**
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import AppStatusBar from '../src/components/AppStatusBar.vue'
import { i18n, setLocale } from '../src/i18n'
import { applyLimitsOff } from '../src/limits-switch'

/**
 * 팝오버를 열고 그 안의 글을 돌려준다. 트리거는 상한 아이콘이 든 단추다.
 *
 * **패널은 `body`로 옮겨 뜬다**(`AppPopover`의 `Teleport`). 그래서 컴포넌트의 글이
 * 아니라 문서의 글을 본다 — 처음에 `view.text()`를 봤다가 빈 손으로 통과할 뻔했다.
 */
async function panelText(off: boolean): Promise<string> {
  applyLimitsOff(off)
  document.body.innerHTML = ''
  const view = mount(AppStatusBar, { global: { plugins: [i18n] }, attachTo: document.body })
  const trigger = view
    .findAll('button')
    .find((one) => one.attributes('aria-label') === i18n.global.t('shell.limits'))
  expect(trigger, 'the limits trigger must exist').toBeDefined()
  await trigger!.trigger('click')
  const panel = document.querySelector('.popover-panel')
  expect(panel, 'the popover must open').not.toBeNull()
  return panel?.textContent ?? ''
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

afterEach(() => applyLimitsOff(false))

describe('상한 팝오버는 상태마다 다른 말을 한다', () => {
  it('켜기 전에는 앞으로 무슨 일이 날지 말한다', async () => {
    const text = await panelText(false)
    expect(text).toContain(i18n.global.t('shell.limitsApplied'))
    expect(text).toContain(i18n.global.t('shell.limitsRisk'))
    expect(text).not.toContain(i18n.global.t('shell.limitsRiskOn'))
  })

  /**
   * **가정법이 남아 있으면 안 된다.** 이 검사가 막는 것이 정확히 그 한 줄이다 —
   * 켠 사람에게 *"해제하면"*은 이미 지난 이야기다.
   */
  it('켠 뒤에는 지금 무슨 일이 날 수 있는지 말한다', async () => {
    const text = await panelText(true)
    expect(text).toContain(i18n.global.t('shell.limitsReleased'))
    expect(text).toContain(i18n.global.t('shell.limitsRiskOn'))
    expect(text).not.toContain(i18n.global.t('shell.limitsRisk'))
  })

  /** 어느 상태에서도 빠지면 안 되는 줄. 이 설정이 어디까지 미치는지는 늘 말한다. */
  it('기기에만 저장된다는 말은 두 상태에 다 있다', async () => {
    expect(await panelText(false)).toContain(i18n.global.t('shell.limitsDevice'))
    expect(await panelText(true)).toContain(i18n.global.t('shell.limitsDevice'))
  })

  /**
   * **두 상태가 같은 글이면 그 자리는 상태를 안 보는 것이다.** 위 검사들이 키를 하나씩
   * 짚는다면, 이것은 **앞으로 늘어날 줄까지** 함께 본다.
   */
  it('두 상태의 글이 서로 다르다', async () => {
    expect(await panelText(false)).not.toBe(await panelText(true))
  })
})
