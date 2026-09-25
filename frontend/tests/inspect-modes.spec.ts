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

import { createPinia, setActivePinia } from 'pinia'

import { i18n, setLocale } from '../src/i18n'
import IntegrityPanel from '../src/views/inspect/IntegrityPanel.vue'
import PortfolioPanel from '../src/views/inspect/PortfolioPanel.vue'
import ReproducePanel from '../src/views/inspect/ReproducePanel.vue'
import ExperimentDetail from '../src/views/results/ExperimentDetail.vue'
import ProjectSummary from '../src/components/ProjectSummary.vue'
import {
  brokenFile,
  mountInspect,
  pickFiles,
  submissionFile,
  submissionWithExperiment,
} from './fixtures/inspect-screen'

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
    // **스토어가 있어야 판이 뜬다** — 대조 판이 알림 스토어를 쓴다(엔진 판이 갈렸을 때).
    setActivePinia(createPinia())
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

  /**
   * **자리가 뜻이다** (§8.21, 2026-09-18 사용자). 무결성과 대조는 둘 다 "이 제출물을 믿을
   * 수 있나"의 답이라 한 열에 붙어 서고, 그래서 **오른쪽 열은 결과 화면과 같은 것**이
   * 된다 — 왼쪽에서 고르고 오른쪽에 상세가 선다.
   *
   * **이 판은 자리를 두 번 옮겼다.** 옮겨도 화면은 멀쩡히 그려지므로 아무것도 안 운다.
   */
  it('대조는 무결성과 한 열에 서고 오른쪽 열에는 상세만 있다', async () => {
    const wrapper = await mountInspect([await submissionWithExperiment('hong.mlpx')])
    await flushPromises()

    /** 두 열 격자에서 이 부품이 든 칸. */
    const columnOf = (element: Element): Element | null => element.closest('.grid > *')
    const integrity = columnOf(wrapper.findComponent(IntegrityPanel).element)
    expect(integrity).not.toBeNull()
    expect(columnOf(wrapper.findComponent(ReproducePanel).element)).toBe(integrity)
    expect(columnOf(wrapper.findComponent(ExperimentDetail).element)).not.toBe(integrity)
    wrapper.unmount()
  })

  /**
   * **안 고르면 마지막 실험이다** (2026-09-18, 실물 파일로 재다 잡았다). 실험이 셋인 파일을
   * 열면 **학생이 제일 먼저 한 실험**이 떠 있었다 — 교사가 먼저 볼 것은 마지막에 한 일이고,
   * 결과 화면도 마지막을 연다. 그런데 바로 그 자리의 주석은 마지막을 연다고 적혀 있었다.
   */
  it('실험이 여럿이면 마지막 실험이 열려 있다', async () => {
    const wrapper = await mountInspect([await submissionWithExperiment('hong.mlpx', 3)])
    await flushPromises()
    expect(wrapper.findComponent(ReproducePanel).props('order')).toBe(3)
    wrapper.unmount()
  })

  /**
   * **대조 판은 상세와 같은 기록된 전처리기를 받는다.** 예상 폭이
   * 학습이 본 열 종류를 거기서 읽는다(`inspect-reproduce-width.spec.ts`). 안 넘기면 prop이
   * `undefined`로 남아 조용히 파일 전체의 종류로 돌아간다 — `null`(못 읽음)과 가른다.
   */
  it('대조 판이 상세와 같은 전처리기를 받는다', async () => {
    const wrapper = await mountInspect([await submissionWithExperiment('hong.mlpx')])
    await flushPromises()
    const handed = wrapper.findComponent(ReproducePanel).props('preprocessor')
    expect(handed).not.toBeUndefined()
    expect(handed).toBe(wrapper.findComponent(ExperimentDetail).props('preprocessor'))
    wrapper.unmount()
  })

  it('대조 판이 어느 실험의 것인지를 말한다', async () => {
    const wrapper = await mountInspect([await submissionWithExperiment('hong.mlpx')])
    await flushPromises()
    // 번호는 결과 화면이 매기는 그것이다 — 교사와 학생이 같은 실험을 다르게 부르면 안 된다.
    expect(wrapper.findComponent(ReproducePanel).text()).toContain(
      i18n.global.t('results.experimentName', { index: 1 }),
    )
    wrapper.unmount()
  })

  /**
   * **고른 실험은 제출물을 안 건넌다** (2026-09-18 R28 C-8).
   *
   * 실험 id는 **같은 프로젝트에서 나온 파일들 사이에서 겹친다** — 교사가 나눠 준 시작
   * 파일로 학습한 반이 전부 그 모양이다. 줄을 옮길 때 고른 id를 안 비우면 다음 파일에서
   * 그 id가 그대로 맞아, **교사가 앞 학생에게서 고른 그 실험**이 열린 채로 선다.
   */
  it('다른 제출물로 옮기면 마지막 실험으로 돌아온다', async () => {
    const wrapper = await mountInspect([
      await submissionWithExperiment('hong.mlpx', 3),
      await submissionWithExperiment('kim.mlpx', 3),
    ])
    await flushPromises()
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    // 첫 실험을 고른다 — 이 id는 다음 파일에도 그대로 있다.
    await wrapper.findAllComponents({ name: 'ExperimentList' })[0]!.vm.$emit('pick', 'experiment-1')
    await flushPromises()
    expect(wrapper.findComponent(ReproducePanel).props('order')).toBe(1)

    await wrapper.findAll('tbody tr')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ReproducePanel).props('order'), 'the choice must not travel').toBe(
      3,
    )
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
