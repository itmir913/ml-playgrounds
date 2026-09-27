/**
 * **`CLAUDE.md`가 다시 불어나지 않는가.**
 *
 * `CLAUDE.md`는 모든 세션이 맨 먼저 통째로 읽는다. 규칙과 한 줄 이유만 두고, 날짜와
 * 사고 경위는 `docs/cases/`의 판례로 보낸다 (`docs/workflow.md` §8).
 *
 * **못 보는 것** — 날짜 없이 적은 경위("그때 또 그랬다")와, 상한 안에서 규칙이 아닌
 * 것이 늘어나는 것. 상한은 그것을 늦출 뿐이고 가르는 것은 사람이다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * `CLAUDE.md`의 줄 수 상한. 경량화를 마친 줄 수 그대로다.
 * **늘려야 하면 이 값을 고친다** — 그래서 늘어난 것이 diff에 드러난다.
 */
export const CLAUDE_MD_MAX_LINES = 143

/** 규칙 문서에 둘 수 없는 날짜 모양. 날짜는 판례가 갖는다. */
export const DATE = /\b\d{4}-\d{2}-\d{2}\b/

/** 줄 수. 끝의 줄바꿈은 줄이 아니다. */
export function lineCount(text: string): number {
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length
}

/** 날짜가 적힌 줄. `번호: 줄` 모양이다. */
export function datedLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .flatMap((line, index) => (DATE.test(line) ? [`${index + 1}: ${line.trim()}`] : []))
}

const TEXT = readFileSync(join(process.cwd(), '..', 'CLAUDE.md'), 'utf-8')

describe('CLAUDE.md 무게', () => {
  it('읽을 것이 실제로 있다', () => {
    // 경로가 어긋나 빈 글을 읽고 통과하는 것을 막는다.
    expect(TEXT).toContain('## 1. 절대 원칙')
  })

  it('줄 수가 상한 안이다', () => {
    expect(lineCount(TEXT), 'CLAUDE.md is over its line budget').toBeLessThanOrEqual(
      CLAUDE_MD_MAX_LINES,
    )
  })

  it('날짜가 없다', () => {
    expect(datedLines(TEXT), 'dates belong in docs/cases/, not CLAUDE.md').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    expect(lineCount('a\nb\n')).toBe(2)
    expect(lineCount('a\r\nb')).toBe(2)
    expect(datedLines('규칙\n태그도 서명한다 (2026-08-31).')).toEqual([
      '2: 태그도 서명한다 (2026-08-31).',
    ])
    expect(datedLines('버전 0.11.2 이하')).toEqual([])
  })
})
