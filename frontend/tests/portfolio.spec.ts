/**
 * 포트폴리오의 문항과 답 (mlpx-spec.md §8).
 *
 * **여기서 지키려는 것은 글이 사라지지 않는 것이다.** 글을 잃는 방법은 "지우기"
 * 하나뿐이어야 하고(§8.4), 나머지 동작 - 가져오기·순서 바꾸기·제목 고치기 - 은
 * 어느 것도 답을 건드리면 안 된다.
 */

import { readFileSync } from 'node:fs'

import MarkdownIt from 'markdown-it'
import { describe, expect, it } from 'vitest'

import { newProjectDocument } from '../src/project/create'
import { parsePortfolioForm } from '../src/project/portfolio-form'
import { withIdentity } from '../src/project/identity'
import { identifiedExport, portfolioMarkdownText } from '../src/project/portfolio-text'
import {
  attachmentsOf,
  hasTemplate,
  isAppAttachmentPath,
  isPortfolioAnswered,
  nextAttachmentPath,
  portfolioBytes,
  orphanAnswers,
  photosOf,
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
  withoutReleasedAttachments,
  type PortfolioMarkdownText,
} from '../src/project/portfolio'
import type { Portfolio } from '../src/project/schema'
import { DIR, readProject, type ProjectFile } from '../src/project/format'
import { writeProjectBytes } from './fixtures/write'
import { unzipSync } from 'fflate'

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

  /**
   * **빈 포트폴리오에서만 가져오는 픽스처는 이 갈래를 안 지나간다.** 처음 고쳤을 때
   * 그래서 절반만 닫혔다 — 밖에 이미 `느낀-점`이 있으면 양식 안의 둘째 `## 느낀 점`이
   * 여전히 안내문째 사라졌다 (2026-08-31 사각 감사 A-2).
   *
   * 이름을 **묶음 안의 등장 순번**으로 정해야 둘째가 언제나 `느낀-점-2`이고,
   * 그래야 세 번을 가져와도 사본이 안 쌓인다.
   */
  it('밖에 이미 있는 제목과 겹쳐도 둘째 문항이 산다', () => {
    const before = portfolio([{ id: '느낀-점', title: '느낀 점' }], { '느낀-점': '내 글' })
    const after = withImportedSections(before, [
      { title: '느낀 점', description: '첫 안내문' },
      { title: '느낀 점', description: '둘째 안내문' },
    ])
    expect(after.template.sections.map((section) => section.id)).toEqual(['느낀-점', '느낀-점-2'])
    expect(after.answers['느낀-점'], 'the text being written is unchanged').toBe('내 글')
  })

  it('세 번 가져와도 사본이 안 쌓인다 - 번호는 등장 순번이지 남은 자리가 아니다', () => {
    const drafts = [{ title: '느낀 점' }, { title: '다른 것' }, { title: '느낀 점' }]
    let portfolioFile = withImportedSections(portfolio([]), drafts)
    portfolioFile = withImportedSections(portfolioFile, drafts)
    portfolioFile = withImportedSections(portfolioFile, drafts)
    expect(portfolioFile.template.sections.map((section) => section.id)).toEqual([
      '느낀-점',
      '다른-것',
      '느낀-점-2',
    ])
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

  it('번호는 가리키는 것들의 최대값 + 1이다 - 가장 큰 번호를 떼면 그 번호가 다시 쓰인다', () => {
    const two = withAttachmentAdded(
      withAttachmentAdded(before, 'a', 'portfolio/attachments/1.webp'),
      'a',
      'portfolio/attachments/2.webp',
    )
    const removed = withAttachmentRemoved(two, 'a', 'portfolio/attachments/2.webp')
    expect(nextAttachmentPath(removed, '.webp', [])).toBe('portfolio/attachments/2.webp')
    expect(nextAttachmentPath(two, '.webp', [])).toBe('portfolio/attachments/3.webp')
  })

  /** 아무도 안 가리켜도 바이트가 남아 있는 이름은 다시 주지 않는다 — 문항을 지운 뒤가 그렇다. */
  it('바이트로 들고 있는 이름도 센다', () => {
    const stored = ['portfolio/attachments/1.webp', 'portfolio/attachments/5.jpg']
    expect(nextAttachmentPath(before, '.webp', stored)).toBe('portfolio/attachments/6.webp')
  })

  /**
   * **가운데가 빈 번호** (2026-09-23, R37 C-6). 검사 셋이 **구멍 없는 경우만** 봤다 —
   * `[1, 3]`처럼 가운데가 빠진 상태를 지나가는 줄이 하나도 없었다.
   */
  it('가운데가 빈 번호에서도 최대값 + 1이다', () => {
    const gapped = withAttachmentAdded(
      withAttachmentAdded(before, 'a', 'portfolio/attachments/1.webp'),
      'a',
      'portfolio/attachments/3.webp',
    )
    expect(nextAttachmentPath(gapped, '.webp', [])).toBe('portfolio/attachments/4.webp')

    // 가운데를 지워도 최대값은 그대로다 — 구멍을 메우지 않는다.
    const middleGone = withAttachmentRemoved(gapped, 'a', 'portfolio/attachments/1.webp')
    expect(nextAttachmentPath(middleGone, '.webp', [])).toBe('portfolio/attachments/4.webp')
  })

  it('굽는 형식이 갈려도 이름은 그 형식을 따른다', () => {
    expect(nextAttachmentPath(before, '.jpg', [])).toBe('portfolio/attachments/1.jpg')
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

/**
 * **놓는 바이트** — 편집 뒤에 아무도 안 가리키게 된 사진만 놓는다 (2026-09-28 감사 D C-2·C-3).
 *
 * 문항을 지울 때 참조만 떼던 때는 바이트가 브라우저 저장소에 남았고, 사진 하나를 뗄 때
 * 참조를 안 보고 지우던 때는 같은 경로를 가리키는 다른 문항의 사진이 함께 사라졌다.
 */
describe('놓는 바이트', () => {
  const X = 'portfolio/attachments/1.webp'
  const Y = 'portfolio/attachments/2.webp'
  const Z = 'portfolio/attachments/9.webp'
  const stored = new Map([
    [X, new Uint8Array([1])],
    [Y, new Uint8Array([2])],
    [Z, new Uint8Array([9])],
  ])
  const shared: Portfolio = {
    ...portfolio([
      { id: 'a', title: '동기' },
      { id: 'b', title: '방법' },
    ]),
    attachments: { a: [X, Y], b: [X] },
  }

  it('문항을 지우면 그 문항만 가리키던 사진을 놓는다', () => {
    const kept = withoutReleasedAttachments(shared, withSectionRemoved(shared, 'a'), stored)
    expect([...kept.keys()].sort()).toEqual([X, Z])
  })

  it('다른 문항이 아직 가리키는 사진은 떼어도 안 놓는다', () => {
    const kept = withoutReleasedAttachments(shared, withAttachmentRemoved(shared, 'a', X), stored)
    expect([...kept.keys()].sort()).toEqual([X, Y, Z])
  })

  it('원래 아무도 안 가리키던 바이트는 건드리지 않는다', () => {
    const kept = withoutReleasedAttachments(shared, withAttachmentRemoved(shared, 'a', Y), stored)
    expect([...kept.keys()].sort()).toEqual([X, Z])
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
  /**
   * **`html: true`로 렌더링한다.** 기본값은 `html: false`라 `<!--`가 애초에 주석이
   * 안 되고, 그러면 HTML 주석 검사가 **울타리 절반만 보면서 초록**이 된다
   * (2026-08-31 사각 감사 C-6). 이 파일이 나가는 곳은 GitHub·VS Code처럼
   * HTML을 켜 두고 여는 뷰어다.
   */
  const titlesIn = (markdown: string) =>
    [...new MarkdownIt({ html: true }).render(markdown).matchAll(/<h2>([^<]*)</g)].map(
      ([, title]) => title,
    )

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

  /**
   * **닫아 주는 줄이 여는 줄이 될 수 있다.** 처음 고쳤을 때 픽스처가 0열의 백틱
   * 셋뿐이라 아래 셋을 한 번도 안 지나갔고, 그 셋에서는 **고치기 전보다 나빠졌다**
   * (2026-08-31 사각 감사 A-1).
   *
   * - **탭으로 들여쓴 줄은 울타리가 아니다** (CommonMark에서 탭은 네 칸이다).
   *   울타리로 읽으면 없던 것을 닫으려다 진짜 울타리를 연다.
   * - **목록 안 울타리는 0열로 안 닫힌다.** 닫는 줄이 여는 줄의 들여쓰기를 따라야 한다.
   * - **백틱 울타리의 언어 자리에는 백틱이 못 온다.** 그 줄은 코드 스팬이 든 글이다.
   */
  const answersKeepTitles = (answer: string) =>
    titlesIn(
      renderPortfolioMarkdown(
        TEXT,
        portfolio(
          [
            { id: 'a', title: '동기' },
            { id: 'b', title: '방법' },
          ],
          { a: answer, b: '잘 됐다' },
        ),
      ),
    )

  it('탭으로 들여쓴 백틱은 울타리가 아니다 - 닫아 주면 안 된다', () => {
    expect(answersKeepTitles(['설명', '\t```', 'print(1)'].join('\n'))).toEqual(['동기', '방법'])
  })

  /**
   * 울타리로 잘못 읽으면 **그 뒤가 이스케이프를 안 거친다** — 울타리 안에서는
   * 안 하기 때문이다. 그러면 학생이 쓴 `##`이 진짜 문항이 된다.
   */
  it('탭 뒤의 ##도 문항이 되지 않는다', () => {
    expect(answersKeepTitles(['설명', '\t```', '## 가짜 문항'].join('\n'))).toEqual([
      '동기',
      '방법',
    ])
  })

  it('목록 안에 들여쓴 울타리는 통째 감싼다', () => {
    expect(answersKeepTitles(['- 코드:', '  ```python', '  print(1)'].join('\n'))).toEqual([
      '동기',
      '방법',
    ])
  })

  it('언어 자리에 백틱이 있으면 울타리가 아니다 - 코드 스팬이 든 글이다', () => {
    expect(answersKeepTitles(['```js `x`', 'print(1)'].join('\n'))).toEqual(['동기', '방법'])
  })

  it('그 글 안의 ##도 문항이 되지 않는다', () => {
    expect(answersKeepTitles(['```js `x`', '## 가짜 문항', '내용'].join('\n'))).toEqual([
      '동기',
      '방법',
    ])
  })

  /**
   * **들여쓴 줄을 첫 줄에 두지 않는다** (0.35.2 경계 감사 B C-2). 답은 `trim()`을 거쳐 판정에 들어서, 첫 줄의
   * 들여쓰기는 판정 전에 지워진다 — 그 자리에 두면 들여쓰기를 한 번도 안 지난다.
   */
  it('세 칸까지 들여쓴 #도 막는다 - 거기까지는 진짜 제목이다', () => {
    expect(answersKeepTitles(['내용', '   ## 가짜 문항'].join('\n'))).toEqual(['동기', '방법'])
  })

  /**
   * **닫는 울타리 뒤의 스페이스·탭은 닫는다** (0.35.2 경계 감사 B C-4). 안 닫는 것으로 세면 답 끝에 울타리를 더하는데,
   * 뷰어는 이미 닫았으므로 더한 줄이 새 울타리를 열어 뒤 문항을 삼킨다. 닫는 줄을 마지막 줄에 두면 `trim()`이 꼬리
   * 공백을 지우므로 뒤에 글을 둔다. 반대쪽(전각 공백·NBSP는 안 닫는다)은 *"결정 89"* 묶음이 잰다.
   */
  it.each([
    ['스페이스', '  '],
    ['탭', '\t'],
    ['섞임', ' \t '],
  ])('닫는 울타리 뒤의 %s는 닫는다 - 뒤 문항이 산다', (_, tail) => {
    expect(answersKeepTitles(['```', 'x', `\`\`\`${tail}`, '뒤 글'].join('\n'))).toEqual([
      '동기',
      '방법',
    ])
  })

  /**
   * **주석은 세지 않고 훑는다.** 세기만 하면 코드 스팬 안의 `<!--`에 짝이 붙어
   * 제출물에 `-->`가 한 줄 더 생기고, 같은 줄에서 `-->`가 앞설 때는 열린 주석을
   * 놓친다 (2026-08-31 사각 감사 C-5·C-6).
   */
  it('코드 스팬 안의 여는 주석에는 짝을 안 붙인다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: 'HTML 주석은 `<!--` 로 시작한다.' }),
    )
    expect(markdown).not.toContain('-->')
  })

  /**
   * **줄 가운데의 `<!--`는 삼키지 않는다.** 삼킴을 만드는 것은 줄 머리에서 열리는
   * HTML 블록이고, 줄 가운데 것은 `-->`가 없으면 그냥 글자로 남는다. 거기에 짝을
   * 붙여 주면 **학생이 쓴 글이 진짜 주석이 되어 뷰어에서 사라진다**
   * (2026-08-31 사각 감사 A-1).
   *
   * **제목을 세는 것으로는 이 축이 안 갈린다** — 두 방식 모두에서 제목은 살아 있다.
   * 붙는 줄을 직접 본다.
   */
  it('줄 가운데의 여는 주석에는 짝을 안 붙인다 - 붙이면 그 글이 사라진다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '입력 --> 출력 <!-- 메모' }),
    )
    expect(markdown).not.toContain(['-->', ''].join('\n'))
    expect(new MarkdownIt({ html: true }).render(markdown)).toContain('메모')
  })

  /** 줄 머리의 주석만이 뒤를 삼킨다 — 짝을 붙이는 대신 글자로 싣는다 (open-decisions.md 89). */
  it('줄 머리의 여는 주석은 글자로 싣는다 - 짝을 안 붙여도 뒤를 안 삼킨다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio(
        [
          { id: 'a', title: '동기' },
          { id: 'b', title: '방법' },
        ],
        { a: '<!-- 메모', b: '잘 됐다' },
      ),
    )
    expect(markdown).toContain('## 동기\n\n&lt;!-- 메모\n\n## 방법')
    expect(markdown).not.toContain('-->')
    expect(titlesIn(markdown)).toEqual(['동기', '방법'])
  })

  it('같은 줄에서 열고 닫은 주석에는 안 붙인다', () => {
    const markdown = renderPortfolioMarkdown(
      TEXT,
      portfolio([{ id: 'a', title: '동기' }], { a: '<!-- 메모 --> 그리고 글' }),
    )
    expect(markdown.match(/-->/g)).toHaveLength(1)
  })

  /**
   * **빈 줄로 안 끝나는 HTML 블록이 뒤 문항을 안 삼킨다** (2026-09-28 감사 D A-1).
   *
   * 주석만 막던 때 CommonMark의 HTML 블록 유형 1·3·4·5는 그대로였다 — `<pre>는 …`로
   * 시작하는 답 하나가 교사가 받는 묶음의 `document.md`에서 **뒤 문항을 전부** 지웠다.
   * CRLF로 적힌 울타리도 같은 모양으로 샜다(JS의 `.`은 `\r`에 안 맞는다).
   *
   * **제목 목록 전체를 견주고, 답이 실린 모양을 통째로 본다.** 닫는 말을 붙이던 때(결정 89 전)와 달리 이제는
   * 코드 밖의 `<`가 `&lt;`가 되고 닫는 말은 없다 — 블록이 안 열리니 닫을 것이 없다. 울타리는 전처럼
   * 닫는 줄을 더한다(§8.6 "읽기 좋은 것이 기준").
   */
  describe('빈 줄로 안 끝나는 HTML 블록이 뒤 문항을 안 삼킨다', () => {
    const cases: [name: string, answer: string, written: string][] = [
      ['pre', '<pre>는 서식을 그대로 둔다', '&lt;pre>는 서식을 그대로 둔다'],
      ['style', '<style>\n.box { color: red }', '&lt;style>\n.box { color: red }'],
      ['script', '<SCRIPT>\nalert(1)', '&lt;SCRIPT>\nalert(1)'],
      ['textarea', '<textarea>', '&lt;textarea>'],
      ['php', '<?php echo 1;', '&lt;?php echo 1;'],
      ['doctype', '<!DOCTYPE html', '&lt;!DOCTYPE html'],
      ['cdata', '<![CDATA[ x', '&lt;![CDATA[ x'],
      ['CRLF로 적힌 울타리', '```python\r\nprint(1)', '```python\nprint(1)\n```'],
    ]
    const threeSections = (answer: string) =>
      renderPortfolioMarkdown(
        TEXT,
        portfolio(
          [
            { id: 'a', title: '동기' },
            { id: 'b', title: '방법' },
            { id: 'c', title: '느낀 점' },
          ],
          { a: answer, b: '둘째 답', c: '셋째 답' },
        ),
      )

    for (const [name, answer, written] of cases) {
      it(name, () => {
        const markdown = threeSections(answer)
        expect(titlesIn(markdown)).toEqual(['동기', '방법', '느낀 점'])
        expect(markdown).toContain(`## 동기\n\n${written}\n\n## 방법`)
      })
    }

    it('같은 줄에서 닫은 블록에는 안 붙인다 - 여는 태그도 닫는 태그도 글자다', () => {
      const markdown = threeSections('<script>x()</script> 이렇게 쓴다')
      expect(markdown).toContain('## 동기\n\n&lt;script>x()&lt;/script> 이렇게 쓴다\n\n## 방법')
      expect(titlesIn(markdown)).toEqual(['동기', '방법', '느낀 점'])
    })

    it('줄 가운데의 <pre>에는 안 붙인다 - 인라인 HTML은 뒤를 안 삼킨다', () => {
      const markdown = threeSections('HTML에서 <pre> 태그는 서식을 둔다')
      expect(markdown).not.toContain('</pre>')
    })

    /**
     * **`<!--`가 글자가 되면 그 뒤의 ` ``` `는 뷰어에서도 울타리다** (결정 89). 결정 89 전에는
     * 주석 블록 안의 ` ``` `를 울타리로 안 셌다 — 이제는 세야 뒤의 `##`이 울타리 안에 들고, 우리가
     * 더한 닫는 줄로 문항 경계가 되살아난다.
     */
    it('주석처럼 보이는 줄 뒤의 울타리는 울타리다 - 뒤의 ##이 문항이 되지 않는다', () => {
      expect(answersKeepTitles(['<!--', '```', '-->', '## 가짜 문항'].join('\n'))).toEqual([
        '동기',
        '방법',
      ])
    })
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

  /**
   * **문항이 하나뿐인 픽스처에서는 순서도 짝도 항등이다** (공통 §2.2). 그래서 답을
   * 한 칸씩 밀어도, 절 순서를 통째로 뒤집어도 저장소가 조용했다 (R14-1 감사 A-2).
   *
   * `document.md`는 교사가 여는 그 파일이고(CLAUDE.md §1.3), 여기가 어긋나면
   * **학생의 답이 남의 문항 아래에 선다.**
   */
  const two = portfolio(
    [
      { id: 'a', title: '첫 문항' },
      { id: 'b', title: '둘째 문항' },
    ],
    { a: '첫 글', b: '둘째 글' },
  )

  it('두 문항의 답이 안 뒤바뀐다', () => {
    expect(portfolioSections(two)).toEqual([
      { id: 'a', title: '첫 문항', answer: '첫 글' },
      { id: 'b', title: '둘째 문항', answer: '둘째 글' },
    ])
  })

  it('마크다운의 절 순서와 짝이 양식과 같다', () => {
    // **이어진 덩어리로 못 박는다.** 조각으로 흩으면 순서도 짝도 못 본다.
    expect(renderPortfolioMarkdown(TEXT, two)).toContain(
      ['## 첫 문항', '', '첫 글', '', '## 둘째 문항', '', '둘째 글', ''].join('\n'),
    )
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
   * **여기까지가 함수 층이고, 파일까지 가는 것을 잇는 검사가 저장소에 없었다**
   * (2026-08-31 사각 감사 C-7). `format.spec.ts`는 `document.md` 자리에 박은
   * 문자열을 넣고 왕복시키므로 **엔트리는 보지만 내용은 안 본다.**
   *
   * `.mlpx`가 곧 수행평가 제출물이다 (`CLAUDE.md` §1.3). 겹치는 제목이 든 양식과
   * 안 닫은 울타리가 **파일에서** 어떻게 보이는지가 이 검사의 몫이다.
   */
  it('그린 마크다운이 파일 안의 document.md로 그대로 간다', async () => {
    const imported = withImportedSections(blank.portfolio, [
      { title: '느낀 점' },
      { title: '느낀 점' },
    ])
    const answered = withAnswer(
      withAnswer(imported, '느낀-점', ['```python', 'print(1)'].join('\n')),
      '느낀-점-2',
      '둘째 답',
    )
    const { document, markdown } = identifiedExport(
      { ...blank, portfolio: answered },
      identity,
      now,
      label,
      'ko',
    )

    const file: ProjectFile = {
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    const { bytes } = await writeProjectBytes(file, markdown)
    const { project: opened } = await readProject(bytes)

    // 파일에서 꺼낸 글이 그린 글과 같고, 문항 둘이 살아 있다.
    const inFile = new TextDecoder().decode(unzipSync(bytes)[`${DIR.portfolio}document.md`]!)
    expect(inFile).toBe(markdown)
    expect(
      [...new MarkdownIt({ html: true }).render(inFile).matchAll(/<h2>([^<]*)</g)].map(
        ([, title]) => title,
      ),
    ).toEqual(['느낀 점', '느낀 점'])
    expect(opened.document.portfolio.template.sections).toHaveLength(2)
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
    /**
     * **키까지 없다** (2026-09-23 R37 C-3). 전에는 `{ student: undefined }`라 값 없는
     * 키가 메모리에 남았고 위 줄은 그래도 통과했다 — 파일은 멀쩡하지만(`JSON.stringify`가
     * 떨어뜨린다) **나가는 파일과 메모리의 모양이 달랐다.**
     */
    expect(Object.hasOwn(cleared.manifest, 'student')).toBe(false)
    // 그리고 **지우기가 죽지 않았다** — 키째 떼는 고침이 옛 값을 남기면 안 된다.
    expect(named.manifest.student).toBeDefined()
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

/**
 * **문항에 붙은 사진을 화면이 그리는 모양으로 만든다** (`photosOf`).
 *
 * 포트폴리오 편집 화면이 들고 있던 것을 순수 함수로 뺐다 (2026-09-18) — 점검 화면이
 * 같은 것을 그리고, 옮겨 적으면 두 화면이 다른 사진을 보인다.
 */
describe('문항에 붙은 사진', () => {
  const urls = new Map([
    ['portfolio/attachments/1.webp', 'blob:1'],
    ['portfolio/attachments/2.webp', 'blob:2'],
  ])

  function withPhotos(paths: string[]): Portfolio {
    const base = portfolio([{ id: 'why', title: '왜' }])
    return { ...base, attachments: { why: paths } }
  }

  it('붙은 순서 그대로 준다', () => {
    const photos = photosOf(
      withPhotos(['portfolio/attachments/2.webp', 'portfolio/attachments/1.webp']),
      'why',
      urls,
    )
    expect(photos.map((one) => one.path)).toEqual([
      'portfolio/attachments/2.webp',
      'portfolio/attachments/1.webp',
    ])
    expect(photos.map((one) => one.url)).toEqual(['blob:2', 'blob:1'])
  })

  it('주소가 없는 첨부는 뺀다 - 빈 img는 깨진 그림으로 보인다', () => {
    // 파일에서 바이트가 빠진 첨부다. 남의 파일에서 온다.
    const photos = photosOf(
      withPhotos(['portfolio/attachments/1.webp', 'portfolio/attachments/9.webp']),
      'why',
      urls,
    )
    expect(photos.map((one) => one.path)).toEqual(['portfolio/attachments/1.webp'])
  })

  it('붙은 것이 없으면 빈 목록이다', () => {
    expect(photosOf(portfolio([{ id: 'why', title: '왜' }]), 'why', urls)).toEqual([])
  })
})

/**
 * **줄 규칙이 울타리를 확신하지 못하는 답은 더 긴 울타리로 통째 감싼다** (open-decisions.md 82,
 * mlpx-spec.md §8.6).
 *
 * 닫는 줄을 더하는 규칙은 울타리가 **목록 안**에 있거나 **HTML 블록(CommonMark 유형 6·7) 안**에
 * 있을 때 판정을 틀렸다(HTML 블록 쪽은 결정 89가 코드 밖의 `<`를 글자로 싣는 것으로 대신한다 — 아래
 * *"결정 89"* 묶음) — 뷰어는 이미 닫았는데 우리가 더한 줄이 새 울타리를 열어 뒤 문항을 전부
 * 삼켰다(2026-09-29 야간 감사 N3 #2). 감싼 울타리는 답 안의 가장 긴 백틱 연속보다 하나 길어서
 * 답 안의 어느 줄로도 안 닫힌다(CommonMark: 닫는 줄은 여는 줄 이상 길어야 한다).
 *
 * **CommonMark 파서(markdown-it, `html: true`)로 제목을 센다** — 글자를 찾으면 삼켜진 문항의
 * 글자도 코드 블록 안에 그대로 있어서 못 본다.
 */
describe('결정 82: 확신 못 하는 울타리는 더 긴 울타리로 감싼다', () => {
  const headingsOf = (markdown: string) =>
    [...new MarkdownIt({ html: true }).render(markdown).matchAll(/<h([12])>([^<]*)</g)].map(
      ([, level, title]) => `h${level}:${title}`,
    )

  const THREE = [
    { id: 'a', title: '동기' },
    { id: 'b', title: '방법' },
    { id: 'c', title: '느낀 점' },
  ]
  const EXPECTED = ['h1:붓꽃 품종 분류', 'h2:동기', 'h2:방법', 'h2:느낀 점']

  const render = (a: string, b = '둘째 답') =>
    renderPortfolioMarkdown(TEXT, portfolio(THREE, { a, b, c: '셋째 답' }))

  /** 야간 감사가 확인한 현실형 둘. 둘 다 고치기 전에는 `느낀 점`이 삼켜졌다. */
  it.each([
    [
      '목록 안의 울타리를 안 닫고 덜 들여쓴 글이 온다',
      '1. 데이터 불러오기\n   ```python\n   df = pd.read_csv("a.csv")\n위 코드로 불러왔다.',
    ],
    ['줄바꿈 태그 뒤의 울타리', '<br>\n```python\n\nprint(1)'],
  ])('%s', (_, answer) => {
    expect(headingsOf(render('첫 답', answer))).toEqual(EXPECTED)
    expect(headingsOf(render(answer))).toEqual(EXPECTED)
  })

  /**
   * **까다로운 줄을 셋씩 모든 순서로 잇는다.** 야간 감사의 퍼저가 줄인 반례들이 이 조각들로
   * 이루어졌다(목록 표지·들여쓴 울타리·물결·HTML·setext·주석·닫는 말). 조각이 늘면 조합은 세제곱으로
   * 늘어나므로 조각은 반례에 나온 모양만 둔다.
   */
  it('까다로운 줄의 조합이 뒤 문항을 안 삼킨다', () => {
    const pieces = [
      '- a',
      '  - b',
      '- ```',
      '  ```',
      '   ~~~~',
      '```',
      '````',
      '~~~',
      '<div>',
      '<br>',
      '</a>',
      '<!--',
      '-->',
      '<?php',
      '?>',
      '<pre>',
      '> ```',
      '---',
      '===',
      '# y',
      '`',
      '',
    ]
    const broken: string[] = []
    for (const one of pieces) {
      for (const two of pieces) {
        for (const three of pieces) {
          const answer = [one, two, three].join('\n')
          if (answer.trim() === '') continue
          for (const markdown of [render(answer), render('첫 답', answer)]) {
            const found = headingsOf(markdown)
            if (found.join('|') !== EXPECTED.join('|')) broken.push(JSON.stringify(answer))
          }
        }
      }
    }
    expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
  })

  it('감싼 울타리는 답 안의 가장 긴 백틱 연속보다 하나 길다', () => {
    const answer = '- 코드:\n  ````js\n  let a = `x`\n  ````'
    const markdown = render(answer)
    expect(markdown).toContain(`## 동기\n\n\`\`\`\`\`\n${answer}\n\`\`\`\`\`\n\n## 방법`)
  })

  /**
   * **감싸는 조건의 갈래마다 한 줄씩.** 조합 검사는 문항이 살아 있는지만 보므로, 감싸지 않아도 우연히 살아남는
   * 모양에서는 조건의 가지가 빠져도 안 운다. 여기서는 감쌌는지를 직접 본다.
   */
  it.each([
    ['인용 안의 울타리', '> ```\n인용 안의 코드'],
    ['탭 뒤의 울타리', '설명\n\t```\n탭 뒤'],
    ['번호 목록 표지 뒤의 울타리', '1.```python\nprint(1)'],
    // 0열 울타리와 줄머리 `<`를 감싸던 조건 (2)는 결정 89가 걷어냈다 — "결정 89" 묶음의 퍼저가 그 모양을 본다.
  ])('%s는 감싼다', (_, answer) => {
    const markdown = render(answer)
    expect(markdown).toMatch(/## 동기\n\n`{3,}\n/)
    expect(markdown).toContain(`\n${answer}\n`)
    expect(headingsOf(markdown)).toEqual(EXPECTED)
  })

  it('백틱이 없으면 지금 길이다', () => {
    const answer = '- 표:\n   ~~~\n   값'
    expect(render(answer)).toContain(`## 동기\n\n\`\`\`\n${answer}\n\`\`\`\n\n## 방법`)
  })

  it('감싼 답은 글자를 바꾸지 않는다 — 안의 #도 줄머리 <도 이스케이프하지 않는다', () => {
    const answer = '- <div>\n  ```\n\n# 제목 아님\n<b>'
    const markdown = render(answer)
    expect(markdown).toContain(`\`\`\`\`\n${answer}\n\`\`\`\``)
    expect(markdown).not.toContain('\\#')
    expect(markdown).not.toContain('&lt;')
  })

  /** **회귀 — 줄 규칙이 확신하는 답은 바이트가 그대로다.** 목록·강조가 뷰어에서 살아난다. */
  it('0열의 울타리만 있는 답과 목록만 있는 답은 감싸지 않는다', () => {
    const code = '설명\n\n```python\n# 주석\nprint(1)\n```\n\n- 결과'
    expect(render(code)).toContain(`## 동기\n\n${code}\n\n## 방법`)
    const unclosed = '```python\nprint(1)'
    expect(render(unclosed)).toContain(`## 동기\n\n${unclosed}\n\`\`\`\n\n## 방법`)
    const list = '- 고양이\n- 개'
    expect(render(list)).toContain(`## 동기\n\n${list}\n\n## 방법`)
    expect(new MarkdownIt().render(render(list))).toContain('<li>고양이</li>')
  })

  /**
   * **읽는 쪽은 `document.md`를 해석하지 않는다** — 원본은 `document.json`이고 `.md`는 해시로
   * 대조만 한다(mlpx-spec.md §8.6). 그래서 옛 방식으로 닫은 파일과 새로 감싼 파일이 둘 다 열리고
   * 포맷 버전은 그대로다. 결정 89(코드 밖의 `<`를 `&lt;`로 싣는다)도 같다 — 옛 방식은 HTML 블록에 닫는 말을 붙였다.
   */
  it.each([
    ['결정 82 — 목록 안 울타리', '- a\n  ```\n위', '  ```'],
    [
      '결정 89 — 목록 안 주석 뒤의 0열 태그',
      '- 실습 코드\n  <!-- 여기부터\n<style>\np { color: red; }',
      '-->',
    ],
  ])('옛 방식의 document.md도 새 방식의 것도 그대로 열린다 (%s)', async (_, answer, oldCloser) => {
    const blank = newProjectDocument(
      { name: '붓꽃 품종 분류', locale: 'ko', dataType: 'tabular' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-08-05T09:00:00Z',
        randomState: 4242,
      },
    )
    const document = {
      ...blank,
      portfolio: withAnswer(
        withImportedSections(blank.portfolio, [{ title: '동기' }]),
        '동기',
        answer,
      ),
    }
    const file: ProjectFile = {
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    }
    const oldMarkdown = `# 붓꽃 품종 분류\n\n## 동기\n\n${answer}\n${oldCloser}\n`
    const newMarkdown = renderPortfolioMarkdown(TEXT, document.portfolio)
    expect(newMarkdown).not.toBe(oldMarkdown)

    for (const markdown of [oldMarkdown, newMarkdown]) {
      const { bytes } = await writeProjectBytes(file, markdown)
      const { project: opened, integrity } = await readProject(bytes)
      expect(integrity.status).toBe('UNCHANGED')
      expect(opened.document.portfolio.answers).toEqual(document.portfolio.answers)
      expect(opened.document.manifest.formatVersion).toBe(blank.manifest.formatVersion)
      const inFile = new TextDecoder().decode(unzipSync(bytes)[`${DIR.portfolio}document.md`]!)
      expect(inFile).toBe(markdown)
    }
  })
})

/**
 * **코드 밖의 `<`는 `&lt;`로 싣는다** (open-decisions.md 89, mlpx-spec.md §8.6).
 *
 * 학생 답의 HTML이 `document.md`에 그대로 실리면, HTML을 거르지 않는 뷰어로 교사가 열 때 학생이 쓴 코드가 교사
 * 화면에서 돈다(XSS). 줄머리의 태그는 HTML 블록을 열어 뒤 문항까지 삼켰다(감사 슬라이스 4 A-1). 제목과 태그는
 * markdown-it(`html: true`)으로 렌더해서 센다 — 렌더된 글의 `<`는 `&lt;`로 나오므로 **렌더 결과의 날것 `<`는 태그뿐이다.**
 */
describe('결정 89: 코드 밖의 <는 &lt;로 싣는다', () => {
  /** 이 묶음의 답에서 마크다운이 만드는 요소. 여기 없는 이름이 서면 학생이 쓴 태그다. */
  const MARKDOWN_TAGS = new Set([
    'h1',
    'h2',
    'p',
    'ul',
    'ol',
    'li',
    'code',
    'pre',
    'blockquote',
    'em',
    'strong',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ])
  /** 마크다운 링크가 만드는 `<a>`. markdown-it은 `javascript:` 주소로는 링크를 안 만든다. */
  const MARKDOWN_LINK = /^<a href="(?!javascript:)[^"]*">$/i
  const rawTagsIn = (markdown: string) => {
    const html = new MarkdownIt({ html: true }).render(markdown)
    const found = [...html.matchAll(/<(\/?)([^\s>/]*)[^>]*>?/g)]
      .filter(([whole, closing, name]) => {
        const tag = name!.toLowerCase()
        if (MARKDOWN_TAGS.has(tag)) return false
        return !(tag === 'a' && (closing === '/' || MARKDOWN_LINK.test(whole)))
      })
      .map(([whole]) => whole)
    // 마크다운의 `<pre>`는 언제나 `<pre><code`다 — 홀로 선 `<pre>`는 학생이 쓴 것이다.
    return [...found, ...[...html.matchAll(/<pre>(?!<code)/g)].map(([whole]) => whole)]
  }

  const headingsOf = (markdown: string) =>
    [...new MarkdownIt({ html: true }).render(markdown).matchAll(/<h([12])>([^<]*)</g)].map(
      ([, level, title]) => `h${level}:${title}`,
    )

  const THREE = [
    { id: 'a', title: '동기' },
    { id: 'b', title: '방법' },
    { id: 'c', title: '느낀 점' },
  ]
  const EXPECTED = ['h1:붓꽃 품종 분류', 'h2:동기', 'h2:방법', 'h2:느낀 점']

  const render = (a: string, b = '둘째 답') =>
    renderPortfolioMarkdown(TEXT, portfolio(THREE, { a, b, c: '셋째 답' }))

  it.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('감사의 현실형 반례에서 뒤 문항이 다 선다 (%s)', (_, eol) => {
    const answer = ['- 실습 코드', '  <!-- 여기부터', '<style>', 'p { color: red; }'].join(eol)
    for (const markdown of [render(answer), render('첫 답', answer)]) {
      expect(headingsOf(markdown)).toEqual(EXPECTED)
      expect(rawTagsIn(markdown)).toEqual([])
    }
  })

  /**
   * **감사의 조각을 셋씩 모든 순서 × LF/CRLF × 첫째/둘째 문항으로 잇는다.** 주석·유형 1–5 태그·유형 6·7 태그를
   * 목록·인용 표지와 울타리 사이에 섞는다 — 82의 감싸는 조건 (2)(0열 울타리와 줄머리 `<`)가 지키던 병, HTML 블록
   * 안의 ` ``` `를 줄 규칙이 울타리로 세어 뒤 문항을 잃는 것도 여기서 본다. 조건 (2)는 걷어냈다. 학생의 태그가 서는지도 본다.
   */
  it('감사의 조각 조합이 뒤 문항을 안 삼키고 태그도 안 세운다', () => {
    const pieces = [
      '  <!--',
      '<!--',
      '-->',
      '<style>',
      '<script>',
      '<pre>',
      '<?php',
      '<![CDATA[',
      '- a',
      '- <div>',
      '> <div>',
      '<div>',
      '<br/>',
      '```',
      '    ```',
      '-\t```',
      '\u00a0```',
      '# y',
      '',
    ]
    const broken: string[] = []
    for (const one of pieces) {
      for (const two of pieces) {
        for (const three of pieces) {
          for (const eol of ['\n', '\r\n']) {
            const answer = [one, two, three].join(eol)
            if (answer.trim() === '') continue
            for (const markdown of [render(answer), render('첫 답', answer)]) {
              if (headingsOf(markdown).join('|') !== EXPECTED.join('|')) {
                broken.push(JSON.stringify(answer))
              }
              if (rawTagsIn(markdown).length > 0) broken.push(`tag ${JSON.stringify(answer)}`)
            }
          }
        }
      }
    }
    expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
  })

  /**
   * **보안 퍼저.** 태그류와 코드 스팬의 까다로운 조각(길이 다른 백틱·이스케이프된 백틱·줄을 넘는 스팬·링크 목적지·표 칸)을
   * 컨테이너·울타리 조각과 섞어 셋씩 잇는다. 학생 원문의 태그가 요소로 서는 경우가 하나도 없어야 한다.
   */
  it('태그와 코드 스팬 조각의 조합에서 학생의 태그가 하나도 안 선다', () => {
    const pieces = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '`<b>`',
      '`` ` ``',
      '` <img src=x onerror=alert(1)> ``',
      '\\`<img src=x onerror=alert(1)>`',
      '\\`',
      '<',
      'a<b',
      '`a',
      '- b`',
      'b` <img src=x onerror=alert(1)> `c`',
      '[a](`) <svg onload=alert(1)> (`)',
      '| `a | <img src=x onerror=alert(1)>` |',
      '|---|---|',
      '- a',
      '> q',
      '```',
      '    ```',
      '',
    ]
    const broken: string[] = []
    for (const one of pieces) {
      for (const two of pieces) {
        for (const three of pieces) {
          for (const eol of ['\n', '\r\n']) {
            const answer = [one, two, three].join(eol)
            if (answer.trim() === '') continue
            for (const markdown of [render(answer), render('첫 답', answer)]) {
              const tags = rawTagsIn(markdown)
              if (tags.length > 0) broken.push(`${JSON.stringify(answer)} ${tags.join(' ')}`)
            }
          }
        }
      }
    }
    expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
  })

  /** 태그류마다 한 줄씩 — 실린 모양을 통째로 보고, 렌더에서 태그가 안 서는지 본다. */
  it.each([
    ['문장 안의 script', '설명 <script>alert(1)</script>', '설명 &lt;script>alert(1)&lt;/script>'],
    [
      '문장 안의 img onerror',
      '설명 <img src=x onerror=alert(1)>',
      '설명 &lt;img src=x onerror=alert(1)>',
    ],
    [
      'javascript 주소의 a',
      '<a href="javascript:alert(1)">눌러</a>',
      '&lt;a href="javascript:alert(1)">눌러&lt;/a>',
    ],
    ['주석', '메모 <!-- 숨김 -->', '메모 &lt;!-- 숨김 -->'],
    ['처리 명령', '<?php echo 1; ?>', '&lt;?php echo 1; ?>'],
    ['CDATA', '<![CDATA[ x ]]>', '&lt;![CDATA[ x ]]>'],
    ['줄머리 div', '설명\n   <div>', '설명\n   &lt;div>'],
    ['목록·인용 표지 뒤', '- <div>\n> <br>\n1. <b>', '- &lt;div>\n> &lt;br>\n1. &lt;b>'],
  ])('%s는 태그로 안 선다', (_, answer, written) => {
    const markdown = render(answer)
    expect(markdown).toContain(`## 동기\n\n${written}\n\n## 방법`)
    expect(rawTagsIn(markdown)).toEqual([])
    expect(headingsOf(markdown)).toEqual(EXPECTED)
  })

  /**
   * **코드 스팬의 갈래** (`trustedCodeSpans`). 믿는 스팬 안은 그대로, 믿지 못하는 문단은 스팬 안까지 바꾼다 — 틀리게
   * 믿으면 태그가 서고, 틀리게 안 믿으면 코드 안에 `&lt;`가 보일 뿐이다.
   */
  it.each([
    ['같은 길이로 닫힌 스팬은 그대로', 'HTML은 `<div>`로 쓴다 <i>', 'HTML은 `<div>`로 쓴다 &lt;i>'],
    ['길이가 다른 백틱은 안 닫는다', '``a ` <b>`` 뒤 <i>', '``a ` <b>`` 뒤 &lt;i>'],
    ['안 닫힌 백틱은 글자다', '`<b> 그리고', '`&lt;b> 그리고'],
    [
      '남는 백틱 하나가 앞의 스팬을 안 흔든다',
      '`<b>` 그리고 ` 하나 <i>',
      '`<b>` 그리고 ` 하나 &lt;i>',
    ],
    ['이스케이프된 백틱은 안 연다', '\\`<b>`', '\\`&lt;b>`'],
    ['이스케이프된 백슬래시 뒤의 백틱은 연다', '\\\\`<b>`', '\\\\`<b>`'],
    ['첫 백틱만 이스케이프되면 나머지가 연다', '\\``<b>`', '\\``<b>`'],
    ['스팬 안의 백슬래시는 닫는 백틱을 못 막는다', '`a\\` <b> `', '`a\\` &lt;b> `'],
    ['줄을 넘는 스팬이 있는 문단은 안 믿는다', '`a\n<b>` 끝 `<i>`', '`a\n&lt;b>` 끝 `&lt;i>`'],
    [
      '목록이 가른 스팬',
      '`a\n- b`\n`<img src=x onerror=alert(1)>` y',
      '`a\n- b`\n`&lt;img src=x onerror=alert(1)>` y',
    ],
    ['빈 줄로 나뉜 문단은 따로 짝짓는다', '`a\n\n`<b>`', '`a\n\n`<b>`'],
    [
      // 주소가 http·https가 아니라 `(` 앞에 백슬래시도 붙는다(결정 93).
      '링크 목적지가 있는 문단은 안 믿는다',
      '[a](`) <img src=x onerror=alert(1)> (`)',
      '[a]\\(`) &lt;img src=x onerror=alert(1)> (`)',
    ],
    ['표 칸을 넘는 스팬은 안 믿는다', '| `a | <b>` |\n|---|---|', '| `a | &lt;b>` |\n|---|---|'],
  ])('%s', (_, answer, written) => {
    const markdown = render(answer)
    expect(markdown).toContain(`## 동기\n\n${written}\n\n## 방법`)
    expect(rawTagsIn(markdown)).toEqual([])
  })

  it('울타리 안의 <는 안 바꾼다 — 코드 블록 안의 &lt;는 그대로 보인다', () => {
    const closed = '```html\n<div>\n  <!-- 메모\n```'
    expect(render(closed)).toContain(`## 동기\n\n${closed}\n\n## 방법`)
    const unclosed = '설명\n~~~\n<style>'
    expect(render(unclosed)).toContain(`## 동기\n\n${unclosed}\n~~~\n\n## 방법`)
  })

  it('여는 울타리 줄의 언어 자리는 코드가 아니다', () => {
    expect(render('```<b>\nx\n```')).toContain('## 동기\n\n```&lt;b>\nx\n```\n\n## 방법')
  })

  /** 들여쓴 코드 블록은 가리지 않는다 — 바꾸는 쪽으로 기울어 `&lt;`가 보인다(open-decisions.md 89 "대가"). */
  it('들여쓴 코드 블록의 <는 바꾼다', () => {
    expect(render('설명\n\n    <x>')).toContain('## 동기\n\n설명\n\n    &lt;x>\n\n## 방법')
  })

  it('<가 없는 답은 바이트가 그대로다 — >와 &도 안 바꾼다', () => {
    const answers = [
      '설명\n\n```python\n# 주석\nprint(1)\n```\n\n- 결과',
      '- 고양이\n- 개',
      'x > y & z, 이미 쓴 &lt;b&gt;',
      '> 인용문\n> 둘째 줄',
      '1. 첫째\n2. 둘째',
      '| a | b |\n|---|---|\n| 1 | 2 |',
    ]
    for (const answer of answers) {
      expect(render(answer)).toContain(`## 동기\n\n${answer}\n\n## 방법`)
    }
  })

  /**
   * **답 밖의 사용자 글** — 문서 제목(프로젝트 이름)·문항 제목·머리글(학번·이름 값)·이전 문항 제목도 `document.md`에
   * 실린다. 답과 같은 판정(`escapeInline`)을 거친다. 제목 구조가 그대로 서는지는 요소 이름의 차례로 본다.
   */
  describe('답 밖의 사용자 글', () => {
    const XSS = '<img src=x onerror=alert(1)> <svg onload=alert(1)> <script>alert(1)</script>'
    const levelsIn = (markdown: string) =>
      [...new MarkdownIt({ html: true }).render(markdown).matchAll(/<(h[1-6])>/g)].map(
        ([, level]) => level,
      )
    const withText = (title: string, label: string, value: string) =>
      renderPortfolioMarkdown(
        { title, rows: [[label, value]], orphanTitle: `이전 ${XSS}` },
        portfolio(THREE, { 옛것: '남은 글' }),
      )

    it.each([
      ['문서 제목', () => withText(`붓꽃 ${XSS}`, '이름', '홍길동')],
      ['머리글 값', () => withText('붓꽃', '이름', XSS)],
      ['머리글 라벨', () => withText('붓꽃', XSS, '홍길동')],
      [
        '문항 제목',
        () =>
          renderPortfolioMarkdown(
            TEXT,
            portfolio([
              { id: 'a', title: `동기 ${XSS}` },
              { id: 'b', title: '방법' },
            ]),
          ),
      ],
      // 라벨과 값을 따로 판정하면 라벨의 남는 백틱과 값의 백틱이 뷰어에서 짝지어 값의 태그가 스팬 밖으로 나온다.
      ['라벨과 값 사이의 백틱', () => withText('붓꽃', '`a', '`<img src=x onerror=alert(1)>`')],
    ])('%s에 쓴 태그가 안 서고 제목 구조가 그대로다', (_, make) => {
      const markdown = make()
      expect(rawTagsIn(markdown)).toEqual([])
      expect(levelsIn(markdown)[0]).toBe('h1')
      expect(
        levelsIn(markdown)
          .slice(1)
          .every((level) => level === 'h2'),
      ).toBe(true)
      expect(levelsIn(markdown).length).toBeGreaterThanOrEqual(3)
    })

    it('제목의 코드 스팬 안은 답과 같이 그대로다', () => {
      const markdown = renderPortfolioMarkdown(
        { ...TEXT, title: '`print(<x>)` 출력 <b>' },
        portfolio([{ id: 'a', title: '`a<b` 비교 <i>' }]),
      )
      expect(markdown).toContain('# `print(<x>)` 출력 &lt;b>\n')
      expect(markdown).toContain('## `a<b` 비교 &lt;i>\n')
      expect(rawTagsIn(markdown)).toEqual([])
    })

    it('<가 없는 제목과 머리글은 바이트가 그대로다', () => {
      const markdown = renderPortfolioMarkdown(
        {
          title: '붓꽃 > 분류 & `코드`',
          rows: [['이름', '홍길동 `a`']],
          orphanTitle: '이전 문항의 답',
        },
        portfolio([{ id: 'a', title: '동기 > 방법' }], { a: '글', 옛것: '남은 글' }),
      )
      expect(markdown).toBe(
        '# 붓꽃 > 분류 & `코드`\n\n- **이름**: 홍길동 `a`\n\n## 동기 > 방법\n\n글\n\n## 이전 문항의 답\n\n남은 글\n',
      )
    })

    /**
     * **홑 `\r`은 줄 끝이다** (보안 검토 A-2). 입력 칸은 CR을 거르지만 스키마는 아무 문자열이나 받아, 조작한 `.mlpx`의
     * 제목이 교사의 점검 묶음에서 그대로 구워진다.
     */
    it.each([
      ['문서 제목', () => withText('`\r<img src=x onerror=alert(1)>`', '이름', '홍길동')],
      ['머리글 값', () => withText('붓꽃', '이름', '`\r- <img src=x onerror=alert(1)>`')],
      [
        '문항 제목',
        () =>
          renderPortfolioMarkdown(
            TEXT,
            portfolio([
              { id: 'a', title: '`\r<img src=x onerror=alert(1)>`' },
              { id: 'b', title: '방법' },
            ]),
          ),
      ],
    ])('%s의 홑 \\r이 줄을 가르지 않는다', (_, make) => {
      const markdown = make()
      expect(rawTagsIn(markdown)).toEqual([])
      expect(markdown.includes('\r')).toBe(false)
    })

    /** 제목·라벨·값에 줄 끝과 백틱·태그 조각을 셋씩 넣는다. 태그가 안 서고 제목 구조가 그대로여야 한다. */
    it('한 줄 글의 줄 끝 조합에서 태그가 안 선다', () => {
      const pieces = [
        '`',
        '\r',
        '\n',
        '\r\n',
        '\u2028',
        '<img src=x onerror=alert(1)>',
        '- ',
        '# ',
        'a',
      ]
      const broken: string[] = []
      for (const one of pieces) {
        for (const two of pieces) {
          for (const three of pieces) {
            const line = one + two + three
            const made = [
              withText(line, '이름', '홍길동'),
              withText('붓꽃', line, '홍길동'),
              withText('붓꽃', '이름', line),
              renderPortfolioMarkdown(
                TEXT,
                portfolio([
                  { id: 'a', title: line },
                  { id: 'b', title: '방법' },
                ]),
              ),
            ]
            for (const markdown of made) {
              const levels = levelsIn(markdown)
              const shaped = levels[0] === 'h1' && levels.slice(1).every((level) => level === 'h2')
              if (rawTagsIn(markdown).length > 0 || !shaped) broken.push(JSON.stringify(line))
            }
          }
        }
      }
      expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
    })
  })

  /**
   * **판정의 공백과 줄 끝은 CommonMark다 — 스페이스·탭, `\n`·`\r`** (보안 검토 A-1). JS의 `trim`·`\s`는 유니코드 공백까지
   * 공백으로 보고 `.`은 U+2028/2029에 안 맞아, 빈 줄과 닫는 울타리를 뷰어와 다르게 셌다.
   */
  describe('유니코드 공백과 줄 구분자', () => {
    const IMG = '<img src=x onerror=alert(1)>'

    it.each([
      ['전각 공백 줄이 문단을 가르지 않는다', `\`a\n\u3000\n\`${IMG}\``],
      [
        '현실형 — 전각 공백 줄 뒤의 스팬',
        '코드는 `a\n\u3000\n`<b onmouseover=alert(1)>굵게</b>` 이다',
      ],
      ['닫는 울타리 뒤의 전각 공백', `\`\`\`\n\`\`\`\u3000\n\`\`\`\n${IMG}\n\`\`\``],
      ['닫는 울타리 뒤의 NBSP', `\`\`\`\n\`\`\`\u00a0\n\`\`\`\n${IMG}\n\`\`\``],
      ['여는 울타리 언어 자리의 U+2028', `\`\`\`x\u2028\n\`\`\`\n${IMG}\n\`\`\``],
      ['여는 물결 울타리 뒤의 U+2029', `~~~\u2029\n~~~\n${IMG}\n~~~`],
    ])('%s', (_, answer) => {
      for (const markdown of [render(answer), render('첫 답', answer)]) {
        expect(rawTagsIn(markdown)).toEqual([])
        expect(headingsOf(markdown)).toEqual(EXPECTED)
      }
    })

    /** 빈 줄처럼 보이는 줄·닫는 울타리 뒤·여는 울타리 뒤에 유니코드 공백과 줄 구분자를 두고 셋씩 잇는다. */
    it('유니코드 공백 조각의 조합에서 태그가 안 선다', () => {
      const spaces = ['\u3000', '\u00a0', '\u2028', '\u2029', '\ufeff', '\v', '\f']
      const pieces = [
        '```',
        '~~~',
        '`a',
        `\`${IMG}\``,
        IMG,
        ...spaces,
        ...spaces.slice(0, 3).map((space) => `\`\`\`${space}`),
        // 닫는 줄로 착각하면 다음 줄이 여는 줄이 된다 — 그 두 줄을 한 조각으로 둬야 셋씩 이어서 닿는다.
        ...spaces.slice(0, 3).map((space) => `\`\`\`${space}\n\`\`\``),
        '```x\u2028',
        '~~~\u2029',
      ]
      const broken: string[] = []
      for (const one of pieces) {
        for (const two of pieces) {
          for (const three of pieces) {
            for (const eol of ['\n', '\r\n']) {
              const answer = [one, two, three].join(eol)
              for (const markdown of [render(answer), render('첫 답', answer)]) {
                if (rawTagsIn(markdown).length > 0) broken.push(JSON.stringify(answer))
              }
            }
          }
        }
      }
      expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
    })

    /**
     * **판정 구역에 JS 공백 판정이 없다.** `portfolio.ts`의 표시(`여기서 \`escapeInline\`까지가`)부터
     * `renderPortfolioMarkdown` 앞까지에서 주석을 걷고 `.trim(`·`\s`·정규식의 `.`+수량자를 찾는다.
     * 정규식 `.`은 모양으로만 찾는다 — 수량자 없는 홑 `.`은 못 본다.
     */
    it('판정 구역에 JS 공백 판정이 없다', () => {
      const source = readFileSync(new URL('../src/project/portfolio.ts', import.meta.url), 'utf-8')
      // 표시는 머리 주석 안에 있다 — 그 주석이 닫힌 뒤부터 훑는다.
      const marker = source.indexOf('여기서 `escapeInline`까지가')
      expect(marker, 'marker missing').toBeGreaterThan(0)
      const start = source.indexOf('*/', marker) + 2
      const end = source.indexOf('export function renderPortfolioMarkdown')
      expect(end, 'renderer missing').toBeGreaterThan(start)
      const code = source
        .slice(start, end)
        .replace(/\/\*[^]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      const found = [...code.matchAll(/\.trim(?:Start|End)?\(|\\s|(?<!\\)\.[*+?]/g)].map(
        ([hit]) => hit,
      )
      expect(
        found,
        'use CommonMark whitespace ([ \\t], \\r, \\n) in the markdown judgement',
      ).toEqual([])
    })
  })
})

/**
 * **주소가 http·https가 아닌 링크는 글자로 싣는다** (open-decisions.md 93, mlpx-spec.md §8.6).
 *
 * `[눌러](javascript:alert(1))`는 `<`가 없어 89를 그대로 지나, 링크를 거르지 않는 뷰어로 교사가 열고 누르면 돈다.
 * markdown-it은 `validateLink`로 `javascript:`·`vbscript:`·`file:`·이미지 아닌 `data:`를 막지만 다른 뷰어는 더 느슨하다고
 * 본다 — 그래서 **`validateLink`를 끈 렌더러로도 잰다.** 거기서 http·https가 아닌 `href`·`src`가 하나도 없어야 막힌 것이다.
 */
describe('결정 93: 주소가 http·https가 아닌 링크는 글자로 싣는다', () => {
  const strict = new MarkdownIt({ html: true })
  /** 링크를 거르지 않는 뷰어. `normalizeLink`(퍼센트 인코딩)와 엔티티 해석은 그대로다. */
  const loose = new MarkdownIt({ html: true })
  loose.validateLink = () => true

  /**
   * 렌더 결과의 `href`·`src` 중 http·https가 아닌 것. markdown-it은 속성 값을 늘 큰따옴표로 싸고 글 속의 `"`·`<`를
   * 엔티티로 내므로, 렌더 결과의 ` href="`·` src="`는 속성뿐이다. 값의 엔티티를 풀고 스킴을 본다.
   */
  const unsafeLinksIn = (markdown: string, md: typeof loose = loose) =>
    [...md.render(markdown).matchAll(/ (href|src)="([^"]*)"/g)]
      .map(([, name, value]) => {
        const url = value!
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
        return `${name!}=${url}`
      })
      .filter((attribute) => !/^(href|src)=https?:\/\//i.test(attribute))

  const THREE = [
    { id: 'a', title: '동기' },
    { id: 'b', title: '방법' },
    { id: 'c', title: '느낀 점' },
  ]
  const render = (a: string) =>
    renderPortfolioMarkdown(TEXT, portfolio(THREE, { a, b: '둘째 답', c: '셋째 답' }))

  /**
   * 답·문서 제목·문항 제목·머리글 값·머리글 라벨·이전 문항 제목·이전 문항의 답 — 사용자 글이 실리는 자리마다.
   * 이전 문항의 답은 정상 경로로는 안 생기고 손으로 고친 파일에서 온다(0.35.2 경계 감사 B C-3).
   */
  const PLACES: [string, (text: string) => string][] = [
    ['답', render],
    ['문서 제목', (text) => renderPortfolioMarkdown({ ...TEXT, title: text }, portfolio(THREE))],
    [
      '문항 제목',
      (text) =>
        renderPortfolioMarkdown(
          TEXT,
          portfolio([
            { id: 'a', title: text },
            { id: 'b', title: '방법' },
          ]),
        ),
    ],
    [
      '머리글 값',
      (text) => renderPortfolioMarkdown({ ...TEXT, rows: [['이름', text]] }, portfolio(THREE)),
    ],
    [
      '머리글 라벨',
      (text) => renderPortfolioMarkdown({ ...TEXT, rows: [[text, '홍']] }, portfolio(THREE)),
    ],
    [
      '이전 문항 제목',
      (text) =>
        renderPortfolioMarkdown(
          { ...TEXT, orphanTitle: text },
          portfolio(THREE, { 옛것: '남은 글' }),
        ),
    ],
    ['이전 문항의 답', (text) => renderPortfolioMarkdown(TEXT, portfolio(THREE, { 옛것: text }))],
  ]

  /** 결정 93이 적은 가리는 모양. 정의(`[r]: …`)는 같은 글에 참조를 함께 둔다. */
  const DISGUISES: [string, string][] = [
    ['javascript', '[눌러](javascript:alert(1))'],
    ['대소문자', '[눌러](JaVaScRiPt:alert(1))'],
    ['이름 문자 참조', '[눌러](javascript&colon;alert(1))'],
    ['십진 문자 참조', '[눌러](java&#115;cript:alert(1))'],
    ['십육진 문자 참조', '[눌러](&#x6A;avascript:alert(1))'],
    ['스킴 머리의 문자 참조', '[눌러](&#104;ttp:alert(1))'],
    // 날글자 `http:`이지만 `//`가 없다 — 통과하는 것은 `http://`다(0.35.2 경계 감사 B C-1).
    ['스킴만 http', '[눌러](http:alert(1))'],
    ['백슬래시 이스케이프', '[눌러](javascript\\:alert(1))'],
    ['앞뒤 공백', '[눌러](  javascript:alert(1)  )'],
    ['앞의 탭', '[눌러](\tjavascript:alert(1))'],
    ['중간의 탭', '[눌러](java\tscript:alert(1))'],
    ['앞의 줄바꿈', '[눌러](\njavascript:alert(1))'],
    ['꺾쇠 목적지', '[눌러](<javascript:alert(1)>)'],
    ['제목 붙은 목적지', '[눌러](javascript:alert(1) "t")'],
    ['제목에 숨은 http', '[눌러](javascript:alert(1) "http://ok")'],
    ['괄호 사이의 공백', '[눌러] (javascript:alert(1))'],
    ['중첩 괄호', '[눌러](javascript:alert((1)))'],
    ['중첩 대괄호', '[a [b] c](javascript:alert(1))'],
    ['겹 대괄호', '[[눌러]](javascript:alert(1))'],
    ['이미지', '![그림](javascript:alert(1))'],
    ['data 이미지', '![그림](data:image/svg+xml,x)'],
    ['data 링크', '[눌러](data:text/html,x)'],
    ['vbscript', '[눌러](vbscript:msgbox(1))'],
    ['file', '[눌러](file:///C:/Windows/win.ini)'],
    ['상대 주소', '[눌러](../other.html)'],
    ['프로토콜 상대 주소', '[눌러](//evil.example/x)'],
    ['이미지 안의 링크', '[![그림](http://example.com/a.png)](javascript:alert(1))'],
    ['http 안에 숨은 링크', '[a](http://ok/](javascript:alert(1)))'],
    ['참조 링크', '[눌러][r] [r]: javascript:alert(1)'],
    ['참조 정의가 먼저', '[r]: javascript:alert(1)\n\n[눌러][r]'],
    ['생략 참조', '[r][]\n\n[r]: javascript:alert(1)'],
    ['단축 참조', '[r]\n\n[r]: javascript:alert(1)'],
    ['정의의 꺾쇠 목적지', '[r]\n\n[r]: <javascript:alert(1)> "t"'],
    ['정의의 다음 줄 목적지', '[r]\n\n[r]:\n  javascript:alert(1)'],
    ['정의 앞의 공백', '[r]\n\n[r] : javascript:alert(1)'],
    ['코드 스팬처럼 보이는 정의', '[r`]: javascript:alert(1)`\n\n[r`]'],
  ]

  describe.each(PLACES)('%s', (_, place) => {
    it.each(DISGUISES)('%s — http·https가 아닌 주소가 안 선다', (_, text) => {
      const markdown = place(text)
      expect(unsafeLinksIn(markdown, loose)).toEqual([])
      expect(unsafeLinksIn(markdown, strict)).toEqual([])
    })
  })

  /** 정의가 다른 자리에 있어도 문서 전체에 걸린다 — 답의 정의를 제목의 참조가 쓴다. */
  it('답의 정의를 제목의 참조가 써도 안 선다', () => {
    const markdown = renderPortfolioMarkdown(
      { ...TEXT, title: '[눌러][r]' },
      portfolio(THREE, { a: '[r]: javascript:alert(1)' }),
    )
    expect(unsafeLinksIn(markdown)).toEqual([])
  })

  /** 글자로 싣는 모양 — 주소를 여는 `(`·`:` 앞에 백슬래시. 뷰어에는 원문 글자가 보이고 링크는 하나도 안 선다. */
  it.each([
    ['인라인 링크', '[눌러](javascript:alert(1))', '[눌러]\\(javascript:alert(1))'],
    ['이미지', '![그림](data:image/svg+xml,x)', '![그림]\\(data:image/svg+xml,x)'],
    ['참조 정의', '[r]: javascript:alert(1)', '[r]\\: javascript:alert(1)'],
    ['괄호 사이의 공백', '[눌러] (javascript:alert(1))', '[눌러] \\(javascript:alert(1))'],
  ])('%s는 글자로 실리고 원문이 보인다', (_, answer, written) => {
    const markdown = render(answer)
    expect(markdown).toContain(`## 동기\n\n${written}\n\n## 방법`)
    const html = loose.render(markdown)
    expect(html).not.toMatch(/<a |<img /)
    expect(html).toContain(`<p>${answer.replace(/"/g, '&quot;')}</p>`)
  })

  it('http·https 링크와 이미지는 바이트 그대로 선다', () => {
    const answers = [
      '[자료](https://example.com/a?b=1&c=2) 와 ![그림](http://example.com/a.png "제목")',
      '[자료](HTTPS://example.com) [b]( http://example.com/b )',
      '[자료][r]\n\n[r]: https://example.com/r "제목"',
      '[![그림](https://example.com/a.png)](https://example.com)',
    ]
    for (const answer of answers) {
      const markdown = render(answer)
      expect(markdown).toContain(`## 동기\n\n${answer}\n\n## 방법`)
      expect(unsafeLinksIn(markdown)).toEqual([])
      expect(strict.render(markdown)).toMatch(/<a href="https?:\/\//i)
    }
    const title = renderPortfolioMarkdown(
      { ...TEXT, title: '[자료](https://example.com)' },
      portfolio(THREE),
    )
    expect(title).toContain('# [자료](https://example.com)\n')
  })

  it('코드 안의 javascript: 링크는 그대로다', () => {
    const fenced = '```md\n[눌러](javascript:alert(1))\n[r]: javascript:alert(1)\n```'
    expect(render(fenced)).toContain(`## 동기\n\n${fenced}\n\n## 방법`)
    const span = '주소는 `javascript:alert(1)`로 쓴다'
    expect(render(span)).toContain(`## 동기\n\n${span}\n\n## 방법`)
  })

  it('링크가 없는 글은 바이트가 그대로다', () => {
    const answers = [
      '설명 (괄호) [대괄호] 뒤 : 콜론',
      '배열 a[0] = 1, 함수 f(x)',
      '- [ ] 할 일\n- [x] 한 일',
      '시각 12:30, 주소 없이 http://example.com',
    ]
    for (const answer of answers) {
      expect(render(answer)).toContain(`## 동기\n\n${answer}\n\n## 방법`)
    }
  })

  /** 앱이 짓는 사진 링크는 사용자 글이 아니다 — 상대 경로 그대로 선다(mlpx-spec.md §8.6.1). */
  it('앱이 짓는 사진 링크는 그대로다', () => {
    const made = nextAttachmentPath(portfolio(THREE), '.jpg', [])
    const withPhoto: Portfolio = {
      ...portfolio(THREE, { a: '글' }),
      attachments: { a: ['portfolio/attachments/1.webp', made] },
    }
    const markdown = renderPortfolioMarkdown(TEXT, withPhoto)
    expect(markdown).toContain('\n![](attachments/1.webp)\n')
    expect(markdown).toContain(`\n![](${made.slice(DIR.portfolio.length)})\n`)
    expect(strict.render(markdown)).toContain('<img src="attachments/1.webp" alt="">')
  })

  /**
   * **조작한 파일의 사진 경로** (보안 검토 v6 A-1). 경로는 학생의 `document.json`에서 오고, 읽기는 zip 엔트리가 있는지와
   * 새는지만 본다. 앱이 지은 모양이 아니면 사진 링크로 안 싣는다 — 링크 문법을 깨고 태그·정의를 세운다.
   */
  const TAMPERED_PATHS = [
    'portfolio/attachments/a)<img src=x onerror=alert(1)>',
    'portfolio/attachments/a) [c](javascript:alert(1)',
    'portfolio/attachments/a)\n\n[r]: javascript:alert(1)\n\n[눌러][r]',
    'portfolio/attachments/2)<img src=x onerror=alert(1)>.webp',
  ]

  it.each(TAMPERED_PATHS)('조작한 사진 경로 %j는 싣지 않는다', (path) => {
    const tampered: Portfolio = {
      ...portfolio(THREE, { a: '글' }),
      attachments: { a: [path, 'portfolio/attachments/1.webp'] },
    }
    const markdown = renderPortfolioMarkdown(TEXT, tampered)
    expect(markdown).not.toContain(path.slice(DIR.portfolio.length))
    expect(markdown).toContain('\n![](attachments/1.webp)\n')
    for (const md of [strict, loose]) {
      expect(unsafeLinksIn(markdown, md).filter((one) => one !== 'src=attachments/1.webp')).toEqual(
        [],
      )
      expect(md.render(markdown)).not.toMatch(/<img [^>]*onerror|<a /)
    }
  })

  it.each([
    ['portfolio/attachments/1.webp', true],
    ['portfolio/attachments/12.jpg', true],
    ['portfolio/attachments/0.webp', false],
    ['portfolio/attachments/01.webp', false],
    ['portfolio/attachments/+1.webp', false],
    ['portfolio/attachments/ 1.webp', false],
    ['portfolio/attachments/1e3.webp', false],
    ['portfolio/attachments/1.png', false],
    ['portfolio/attachments/1.jpeg', false],
    ['portfolio/attachments/1.webp\n', false],
    ['portfolio/attachments/sub/1.webp', false],
    ['portfolio/attachments/1).webp', false],
    ['portfolio/1.webp', false],
  ])('앱이 지은 모양 판정 %j → %s', (path, expected) => {
    expect(isAppAttachmentPath(path)).toBe(expected)
  })

  it('nextAttachmentPath가 짓는 경로는 앱이 지은 모양이다', () => {
    const stored = ['portfolio/attachments/7.webp', 'portfolio/attachments/x.jpg']
    for (const extension of ['.webp', '.jpg']) {
      expect(isAppAttachmentPath(nextAttachmentPath(portfolio(THREE), extension, []))).toBe(true)
      expect(isAppAttachmentPath(nextAttachmentPath(portfolio(THREE), extension, stored))).toBe(
        true,
      )
    }
  })

  const PIECES = [
    '[',
    ']',
    '(',
    ')',
    '![',
    '[a](',
    '](',
    'javascript:',
    'JaVaScRiPt:',
    'java&#115;cript:',
    '&#x6A;avascript:',
    'java\tscript:',
    'javascript&colon;',
    'data:text/html,x',
    'http://ok',
    '<',
    '>',
    '`',
    '\\',
    ' "t"',
    ' ',
    '\t',
    '\n',
    '\n\n',
    '[r]: ',
    '[a][r]',
  ]

  /**
   * **보안 퍼저.** 링크 조각을 셋씩 이어 답과 문서 제목에 넣는다. 링크를 거르지 않는 렌더에서 http·https가 아닌
   * `href`·`src`가 하나도 없어야 한다. 참조 정의가 걸리게 뒤에 `[r]`을 하나 붙인다.
   */
  it('링크 조각을 셋씩 이어도 http·https가 아닌 주소가 안 선다', () => {
    const broken: string[] = []
    for (const one of PIECES) {
      for (const two of PIECES) {
        for (const three of PIECES) {
          const text = `${one}${two}${three} [r] [a]`
          for (const markdown of [
            render(text),
            renderPortfolioMarkdown({ ...TEXT, title: text }, portfolio(THREE)),
          ]) {
            if (unsafeLinksIn(markdown).length > 0) broken.push(JSON.stringify(text))
          }
        }
      }
    }
    expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
  })

  /** 넷씩은 조각을 좁혀 답에만 넣는다 — 인라인 링크 하나를 조각 넷으로 짓는 모양이 여기서 닿는다. */
  it('링크 조각을 넷씩 이어도 http·https가 아닌 주소가 안 선다', () => {
    const core = [
      '[',
      '](',
      ']',
      '(',
      'javascript:',
      '&#x6A;avascript:',
      'http://ok',
      '<',
      '\\',
      '`',
      ')',
      '\n',
      '[r]: ',
    ]
    const broken: string[] = []
    for (const one of core) {
      for (const two of core) {
        for (const three of core) {
          for (const four of core) {
            const text = `${one}${two}${three}${four} [r]`
            if (unsafeLinksIn(render(text)).length > 0) broken.push(JSON.stringify(text))
          }
        }
      }
    }
    expect(broken.slice(0, 10), `${String(broken.length)} broken`).toEqual([])
  })
})

/**
 * **백틱이 많은 답도 마크다운이 곧 나온다** (R42 감사 C-1). [파일로 저장]은 내보낼 때 이 마크다운을 만들고 그동안
 * 화면이 멈춘다. 짝을 찾을 때마다 문단 앞에서부터 훑거나 한 줄의 스팬 목록을 통째로 베끼면 제곱 시간이라,
 * 고치기 전에는 짝 64,000개(256KB)에 3.5초가 걸렸다. 문항 하나의 글은 `MAX_PORTFOLIO_BYTES`까지 받는다.
 *
 * **시간을 재는 검사다.** 개발 PC에서 고친 뒤는 모양마다 0.25~0.74초이고, 한도는 그 열세 배 넘게 둔다 — 부하로는
 * 안 넘고 제곱 시간으로는 넘는다. 고치기 전 코드를 다시 심으면 우는 것까지 확인했다(R42 고침).
 */
describe('백틱이 많은 답도 마크다운이 곧 나온다', () => {
  const PAIRS = 200_000
  const BUDGET_MS = 10_000
  const shapes: Record<string, string> = {
    '짝마다 줄을 바꾼다': Array.from({ length: PAIRS }, () => '`x`').join('\n'),
    '한 줄에 다 있다': Array.from({ length: PAIRS }, () => '`x`').join(' '),
    '짝 없는 연속이 길이마다 하나씩 앞에 있다':
      Array.from({ length: 300 }, (_, index) => '`'.repeat(index + 2)).join(' ') +
      ' ' +
      Array.from({ length: PAIRS }, () => '`x`').join(' '),
  }
  for (const [name, answer] of Object.entries(shapes)) {
    it(
      name,
      () => {
        const started = performance.now()
        const markdown = renderPortfolioMarkdown(
          TEXT,
          portfolio([{ id: 'a', title: '답' }], { a: answer }),
        )
        const elapsed = performance.now() - started
        expect(markdown).toContain('`x`')
        expect(elapsed, `${String(Math.round(elapsed))} ms`).toBeLessThan(BUDGET_MS)
      },
      120_000,
    )
  }
})
