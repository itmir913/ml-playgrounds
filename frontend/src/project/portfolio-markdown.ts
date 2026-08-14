/**
 * 안내문을 그린다 (mlpx-spec.md §8.1).
 *
 * **여기가 이 저장소에서 남이 준 글을 HTML로 바꾸는 유일한 자리다.** 양식은 파일로도
 * 주소로도 들어오므로 **어느 입구로 들어왔든 같은 경로를 탄다** - 입구가 늘었다고
 * 방어선이 갈라지면 그 자리가 곧 구멍이다.
 *
 * **답은 여기 안 온다.** 답은 서식 없는 글이고 화면이 글자 그대로 보여준다 (§8).
 * 그래서 렌더링은 한 방향이고, 문법 편집기도 미리보기 전환도 없다.
 *
 * **markdown-it을 고른 이유는 기본값이 지키는 쪽이기 때문이다**
 * (`open-decisions.md` "마크다운 렌더러는 markdown-it이다"). `html: false`가 기본이고
 * 링크 프로토콜 검사도 기본으로 켜져 있다. marked는 HTML을 통과시키는 것이 기본이라
 * 살균기가 하중을 받는 부재가 된다.
 *
 * 우리가 더 좁힌 것 셋 -
 *
 * 1. **링크는 `http`·`https`만.** 나머지는 글자로 남는다(markdown-it이 그렇게 떨어뜨린다).
 * 2. **링크는 새 탭에서 열리고 `rel="noopener noreferrer"`가 붙는다.** 쓰던 글이 있는
 *    탭을 남의 주소가 가져가면 안 된다.
 * 3. **그림은 그리지 않는다.** 원격 이미지는 우리 페이지가 남의 서버에 요청을 보내는
 *    것이고 추적 픽셀과 구분할 수 없다. 사진은 답에 붙는 것이고 파일 안에 담긴다.
 * 4. **엔터는 줄바꿈이다**(`breaks: true`). CommonMark은 홑 개행을 공백으로 보는데,
 *    이 화면에서 안내문을 고치는 사람은 마크다운을 모른다 - 엔터를 쳤는데 한 줄로
 *    붙으면 그건 문법이 아니라 고장으로 읽힌다. **대가는 원본이 80칸에서 접혀 있을
 *    때 접은 자리마다 줄이 바뀌는 것이고**, 그건 파일에 보이는 그대로 나오는 것이라
 *    설명할 수 있다. 상호 변환을 접은 이유는 `open-decisions.md`에 있다.
 *
 * **우리가 주소를 링크로 만들지는 않는다**(`linkify`를 안 켠다). 글 안의 주소를 링크로
 * 바꾸는 것은 우리 판단이지 쓴 사람의 뜻이 아니다.
 */

import MarkdownIt from 'markdown-it'

/** 링크로 인정하는 프로토콜. 상대 경로도 여기서 떨어진다 - 우리 앱 안을 가리키게 두지 않는다. */
const ALLOWED_LINK = /^https?:\/\//i

const renderer = new MarkdownIt({ html: false, linkify: false, breaks: true })

renderer.validateLink = (url) => ALLOWED_LINK.test(url.trim())

// 그림은 규칙째 끈다. `![대체글](주소)`는 글자 그대로 남는다.
renderer.disable('image')

renderer.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  token?.attrSet('target', '_blank')
  token?.attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, index, options)
}

/**
 * 안내문 마크다운을 HTML로. **이 결과만 `v-html`에 들어간다**
 * (`tests/ui-rules.spec.ts`가 다른 자리의 `v-html`을 막는다).
 */
export function renderGuidance(markdown: string): string {
  return renderer.render(markdown)
}
