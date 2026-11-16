// @vitest-environment jsdom
/**
 * **프로젝트 흐름도의 판과 창을 마운트해서 본다** (`FlowCanvas.vue`, `FlowDialog.vue`, `FlowCard.vue`).
 *
 * jsdom이 못 재는 것은 여기 없다 — `showModal`의 첫 초점, 취소 불가가 된 `cancel`, 호버의 속도는 사람 확인이다
 * (`docs/rule-coverage.md`). 여기서는 그 판단이 기대는 **DOM의 규칙**을 본다: 빈 곳을 누르면 풀리는 범위,
 * `Esc`가 두 단계로 가는 길(keydown), 창이 열린 채로는 강조가 켜져 있지 않은 것, 군집화의 기준 이름.
 */

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import FlowCanvas from '../src/components/flow/FlowCanvas.vue'
import FlowCard from '../src/components/flow/FlowCard.vue'
import FlowDialog from '../src/components/flow/FlowDialog.vue'
import { useFlowDialog } from '../src/composables/useFlowDialog'
import { i18n, setLocale } from '../src/i18n'
import { FLOW_GEOMETRY } from '../src/ml/flow-layout'
import { withTask } from './fixtures/flow-cases'
import { projectFile } from './fixtures/project'

vi.mock('@/ml/flow-counts', () => ({
  flowCountsOf: vi.fn(async () => null),
  flowCountsLite: vi.fn(() => null),
  barValuesOf: vi.fn(() => null),
}))

const PREP = {
  total: 150,
  usable: 150,
  sampled: 150,
  train: 150,
  test: 0,
  unusable: 0,
  notDrawn: 0,
  featureCount: 4,
  prep: 'preprocess',
  testFile: null,
} as const

beforeEach(async () => {
  // jsdom의 `<dialog>`는 열림을 모른다 — 열림만 세우는 대역이다(초점 규칙은 사람 확인).
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement): void {
    this.removeAttribute('open')
  }
  await setLocale('ko')
  useFlowDialog().close()
})

afterEach(() => {
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  document.body.innerHTML = ''
})

const learnOf = (wrapper: ReturnType<typeof mount>) =>
  wrapper.findAll('button').find((button) => button.text().startsWith('학습'))!

function mountCanvas(file = projectFile(), counts: typeof PREP | null = null) {
  const wrapper = mount(FlowCanvas, {
    props: {
      file,
      counts,
      bars: null,
      pinned: null,
      'onUpdate:pinned': (value: string | null) => wrapper.setProps({ pinned: value }),
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  return wrapper
}

describe('판의 빈 곳을 누르면 고정이 풀린다', () => {
  it('그림 밖 여백(판 바탕)을 눌러도 풀린다', async () => {
    const wrapper = mountCanvas()
    await learnOf(wrapper).trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual([null])
    wrapper.unmount()
  })

  it('노드를 누른 것은 풀지 않고 확대 막대를 누른 것도 풀지 않는다', async () => {
    const wrapper = mountCanvas()
    await learnOf(wrapper).trigger('click')
    const bar = wrapper
      .findAll('button')
      .find((button) => button.attributes('aria-label') === '확대')!
    await bar.trigger('click')
    expect(wrapper.emitted('update:pinned')?.at(-1)).toEqual(['learn'])
    wrapper.unmount()
  })
})

describe('창은 열릴 때 강조가 켜져 있지 않고 Esc는 두 단계다', () => {
  function mountDialog() {
    const wrapper = mount(FlowDialog, {
      props: { file: projectFile(), lite: true, open: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    return wrapper
  }

  it('열린 직후에는 흐려진 것이 없다', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.findAll('.flow-dim')).toEqual([])
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])
    wrapper.unmount()
  })

  it('keydown Escape: 고정이 있으면 막고 풀고, 없으면 그대로 두어 닫히게 한다', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    const dialog = wrapper.find('dialog')

    await learnOf(wrapper).trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)

    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.element.dispatchEvent(first)
    await flushPromises()
    expect(first.defaultPrevented).toBe(true)
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])

    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    dialog.element.dispatchEvent(second)
    expect(second.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('닫기는 제목줄 오른쪽 위의 아이콘 단추이고 아래 동작 줄은 없다', async () => {
    const wrapper = mountDialog()
    const close = wrapper.find('dialog button[aria-label="닫기"]')
    expect(close.exists()).toBe(true)
    expect(wrapper.find('dialog .mt-6.shrink-0').exists()).toBe(false)
    await close.trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
    wrapper.unmount()
  })

  it('창은 초점을 창 자신에 두고 연다 — 첫 단추가 강조를 켜지 않는다', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('dialog').attributes('autofocus')).toBeDefined()
    wrapper.unmount()
  })
})

describe('대시보드 카드의 Esc와 빈 곳', () => {
  function mountCard() {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => FLOW_GEOMETRY.width,
    })
    return mount(FlowCard, {
      props: { file: projectFile() },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
  }

  it('가라앉은 바탕의 빈 곳을 누르면 풀린다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)
    await wrapper.find('.bg-surface-sunken').trigger('click')
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])
    wrapper.unmount()
  })

  it('Esc는 카드 밖(문서)에서도 받아 고정만 푼다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.findAll('[aria-pressed="true"]')).toEqual([])
    wrapper.unmount()
  })

  it('창이 열려 있으면 창이 우선이다 — 카드는 Esc를 안 받는다', async () => {
    const wrapper = mountCard()
    await flushPromises()
    await learnOf(wrapper).trigger('click')
    useFlowDialog().open(projectFile())
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(wrapper.findAll('[aria-pressed="true"]').length).toBe(1)
    wrapper.unmount()
  })
})

describe('군집화의 기준 이름', () => {
  it('나누지 않는 유형은 학습에 사용하는 데이터 기준이라 부른다', () => {
    const cluster = mountCanvas(withTask(projectFile(), 'clustering'), PREP)
    expect(cluster.text()).toContain('학습에 사용하는 데이터 기준')
    cluster.unmount()
    const split = mountCanvas(projectFile(), PREP)
    expect(split.text()).toContain('훈련 데이터 기준')
    expect(split.text()).not.toContain('학습에 사용하는 데이터 기준')
    split.unmount()
  })
})
