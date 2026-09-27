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
