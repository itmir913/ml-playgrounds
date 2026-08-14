/**
 * 양식 마크다운을 문항으로 가른다 (mlpx-spec.md §8.1).
 *
 * **여기가 하는 일은 구조를 가르는 것뿐이다.** `#`은 문서 제목이고 `##`이 문항이며
 * 다음 `##`까지가 그 문항의 안내문이다. 안내문은 **글자 그대로 넘긴다** - 목록·표·
 * 강조가 살아나는 것과 살균은 markdown-it이 오는 다음 단계의 일이다
 * (`roadmap.md` V5, `open-decisions.md` "1단계도 마크다운을 읽는다").
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
 * 우리가 내보낸 양식에 박혀 있는 문항 id (§8.2).
 *
 * **제목 바로 아래 줄에 있어야 읽는다.** 그래야 마크다운 → 문항 → 마크다운 왕복이
 * 무손실이고, 제목을 다듬어도 답이 붙어 있다. 맨손으로 쓴 양식에는 이 줄이 없고
 * 그때는 제목에서 슬러그를 만든다.
 */
const ID_COMMENT = /^<!--\s*id:\s*(.+?)\s*-->$/

interface OpenSection {
  id?: string
  title: string
  body: string[]
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
  const lines = markdown.split(/\r?\n/)
  const sections: DraftSection[] = []
  let title: string | undefined
  let open: OpenSection | null = null

  for (const line of lines) {
    const heading = SECTION_HEADING.exec(line)
    if (heading) {
      if (open) sections.push(close(open))
      open = { title: (heading[1] ?? '').trim(), body: [] }
      continue
    }

    if (open === null) {
      const document = DOCUMENT_HEADING.exec(line)
      if (document && title === undefined) title = (document[1] ?? '').trim()
      continue
    }

    // id 주석은 제목과 안내문 사이에서만 읽는다. 안내문이 시작된 뒤에 나오면 그건
    // 안내문의 글자다 - 남이 쓴 양식 본문을 우리가 id로 가로채면 안 된다.
    const beforeBody = open.body.every((earlier) => earlier.trim() === '')
    const marked = beforeBody ? ID_COMMENT.exec(line.trim()) : null
    const markedId = marked?.[1]
    if (markedId !== undefined) {
      open.id = markedId
      continue
    }
    open.body.push(line)
  }
  if (open) sections.push(close(open))

  return { ...(title === undefined || title === '' ? {} : { title }), sections }
}
