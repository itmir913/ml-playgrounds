/**
 * **소스에 날것 bidi·C1 문자가 없다** (2026-09-28 감사 A 독립 검토).
 *
 * 양방향(bidi) 서식 문자는 편집기와 리뷰 화면에서 **글자 순서를 뒤집어 보인다** — 보이는 코드와
 * 도는 코드가 달라지는 Trojan Source 모양이다(CVE-2021-42574). C1 제어문자는 아예 안 보인다.
 * 파일 이름에서 이 문자들을 걷는 규칙(`data/file-name-rules.ts`)을 세우면서 **그 정규식 자체를
 * 날것으로 적었다가** 검토에서 걸렸다. 이스케이프(`U+202E`를 역슬래시-u 네 자리로)로 적으면 뜻은 같고 눈에 보인다.
 *
 * **U+200B(폭 없는 공백)는 대상이 아니다.** 순서를 바꾸지 않고, 줄바꿈 자리를 주려고 로케일과
 * 스타일에 일부러 넣은 곳이 있다.
 *
 * **이 파일도 날것을 안 쓴다** — 찾을 문자를 코드 포인트 숫자로 적고 정규식을 문자열로 짓는다.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** 찾을 코드 포인트 범위(양끝 포함). C1 · 아랍 문자 표지 · LRM/RLM · 내장·덮어쓰기 · 격리. */
const FORBIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x80, 0x9f],
  [0x61c, 0x61c],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]

const HEX_WIDTH = 4
const BACKSLASH = String.fromCharCode(92)

/** 코드 포인트를 정규식의 `\uXXXX`로. 날것을 소스에 두지 않으려고 문자열로 짓는다. */
function escaped(code: number): string {
  return `${BACKSLASH}u${code.toString(16).padStart(HEX_WIDTH, '0')}`
}

const FORBIDDEN = new RegExp(
  `[${FORBIDDEN_RANGES.map(([from, to]) => `${escaped(from)}-${escaped(to)}`).join('')}]`,
  'g',
)

/** 글에서 찾은 자리. `U+202E` 같은 이름으로 돌려준다. */
function hitsIn(text: string): string[] {
  return [...text.matchAll(FORBIDDEN)].map(
    (match) =>
      `U+${(match[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(HEX_WIDTH, '0')}`,
  )
}

const ROOT = process.cwd()
const SCANNED = /\.(ts|vue|js|mjs|json|css|html)$/

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return filesUnder(path)
    return SCANNED.test(entry) ? [path] : []
  })
}

const FILES = ['src', 'tests'].flatMap((directory) => filesUnder(join(ROOT, directory)))

describe('소스에 날것 bidi·C1 문자가 없다', () => {
  it('훑을 파일을 실제로 찾는다', () => {
    // 0개면 경로가 썩은 것이지 규칙이 지켜진 게 아니다.
    expect(FILES.length).toBeGreaterThan(100)
  })

  it('검사기가 날것을 잡고 이스케이프는 안 잡는다', () => {
    const planted = `const name = 'a${String.fromCodePoint(0x202e)}b'`
    expect(hitsIn(planted)).toEqual(['U+202E'])
    expect(hitsIn(`const name = 'a${BACKSLASH}u202eb'`)).toEqual([])
    // 폭 없는 공백은 대상이 아니다 — 로케일이 일부러 쓴다.
    expect(hitsIn(`a${String.fromCodePoint(0x200b)}b`)).toEqual([])
  })

  it('소스에 날것 bidi·C1 문자가 없다', () => {
    const found = FILES.flatMap((path) =>
      readFileSync(path, 'utf-8')
        .split('\n')
        .flatMap((line, index) => {
          const hits = hitsIn(line)
          return hits.length === 0 ? [] : [`${path}:${index + 1} ${hits.join(',')}`]
        }),
    )
    expect(found, 'write these as escapes (\\uXXXX) instead').toEqual([])
  })
})
