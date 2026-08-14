/**
 * 포트폴리오의 문항과 답 (mlpx-spec.md §8).
 *
 * **여기서 지키려는 것은 글이 사라지지 않는 것이다.** 글을 잃는 방법은 "지우기"
 * 하나뿐이어야 하고(§8.4), 나머지 동작 - 가져오기·순서 바꾸기·제목 고치기 - 은
 * 어느 것도 답을 건드리면 안 된다.
 */

import { describe, expect, it } from 'vitest'

import { newProjectDocument } from '../src/project/create'
import { parsePortfolioForm } from '../src/project/portfolio-form'
import { portfolioMarkdownText } from '../src/project/portfolio-text'
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
