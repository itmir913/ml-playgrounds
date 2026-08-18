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

import { ENTRY, MLPX_EXTENSION } from '../src/project/format'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

/** 은퇴한 이름 -> 지금 이름. 엔트리를 옮기면 여기에 한 줄 더한다. */
const RETIRED: readonly (readonly [string, string])[] = [
  ['portfolio.json', ENTRY.portfolio],
  ['portfolio.md', ENTRY.portfolioMarkdown],
  ['portfolio/images/', 'portfolio/attachments/'],
]

/** 줄 나누기. **정규식 리터럴로 둔다** - 문자열로 적으면 이스케이프가 한 겹 더 든다. */
const NEWLINE = /\r?\n/

/** `'.csv,.xlsx'`처럼 확장자를 쉼표로 이어 붙인 리터럴. */
const ACCEPT_LITERAL = /['"`]\.[a-z0-9]+(?:,\.[a-z0-9]+)+['"`]/

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
      const lines = readFileSync(path, 'utf8').split(NEWLINE)
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

/**
 * 확장자 문자열은 상수 하나다 (`CLAUDE.md` §1.3, `format.ts`의 `MLPX_EXTENSION`).
 *
 * **주석은 통과시킨다.** 이 저장소의 주석은 `.mlpx`를 쉰 번 넘게 부르고 그게 값이다 —
 * 규약이 금지한 것은 "코드 안에서 직접 쓰는 것"이다. 그래서 **`.mlpx`가 든 줄은 전부
 * 주석 줄이어야 한다**로 검사한다.
 *
 * **일부러 관대하지 않게 짰다.** 코드 줄 끝에 달린 주석에 `.mlpx`가 있으면 이 검사는
 * 그것도 잡는다(가짜 빨강). 반대 방향(놓치는 것)보다 낫다 — 놓치면 조용히 초록이 된다.
 */
describe('확장자', () => {
  /** 주석으로 시작하는 줄인가. 블록 주석의 몸통(` * …`)까지 센다. */
  function isComment(line: string): boolean {
    const trimmed = line.trimStart()
    return (
      trimmed.startsWith('*') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('<!--')
    )
  }

  it('코드가 확장자를 직접 쓰지 않는다', () => {
    const source = join(SRC, 'project', 'format.ts')
    const found: string[] = []
    for (const path of sourceFiles(SRC)) {
      if (path === source) continue
      readFileSync(path, 'utf8')
        .split(NEWLINE)
        .forEach((line, index) => {
          if (line.includes(MLPX_EXTENSION) && !isComment(line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
    }
    expect(found, 'MLPX_EXTENSION을 쓰지 않고 확장자를 직접 적은 자리').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    // 쪼개 두지 않으면 이 줄이 스스로 걸린다.
    const bait = `const accept = '` + `.mlpx'`
    expect(bait.includes(MLPX_EXTENSION) && !isComment(bait)).toBe(true)
  })
})

/**
 * 파일 고르기의 `accept` 문자열도 상수 하나다.
 *
 * **`architecture.md` §9.1.1이 이미 한 번 지운 모양이다** — 등록부에 있는 값을 화면이
 * 베껴 오는 자리. 한쪽이 늘면 학생은 같은 앱에서 **어떤 파일은 되고 어떤 파일은 안
 * 되는 자리**를 만난다. `BatchPredict.vue`가 실제로 그렇게 두 벌이었다 (V11 R4 B-5).
 */
describe('파일 고르기의 accept', () => {
  /** 등록부. 값이 사는 자리라 훑기에서 뺀다. */
  const REGISTRIES = [join(SRC, 'data', 'table.ts'), join(SRC, 'data', 'image', 'upload.ts')]

  it('확장자 목록을 화면이 직접 적지 않는다', () => {
    const found: string[] = []
    for (const path of sourceFiles(SRC)) {
      if (REGISTRIES.includes(path)) continue
      readFileSync(path, 'utf8')
        .split(NEWLINE)
        .forEach((line, index) => {
          // `'.csv,.xlsx'` 처럼 확장자를 쉼표로 이어 붙인 리터럴.
          if (ACCEPT_LITERAL.test(line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
    }
    expect(found, 'accept 문자열을 직접 적은 자리').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    expect(ACCEPT_LITERAL.test(`const a = '` + `.csv,.xlsx'`)).toBe(true)
    expect(ACCEPT_LITERAL.test('const a = TABULAR_ACCEPT')).toBe(false)
  })
})
