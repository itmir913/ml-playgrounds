/**
 * 안내문 렌더링과 살균 (`project/portfolio-markdown.ts`, mlpx-spec.md §8.1).
 *
 * **여기가 남이 준 글을 HTML로 바꾸는 유일한 자리다.** 양식은 파일로도 주소로도
 * 들어오고 어느 입구로 들어왔든 이 함수 하나를 지난다 - 그래서 검사도 입구가 아니라
 * 이 함수에 건다.
 *
 * **살아나야 하는 것도 함께 본다.** 다 막는 것은 쉽고, 그러면 안내문에 목록 하나
 * 못 쓴다.
 */

import { describe, expect, it } from 'vitest'

import { renderGuidance } from '../src/project/portfolio-markdown'

describe('마크다운은 살아난다', () => {
  it('목록과 강조가 그대로 보인다', () => {
    const html = renderGuidance('- 하나\n- **둘**')
    expect(html).toContain('<li>하나</li>')
    expect(html).toContain('<strong>둘</strong>')
  })

  it('표도 살아난다 - 안내문에 들어갈 수 있다고 명세가 말한다', () => {
    const html = renderGuidance('| 값 | 뜻 |\n|---|---|\n| 1 | 하나 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>하나</td>')
  })
})

describe('엔터는 줄바꿈이다', () => {
  it('세 줄을 치면 세 줄로 나온다 - 쓰는 사람은 마크다운을 모른다', () => {
    const html = renderGuidance('첫번째\n두번째\n세번째')
    expect(html.match(/<br>/g) ?? []).toHaveLength(2)
    expect(html).toContain('첫번째')
    expect(html).toContain('세번째')
  })

  it('빈 줄은 그대로 문단을 나눈다', () => {
    const html = renderGuidance('첫 문단\n\n둘째 문단')
    expect(html.match(/<p>/g) ?? []).toHaveLength(2)
  })
})

describe('남이 준 글은 살균을 거친다', () => {
  it('raw HTML은 통과하지 못한다', () => {
    const html = renderGuidance('<script>alert(1)</script>\n\n<b>굵게</b>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    // 글자로는 남는다. 지우면 무엇이 있었는지도 모른다.
    expect(html).toContain('alert(1)')
  })

  it('속성을 심는 HTML도 태그가 되지 못한다', () => {
    const html = renderGuidance('<img src=x onerror="alert(1)">')
    // **글자로는 남는다.** 지우면 무엇이 있었는지도 모른다 - 중요한 것은 태그가
    // 아니라는 것이고, 태그가 아니면 `onerror`도 그냥 글자다.
    expect(html).not.toMatch(/<img/i)
    expect(html).toContain('&lt;img')
  })

  it('javascript: 링크는 링크가 아니다', () => {
    const html = renderGuidance('[누르지 마세요](javascript:alert(1))')
    expect(html).not.toContain('href')
    expect(html).toContain('누르지 마세요')
  })

  it('data: 링크도 막는다 - 페이지를 통째로 실어 나를 수 있다', () => {
    expect(renderGuidance('[열기](data:text/html;base64,PHNjcmlwdD4=)')).not.toContain('href')
  })

  it('상대 경로도 링크가 아니다 - 우리 앱 안을 가리키게 두지 않는다', () => {
    expect(renderGuidance('[안으로](/project/1)')).not.toContain('href')
  })

  /**
   * **허용 목록이 앵커로 시작하는지를 본다.**
   *
   * 위 세 페이로드에는 `https://`가 글자로 하나도 안 들어 있어서, 정규식에서
   * 앵커(`^`)를 지워도 셋 다 그대로 막혔다 — 즉 검사들이 "프로토콜이 **앞에**
   * 있는가"가 아니라 "이 특정 세 문자열이 안 지나가는가"만 봤다 (R9 감사 A-2).
   * 앵커를 지운 상태로 실제 렌더링하면 `href="javascript:…"`가 나간다.
   *
   * 양식은 **파일에서 가져오기**로 남이 준 `.md`가 그대로 들어오고, 그 결과가
   * `v-html`에 들어간다. 저장소에서 스크립트 주입 표면이 여기 하나다.
   */
  it('허용 프로토콜이 뒤에 섞여 있어도 링크가 아니다', () => {
    expect(renderGuidance("[x](javascript:fetch('https://a.example'))")).not.toContain('href')
    expect(renderGuidance('[x](data:text/html,https://a.example)')).not.toContain('href')
  })
})

describe('링크는 누를 수 있되 조건이 붙는다', () => {
  const html = renderGuidance('[자료](https://example.org/자료)')

  it('http·https는 링크가 된다', () => {
    expect(html).toContain('href="https://example.org/')
  })

  it('새 탭에서 열린다 - 쓰던 글이 있는 탭을 남의 주소가 가져가면 안 된다', () => {
    expect(html).toContain('target="_blank"')
  })

  it('rel이 붙는다', () => {
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('우리가 주소를 링크로 만들지는 않는다', () => {
    // 글 안의 주소를 링크로 바꾸는 것은 우리 판단이지 쓴 사람의 뜻이 아니다.
    expect(renderGuidance('https://example.org 를 보세요')).not.toContain('<a ')
  })
})

describe('그림은 그리지 않는다', () => {
  it('원격 이미지가 요청으로 나가지 않는다', () => {
    const html = renderGuidance('![고양이](https://example.org/cat.png)')
    expect(html).not.toMatch(/<img/i)
    // 글자로는 남는다 - 무엇을 넣으려 했는지는 보인다.
    expect(html).toContain('고양이')
  })
})
