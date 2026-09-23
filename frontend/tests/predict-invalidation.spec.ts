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
 *
 * **학생의 손으로 몬다** (2026-09-23 R38-V V-C1). 처음에는 답을 `panel.answers`에 손으로
 * 넣고 `panel.set()`·`panel.toggle()`·`panel.sample()`을 직접 불렀다 — 그러면 `InputRow`의
 * `@set`, 필터의 `@toggle`, [가져오기]의 `@click`을 끊어도 초록이었고(V7~V9 조용), **답을
 * 내는 루프(`run()`)는 한 번도 안 돌았다.** 이제 답은 [예측하기]로 내고, 바꾸는 것은 칸의
 * `input` 사건 · 필터 칩의 클릭 · 바의 단추다. 판의 안쪽은 **읽기만** 한다.
 */

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import { i18n, setLocale } from '../src/i18n'
import { useProjectStore } from '../src/stores/project'
import InputRow from '../src/views/predict/InputRow.vue'
import PredictFilters from '../src/views/predict/PredictFilters.vue'
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

/** 읽기만 한다. */
interface PanelInternals {
  answers: ReadonlyMap<string, { value?: unknown; failure?: unknown }>
}

const WAIT_MS = 10_000

/**
 * **진짜로 학습한 프로젝트를 띄운다.** 가짜 모델로는 쓸 수 있는 모델이 없어서 입력 칸이
 * 하나도 안 서고 가져오기도 아무 일을 안 한다 — 그 상태로 재면 지우는 줄을 안 지난다.
 * **알고리즘이 둘이다** — 필터는 한 축에 선택지가 둘 이상이어야 선다(`PredictFilters`).
 */
async function mountPanel() {
  setActivePinia(createPinia())
  useProjectStore().update(await trainedIrisProject(['decision_tree', 'knn']))
  const wrapper = mount(TabularPredictPanel, {
    global: { plugins: [i18n], stubs: { BatchPredict: FakeBatch } },
  })
  await flushPromises()
  return wrapper
}

function panelOf(wrapper: VueWrapper): PanelInternals {
  return wrapper.vm as unknown as PanelInternals
}

function button(wrapper: VueWrapper, key: string) {
  const found = wrapper.findAll('button').find((one) => one.text() === i18n.global.t(key))
  expect(found, key).toBeDefined()
  return found!
}

/** 답을 기다리는 카드의 수. 답이 서면 0이고, 지워지면 보이는 모델 수다. */
function waiting(wrapper: VueWrapper): number {
  return wrapper.text().split(i18n.global.t('predict.tabular.waiting')).length - 1
}

/**
 * 답이 선 상태를 **학생이 만드는 길로** 만든다 — [무작위로 가져오기]로 칸을 채우고 [예측하기].
 * 두 모델 다 **값으로** 답해야 한다(실패로 답하면 이 검사가 재는 것이 흐려진다).
 */
async function answered(wrapper: VueWrapper): Promise<void> {
  await button(wrapper, 'predict.tabular.fromData').trigger('click')
  await flushPromises()
  await button(wrapper, 'predict.run').trigger('click')
  await vi.waitFor(() => {
    if (panelOf(wrapper).answers.size < 2) throw new Error('answers not in yet')
  }, WAIT_MS)
  await flushPromises()
  for (const answer of panelOf(wrapper).answers.values()) {
    expect(answer.failure).toBeUndefined()
    expect(answer.value).toBeDefined()
  }
  expect(waiting(wrapper)).toBe(0)
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
    const wrapper = await mountPanel()
    await answered(wrapper)

    const field = wrapper.findComponent(InputRow).find('input')
    expect(field.exists()).toBe(true)
    await field.setValue('5.5')

    expect(panelOf(wrapper).answers.size).toBe(0)
    expect(waiting(wrapper)).toBe(2)
  })

  it('필터를 바꾸면', async () => {
    const wrapper = await mountPanel()
    await answered(wrapper)

    // 칩 하나를 끈다 — 남은 카드 하나도 답이 지워져야 한다.
    const chip = wrapper.findComponent(PredictFilters).find('button[aria-pressed="true"]')
    expect(chip.exists()).toBe(true)
    await chip.trigger('click')

    expect(panelOf(wrapper).answers.size).toBe(0)
    expect(waiting(wrapper)).toBe(1)
  })

  /** [무작위로 하나 가져오기]는 칸을 **통째로** 갈아 끼우므로 더더욱 옛 답이 남으면 안 된다. */
  it('무작위로 한 줄을 가져오면', async () => {
    const wrapper = await mountPanel()
    await answered(wrapper)

    await button(wrapper, 'predict.tabular.fromData').trigger('click')
    await flushPromises()

    expect(panelOf(wrapper).answers.size).toBe(0)
    expect(waiting(wrapper)).toBe(2)
  })
})
