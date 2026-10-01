// @vitest-environment jsdom
// 판이 무엇을 그리는지 재는 스펙이라 DOM이 필요하다.
/**
 * **점검의 포트폴리오 판이 낸 것을 덮지 않는가** (`views/inspect/PortfolioPanel.vue`).
 *
 * 글이 없어도 사진이나 지금 양식에 없는 문항의 답이 있으면 그것이 학생이 낸 것이다 —
 * 빈 글 문장(`inspect.portfolioEmpty`)으로 덮으면 교사는 그것을 못 본다.
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

  /**
   * **답 안의 공백을 접지 않는다** (mlpx-spec.md §8.3). `pre-line`은 줄바꿈만 살리고 줄머리
   * 들여쓰기와 이어진 공백을 하나로 접는다 — 파이썬 코드의 들여쓰기가 교사 화면에서 사라졌다.
   * jsdom은 CSS를 계산하지 않으므로 글이 앉은 요소의 공백 규칙 클래스를 본다. 이 판과 학생의
   * [완성본]은 같은 부품(`PortfolioPreview`)이고, 지금 양식에 없는 답(`OrphanAnswers`)도 같이 잰다.
   *
   * **살리는 것은 둘째 줄부터다.** 두 부품이 답을 `trim()`해 앉히므로 첫 줄 앞의 들여쓰기는 걷힌다 — 그대로
   * 두기로 했다(open-decisions.md 91). 그래서 여기 답은 첫 줄이 들여쓰기 없이 시작한다.
   */
  it('답 안의 공백과 둘째 줄부터의 들여쓰기를 접지 않는다', () => {
    const code = 'for i in range(3):\n    print(i)    # a  b'
    const orphan = '예전 답\n\tx  =  1'
    const panel = withPortfolio({
      template: { sections: [{ id: 'motivation', title: '동기' }] },
      answerFormat: 'plain-v1',
      answers: { motivation: code, removed: orphan },
      attachments: {},
    })

    for (const text of [code, orphan]) {
      const holders = panel.findAll('p').filter((one) => one.element.textContent === text)
      expect(holders).toHaveLength(1)
      const rules = holders[0]!.classes().filter((one) => one.startsWith('whitespace-'))
      expect(rules).toEqual(['whitespace-pre-wrap'])
    }
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
