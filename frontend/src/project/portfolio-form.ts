/**
 * 양식 마크다운을 문항으로 가른다 (mlpx-spec.md §8.1).
 *
 * **여기가 하는 일은 구조를 가르는 것뿐이다.** `#`은 문서 제목이고 `##`이 문항이며
 * 다음 `##`까지가 그 문항의 안내문이다. 안내문을 그리는 것과 살균은
 * `portfolio-markdown.ts`가 한다.
 *
 * **출처가 달라도 여기 하나를 지난다** (§8.7). 내장 프리셋이든 파일이든 주소든
 * 돌려주는 것은 마크다운 문자열 하나이고, 파싱과 문항 세우기는 한 벌이다 - 입구가
 * 늘었다고 방어선이 갈라지면 그 자리가 곧 구멍이다.
 */

import type { DraftSection } from './portfolio'

export interface ParsedForm {
  /** 양식의 문서 제목. **없어도 된다** (§8.1) - 문항이 아니다. */
  readonly title?: string
  readonly sections: readonly DraftSection[]
}

/** 문항 제목 줄. `##`이고, `###` 아래는 안내문의 일부다. */
const SECTION_HEADING = /^##(?!#)\s*(.*)$/

/** 문서 제목 줄. */
const DOCUMENT_HEADING = /^#(?!#)\s*(.*)$/

/**
 * 제목 줄에 적힌 문항 id (§8.2). `## 이 주제를 선택한 이유 {#topic}`
 *
 * **Pandoc 계열의 관행이다**(kramdown·MkDocs·Quarto가 같은 것을 쓴다). 우리가 내보낸
 * 양식에는 이것이 있어서 제목을 다듬어도 답이 붙어 있고, 맨손으로 쓴 양식에는 없어서
 * 제목에서 슬러그를 만든다 - **둘 다 열려야 한다.**
 */
const HEADING_ID = /\s*\{#([\w-]+)\}\s*$/

/**
 * HTML 주석. **양식을 읽을 때 통째로 걷어낸다** (§8.2).
 *
 * 그것은 양식을 쓴 사람의 메모이지 학생이 읽을 안내문이 아니다. 남겨 두면
 * `html: false`인 렌더러가 그것을 **글자로** 보여준다 - `<!-- 여기 고칠 것 -->`이
 * 학생 화면에 그대로 뜬다 (§8.1).
 */
const HTML_COMMENT = /<!--[\s\S]*?-->/g

interface OpenSection {
  readonly id: string | undefined
  readonly title: string
  readonly body: string[]
}

/** 제목에서 id를 떼어낸다. 없으면 제목만 돌아온다. */
function splitHeading(text: string): { title: string; id: string | undefined } {
  const marked = HEADING_ID.exec(text)
  if (marked === null) return { title: text.trim(), id: undefined }
  return { title: text.replace(HEADING_ID, '').trim(), id: marked[1] }
}

function close(open: OpenSection): DraftSection {
  const description = open.body.join('\n').trim()
  return {
    ...(open.id === undefined ? {} : { id: open.id }),
    title: open.title,
    ...(description === '' ? {} : { description }),
  }
}

/**
 * 양식을 읽는다.
 *
 * 문항 앞에 있는 글은 버린다 - 문서 머리말이고 어느 문항의 것도 아니다. 제목이 빈
 * `##`도 문항으로 센다: 그 자리에 문항이 하나 있었다는 사실은 제목이 비었다고
 * 사라지지 않고, id는 순번으로 떨어진다 (`sectionIdFor`).
 */
export function parsePortfolioForm(markdown: string): ParsedForm {
  const lines = markdown.replace(HTML_COMMENT, '').split(/\r?\n/)
  const sections: DraftSection[] = []
  let title: string | undefined
  let open: OpenSection | null = null

  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line)
    if (heading) {
      if (open) sections.push(close(open))
      open = { ...splitHeading(heading[1] ?? ''), body: [] }
      continue
    }

    if (open === null) {
      const document = DOCUMENT_HEADING.exec(line)
      if (document && title === undefined) title = splitHeading(document[1] ?? '').title
      continue
    }

    open.body.push(line)
  }
  if (open) sections.push(close(open))

  return { ...(title === undefined || title === '' ? {} : { title }), sections }
}
