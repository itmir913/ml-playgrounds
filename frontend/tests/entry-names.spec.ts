/**
 * zip 엔트리 이름이 소스에서 옛 이름으로 불리지 않는가.
 *
 * **V11 R3 감사가 잡은 것이 이 종류였다.** 포트폴리오가 디렉터리로 옮겨 갔는데
 * (`portfolio.json` -> `portfolio/document.json`, `portfolio.md` -> `portfolio/document.md`)
 * 주석과 문서 **일곱 자리**가 옛 이름으로 남아 있었다. 코드는 상수를 쓰므로 멀쩡히
 * 돌았고, 그래서 아무도 몰랐다 — 다음 사람이 그 주석을 믿고 `portfolio.json`을 찾다가
 * 없는 것을 발견한다.
 *
 * **은퇴한 이름은 손으로 적는다.** 상수에서 뽑을 수 있는 것은 지금 이름이지 옛 이름이
 * 아니다. 엔트리를 옮기는 사람이 여기에 한 줄 더하는 것이 이 검사의 사용법이다.
 *
 * **못 보는 것**: `docs/` 아래는 안 훑는다. `open-decisions.md`는 날짜가 박힌 기록이라
 * 그때의 이름이 그때는 맞았고, 그것까지 고치면 결정문이 무엇을 결정했는지가 흐려진다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { ENTRY } from '../src/project/format'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

/** 은퇴한 이름 -> 지금 이름. 엔트리를 옮기면 여기에 한 줄 더한다. */
const RETIRED: readonly (readonly [string, string])[] = [
  ['portfolio.json', ENTRY.portfolio],
  ['portfolio.md', ENTRY.portfolioMarkdown],
  ['portfolio/images/', 'portfolio/attachments/'],
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry) ? [path] : []
  })
}

describe('엔트리 이름', () => {
  it('은퇴한 이름이 소스 어디에도 없다', () => {
    const found: string[] = []
    for (const path of sourceFiles(SRC)) {
      const lines = readFileSync(path, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        for (const [old, now] of RETIRED) {
          // `portfolio/document.json`은 `portfolio.json`을 안 품는다. 부분 일치로 충분하다.
          if (line.includes(old)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${old} -> ${now}`)
          }
        }
      })
    }
    expect(found, '옛 엔트리 이름을 부르는 자리').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    // 이 줄 자체는 문자열을 쪼개 두어 위 검사에 안 걸린다. 쪼개지 않으면 이 파일이
    // 스스로를 잡는데, 그건 검사기가 도는 증거가 아니라 검사기가 자기를 무는 것이다.
    const bait = `portfolio` + `.json`
    expect(RETIRED.some(([old]) => bait.includes(old))).toBe(true)
  })
})
