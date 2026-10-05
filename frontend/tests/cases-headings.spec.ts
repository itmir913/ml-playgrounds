/**
 * **판례의 절은 규칙 문서의 절과 짝이다** (`docs/cases/README.md`, `docs/workflow.md` §6).
 *
 * `docs/cases/X.md`는 `docs/X.md`(허브)와 `docs/X/*.md`(스포크)를 따라간다. 절 번호와
 * 제목이 주소라서, 판례 쪽 절이 규칙 문서에 없는 이름을 달면 "같은 절에 이유가 있다"는
 * 가리킴이 어디에도 닿지 않는다.
 *
 * **무는 것** — `## 판례` 밖에서,
 *
 * - `##` 표제는 허브나 스포크의 어느 표제와 **같은 주소**여야 한다. 주소는 장식(`**`·백틱·`~~`)과
 *   뒤의 부연(`— 경위`, `(2026-09-03)`)을 뗀 앞쪽이다 (`doc-refs.spec.ts`의 `indexKey`와 같다).
 * - 번호를 단 표제(`### 8.13.1 …`)는 **깊이와 상관없이** 그 번호가 허브나 스포크에 있어야 한다.
 *
 * **못 보는 것** — 알고 두는 구멍이다.
 *
 * - **번호 없는 `###` 이하.** 짝을 이룬 절 안에서 판례가 제 구조로 쓰는 소제목이다.
 *   날짜를 단 기록이 절 안에 있는 것도 이 저장소의 관행이라(`architecture.md` §8.13.1 아래처럼)
 *   사고 한 건이 `## 판례` 대신 절 안에 들어가도 못 가른다. 사람이 읽는다.
 * - **번호는 맞는데 제목이 다른 절.** 번호만 맞춘다 — 부연이 붙은 제목은 판례 쪽이 더 길다.
 * - **`#` 표제.** 갈라져 나온 스포크를 이어 붙인 파일은 `#`가 여럿이라 보지 않는다.
 *   그 아래 `##`는 위 규칙대로 본다.
 * - **허브에만 있고 판례에 없는 절.** 이유가 없는 절도 있다.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const DOCS = join(process.cwd(), '..', 'docs')
const CASES = join(DOCS, 'cases')
const NEWLINE = /\r?\n/

interface Heading {
  level: number
  line: string
}

/** 울타리 밖의 표제. */
function headings(text: string): Heading[] {
  const found: Heading[] = []
  let fenced = false
  for (const line of text.split(NEWLINE)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    const match = fenced ? null : /^(#{1,6})\s/.exec(line)
    if (match) found.push({ level: match[1]!.length, line })
  }
  return found
}

/** 장식을 걷어낸 표제. */
function clean(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/[~*`]/g, '')
    .trim()
}

/** 주소로 쓰이는 앞쪽. 부연(`— …`)과 끝의 날짜 괄호를 뗀다. */
export function addressOf(line: string): string {
  return clean(line)
    .split(/\s[—–]\s/)[0]!
    .replace(/\s*\((?:V\d+,?\s*)?\d{4}-\d{2}-\d{2}\)\s*$/, '')
    .trim()
}

/** 표제가 이고 있는 번호. `### 8.13.1 예측 화면` -> `8.13.1`. */
export function numberOf(line: string): string | null {
  const match = /^(\d+(?:\.\d+)*|\d+-\d+)\.?(?:\s|$)/.exec(clean(line))
  return match ? match[1]! : null
}

/** 허브와 스포크의 표제 전부. */
function ruleHeadings(name: string): Heading[] {
  const found = headings(readFileSync(join(DOCS, name), 'utf-8'))
  const spokes = join(DOCS, name.replace(/\.md$/, ''))
  if (existsSync(spokes)) {
    for (const entry of readdirSync(spokes).sort()) {
      if (entry.endsWith('.md')) found.push(...headings(readFileSync(join(spokes, entry), 'utf-8')))
    }
  }
  return found
}

/** 판례 파일에서 짝이 없는 표제. */
export function unpaired(caseText: string, rule: readonly Heading[]): string[] {
  const addresses = new Set(rule.map((h) => addressOf(h.line)))
  const numbers = new Set(rule.map((h) => numberOf(h.line)).filter((n) => n !== null))
  const bad: string[] = []
  let inCases = false
  for (const h of headings(caseText)) {
    if (h.level === 1) continue
    if (h.level === 2) inCases = addressOf(h.line) === '판례'
    if (inCases) continue
    const number = numberOf(h.line)
    if (h.level === 2 && !addresses.has(addressOf(h.line))) bad.push(h.line)
    else if (number !== null && !numbers.has(number)) bad.push(h.line)
  }
  return bad
}

const CASE_FILES = readdirSync(CASES)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .sort()

describe('판례의 절은 규칙 문서의 절과 짝이다', () => {
  it.each(CASE_FILES)('%s', (name) => {
    const caseText = readFileSync(join(CASES, name), 'utf-8')
    expect(
      unpaired(caseText, ruleHeadings(name)),
      `headings in docs/cases/${name} with no matching heading in docs/${name} or its spokes`,
    ).toEqual([])
  })

  it('짝이 없는 절과 번호를 잡는다', () => {
    const rule = headings('# T\n## 0. 여는 법\n### 8.1 화면\n## 판례\n')
    const sample = [
      '# T — 이유',
      '## 왜 세웠나',
      '## 0. 여는 법 — 경위',
      '### 왜 세웠나',
      '### 8.2 없는 번호',
      '## 판례',
      '### 2026-10-01 — 무엇이든',
    ].join('\n')
    expect(unpaired(sample, rule)).toEqual(['## 왜 세웠나', '### 8.2 없는 번호'])
  })
})
