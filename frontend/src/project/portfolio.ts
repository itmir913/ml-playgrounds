/**
 * 포트폴리오 - 문항과 답을 다루는 순수 함수들, 그리고 사람이 읽는 마크다운.
 *
 * **양식은 마크다운이고 답은 서식 없는 글이다** (mlpx-spec.md §8). 문항을 더하고
 * 지우고 옮기는 판단이 전부 여기 있고 화면은 결과를 받아 그린다 - 컴포넌트 안에 두면
 * 아무도 그 판단을 테스트하지 않는다 (CLAUDE.md §4).
 *
 * **여기는 i18n을 모른다.** 문항 문구는 쓴 사람의 말이라 애초에 번역 대상이 아니고,
 * `.md` 머리글의 라벨은 부르는 쪽이 만들어 넘긴다 (§8.6).
 */

import { DIR } from './format'
import type { Portfolio, PortfolioTemplateSection } from './schema'

/** 아직 id가 없는 문항. 마크다운에서 갓 읽어 온 것과 화면이 새로 만드는 것이 이 모양이다. */
export interface DraftSection {
  /** 양식에 주석으로 박혀 있던 id (§8.2). 없으면 제목에서 만든다. */
  readonly id?: string
  readonly title: string
  readonly description?: string
}

/** 화면이 문항 하나를 그리는 데 필요한 것 전부. */
export interface PortfolioSection extends PortfolioTemplateSection {
  readonly answer: string
}

/** 지금 양식에 없는 id에 붙어 있는 답 (§8.4). */
export interface OrphanAnswer {
  readonly id: string
  readonly answer: string
}

/** 슬러그를 만들 수 없는 제목이 떨어지는 자리. 뒤에 순번이 붙는다 (§8.2). */
const FALLBACK_ID_PREFIX = 'section'

/** 슬러그에 남길 글자. 한글도 글자다 - 라틴 문자만 남기면 한국어 제목이 전부 순번이 된다. */
const NOT_IN_SLUG = /[^\p{L}\p{N}]+/gu

const TRIM_DASHES = /^-+|-+$/g

export function sectionsOf(portfolio: Portfolio): readonly PortfolioTemplateSection[] {
  return portfolio.template.sections
}

/**
 * 양식을 골랐는가. **비어 있는 것이 "아직 안 골랐다"다** (mlpx-spec.md §8.5).
 * 화면은 이것이 거짓일 때 시작 화면을 낸다.
 */
export function hasTemplate(portfolio: Portfolio): boolean {
  return portfolio.template.sections.length > 0
}

/** 화면이 그릴 문항들. 답을 문항에 붙여 준다. */
export function portfolioSections(portfolio: Portfolio): PortfolioSection[] {
  return portfolio.template.sections.map((section) => ({
    ...section,
    answer: portfolio.answers[section.id] ?? '',
  }))
}

/**
 * 제목에서 문항 id를 만든다 (§8.2).
 *
 * **순서 번호로 하지 않는다** - 문항 순서를 바꾸는 순간 답이 엉뚱한 문항에 조용히
 * 붙는다. 슬러그는 제목을 고치면 답이 떨어져 나가지만 그건 화면에 보인다.
 *
 * 기호만 있는 제목처럼 만들 수 없는 것은 순번으로 떨어진다. **순번은 그 양식 안에서의
 * 자리다** - 같은 양식을 두 번 가져와도 같은 id가 나와야 다시 안 붙는다 (§8.3).
 */
export function sectionIdFor(title: string, index: number): string {
  const slug = title.trim().toLowerCase().replace(NOT_IN_SLUG, '-').replace(TRIM_DASHES, '')
  return slug === '' ? `${FALLBACK_ID_PREFIX}-${index + 1}` : slug
}

/** 이미 쓰인 id를 피해 번호를 붙인다. 겹치는 제목이 한 양식 안에 둘 있을 수 있다. */
function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

function draftToSection(draft: DraftSection, id: string): PortfolioTemplateSection {
  const description = draft.description?.trim()
  return {
    id,
    title: draft.title.trim(),
    ...(description === undefined || description === '' ? {} : { description }),
  }
}

/**
 * 가져온 문항을 뒤에 붙인다. **대체가 아니라 추가다** (mlpx-spec.md §8.3).
 *
 * **이미 있는 id는 다시 붙이지 않는다.** 그래야 두 번 눌러도 문항이 불어나지 않고,
 * 그 문항에 쓴 글도 안 흔들린다. 밖에 이미 있는 것에 번호를 붙이지 않는 이유가
 * 그것이다 - 번호를 붙이면 같은 양식을 가져올 때마다 사본이 쌓인다.
 */
export function withImportedSections(
  portfolio: Portfolio,
  drafts: readonly DraftSection[],
): Portfolio {
  const existing = new Set(portfolio.template.sections.map((section) => section.id))
  const added: PortfolioTemplateSection[] = []
  drafts.forEach((draft, index) => {
    const natural = draft.id ?? sectionIdFor(draft.title, index)
    if (existing.has(natural)) return
    added.push(draftToSection(draft, natural))
    existing.add(natural)
  })
  if (added.length === 0) return portfolio
  return {
    ...portfolio,
    template: { ...portfolio.template, sections: [...portfolio.template.sections, ...added] },
  }
}

/**
 * 사람이 문항 하나를 더한다.
 *
 * **가져오기와 다르다** - 여기서는 id가 겹쳐도 건너뛰지 않고 번호를 받는다. 누른
 * 사람은 문항이 하나 늘기를 기대했고, 아무 일도 안 일어나는 것은 고장으로 읽힌다.
 */
export function withSectionAdded(portfolio: Portfolio, draft: DraftSection): Portfolio {
  const taken = new Set(portfolio.template.sections.map((section) => section.id))
  const id = uniqueId(draft.id ?? sectionIdFor(draft.title, taken.size), taken)
  return {
    ...portfolio,
    template: {
      ...portfolio.template,
      sections: [...portfolio.template.sections, draftToSection(draft, id)],
    },
  }
}

/**
 * 문항을 지운다. **그 문항의 답도 함께 지운다** (mlpx-spec.md §8.4).
 *
 * 되돌릴 수 없다. 의도가 분명하기 때문이다 - 지우겠다고 누른 것이다. 답이 유령으로
 * 파일에 남으면 크기만 먹고 아무도 못 본다.
 */
export function withSectionRemoved(portfolio: Portfolio, id: string): Portfolio {
  const sections = portfolio.template.sections.filter((section) => section.id !== id)
  if (sections.length === portfolio.template.sections.length) return portfolio
  const answers = { ...portfolio.answers }
  delete answers[id]
  // **첨부도 함께 지운다.** 문서에서만 떼면 사진 바이트가 파일에 남아 크기만 먹고
  // 아무도 못 본다 - 저장할 때 아무도 안 가리키는 것은 안 담긴다(`keptAttachments`).
  const attachments = { ...portfolio.attachments }
  delete attachments[id]
  return { ...portfolio, template: { ...portfolio.template, sections }, answers, attachments }
}

/** 문항을 한 칸 옮긴다. 끝에서 더 가면 아무 일도 안 일어난다. */
export function withSectionMoved(portfolio: Portfolio, id: string, delta: number): Portfolio {
  const sections = [...portfolio.template.sections]
  const from = sections.findIndex((section) => section.id === id)
  const to = from + delta
  if (from === -1 || to < 0 || to >= sections.length) return portfolio
  const [moved] = sections.splice(from, 1)
  if (moved === undefined) return portfolio
  sections.splice(to, 0, moved)
  return { ...portfolio, template: { ...portfolio.template, sections } }
}

/**
 * 문항의 문구를 고친다. **id는 안 건드린다** - 제목을 다듬었다고 쓴 글이 떨어져
 * 나가면 아무도 제목을 못 고친다.
 *
 * **쓴 그대로 담는다. 여기서 다듬지 않는다** (2026-08-14에 고쳤다). 타자마다 `trim()`을
 * 걸었더니 **안내문에 줄바꿈을 칠 수 없었다** - 끝에 친 `\n`이 잘려 저장된 값이 화면과
 * 달라지고, Vue는 DOM의 지금 값과 새 값을 견주므로(`patchDOMProp`) 그때 칸을 다시
 * 써서 방금 친 줄바꿈을 지운다. 제목 끝의 공백도 같은 이유로 안 지운다.
 *
 * **비어 있으면 자리 자체를 지운다.** 빈 문자열을 파일에 남기지 않는다 - 안내문이
 * 없는 것과 빈 안내문이 있는 것은 같은 것이다.
 */
export function withSectionText(
  portfolio: Portfolio,
  id: string,
  patch: { readonly title?: string; readonly description?: string },
): Portfolio {
  const sections = portfolio.template.sections.map((section) => {
    if (section.id !== id) return section
    const description = patch.description ?? section.description
    const blank = description === undefined || description.trim() === ''
    // **`description`을 먼저 떼어낸다.** 안 떼면 비웠을 때 옛 안내문이 그대로 남는다.
    const { description: cleared, ...rest } = section
    void cleared
    return {
      ...rest,
      title: patch.title ?? section.title,
      ...(blank ? {} : { description }),
    }
  })
  return { ...portfolio, template: { ...portfolio.template, sections } }
}

/** 답을 갈아 끼운다. 쓴 그대로 담는다 - 다듬는 것은 읽는 쪽이 한다. */
export function withAnswer(portfolio: Portfolio, id: string, answer: string): Portfolio {
  return { ...portfolio, answers: { ...portfolio.answers, [id]: answer } }
}

/** 이 문항에 붙은 사진들. 붙인 순서가 곧 보이는 순서다. */
export function attachmentsOf(portfolio: Portfolio, sectionId: string): readonly string[] {
  return portfolio.attachments[sectionId] ?? []
}

/** 파일 안에서 누군가 가리키고 있는 사진 경로 전부. */
export function referencedAttachments(portfolio: Portfolio): Set<string> {
  return new Set(Object.values(portfolio.attachments).flat())
}

/**
 * 다음 사진이 가질 경로.
 *
 * **있는 것들의 최대 번호 + 1이다.** 개수로 세면 지웠다 붙일 때 번호가 되풀이되고,
 * 그러면 옛 무결성 기록과 같은 이름의 다른 사진이 생긴다.
 */
export function nextAttachmentPath(portfolio: Portfolio, extension: string): string {
  const numbers = [...referencedAttachments(portfolio)].map((path) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return Number.parseInt(name, 10)
  })
  const last = Math.max(0, ...numbers.filter((one) => Number.isFinite(one)))
  return `${DIR.attachments}${last + 1}${extension}`
}

/** 사진 하나를 문항에 붙인다. **답 아래에 카드로 붙는다** - 문단 중간에는 못 꽂는다. */
export function withAttachmentAdded(
  portfolio: Portfolio,
  sectionId: string,
  path: string,
): Portfolio {
  return {
    ...portfolio,
    attachments: {
      ...portfolio.attachments,
      [sectionId]: [...attachmentsOf(portfolio, sectionId), path],
    },
  }
}

/** 사진 하나를 뗀다. 마지막 한 장을 떼면 그 문항의 자리도 없앤다. */
export function withAttachmentRemoved(
  portfolio: Portfolio,
  sectionId: string,
  path: string,
): Portfolio {
  const kept = attachmentsOf(portfolio, sectionId).filter((one) => one !== path)
  const attachments = { ...portfolio.attachments }
  if (kept.length === 0) delete attachments[sectionId]
  else attachments[sectionId] = kept
  return { ...portfolio, attachments }
}

/**
 * 지금 양식에 없는 id의 답 (mlpx-spec.md §8.4).
 *
 * 정상 경로로는 안 생긴다 - 문항을 지우면 답도 함께 지우고, 가져오기는 대체가 아니다.
 * **그래도 버리지 않는다.** 남이 손으로 고친 파일에서는 올 수 있고, 그때 조용히
 * 지우면 그 파일을 준 사람의 글이 말없이 사라진다.
 */
export function orphanAnswers(portfolio: Portfolio): OrphanAnswer[] {
  const known = new Set(portfolio.template.sections.map((section) => section.id))
  return Object.entries(portfolio.answers)
    .filter(([id, answer]) => !known.has(id) && answer.trim() !== '')
    .map(([id, answer]) => ({ id, answer }))
}

/**
 * 체크리스트가 완료로 넘어가는 기준 (mlpx-spec.md §8.3).
 *
 * **"한 글자라도 썼는가"가 아니라 "모든 문항에 답이 있는가"다.** 딸려 오는 것 셋 -
 * 문항을 새로 추가하면 완료가 다시 풀리고(자기가 늘린 것이다), 지금 양식에 없는
 * 문항의 답은 안 세며, 양식을 아직 고르지 않았으면 완료가 아니다.
 */
export function isPortfolioAnswered(portfolio: Portfolio): boolean {
  if (!hasTemplate(portfolio)) return false
  return portfolio.template.sections.every(
    (section) => (portfolio.answers[section.id] ?? '').trim() !== '',
  )
}

const encoder = new TextEncoder()

/**
 * 포트폴리오가 차지하는 글의 바이트 수. 상한 판정에 쓴다 (mlpx-spec.md §8.6.1).
 *
 * **첨부도 나중에 같은 상한에 합류한다.** 문항마다 나누지 않는 이유는 나누면 어느
 * 칸이 얼마인지를 설명해야 하기 때문이다.
 */
export function portfolioTextBytes(portfolio: Portfolio): number {
  let bytes = 0
  for (const section of portfolio.template.sections) {
    bytes += encoder.encode(section.title).length
    bytes += encoder.encode(section.description ?? '').length
  }
  for (const answer of Object.values(portfolio.answers)) {
    bytes += encoder.encode(answer).length
  }
  return bytes
}

/**
 * 글과 첨부를 합친 크기. **상한이 보는 값이다** (mlpx-spec.md §8.6.1).
 *
 * 문항마다 나누지 않는다 - 나누면 어느 칸이 얼마인지를 설명해야 한다.
 */
export function portfolioBytes(
  portfolio: Portfolio,
  attachments: ReadonlyMap<string, Uint8Array>,
): number {
  let bytes = portfolioTextBytes(portfolio)
  for (const path of referencedAttachments(portfolio)) {
    bytes += attachments.get(path)?.byteLength ?? 0
  }
  return bytes
}

/**
 * `.md` 머리글과 라벨. **부르는 쪽이 만들어 넘긴다** (mlpx-spec.md §8.6).
 *
 * 포맷 계층은 `t()`를 모른다 - i18n을 끌어들이면 zip 왕복 테스트마다 번역을 부팅해야
 * 한다.
 */
export interface PortfolioMarkdownText {
  /** 문서 제목. 프로젝트 이름이다. */
  readonly title: string
  /** 머리에 적는 프로젝트 정보. 화면에서는 `ProjectSummary`가 하는 일이다. */
  readonly rows: readonly (readonly [label: string, value: string])[]
  /** 지금 양식에 없는 답을 모아 두는 자리의 제목. */
  readonly orphanTitle: string
}

/** 줄머리의 `#`. 앞의 여백까지 함께 본다 - 세 칸까지 들여쓴 제목도 제목으로 읽힌다. */
const LINE_LEADING_HASH = /^(\s{0,3})(#+)/

/** 단독으로 서면 앞줄을 제목으로 만드는 줄. */
const SETEXT_UNDERLINE = /^(\s{0,3})(-{2,}|={2,})\s*$/

/**
 * 답을 `.md`에 담을 수 있게 만든다.
 *
 * **읽기 좋은 것이 기준이다** (mlpx-spec.md §8.6). 전부 이스케이프하면 안전하기는
 * 한데 읽으라고 만든 파일을 읽기 나쁘게 만든다 - 메모장으로 열면 `\#`이 보인다.
 * 막을 것은 **문항 구조를 깨는 것뿐**이고, 답에 목록이나 강조가 들어가 그대로
 * 살아나는 것은 사고가 아니라 잘 된 것이다.
 */
function escapeAnswer(answer: string): string {
  return answer
    .split('\n')
    .map((line) =>
      line
        .replace(LINE_LEADING_HASH, '$1\\$2')
        .replace(SETEXT_UNDERLINE, (_match, indent: string, rule: string) => `${indent}\\${rule}`),
    )
    .join('\n')
}

/** 머리글 값은 한 줄에 담긴다. 줄바꿈이 들어오면 목록이 깨진다. */
function oneLine(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').trim()
}

/**
 * 포트폴리오를 사람이 읽는 마크다운으로 만든다. **`.mlpx` 안의 `portfolio.md`가
 * 이것이다.**
 *
 * 원본은 `portfolio.json`이고 이건 파생물인데, 그래도 파일에 담는 이유는 **우리 앱
 * 없이도 읽혀야 하기 때문이다** - 교사가 압축을 풀어 메모장으로 열어도 학생이 무엇을
 * 썼는지 보여야 한다 (CLAUDE.md §1.3).
 *
 * **머리에 프로젝트 정보를 적는다** (§8.6). 화면에서는 `ProjectSummary`가 그 일을
 * 하는데, 파일만 받은 사람은 그 화면을 못 본다.
 *
 * **안 쓴 문항도 제목은 남긴다.** 빈 칸이 보이는 것과 문항이 사라지는 것은 다르다 -
 * 받은 파일에 "느낀 점"이 없으면 안 쓴 것인지 문항이 없었던 것인지 알 수 없다.
 */
export function renderPortfolioMarkdown(text: PortfolioMarkdownText, portfolio: Portfolio): string {
  const lines = [`# ${oneLine(text.title)}`, '']
  for (const [label, value] of text.rows) {
    lines.push(`- **${oneLine(label)}**: ${oneLine(value)}`)
  }
  if (text.rows.length > 0) lines.push('')

  for (const section of portfolioSections(portfolio)) {
    lines.push(`## ${oneLine(section.title)}`, '')
    const answer = escapeAnswer(section.answer.trim())
    if (answer !== '') lines.push(answer, '')
    // **사진은 상대 경로로 적는다** (§8.6.1). `portfolio/document.md`에서 본 자리이고,
    // 압축을 푼 뒤에도 그대로 맞는다 - 안 적으면 파일만 받은 사람에게는 사진이 없다.
    for (const path of attachmentsOf(portfolio, section.id)) {
      lines.push(`![](${path.slice(DIR.portfolio.length)})`, '')
    }
  }

  // 지금 양식에 없는 답도 파일에 남긴다. 화면이 "이전 문항의 답"으로 보여주는 것과
  // 같은 것이고, 여기서 빠뜨리면 파일만 받은 사람에게는 그 글이 없는 것이 된다.
  const orphans = orphanAnswers(portfolio)
  if (orphans.length > 0) {
    lines.push(`## ${oneLine(text.orphanTitle)}`, '')
    for (const orphan of orphans) {
      lines.push(escapeAnswer(orphan.answer.trim()), '')
    }
  }

  return `${lines.join('\n').trimEnd()}\n`
}
