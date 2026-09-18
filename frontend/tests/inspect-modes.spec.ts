// @vitest-environment jsdom
// 모드는 화면의 상태라 띄워야 보인다.
/**
 * **열람의 두 모드** — 모델과 포트폴리오 (architecture.md §8.21, 2026-09-18 사용자).
 *
 * 수행평가를 매기는 동선이 둘이다. 한 화면에 쌓아 두면 글은 언제나 맨 아래에 있고,
 * 서른 명이면 끝까지 내리는 동작이 서른 번이다.
 *
 * **여기서 지키는 것은 "모드가 유지된다"이다.** 갈래의 이유가 *글만 서른 개 읽기*라,
 * 줄을 바꿀 때 모델로 돌아오면 이 기능은 아무것도 안 바꾼 것이 된다 — 그런데 그 되돌림은
 * 조용하다. `opened`를 비우는 `watch`가 바로 옆에 있어서, 다음 사람이 거기에 한 줄을
 * 더하기 쉽다.
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import IntegrityPanel from '../src/views/inspect/IntegrityPanel.vue'
import PortfolioPanel from '../src/views/inspect/PortfolioPanel.vue'
import ProjectSummary from '../src/components/ProjectSummary.vue'
import { brokenFile, mountInspect, pickFiles, submissionFile } from './fixtures/inspect-screen'

/** 그 모드의 단추. **글자로 찾는다** — 교사가 누르는 것도 그 글자다. */
function modeButton(wrapper: Awaited<ReturnType<typeof mountInspect>>, label: string) {
  const group = wrapper.find('[role="group"]')
  const found = group.findAll('button').find((one) => one.text().trim() === label)
  expect(found, `mode button not found: ${label}`).toBeTruthy()
  return found!
}

const MODEL = () => i18n.global.t('inspect.model')
const PORTFOLIO = () => i18n.global.t('inspect.portfolio')

describe('열람 모드', () => {
  beforeEach(() => {
    setLocale('ko')
  })

  /** 열린 제출물 하나. **항목이 하나면 저절로 골라진다.** */
  async function opened() {
    const wrapper = await mountInspect([await submissionFile('hong.mlpx')])
    await flushPromises()
    return wrapper
  }

  it('처음에는 모델이 서고 글은 없다', async () => {
    const wrapper = await opened()
    expect(wrapper.findComponent(ProjectSummary).exists()).toBe(true)
    expect(wrapper.findComponent(IntegrityPanel).exists()).toBe(true)
    expect(wrapper.findComponent(PortfolioPanel).exists()).toBe(false)
    wrapper.unmount()
  })

  it('포트폴리오를 고르면 글만 남는다', async () => {
    const wrapper = await opened()
    await modeButton(wrapper, PORTFOLIO()).trigger('click')

    expect(wrapper.findComponent(PortfolioPanel).exists()).toBe(true)
    // **요약과 무결성은 모델 쪽에 남는다** — 글을 읽을 때 필요한 것은 글이다.
    expect(wrapper.findComponent(ProjectSummary).exists()).toBe(false)
    expect(wrapper.findComponent(IntegrityPanel).exists()).toBe(false)
    wrapper.unmount()
  })

  it('고른 쪽만 눌린 것으로 그려진다', async () => {
    const wrapper = await opened()
    expect(modeButton(wrapper, MODEL()).attributes('aria-pressed')).toBe('true')
    expect(modeButton(wrapper, PORTFOLIO()).attributes('aria-pressed')).toBe('false')

    await modeButton(wrapper, PORTFOLIO()).trigger('click')
    expect(modeButton(wrapper, MODEL()).attributes('aria-pressed')).toBe('false')
    expect(modeButton(wrapper, PORTFOLIO()).attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('다른 제출물로 옮겨도 모드가 유지된다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('hong.mlpx'),
      await submissionFile('kim.mlpx'),
    ])
    await flushPromises()
    // 제출물이 둘이면 고르는 것은 교사다.
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    await modeButton(wrapper, PORTFOLIO()).trigger('click')

    await wrapper.findAll('tbody tr')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(PortfolioPanel).exists()).toBe(true)
    expect(modeButton(wrapper, PORTFOLIO()).attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })

  it('명렬을 갈아 끼워도 모드가 유지된다', async () => {
    const wrapper = await opened()
    await modeButton(wrapper, PORTFOLIO()).trigger('click')

    // 다음 반 폴더를 고른 것. **못 읽는 줄이 섞여 있어도 모드는 그대로다.**
    await pickFiles(wrapper, [await submissionFile('lee.mlpx'), brokenFile('broken.mlpx')])
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(PortfolioPanel).exists()).toBe(true)
    wrapper.unmount()
  })
})
