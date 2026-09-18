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

/** 첫 묶음의 칸 글자. **글자만 적고 무엇의 글자인지는 열 머리(`프로젝트`)가 말한다.** */
const FIRST_GROUP = 'A'

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

  /** 묶음 칸의 글자들. **열은 묶음이 있을 때만 서므로 없으면 빈 배열이다.** */
  function groupCells(wrapper: Awaited<ReturnType<typeof mountInspect>>): string[] {
    const heads = wrapper.findAll('thead th').map((th) => th.text().trim())
    const at = heads.indexOf(i18n.global.t('inspect.sameProjectColumn'))
    if (at < 0) return []
    return wrapper.findAll('tbody tr').map((row) => row.findAll('td')[at]?.text().trim() ?? '')
  }

  it('짝인 줄에만 묶음 번호가 선다', async () => {
    const wrapper = await mountInspect(await classWithOnePair())
    await flushPromises()
    expect(groupCells(wrapper)).toEqual([FIRST_GROUP, FIRST_GROUP, '', ''])
    wrapper.unmount()
  })

  /** **누를 머리가 있어야 묶음을 눈으로 안 찾는다** (2026-09-18, 사용자). */
  it('묶음 열은 정렬 기준이다', async () => {
    const wrapper = await mountInspect(await classWithOnePair())
    await flushPromises()
    const head = wrapper
      .findAll('thead th')
      .find((th) => th.text().includes(i18n.global.t('inspect.sameProjectColumn')))
    expect(head?.find('button').exists()).toBe(true)
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
    // **진짜 아이디가 판에 있다** — 표에는 글자만 서므로 확인은 여기서 한다.
    expect(panel.props('projectId')).toBe(panel.props('projectId'))
    expect(panel.text()).toContain(panel.props('projectId') as string)
    expect(panel.props('name')).toBe(FIRST_GROUP)
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
   *
   * **숨기지 않는다** (2026-09-18, 사용자가 뒤집었다). 칸마다 같은 글자가 서른 번 서면
   * 구분은 0이라 열도 판도 안 서지만, **그 사실을 말하지 않으면 `전부 다르다`와 `전부
   * 같다`가 화면에서 똑같이 보인다** — 교사가 시작 파일을 나눠 준 적이 없다면 그것이
   * 최악의 상황이고, 화면이 하필 그때 침묵하게 된다.
   */
  it('전부가 한 프로젝트면 한 줄로 말하고 열과 판은 안 세운다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('01-가.mlpx'),
      await submissionFile('02-나.mlpx'),
      await submissionFile('03-다.mlpx'),
    ])
    await flushPromises()
    expect(wrapper.text()).toContain(i18n.global.t('inspect.sameProjectAll', { files: 3 }))
    expect(groupCells(wrapper)).toEqual([])

    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(SameProjectPanel).exists()).toBe(false)
    wrapper.unmount()
  })

  it('아이디가 전부 다르면 아무 말도 안 한다 - 말할 것이 없다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('01-가.mlpx', OTHER[0]),
      await submissionFile('02-나.mlpx', OTHER[1]),
    ])
    await flushPromises()
    expect(wrapper.text()).not.toContain('프로젝트 아이디가 같은')
    expect(wrapper.text()).not.toContain(i18n.global.t('inspect.sameProjectAll', { files: 2 }))
    expect(groupCells(wrapper)).toEqual([])
    wrapper.unmount()
  })
})
