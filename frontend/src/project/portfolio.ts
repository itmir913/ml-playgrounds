/**
 * 포트폴리오를 사람이 읽는 마크다운으로 만든다.
 *
 * **`.mlpx` 안의 `portfolio.md`가 이것이다.** 원본은 `portfolio.json`이고 이건 파생물인데,
 * 그래도 파일에 담는 이유는 **우리 앱 없이도 읽혀야 하기 때문이다** — 교사가 압축을 풀어
 * 메모장으로 열어도 학생이 무엇을 썼는지 보여야 한다 (CLAUDE.md §1.3).
 *
 * **번역 함수를 인자로 받는다.** 여기서 `useI18n()`을 부르면 zip 왕복 테스트마다
 * i18n을 부팅해야 하고, 컴포넌트 밖에서는 부를 수도 없다. 문항 문구는 로케일에 있고
 * 파일에는 id만 남는다 (mlpx-spec.md §8).
 */

import { DEFAULT_PORTFOLIO_SECTIONS, type Portfolio } from './schema'

/** 로케일 키를 문장으로 바꾸는 것. 화면은 `t`를, 테스트는 가짜를 넘긴다. */
export type Translate = (key: string) => string

export interface PortfolioSection {
  readonly id: string
  readonly title: string
  readonly answer: string
}

/**
 * 보여줄 문항들. **교사가 자기 문항을 쓴 경우가 우선이다.**
 *
 * `sections`가 있으면 그 문구는 애초에 번역 대상이 아니므로 파일에 적힌 그대로 쓴다.
 * 없으면 내장 템플릿이고 문구는 로케일에서 온다.
 */
export function portfolioSections(portfolio: Portfolio, translate: Translate): PortfolioSection[] {
  const answers = portfolio.answers
  const custom = portfolio.template.sections
  if (custom !== undefined) {
    return custom.map((section) => ({
      id: section.id,
      title: section.title,
      answer: answers[section.id] ?? '',
    }))
  }
  return DEFAULT_PORTFOLIO_SECTIONS.map((id) => ({
    id,
    title: translate(`portfolio.template.${id}`),
    answer: answers[id] ?? '',
  }))
}

/**
 * 마크다운으로 옮긴다.
 *
 * **안 쓴 문항도 제목은 남긴다.** 빈 칸이 보이는 것과 문항 자체가 사라지는 것은 다르다 —
 * 교사가 받은 파일에서 "느낀 점"이 없으면 학생이 안 쓴 것인지 문항이 없었던 것인지
 * 알 수 없다.
 *
 * 학생이 쓴 글은 **손대지 않는다.** 마크다운 특수문자를 이스케이프하지 않는 것은
 * 학생이 목록이나 굵은 글씨를 쓸 수 있어야 하기 때문이다.
 */
export function renderPortfolioMarkdown(
  projectName: string,
  portfolio: Portfolio,
  translate: Translate,
): string {
  const lines = [`# ${projectName}`, '']
  for (const section of portfolioSections(portfolio, translate)) {
    lines.push(`## ${section.title}`, '', section.answer.trim(), '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
