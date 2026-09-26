// @vitest-environment jsdom
// `v-html`이 그린 DOM을 재는 스펙이라 DOM이 필요하다.
/**
 * **안내문 칸이 살균된 것만 그리는가** (`views/portfolio/GuidanceText.vue`).
 *
 * 살균 규칙 자체는 `portfolio-markdown.spec.ts`가 함수로 잰다. 여기서 재는 것은 **이 저장소에
 * 하나뿐인 `v-html` 자리가 그 함수를 지나는가**다 — 칸이 `props.markdown`을 그대로 꽂아도
 * 함수 검사는 초록이다. 안내문은 가져온 양식 파일에서 오므로 학생이 고르지 않은 글이다.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import GuidanceText from '../src/views/portfolio/GuidanceText.vue'

function render(markdown: string) {
  return mount(GuidanceText, { props: { markdown } })
}

describe('안내문 칸은 살균된 것만 그린다', () => {
  it('글 속의 HTML 태그가 요소가 되지 않는다', () => {
    const view = render('앞 <img src=x onerror="alert(1)"> 뒤')

    expect(view.find('img').exists()).toBe(false)
    expect(view.find('[onerror]').exists()).toBe(false)
  })

  it('javascript: 링크가 주소로 살지 않는다', () => {
    const view = render('[눌러 보세요](javascript:alert(1)) <a href="javascript:alert(2)">여기</a>')

    const hrefs = view.findAll('a').map((one) => one.attributes('href') ?? '')
    expect(hrefs.filter((href) => href.toLowerCase().startsWith('javascript'))).toEqual([])
  })

  it('서식은 산다', () => {
    const view = render('**굵게**')

    expect(view.find('strong').text()).toBe('굵게')
  })
})
