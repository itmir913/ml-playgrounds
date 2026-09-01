/**
 * **CI가 뱉는 글자는 영어다** (CLAUDE.md §4, `docs/workflow.md` "CI가 뱉는 글자는 영어다").
 *
 * 주석과 문서는 한국어지만 **로그는 누가 읽을지 정해져 있지 않다.** 관문이 빨간 날
 * 그것을 읽는 사람이 이 저장소를 여는 사람뿐이라는 보장이 없다.
 *
 * **검사 이름은 예외다.** `it('...')`은 로그가 아니라 그 검사가 무엇을 주장하는지의
 * 서술이고, 규칙이 그렇게 정해 두었다. 그래서 여기서 보는 것은 **실패할 때 딸려 나오는
 * 글자** 둘뿐이다.
 *
 * | 자리 | 왜 |
 * |---|---|
 * | `expect(값, '메시지')` | 실패한 그 줄 밑에 그대로 찍힌다 |
 * | `throw new Error('...')` | 스택과 함께 찍힌다. `src`는 `i18n-usage.spec.ts`가 이미 막는다 |
 *
 * **소스가 아니라 `tests/`를 본다.** `src`의 같은 자리는 그 검사가 막고 있고, 여기가
 * 비어 있던 탓에 119개가 한국어로 쌓여 있었다 (2026-09-01에 옮겼다).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles } from './fixtures/source'

const TESTS = join(__dirname)
const HANGUL = /[가-힣]/

/**
 * **이 파일 자체와, 그 규칙을 시험하는 파일은 뺀다.** 둘 다 한국어 표본을 일부러 들고
 * 있다 — 검사기가 한글을 잡는지 보려면 한글이 있어야 한다.
 */
const EXEMPT = ['ci-language.spec.ts', 'i18n-usage.spec.ts']

/** 주석을 걷어낸다. 규칙이 보는 것은 코드이지 그것을 설명하는 글이 아니다. */
function withoutComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*/g, '')
}

/**
 * `expect(` 뒤의 **최상위 두 번째 인자**. 첫 인자에 괄호와 쉼표가 얼마든지 들어가므로
 * 정규식으로는 못 가른다 — 실제로 정규식으로 뽑았더니 시험 데이터(`'개'`·`'고양이'`)가
 * 메시지로 잡혔다.
 */
function messageArgs(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/\bexpect\(/g)) {
    let index = (match.index ?? 0) + match[0].length - 1
    let depth = 0
    let quote: string | null = null
    let start: number | null = null
    while (index < source.length) {
      const c = source[index] as string
      if (quote !== null) {
        if (c === '\\') index += 2
        else {
          if (c === quote) quote = null
          index += 1
        }
        continue
      }
      if (c === '"' || c === "'" || c === '`') {
        quote = c
        index += 1
        continue
      }
      if (c === '(' || c === '[' || c === '{') depth += 1
      else if (c === ')' || c === ']' || c === '}') {
        depth -= 1
        if (depth === 0) {
          if (start !== null) found.push(source.slice(start, index).trim())
          break
        }
      } else if (c === ',' && depth === 1 && start === null) start = index + 1
      index += 1
    }
  }
  return found
}

const THROWN = /throw new [A-Za-z]*Error\(\s*[`'"][^`'"]*[가-힣]/

describe('CI가 뱉는 글자는 영어다', () => {
  const files = sourceFiles(TESTS).filter(
    (path) => !EXEMPT.some((name) => path.endsWith(name)) && path.endsWith('.ts'),
  )

  it('훑을 파일이 있어야 이 검사가 돈다', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('실패 메시지에 한글이 없다', () => {
    const found: string[] = []
    for (const path of files) {
      const source = withoutComments(readFileSync(path, 'utf-8'))
      for (const arg of messageArgs(source)) {
        const literal = arg.startsWith('"') || arg.startsWith("'") || arg.startsWith('`')
        if (literal && HANGUL.test(arg)) found.push(`${path.slice(TESTS.length + 1)} ${arg}`)
      }
    }
    expect(found).toEqual([])
  })

  it('던지는 원문에 한글이 없다', () => {
    const found = files
      .filter((path) => THROWN.test(withoutComments(readFileSync(path, 'utf-8'))))
      .map((path) => path.slice(TESTS.length + 1))
    expect(found).toEqual([])
  })

  /**
   * **검사기가 실제로 무는지 본다.** 0건을 훑고 통과하는 것이 이 검사의 가장 나쁜
   * 실패이고, 그 둘은 화면에서 똑같이 생겼다.
   */
  it('검사기가 한글 메시지를 잡는다', () => {
    expect(messageArgs("expect(a, '한글이다').toBe(1)")).toEqual(["'한글이다'"])
    // 첫 인자에 쉼표와 괄호가 있어도 두 번째를 고른다.
    expect(messageArgs("expect(f(a, b), '두 번째').toBe(1)")).toEqual(["'두 번째'"])
    // 메시지가 없으면 아무것도 안 잡는다 - 시험 데이터를 메시지로 착각하면 안 된다.
    expect(messageArgs("expect(t('개')).toBe(1)")).toEqual([])
    expect(THROWN.test("throw new Error('한글이다')")).toBe(true)
    expect(THROWN.test("throw new Error('english only')")).toBe(false)
  })
})
