// @vitest-environment jsdom
// 명렬을 진짜로 띄워서 무엇이 보이고 무엇이 안 보이는지 센다.
/**
 * **같은 프로젝트에서 나온 파일을 화면이 어떻게 말하는가** (architecture.md §8.21,
 * 2026-09-18 사용자).
 *
 * 묶는 계산은 `roster.spec.ts`가 본다. 여기서 지키는 것은 **화면이 그것으로 무엇을 하는가**
 * 셋이다 — 표 위 한 줄, 줄마다의 배지, 고른 줄의 판.
 *
 * **안 보이는 것도 검사한다.** 전부가 한 묶음이면 아무것도 안 뜨는 것이 맞는 동작이고,
 * 그건 화면을 띄워야만 보인다 — 교사가 시작 파일을 나눠 준 흔한 경우에 **서른 줄 전부에
 * 표시가 붙으면 앱이 반 전체를 의심하는 꼴**이 된다.
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import SameProjectPanel from '../src/views/inspect/SameProjectPanel.vue'
import { mountInspect, submissionFile } from './fixtures/inspect-screen'

/** 다른 프로젝트에서 나온 파일을 만들 때 쓰는 아이디들. */
const OTHER = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']

const badge = () => i18n.global.t('inspect.sameProject', { group: 1 })

describe('같은 프로젝트를 화면이 말한다', () => {
  beforeEach(() => {
    setLocale('ko')
  })

  /** 한 반. 앞의 둘만 같은 프로젝트에서 나왔다. */
  async function classWithOnePair(): Promise<File[]> {
    return [
      await submissionFile('01-가.mlpx'),
      await submissionFile('02-나.mlpx'),
      await submissionFile('03-다.mlpx', OTHER[0]),
      await submissionFile('04-라.mlpx', OTHER[1]),
    ]
  }

  it('묶음이 있으면 표 위에서 먼저 말한다', async () => {
    const wrapper = await mountInspect(await classWithOnePair())
    await flushPromises()
    expect(wrapper.text()).toContain(
      i18n.global.t('inspect.sameProjectSummary', { groups: 1, files: 2 }),
    )
    wrapper.unmount()
  })

  it('짝인 줄에만 배지가 붙는다', async () => {
    const wrapper = await mountInspect(await classWithOnePair())
    await flushPromises()
    const marked = wrapper
      .findAll('tbody tr')
      .filter((row) => row.text().includes(badge()))
      .map((row) => row.find('td').text().replace(/\s+/g, ' '))
    expect(marked).toHaveLength(2)
    expect(marked.every((text) => text.includes(badge()))).toBe(true)
    wrapper.unmount()
  })

  it('고른 줄에 짝이 있으면 판이 서고, 그 판이 짝을 이름으로 부른다', async () => {
    const wrapper = await mountInspect(await classWithOnePair())
    await flushPromises()
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()

    const panel = wrapper.findComponent(SameProjectPanel)
    expect(panel.exists()).toBe(true)
    expect(panel.props('labels')).toEqual(['01-가.mlpx', '02-나.mlpx'])
    // **지금 보는 줄이 어느 것인지 그 자리에서 보인다.**
    expect(panel.text()).toContain(i18n.global.t('inspect.thisFile'))
    wrapper.unmount()
  })

  it('짝이 없는 줄에는 판이 안 선다 - 드문 것이 눈에 띄어야 한다', async () => {
    const wrapper = await mountInspect(await classWithOnePair())
    await flushPromises()
    await wrapper.findAll('tbody tr')[2]!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(SameProjectPanel).exists()).toBe(false)
    wrapper.unmount()
  })

  /**
   * **교사가 나눠 준 시작 파일.** 픽스처가 같은 아이디를 쓰므로 이것이 그 상태다.
   */
  it('전부가 한 묶음이면 줄도 배지도 판도 없다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('01-가.mlpx'),
      await submissionFile('02-나.mlpx'),
      await submissionFile('03-다.mlpx'),
    ])
    await flushPromises()
    expect(wrapper.text()).not.toContain(badge())
    expect(wrapper.text()).not.toContain('같은 프로젝트에서 나온 파일이')

    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(SameProjectPanel).exists()).toBe(false)
    wrapper.unmount()
  })
})
