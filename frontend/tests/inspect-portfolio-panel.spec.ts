// @vitest-environment jsdom
// 판이 무엇을 그리는지 재는 스펙이라 DOM이 필요하다.
/**
 * **점검의 포트폴리오 판이 낸 것을 덮지 않는가** (`views/inspect/PortfolioPanel.vue`).
 *
 * 글이 없어도 사진이나 지금 양식에 없는 문항의 답이 있으면 그것이 학생이 낸 것이다 —
 * "아직 쓴 글이 없습니다"로 덮으면 교사는 그것을 못 본다.
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import type { Portfolio } from '../src/project/schema'
import PortfolioPanel from '../src/views/inspect/PortfolioPanel.vue'
import PortfolioPreview from '../src/views/portfolio/PortfolioPreview.vue'
import { stubObjectUrls } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

const PHOTO = 'portfolio/attachments/1.webp'

function withPortfolio(portfolio: Portfolio, attachments = new Map<string, Uint8Array>()) {
  const base = projectFile()
  const file: ProjectFile = {
    ...base,
    attachments,
    document: { ...base.document, portfolio },
  }
  return mount(PortfolioPanel, { props: { file }, global: { plugins: [i18n] } })
}

const EMPTY = () => i18n.global.t('inspect.portfolioEmpty')

beforeEach(async () => {
  stubObjectUrls()
  await setLocale('ko')
})

describe('점검 포트폴리오 판은 낸 것을 덮지 않는다', () => {
  it('글 없이 사진만 붙인 문항도 그린다', () => {
    const panel = withPortfolio(
      {
        template: { sections: [{ id: 'motivation', title: '동기' }] },
        answerFormat: 'plain-v1',
        answers: {},
        attachments: { motivation: [PHOTO] },
      },
      new Map([[PHOTO, new Uint8Array([1, 2, 3])]]),
    )

    expect(panel.findComponent(PortfolioPreview).exists()).toBe(true)
    expect(panel.find('img').exists()).toBe(true)
    expect(panel.text()).not.toContain(EMPTY())
  })

  it('지금 양식에 없는 문항의 답만 있어도 그린다', () => {
    const panel = withPortfolio({
      template: { sections: [] },
      answerFormat: 'plain-v1',
      answers: { removed: '예전 문항에 쓴 글' },
      attachments: {},
    })

    expect(panel.findComponent(PortfolioPreview).exists()).toBe(true)
    expect(panel.text()).toContain('예전 문항에 쓴 글')
    expect(panel.text()).not.toContain(EMPTY())
  })

  it('양식만 있고 아무것도 안 냈으면 아직 안 썼다고 말한다', () => {
    const panel = withPortfolio({
      template: { sections: [{ id: 'motivation', title: '동기' }] },
      answerFormat: 'plain-v1',
      answers: { motivation: '   ' },
      attachments: {},
    })

    expect(panel.findComponent(PortfolioPreview).exists()).toBe(false)
    expect(panel.text()).toContain(EMPTY())
  })
})
