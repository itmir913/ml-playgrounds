/**
 * **규칙 문서와 판례가 짝으로 맞물리고, 결정문이 상태를 갖는가** (`docs/workflow.md` §8).
 *
 * - `docs/X.md`마다 `docs/cases/X.md`가 있고 그 반대도 같다.
 * - 규칙 문서는 자기 판례를 이름으로 가리키고, 판례 색인은 판례 파일을 전부 싣는다.
 * - 결정문(`###`)마다 표제 바로 아래 `**[미정]**`·`**[결정]**` 한 줄이 있고, 그 표제가 판례에 그대로 있다.
 *
 * **못 보는 것** — 상태가 사실과 맞는지(미정인데 결정이라 적었는지), 결론 한 문장이 판례와 같은 말인지.
 * 그건 사람이 읽는다.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const DOCS = join(process.cwd(), '..', 'docs')
const CASES = join(DOCS, 'cases')

/** 판례 짝이 없는 문서 — 문서가 아니라 기록 보관소다. */
const NOT_RULE_DOCS = new Set<string>()

/** 결정문 상태로 허락된 두 표기. */
export const STATUSES = ['**[미정]**', '**[결정]**'] as const

const NEWLINE = /\r?\n/

/** 울타리 밖의 `###` 표제와, 그 바로 아래 첫 글줄. */
export function decisions(text: string): { heading: string; status: string }[] {
  const lines = text.split(NEWLINE)
  const found: { heading: string; status: string }[] = []
  let fenced = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced || !/^###\s/.test(line)) continue
    let j = i + 1
    while (j < lines.length && (lines[j] ?? '').trim() === '') j++
    found.push({ heading: line, status: (lines[j] ?? '').split(' ')[0] ?? '' })
  }
  return found
}

/** 허브의 결정문은 `## 결정됨`(차례) 앞까지다. */
function decisionTexts(): { name: string; text: string }[] {
  const hub = readFileSync(join(DOCS, 'open-decisions.md'), 'utf-8')
  const texts = [{ name: 'open-decisions.md', text: hub.split(/^## 결정됨/m)[0] ?? '' }]
  for (const entry of readdirSync(join(DOCS, 'open-decisions')).sort()) {
    if (entry.endsWith('.md')) {
      texts.push({
        name: `open-decisions/${entry}`,
        text: readFileSync(join(DOCS, 'open-decisions', entry), 'utf-8'),
      })
    }
  }
  return texts
}

const RULE_DOCS = readdirSync(DOCS).filter(
  (entry) => entry.endsWith('.md') && !NOT_RULE_DOCS.has(entry),
)
const CASE_DOCS = readdirSync(CASES).filter(
  (entry) => entry.endsWith('.md') && entry !== 'README.md',
)

/** 허브의 차례가 시작하는 표제. 그 뒤는 절 제목(주소)을 옮긴 줄이라 날짜가 남는다. */
const INDEX_HEADINGS = /^## (차례|단계별 기록|결정됨)/m

/** 규칙 문서 본문의 날짜. 표제·목록 줄·울타리 안·차례 뒤는 뺀다. */
export function bodyDates(text: string): string[] {
  const body = text.split(INDEX_HEADINGS)[0] ?? ''
  const found: string[] = []
  let fenced = false
  body.split(NEWLINE).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced || /^#/.test(line) || /^\s*- /.test(line)) return
    if (/\b20\d\d-\d\d-\d\d\b/.test(line)) found.push(`${index + 1}: ${line.trim()}`)
  })
  return found
}

/** 규칙 문서 전부 — 허브와 스포크. 판례와 감사 보고서는 뺀다. */
function ruleFiles(): { name: string; text: string }[] {
  const files: { name: string; text: string }[] = []
  for (const entry of readdirSync(DOCS, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push({ name: entry.name, text: readFileSync(join(DOCS, entry.name), 'utf-8') })
    } else if (entry.isDirectory() && entry.name !== 'cases' && entry.name !== 'audit') {
      for (const spoke of readdirSync(join(DOCS, entry.name))) {
        if (spoke.endsWith('.md')) {
          const name = `${entry.name}/${spoke}`
          files.push({ name, text: readFileSync(join(DOCS, name), 'utf-8') })
        }
      }
    }
  }
  return files
}

describe('규칙 문서의 본문에 날짜가 없다', () => {
  it('날짜는 표제와 차례에만 있다', () => {
    const dated = ruleFiles().flatMap(({ name, text }) =>
      bodyDates(text).map((line) => `${name}:${line}`),
    )
    expect(dated, 'dates belong in docs/cases/, not in rule docs').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    const sample =
      '# 제목 (2026-01-01)\n\n본문 (2026-01-02)\n- 차례 (2026-01-03)\n\n## 차례\n본문 (2026-01-04)'
    expect(bodyDates(sample)).toEqual(['3: 본문 (2026-01-02)'])
  })
})

/**
 * "위 셋"·"아래의 둘"·"다음 3개"처럼 목록을 개수로 가리키는 말. 항목이 늘거나 줄면 곧바로 낡는다.
 * 사이에 꾸밈(`` ` ``·`**`·따옴표)과 줄바꿈이 껴도 같은 말이다 — 위 `셋`이다.
 * 앞에 낱말 경계를 요구한다 — "단위 셋"의 "위"는 가리키는 말이 아니다.
 */
export const COUNTED_REFERENCE =
  /(?:^|[\s('"“*`])(위|아래|앞|뒤|다음)의?[\s*`'"“”]+(둘|셋|넷|다섯|여섯|일곱|여덟|아홉|열|\d+\s*개)/g

/** 글 전체에서 개수로 가리키는 말이 선 줄 번호. 줄바꿈을 건너 갈린 말도 잡는다. */
export function countedReferences(text: string): number[] {
  return [...text.matchAll(COUNTED_REFERENCE)].map(
    (match) => text.slice(0, (match.index ?? 0) + match[0].length).split(NEWLINE).length,
  )
}

describe('규칙 문서가 목록을 개수로 가리키지 않는다', () => {
  it('"위 셋" 같은 말이 없다', () => {
    const counted = [
      { name: 'CLAUDE.md', text: readFileSync(join(DOCS, '..', 'CLAUDE.md'), 'utf-8') },
      ...ruleFiles(),
    ].flatMap(({ name, text }) => countedReferences(text).map((line) => `${name}:${line}`))
    expect(counted, 'name the items instead of counting them').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    const hits = (text: string): number => countedReferences(text).length
    expect(hits('위 셋을 막는다')).toBe(1)
    expect(hits('아래의 둘')).toBe(1)
    expect(hits('규칙은 위 셋이다')).toBe(1)
    expect(hits('위 `둘`이다')).toBe(1)
    expect(hits('위 **셋**이다')).toBe(1)
    expect(hits('다음 3개를 막는다')).toBe(1)
    expect(hits('규칙은 위\n셋이다')).toBe(1)
    expect(hits('셋을 막는다')).toBe(0)
    expect(hits('계수와 단위 셋')).toBe(0)
  })
})

describe('규칙과 판례가 맞물린다', () => {
  it('읽을 것이 실제로 있다', () => {
    expect(RULE_DOCS.length).toBeGreaterThan(8)
    expect(CASE_DOCS.length).toBeGreaterThan(8)
  })

  it('규칙 문서마다 같은 이름의 판례가 있다', () => {
    expect(
      RULE_DOCS.filter((name) => !existsSync(join(CASES, name))),
      'rule doc without a case file',
    ).toEqual([])
  })

  it('판례마다 같은 이름의 규칙 문서가 있다', () => {
    expect(
      CASE_DOCS.filter((name) => !existsSync(join(DOCS, name))),
      'case file without a rule doc',
    ).toEqual([])
  })

  it('규칙 문서는 자기 판례를 가리킨다', () => {
    const silent = RULE_DOCS.filter(
      (name) => !readFileSync(join(DOCS, name), 'utf-8').includes(`docs/cases/${name}`),
    )
    expect(silent, 'rule doc does not point at its case file').toEqual([])
  })

  it('판례 색인이 판례 파일을 전부 싣는다', () => {
    const index = readFileSync(join(CASES, 'README.md'), 'utf-8')
    expect(
      CASE_DOCS.filter((name) => !index.includes(`(${name})`)),
      'case file missing from index',
    ).toEqual([])
  })
})

describe('결정문은 상태를 갖고 판례에 이어진다', () => {
  const CASE_TEXT = readFileSync(join(CASES, 'open-decisions.md'), 'utf-8').split(NEWLINE)
  const all = decisionTexts().flatMap(({ name, text }) =>
    decisions(text).map((decision) => ({ ...decision, name })),
  )

  it('결정문을 실제로 찾는다', () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it('상태는 [미정]·[결정] 둘뿐이다', () => {
    const bad = all
      .filter(({ status }) => !(STATUSES as readonly string[]).includes(status))
      .map(({ name, heading, status }) => `${name}  ${heading}  -> ${status}`)
    expect(bad, 'decision without an allowed status').toEqual([])
  })

  it('결정문의 표제가 판례에 그대로 있다', () => {
    const orphans = all
      .filter(({ heading }) => !CASE_TEXT.includes(heading))
      .map(({ name, heading }) => `${name}  ${heading}`)
    expect(orphans, 'decision heading missing from cases/open-decisions.md').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    const sample = '### 1. 가\n\n**[결정]** 경위\n\n### 2. 나\n본문\n\n```\n### 울타리 안\n```'
    expect(decisions(sample)).toEqual([
      { heading: '### 1. 가', status: '**[결정]**' },
      { heading: '### 2. 나', status: '본문' },
    ])
  })
})
