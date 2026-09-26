// @vitest-environment jsdom
/**
 * **양식 출처가 실패했을 때** (2026-09-02 R24 B-9).
 *
 * 실패를 되보내는 줄을 지워도 관문이 초록이었다. 그러면 프리셋 `index.json`이 404일 때
 * — **학교망이 막았거나 오프라인일 때** — 목록이 조용히 비고 파일 열기 줄만 남는다.
 * 학생은 프리셋이 원래 없는 줄 안다.
 *
 * `portfolio-view.spec.ts`가 이 부품을 그리기는 해도 `$emit('pick')`을 손으로 흘려
 * **실패 경로를 안 지난다.** 여기서는 출처를 실제로 넘어뜨린다.
 *
 * **한 출처가 실패해도 나머지는 선다** — 그것까지 함께 잰다.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { TemplateRow, TemplateSourceContext } from '../src/project/portfolio-sources'
import { useProjectStore } from '../src/stores/project'
import PortfolioView from '../src/views/PortfolioView.vue'
import TemplateSourceList from '../src/views/portfolio/TemplateSourceList.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

/** 등록부가 무엇을 돌려줄지. **검사가 정한다.** */
const registry = vi.hoisted(() => ({
  rows: [] as unknown[],
  failures: [] as unknown[],
}))

vi.mock('../src/project/portfolio-sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/portfolio-sources')>()
  return {
    ...actual,
    templateRows: async () => ({ rows: registry.rows, failures: registry.failures }),
  }
})

const CONTEXT: TemplateSourceContext = {
  locale: 'ko',
  translate: (key) => key,
  pickFile: () => Promise.resolve(null),
}

function standing(label: string, markdown: string): TemplateRow {
  return {
    key: label,
    label,
    weight: 'normal',
    locale: 'ko',
    load: () => Promise.resolve(markdown),
  } as TemplateRow
}

async function open() {
  const wrapper = mount(TemplateSourceList, {
    props: { context: CONTEXT },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  return wrapper
}

beforeEach(async () => {
  registry.rows = []
  registry.failures = []
  await setLocale('ko')
})

describe('R24 B-9: a template source that fails', () => {
  it('the failure is passed on, and the rows that stood still stand', async () => {
    registry.rows = [standing('빈 양식에서 시작', '## 주제\n')]
    registry.failures = [new Error('index.json 404')]
    const wrapper = await open()

    expect(wrapper.findAll('button').map((one) => one.text())).toEqual(['빈 양식에서 시작'])
    // **조용히 넘기지 않는다** — 누른 사람은 무슨 일이 있었는지 알아야 한다.
    expect(wrapper.emitted('failed')).toHaveLength(1)
  })

  it('nothing failed: nothing is said', async () => {
    registry.rows = [standing('빈 양식에서 시작', '## 주제\n')]
    const wrapper = await open()

    expect(wrapper.emitted('failed')).toBeUndefined()
  })

  it('the row itself throws while loading: that is passed on too', async () => {
    registry.rows = [
      {
        key: 'x',
        label: '양식 가져오기',
        weight: 'lead',
        load: () => Promise.reject(new Error('boom')),
      } as TemplateRow,
    ]
    const wrapper = await open()

    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('pick')).toBeUndefined()
    expect(wrapper.emitted('failed')).toHaveLength(1)
  })
})

/**
 * **양식 언어가 시작 화면의 줄에서 파일까지 가는가** (mlpx-spec.md §8.5).
 *
 * `portfolio-view.spec.ts`의 *"언어까지 함께 간다"*는 메뉴 한 칸만 잰다 — 줄이 언어를
 * 떨어뜨리거나 화면이 받은 언어를 안 넘겨도 초록이다. 여기서는 빈 포트폴리오의 시작
 * 화면에서 줄을 실제로 눌러 **파일의 `template.locale`**을 본다. 줄의 언어를 프로젝트
 * 언어와 다르게 둬야 어디서 왔는지 가려진다.
 */
describe('양식 언어는 시작 화면의 줄에서 파일까지 간다', () => {
  it('눌린 줄의 언어가 template.locale에 적힌다', async () => {
    setActivePinia(createPinia())
    stubDialogElement()
    const english = { ...standing('English form', '## Topic\n'), locale: 'en' } as TemplateRow
    registry.rows = [english]
    const base = projectFile()
    useProjectStore().file = {
      ...base,
      document: {
        ...base.document,
        portfolio: {
          template: { sections: [] },
          answerFormat: 'plain-v1',
          answers: {},
          attachments: {},
        },
      },
    }
    const view = mount(PortfolioView, { global: { plugins: [i18n] }, attachTo: document.body })

    const trigger = view.findAll('button').find((one) => one.text() === '양식 가져오기')
    expect(trigger?.exists(), 'the start screen offers the import menu').toBe(true)
    await trigger?.trigger('click')
    await flushPromises()
    const list = view.findComponent(TemplateSourceList)
    const row = list.findAll('button').find((one) => one.text() === 'English form')
    expect(row?.exists(), 'the list shows the row').toBe(true)
    await row?.trigger('click')
    await flushPromises()

    const template = useProjectStore().file?.document.portfolio.template
    expect(template?.sections.map((one) => one.title)).toEqual(['Topic'])
    expect(template?.locale).toBe('en')
    view.unmount()
  })
})
