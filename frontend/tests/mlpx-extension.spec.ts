/**
 * **확장자 문자열은 상수 하나다** (CLAUDE.md §1.3, `project/format.ts`의 `MLPX_EXTENSION`).
 *
 * 주석을 걷은 소스에서 `.mlpx` 글자를 찾는다. 주석은 사람에게 형식 이름을 말하는 자리라 세지
 * 않는다.
 *
 * **못 보는 것** — 글자를 조각내 이어 붙인 것(`'.ml' + 'px'`), `src/` 밖의 도구·스크립트.
 */

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles, withoutComments } from './fixtures/source'

const SRC = join(process.cwd(), 'src')
const HOME = join('project', 'format.ts')
const LITERAL = /\.mlpx\b/

function offenders(): string[] {
  return sourceFiles(SRC).flatMap((path) => {
    const name = relative(SRC, path)
    if (name === HOME) return []
    const lines = withoutComments(readFileSync(path, 'utf-8'))
    return lines.flatMap((line, index) => (LITERAL.test(line) ? [`${name}:${index + 1}`] : []))
  })
}

describe('확장자 상수', () => {
  it('format.ts 밖의 코드에 .mlpx 글자가 없다', () => {
    expect(offenders()).toEqual([])
  })

  it('검사가 코드 속 글자를 잡는다', () => {
    expect(LITERAL.test("const name = 'a.mlpx'")).toBe(true)
  })
})
