/**
 * 포트폴리오의 문항과 답 (mlpx-spec.md §8).
 *
 * **여기서 지키려는 것은 글이 사라지지 않는 것이다.** 글을 잃는 방법은 "지우기"
 * 하나뿐이어야 하고(§8.4), 나머지 동작 - 가져오기·순서 바꾸기·제목 고치기 - 은
 * 어느 것도 답을 건드리면 안 된다.
 */

import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import { newProjectDocument } from '../src/project/create'
import { parsePortfolioForm } from '../src/project/portfolio-form'
import { withIdentity } from '../src/project/identity'
import { identifiedExport, portfolioMarkdownText } from '../src/project/portfolio-text'
import {
  attachmentsOf,
  hasTemplate,
  isPortfolioAnswered,
  nextAttachmentPath,
  portfolioBytes,
  orphanAnswers,
  portfolioSections,
  portfolioTextBytes,
  renderPortfolioMarkdown,
  sectionIdFor,
  withAnswer,
  withImportedSections,
  withSectionAdded,
  withSectionMoved,
  withSectionRemoved,
  withAttachmentAdded,
  withAttachmentRemoved,
  withSectionText,
  type PortfolioMarkdownText,
} from '../src/project/portfolio'
import type { Portfolio } from '../src/project/schema'

function portfolio(
  sections: { id: string; title: string; description?: string }[],
  answers: Record<string, string> = {},
): Portfolio {
  return { template: { sections }, answerFormat: 'plain-v1', answers, attachments: {} }
}

const TEXT: PortfolioMarkdownText = {
  title: '붓꽃 품종 분류',
  rows: [['만든 날짜', '2026-08-14']],
  orphanTitle: '이전 문항의 답',
}

describe('문항 id는 제목 슬러그다', () => {
  it('제목에서 만든다', () => {
    expect(sectionIdFor('이 주제를 선택한 이유', 0)).toBe('이-주제를-선택한-이유')
    expect(sectionIdFor('Why This Topic', 0)).toBe('why-this-topic')
  })

  it('기호만 있는 제목은 순번으로 떨어진다', () => {
    expect(sectionIdFor('???', 2)).toBe('section-3')
    expect(sectionIdFor('   ', 0)).toBe('section-1')
  })

  it('앞뒤 기호는 id에 안 남는다', () => {
    expect(sectionIdFor('  1. 느낀 점!  ', 0)).toBe('1-느낀-점')
  })
})

describe('가져오기는 대체가 아니라 추가다', () => {
  const drafts = [{ title: '동기', description: '왜 골랐는지' }, { title: '느낀 점' }]

  it('쓰던 문항 뒤에 붙는다', () => {
    const before = portfolio([{ id: '내-문항', title: '내 문항' }], { '내-문항': '내 글' })
    const after = withImportedSections(before, drafts)
    expect(after.template.sections.map((section) => section.id)).toEqual([
      '내-문항',
      '동기',
      '느낀-점',
    ])
    expect(after.answers['내-문항']).toBe('내 글')
  })

  it('두 번 가져와도 문항이 안 불어난다', () => {
    const once = withImportedSections(portfolio([]), drafts)
    const twice = withImportedSections(once, drafts)
    expect(twice.template.sections).toHaveLength(2)
  })

  it('두 번째 가져오기가 쓴 글을 안 흔든다', () => {
    const once = withAnswer(withImportedSections(portfolio([]), drafts), '동기', '꽃이 좋아서')
    const twice = withImportedSections(once, drafts)
    expect(twice.answers['동기']).toBe('꽃이 좋아서')
    expect(twice.template.sections[0]!.description).toBe('왜 골랐는지')
  })

  it('양식에 박힌 id가 있으면 그것을 쓴다 - 제목을 다듬어도 답이 붙어 있다', () => {
    const after = withImportedSections(portfolio([]), [
      { id: '동기', title: '이 주제를 고른 까닭' },
    ])
    expect(after.template.sections[0]!.id).toBe('동기')
  })

  /**
   * **밖에 이미 있던 것과 이번 묶음 안의 충돌은 다른 일이다** (§8.2 대 §8.3).
   *
   * 건너뛰기가 둘 다에 걸려 있어서 **교사가 준 양식의 문항이 안내문째 말없이
   * 빠졌다.** 화면은 그때도 "가져왔습니다"라고 정상 보고한다 (R14-1 감사 A-1).
   */
  it('한 양식 안에서 제목이 겹치면 번호를 붙인다 - 뒤엣것이 사라지지 않는다', () => {
    const after = withImportedSections(portfolio([]), [
      { title: '느낀 점', description: '첫 안내문' },
      { title: '느낀 점', description: '둘째 안내문' },
    ])
    expect(after.template.sections).toEqual([
      { id: '느낀-점', title: '느낀 점', description: '첫 안내문' },
      { id: '느낀-점-2', title: '느낀 점', description: '둘째 안내문' },
    ])
  })

  it('슬러그가 같아지는 제목도 겹침이다 - 눈에는 다르게 보인다', () => {
    const after = withImportedSections(portfolio([]), [{ title: '결과' }, { title: '결과?' }])
    expect(after.template.sections.map((section) => section.id)).toEqual(['결과', '결과-2'])
  })

  it('겹치는 문항이 든 양식도 두 번 가져오면 안 불어난다', () => {
    const drafts = [{ title: '느낀 점' }, { title: '느낀 점' }]
    const once = withImportedSections(portfolio([]), drafts)
    expect(withImportedSections(once, drafts)).toBe(once)
  })
})

describe('사람이 더하는 것은 건너뛰지 않는다', () => {
  it('제목이 같아도 문항이 하나 는다', () => {
    const before = withSectionAdded(portfolio([]), { title: '새 문항' })
    const after = withSectionAdded(before, { title: '새 문항' })
    expect(after.template.sections.map((section) => section.id)).toEqual(['새-문항', '새-문항-2'])
  })
})

describe('문항을 지우면 그 글도 지운다', () => {
  it('답이 함께 사라진다', () => {
    const before = portfolio([{ id: '동기', title: '동기' }], { 동기: '꽃이 좋아서' })
    const after = withSectionRemoved(before, '동기')
    expect(after.template.sections).toEqual([])
    expect(after.answers).toEqual({})
  })

  it('없는 id를 지우면 아무 일도 안 일어난다', () => {
    const before = portfolio([{ id: '동기', title: '동기' }])
    expect(withSectionRemoved(before, '없는-것')).toBe(before)
  })
})

describe('글이 사라지는 다른 경로는 없다', () => {
  const before = portfolio(
    [
      { id: 'a', title: '첫 문항' },
      { id: 'b', title: '둘째 문항' },
    ],
    { a: '첫 글', b: '둘째 글' },
  )

  it('순서를 바꿔도 답이 따라간다', () => {
    const after = withSectionMoved(before, 'b', -1)
    expect(after.template.sections.map((section) => section.id)).toEqual(['b', 'a'])
    expect(after.answers).toEqual({ a: '첫 글', b: '둘째 글' })
  })

  it('끝에서 더 가면 아무 일도 안 일어난다', () => {
    expect(withSectionMoved(before, 'a', -1)).toBe(before)
    expect(withSectionMoved(before, 'b', 1)).toBe(before)
  })

  it('제목을 고쳐도 id는 그대로다', () => {
    const after = withSectionText(before, 'a', { title: '아주 다른 제목' })
    expect(after.template.sections[0]!).toEqual({ id: 'a', title: '아주 다른 제목' })
    expect(after.answers['a']).toBe('첫 글')
  })

  it('안내문에 줄바꿈을 칠 수 있다 - 다듬는 것은 읽는 쪽이 한다', () => {
    // 타자마다 trim을 걸었더니 끝에 친 줄바꿈이 잘려 저장됐고, Vue가 DOM의 지금 값과
    // 새 값을 견주면서 칸을 다시 써 **줄바꿈이 안 쳐졌다** (2026-08-14).
    const after = withSectionText(before, 'a', { description: '첫 줄\n' })
    expect(after.template.sections[0]!.description).toBe('첫 줄\n')
  })

  it('제목 끝의 공백도 안 지운다 - 같은 이유다', () => {
    expect(withSectionText(before, 'a', { title: '제목 ' }).template.sections[0]!.title).toBe(
      '제목 ',
    )
  })

  it('안내문을 비우면 자리 자체가 사라진다 - 빈 문자열을 파일에 남기지 않는다', () => {
    const withNote = withSectionText(before, 'a', { description: '이렇게 쓰세요' })
    expect(withNote.template.sections[0]!.description).toBe('이렇게 쓰세요')
    const cleared = withSectionText(withNote, 'a', { description: '  ' })
    expect(cleared.template.sections[0]!).toEqual({ id: 'a', title: '첫 문항' })
  })
})

describe('지금 양식에 없는 답은 버리지 않는다', () => {
  const before = portfolio([{ id: 'a', title: '첫 문항' }], {
    a: '첫 글',
    옛것: '남의 파일에서 온 글',
  })

  it('이전 문항의 답으로 나온다', () => {
    expect(orphanAnswers(before)).toEqual([{ id: '옛것', answer: '남의 파일에서 온 글' }])
  })

  it('빈 답은 세지 않는다 - 보여줄 글이 없다', () => {
    expect(orphanAnswers(portfolio([], { 옛것: '   ' }))).toEqual([])
  })

  it('완료 판정에는 안 센다', () => {
    expect(isPortfolioAnswered(before)).toBe(true)
  })
})

describe('완료는 모든 문항에 답이 있는 것이다', () => {
  it('한 글자라도 쓴 것으로는 안 된다', () => {
    const before = portfolio(
      [
        { id: 'a', title: '첫 문항' },
        { id: 'b', title: '둘째 문항' },
      ],
      { a: '썼다' },
    )
    expect(isPortfolioAnswered(before)).toBe(false)
  })

  it('공백만 쓴 것은 안 쓴 것이다', () => {
    expect(isPortfolioAnswered(portfolio([{ id: 'a', title: 'a' }], { a: ' \n ' }))).toBe(false)
  })

  it('문항을 새로 추가하면 다시 풀린다', () => {
    const done = portfolio([{ id: 'a', title: 'a' }], { a: '썼다' })
    expect(isPortfolioAnswered(done)).toBe(true)
    expect(isPortfolioAnswered(withSectionAdded(done, { title: '새 문항' }))).toBe(false)
  })

  it('양식을 아직 고르지 않았으면 완료가 아니다', () => {
    // 빈 양식에 답이 하나도 없는 것과 "다 썼다"는 다르다.
    expect(hasTemplate(portfolio([]))).toBe(false)
    expect(isPortfolioAnswered(portfolio([]))).toBe(false)
  })
})

describe('사진은 답 아래에 붙는다', () => {
  const before = portfolio([{ id: 'a', title: '첫 문항' }])

  it('붙인 순서가 곧 보이는 순서다', () => {
    const one = withAttachmentAdded(before, 'a', 'portfolio/attachments/1.webp')
    const two = withAttachmentAdded(one, 'a', 'portfolio/attachments/2.webp')
    expect(attachmentsOf(two, 'a')).toEqual([
      'portfolio/attachments/1.webp',
      'portfolio/attachments/2.webp',
    ])
  })

  it('번호는 있는 것들의 최대값 + 1이다 - 지웠다 붙여도 안 되풀이한다', () => {
    const two = withAttachmentAdded(
      withAttachmentAdded(before, 'a', 'portfolio/attachments/1.webp'),
      'a',
      'portfolio/attachments/2.webp',
    )
    const removed = withAttachmentRemoved(two, 'a', 'portfolio/attachments/2.webp')
    expect(nextAttachmentPath(removed, '.webp')).toBe('portfolio/attachments/2.webp')
    expect(nextAttachmentPath(two, '.webp')).toBe('portfolio/attachments/3.webp')
  })

  it('굽는 형식이 갈려도 이름은 그 형식을 따른다', () => {
    expect(nextAttachmentPath(before, '.jpg')).toBe('portfolio/attachments/1.jpg')
  })

  it('마지막 한 장을 떼면 그 문항의 자리도 없앤다', () => {
    const one = withAttachmentAdded(before, 'a', 'portfolio/attachments/1.webp')
    expect(withAttachmentRemoved(one, 'a', 'portfolio/attachments/1.webp').attachments).toEqual({})
  })

  it('문항을 지우면 사진도 함께 사라진다', () => {
    const one = withAttachmentAdded(before, 'a', 'portfolio/attachments/1.webp')
    expect(withSectionRemoved(one, 'a').attachments).toEqual({})
  })
})

describe('상한은 글과 첨부를 합쳐 하나다', () => {
  it('문항 문구와 답을 함께 센다', () => {
    const before = portfolio([{ id: 'a', title: 'ab', description: 'cd' }], { a: 'ef' })
    expect(portfolioTextBytes(before)).toBe(6)
  })

  it('한글은 글자당 세 바이트다 - 길이가 아니라 바이트를 센다', () => {
    expect(portfolioTextBytes(portfolio([], { a: '글' }))).toBe(3)
  })

  it('사진 바이트가 같은 상한에 합류한다', () => {
    const before = withAttachmentAdded(
      portfolio([{ id: 'a', title: 'ab' }], { a: 'ef' }),
      'a',
      'portfolio/attachments/1.webp',
    )
    const bytes = new Map([['portfolio/attachments/1.webp', new Uint8Array(100)]])
    expect(portfolioBytes(before, bytes)).toBe(4 + 100)
  })

  it('아무도 안 가리키는 사진은 안 센다 - 뗀 사진이 자리를 계속 먹으면 안 된다', () => {
    const bytes = new Map([['portfolio/attachments/9.webp', new Uint8Array(100)]])
    expect(portfolioBytes(portfolio([], { a: '글' }), bytes)).toBe(3)
  })
})

describe('마크다운으로 옮긴다', () => {
  it('머리에 프로젝트 정보를 적는다', () => {
    const markdown = renderPortfolioMarkdown(TEXT, portfolio([]))
    expect(markdown.startsWith('# 붓꽃 품종 분류\n')).toBe(true)
    expect(markdown).toContain('- **만든 날짜**: 2026-08-14')
  })

  it('안 쓴 문항도 제목은 남긴다', () => {
    // 받은 파일에 "느낀 점"이 없으면 안 쓴 것인지 문항이 없었던 것인지 알 수 없다.
    const markdown = renderPortfolioMarkdown(TEXT, portfolio([{ id: 'a', title: '느낀 점' }]))
    expect(markdown).toContain('## 느낀 점')
  })

  it('학생이 쓴 목록과 강조는 그대로 살아난다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '- 꽃이 **좋아서**' }),
    )
    expect(markdown).toContain('- 꽃이 **좋아서**')
  })

  it('줄머리의 #은 막는다 - 답이 문항 제목이 되면 구조가 깨진다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '## 가짜 문항\n본문 속 #은 그대로' }),
    )
    expect(markdown).toContain('\\## 가짜 문항')
    expect(markdown).toContain('본문 속 #은 그대로')
  })

  it('단독으로 선 ---와 ===도 막는다 - 앞줄이 제목이 된다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '앞줄\n---\n다음\n===' }),
    )
    expect(markdown).toContain('\\---')
    expect(markdown).toContain('\\===')
  })

  /**
   * **밖에서 렌더링해서 잰다.** 위 검사처럼 `toContain('\\---')`으로 보면 **글자가
   * 있는지**만 알 뿐 **제목이 생겼는지**는 못 본다. 그래서 홑 `-` 하나가 앞줄을
   * `<h2>`로 만드는 것을 저장소가 한 번도 못 봤다 (R14-1 감사 A-4).
   *
   * 학생이 목록을 치다 남긴 **빈 항목(`- `)**이 바로 이 모양이다.
   */
  it('홑 -와 =도 막는다 - setext 밑줄에는 최소 길이가 없다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '앞줄\n-\n다음\n=\n목록 뒤\n- ' }),
    )
    const headings = [...new MarkdownIt().render(markdown).matchAll(/<h([12])>([^<]*)</g)].map(
      ([, level, text]) => `h${level}:${text}`,
    )
    expect(headings).toEqual(['h1:붓꽃 품종 분류', 'h2:동기'])
  })

  /**
   * **여는 줄 하나가 뒤따르는 문항을 전부 삼킨다.** 정보 수업에서 코드를 붙여넣는
   * 것은 흔한 일이고, 백틱 셋을 열고 안 닫는 것도 흔하다 - 그러면 교사가 여는
   * `document.md`에서 그 아래 문항이 통째로 사라진다 (R14-1 감사 B-1).
   *
   * **문항이 몇 개 살아남는지를 센다.** 글자를 찾는 단언으로는 못 본다 - 삼켜진
   * 문항의 글자는 코드 블록 안에 그대로 남아 있기 때문이다.
   */
  const titlesIn = (markdown: string) =>
    [...new MarkdownIt().render(markdown).matchAll(/<h2>([^<]*)</g)].map(([, title]) => title)

  it('안 닫은 코드 울타리가 뒤 문항을 안 삼킨다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio(
        [
          { id: 'a', title: '동기' },
          { id: 'b', title: '느낀 점' },
        ],
        {
          a: '```python\nprint(1)',
          b: '잘 됐다',
        },
      ),
    )
    expect(titlesIn(markdown)).toEqual(['동기', '느낀 점'])
  })

  it('안 닫은 물결 울타리와 HTML 주석도 마찬가지다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio(
        [
          { id: 'a', title: '동기' },
          { id: 'b', title: '방법' },
          { id: 'c', title: '느낀 점' },
        ],
        {
          a: '~~~\n표',
          b: '<!-- 메모',
          c: '끝',
        },
      ),
    )
    expect(titlesIn(markdown)).toEqual(['동기', '방법', '느낀 점'])
  })

  it('제대로 닫은 코드 블록은 안 건드린다 - 안의 #도 그대로다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '```python\n# 주석\nprint(1)\n```' }),
    )
    expect(markdown).toContain('# 주석')
    expect(markdown).not.toContain('\\# 주석')
    expect(new MarkdownIt().render(markdown)).toContain('<code')
  })

  it('학생이 일부러 쓴 목록은 그대로 산다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '- 고양이\n- 개' }),
    )
    expect(new MarkdownIt().render(markdown)).toContain('<li>고양이</li>')
  })

  it('사진은 상대 경로로 적는다 - 압축을 푼 자리에서 그대로 맞는다', () => {
    const before = withAttachmentAdded(
      portfolio([{ id: 'a', title: '동기' }], { a: '글' }),
      'a',
      'portfolio/attachments/3.webp',
    )
    expect(renderPortfolioMarkdown(TEXT, before)).toContain('![](attachments/3.webp)')
  })

  it('이전 문항의 답도 파일에 남는다', () => {
    const markdown = renderPortfolioMarkdown(TEXT, portfolio([], { 옛것: '남의 파일에서 온 글' }))
    expect(markdown).toContain('## 이전 문항의 답')
    expect(markdown).toContain('남의 파일에서 온 글')
  })

  it('답을 문항에 붙여 준다', () => {
    expect(portfolioSections(portfolio([{ id: 'a', title: '동기' }], { a: '글' }))).toEqual([
      { id: 'a', title: '동기', answer: '글' },
    ])
  })
})

describe('양식 마크다운을 문항으로 가른다', () => {
  const form = [
    '# 3학년 프로젝트 보고서',
    '',
    '## 이 주제를 선택한 이유',
    '데이터를 고른 과정도 함께 쓰세요.',
    '',
    '- 목록도 안내문이다',
    '',
    '## 느낀 점',
  ].join('\n')

  it('#은 문서 제목이고 ##이 문항이다', () => {
    const parsed = parsePortfolioForm(form)
    expect(parsed.title).toBe('3학년 프로젝트 보고서')
    expect(parsed.sections.map((section) => section.title)).toEqual([
      '이 주제를 선택한 이유',
      '느낀 점',
    ])
  })

  it('다음 ##까지가 그 문항의 안내문이다', () => {
    const parsed = parsePortfolioForm(form)
    expect(parsed.sections[0]!.description).toBe(
      '데이터를 고른 과정도 함께 쓰세요.\n\n- 목록도 안내문이다',
    )
    expect(parsed.sections[1]!.description).toBeUndefined()
  })

  it('###은 문항이 아니다 - 안내문의 일부다', () => {
    const parsed = parsePortfolioForm('## 문항\n### 작은 제목')
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0]!.description).toBe('### 작은 제목')
  })

  it('제목 줄의 {#id}를 읽는다 - 왕복이 무손실이어야 한다', () => {
    const parsed = parsePortfolioForm('## 이 주제를 고른 까닭 {#motivation}\n안내문')
    expect(parsed.sections[0]!.id).toBe('motivation')
    // **제목에는 표기가 안 남는다.** 남으면 학생 화면에 `{#motivation}`이 보인다.
    expect(parsed.sections[0]!.title).toBe('이 주제를 고른 까닭')
    expect(parsed.sections[0]!.description).toBe('안내문')
  })

  it('HTML 주석은 통째로 걷어낸다 - 양식을 쓴 사람의 메모다', () => {
    // 남겨 두면 `html: false`인 렌더러가 그것을 글자로 보여준다 (§8.1·§8.2).
    const parsed = parsePortfolioForm('## 문항\n안내문\n<!-- 여기 고칠 것 -->\n뒷줄')
    expect(parsed.sections[0]!.description).toBe('안내문\n\n뒷줄')
  })

  it('여러 줄에 걸친 주석도 걷어낸다 - 양식 머리말이 그 모양이다', () => {
    const parsed = parsePortfolioForm('<!--\n  메모\n  두 줄\n-->\n\n## 문항\n안내문')
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0]!.description).toBe('안내문')
  })

  it('문항 앞의 글은 버린다 - 어느 문항의 것도 아니다', () => {
    const parsed = parsePortfolioForm('머리말\n\n## 문항')
    expect(parsed.sections).toHaveLength(1)
    expect(parsed.sections[0]!.description).toBeUndefined()
  })

  it('창에서 만든 파일도 읽는다', () => {
    const parsed = parsePortfolioForm('# 제목\r\n\r\n## 문항\r\n안내문\r\n')
    expect(parsed.sections[0]!.title).toBe('문항')
    expect(parsed.sections[0]!.description).toBe('안내문')
  })

  it('맨손으로 쓴 양식은 슬러그로 떨어진다', () => {
    const parsed = parsePortfolioForm('## 느낀 점')
    const after = withImportedSections(portfolio([]), parsed.sections)
    expect(after.template.sections[0]!.id).toBe('느낀-점')
  })
})

describe('머리글은 부르는 쪽이 만든다', () => {
  const manifest = newProjectDocument(
    { name: '붓꽃 품종 분류', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-05T09:00:00Z',
      randomState: 4242,
    },
  ).manifest
  const label = (key: string) => `[${key}]`

  it('언제 만든 것이고 무슨 데이터로 무엇을 했는지가 들어간다', () => {
    const text = portfolioMarkdownText(manifest, label, 'ko')
    expect(text.title).toBe('붓꽃 품종 분류')
    expect(text.rows.map(([labelText]) => labelText)).toEqual([
      '[meta.created]',
      '[meta.updated]',
      '[meta.dataType]',
      '[meta.taskType]',
    ])
    expect(text.rows[2]![1]).toBe('[dataTypes.tabular]')
  })

  it('아직 안 고른 기계학습 유형은 없음이다 - 기본값을 적으면 고른 것처럼 읽힌다', () => {
    expect(portfolioMarkdownText(manifest, label, 'ko').rows[3]![1]).toBe('[meta.none]')
  })

  it('인적사항은 적었을 때만 나온다', () => {
    const withStudent = { ...manifest, student: { name: '김하늘', studentId: '1-2-03' } }
    const rows = portfolioMarkdownText(withStudent, label, 'ko').rows
    expect(rows.map(([, value]) => value)).toContain('김하늘')
    expect(rows.map(([, value]) => value)).toContain('1-2-03')
    expect(portfolioMarkdownText({ ...manifest, student: {} }, label, 'ko').rows).toHaveLength(4)
  })

  it('인적사항이 맨 위다 - 받은 사람이 제일 먼저 찾는 것이다', () => {
    const withStudent = { ...manifest, student: { name: '김하늘', studentId: '1-2-03' } }
    const rows = portfolioMarkdownText(withStudent, label, 'ko').rows
    expect(rows.slice(0, 2)).toEqual([
      ['[identity.studentId]', '1-2-03'],
      ['[identity.studentName]', '김하늘'],
    ])
  })

  it('이름만 적었으면 그 한 줄만 맨 위에 선다', () => {
    const named = { ...manifest, student: { name: '김하늘' } }
    expect(portfolioMarkdownText(named, label, 'ko').rows[0]).toEqual([
      '[identity.studentName]',
      '김하늘',
    ])
  })
})

describe('내보낼 문서와 그 마크다운은 같은 세대다', () => {
  const label = (key: string) => `[${key}]`
  const blank = newProjectDocument(
    { name: '붓꽃 품종 분류', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-05T09:00:00Z',
      randomState: 4242,
    },
  )
  const identity = { name: '붓꽃 품종 분류', studentId: '1-2-03', studentName: '김하늘' }
  const now = '2026-08-15T07:09:39.319Z'

  /**
   * **실물 `.mlpx`가 잡은 결함이다** (2026-08-15). 화면이 `withIdentity`의 반환을 버리고
   * 갱신 전 manifest로 마크다운을 그려서, 학번과 이름을 처음 적고 내보낸 파일의
   * `manifest.json`에는 인적사항이 있는데 `document.md` 머리글에는 없었다.
   */
  it('처음 적은 인적사항이 머리글에 들어간다 - 갱신 전 manifest를 보면 안 된다', () => {
    expect(blank.manifest.student).toBeUndefined()

    const { document, markdown } = identifiedExport(blank, identity, now, label, 'ko')

    expect(document.manifest.student).toEqual({ studentId: '1-2-03', name: '김하늘' })
    expect(markdown).toContain('1-2-03')
    expect(markdown).toContain('김하늘')
  })

  /**
   * 같은 결함의 둘째 증상이고 **이쪽이 결함군 전체를 막는다.** 머리글의 어느 줄이든
   * 갱신 전 문서에서 나오면 여기서 걸린다.
   */
  it('머리글이 문서와 같은 updatedAt을 쓴다', () => {
    const { document, markdown } = identifiedExport(blank, identity, now, label, 'ko')
    const fromDocument = portfolioMarkdownText(document.manifest, label, 'ko')

    expect(document.manifest.updatedAt).toBe(now)
    expect(markdown).toBe(renderPortfolioMarkdown(fromDocument, document.portfolio))
    expect(markdown).not.toBe(
      renderPortfolioMarkdown(portfolioMarkdownText(blank.manifest, label, 'ko'), blank.portfolio),
    )
  })

  it('답은 그대로 실려 나간다', () => {
    const written = { ...blank, portfolio: withAnswer(blank.portfolio, 'topic', '고양이와 개') }
    const { markdown } = identifiedExport(written, identity, now, label, 'ko')
    expect(markdown).toContain('고양이와 개')
  })

  /**
   * **프로젝트에 이름이 없는 상태를 만들지 않는다.** 빈 이름을 그대로 저장하면
   * `projectFileName`이 projectId 앞 8자로 떨어져서, 수거 폴더에서 누구 것인지 알 수
   * 없는 파일이 나온다.
   */
  it('이름을 지우고 저장해도 옛 이름을 지킨다', () => {
    const named = withIdentity(blank, identity, now)
    const cleared = withIdentity(named, { ...identity, name: '   ' }, now)

    expect(cleared.manifest.name).toBe('붓꽃 품종 분류')
  })

  it('빈 학번과 이름은 지운다 - "안 적음"과 "빈칸을 적음"이 같아 보이면 안 된다', () => {
    const named = withIdentity(blank, identity, now)
    const cleared = withIdentity(named, { name: '이름', studentId: '', studentName: '' }, now)

    expect(cleared.manifest.student).toBeUndefined()
  })
})

describe('양식의 언어는 파일에 남는다', () => {
  const drafts = [{ title: '프로젝트 주제', description: '무엇을 예측했나요' }]

  it('처음 가져올 때 박힌다', () => {
    const after = withImportedSections(portfolio([]), drafts, 'ko')
    expect(after.template.locale).toBe('ko')
  })

  /** 밖에서 받은 `.md`는 언어를 모른다. UI 언어를 대신 적으면 추측이 사실로 굳는다. */
  it('모르는 출처는 언어를 안 남긴다', () => {
    const after = withImportedSections(portfolio([]), drafts)
    expect(after.template.locale).toBeUndefined()
    expect(after.template.sections).toHaveLength(1)
  })

  /** 가져오기가 추가라서 섞을 수 있다. 양식의 정체는 그것을 세운 첫 가져오기가 갖는다. */
  it('두 번째 가져오기는 언어를 안 바꾼다', () => {
    const first = withImportedSections(portfolio([]), drafts, 'ko')
    const second = withImportedSections(first, [{ title: 'What I learned' }], 'en')
    expect(second.template.sections).toHaveLength(2)
    expect(second.template.locale).toBe('ko')
  })

  /** 더한 문항이 하나도 없으면 양식은 그대로다 — 언어도 안 생긴다. */
  it('아무것도 안 늘면 아무것도 안 바뀐다', () => {
    const first = withImportedSections(portfolio([]), drafts, 'ko')
    expect(withImportedSections(first, drafts, 'en')).toBe(first)
  })
})

describe('머리글의 언어가 manifest에 남는다', () => {
  const label = (key: string) => `[${key}]`
  const blank = newProjectDocument(
    { name: '붓꽃 품종 분류', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-08-05T09:00:00Z',
      randomState: 4242,
    },
  )
  const identity = { name: '붓꽃 품종 분류', studentId: '', studentName: '' }

  /**
   * **실물 `.mlpx`가 잡았다** (2026-08-15). `locale: "en"`인데 머리글이 한국어인 파일이
   * 나왔다 — 만들 때 한 번 박고 내보낼 때 갱신하지 않았다.
   */
  it('내보낼 때의 언어로 갱신된다', () => {
    expect(blank.manifest.locale).toBe('ko')
    const { document } = identifiedExport(blank, identity, '2026-08-15T07:00:00Z', label, 'en')
    expect(document.manifest.locale).toBe('en')
  })

  /** 양식의 언어는 그것과 별개다 — 여기서 안 흔들린다. */
  it('양식의 언어를 건드리지 않는다', () => {
    const withForm = {
      ...blank,
      portfolio: withImportedSections(blank.portfolio, [{ title: '주제' }], 'ko'),
    }
    const { document } = identifiedExport(withForm, identity, '2026-08-15T07:00:00Z', label, 'en')
    expect(document.manifest.locale).toBe('en')
    expect(document.portfolio.template.locale).toBe('ko')
  })
})
