// @vitest-environment jsdom
/**
 * **표 예측의 답이 바탕이 바뀌면 지워지는가** (2026-09-23, R38 C-6).
 *
 * 답을 들고 있는 동안 학생이 **입력 칸을 고치거나 · 필터를 바꾸거나 · [무작위로 하나
 * 가져오기]를 누르면**, 지난 답은 지금 화면의 값과 다른 입력으로 나온 것이다. 남겨 두면
 * **새 값 옆에 옛 답이 나란히 선다**(`architecture.md` §8.13.1). 감사자가 재 보니 셋 다 옳게
 * 지워졌는데, **그 지우는 줄 셋이 어느 스펙에서도 실행되지 않았다.**
 *
 * **두 시점 비교다.** 답이 선 **뒤** 바탕을 바꾸면 **처음부터**(아직 안 누른 상태)와 같아야
 * 한다 — 답이 비어 있다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { i18n, setLocale } from '../src/i18n'
import { useProjectStore } from '../src/stores/project'
import TabularPredictPanel from '../src/views/predict/TabularPredictPanel.vue'
import { trainedIrisProject } from './fixtures/trained'

/** 일괄 예측은 이 검사의 주제가 아니다 — 판이 읽는 넷만 내놓는 가짜로 세운다. */
const FakeBatch = defineComponent({
  name: 'BatchPredict',
  setup(_props, { expose }) {
    expose({ busy: false, computing: false, opened: null, hasFile: false })
    return () => h('div')
  },
})

interface PanelInternals {
  answers: Map<string, unknown>
  fields: readonly { name: string }[]
  axes: readonly { id: 'experiment' | 'algorithm'; options: readonly { id: string }[] }[]
  set: (name: string, value: string) => void
  toggle: (axis: 'experiment' | 'algorithm', id: string) => void
  sample: () => void
}

/**
 * **진짜로 학습한 프로젝트를 띄운다.** 가짜 모델로는 쓸 수 있는 모델이 없어서 입력 칸이
 * 하나도 안 서고 가져오기도 아무 일을 안 한다 — 그 상태로 재면 지우는 줄을 안 지난다.
 */
async function mountPanel(): Promise<PanelInternals> {
  setActivePinia(createPinia())
  useProjectStore().update(await trainedIrisProject())
  const wrapper = mount(TabularPredictPanel, {
    global: { plugins: [i18n], stubs: { BatchPredict: FakeBatch } },
  })
  return wrapper.vm as unknown as PanelInternals
}

/** 답이 선 상태를 만든다. **답의 모양은 이 검사의 주제가 아니다** — 지워지는가만 본다. */
function withAnswer(panel: PanelInternals): void {
  panel.answers = new Map([['run-1', { value: 'setosa' }]])
  expect(panel.answers.size).toBe(1)
}

beforeEach(async () => {
  await setLocale('ko')
  // **jsdom에는 `scrollIntoView`가 없다.** [가져오기]가 채운 줄로 화면을 굴리는데, 안 채워
  // 두면 처리 안 된 오류가 쌓여 **검사는 초록인데 관문이 빨개진다.**
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
})

describe('답은 바탕이 바뀌면 지워진다', () => {
  it('입력 칸을 고치면', async () => {
    const panel = await mountPanel()
    const field = panel.fields[0]?.name
    expect(field).toBeDefined()
    withAnswer(panel)

    panel.set(field ?? '', '5.5')
    expect(panel.answers.size).toBe(0)
  })

  it('필터를 바꾸면', async () => {
    const panel = await mountPanel()
    const axis = panel.axes[0]
    const option = axis?.options[0]?.id
    expect(option).toBeDefined()
    withAnswer(panel)

    panel.toggle(axis?.id ?? 'experiment', option ?? '')
    expect(panel.answers.size).toBe(0)
  })

  /** [무작위로 하나 가져오기]는 칸을 **통째로** 갈아 끼우므로 더더욱 옛 답이 남으면 안 된다. */
  it('무작위로 한 줄을 가져오면', async () => {
    const panel = await mountPanel()
    withAnswer(panel)

    panel.sample()
    expect(panel.answers.size).toBe(0)
  })
})
