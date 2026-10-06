/**
 * **일본어 화면은 한자를 일본식 자형으로 그린다** (2026-10-06).
 *
 * Pretendard는 가나와 한자를 덮지만 한자가 한국식 자형이다. ko·en의 스택(`theme.css`)을
 * 일본어 화면이 그대로 쓰던 동안, 일본어 화면의 한자가 전부 한국식으로 그려졌다 —
 * `theme.css` 주석은 "Pretendard는 가나를 덮지 않는다"고 적고 있었다. `base.css`의
 * `:root:lang(ja)`가 스택을 갈아 끼운다.
 *
 * **어떤 글꼴로 그려지는지는 이 검사가 못 본다** — 기기의 글꼴 목록 뒤에 있다. 사람 확인이다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const STYLES = join(process.cwd(), 'src', 'styles')

/** `selector { --font-sans: …; }`의 값. 없으면 `null`. */
function fontStackIn(css: string, selector: string): string | null {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return null
  const block = css.slice(start, css.indexOf('}', start))
  const match = /--font-sans:([^;]+);/.exec(block)
  return match?.[1]?.replace(/\s+/g, ' ').trim() ?? null
}

describe('글꼴 스택', () => {
  const base = readFileSync(join(STYLES, 'base.css'), 'utf-8')
  const theme = readFileSync(join(STYLES, 'theme.css'), 'utf-8')

  it('ko·en은 Pretendard가 앞이다', () => {
    const stack = /--font-sans:([^;]+);/.exec(theme)?.[1] ?? ''
    expect(stack.trim().startsWith("'Pretendard Variable'")).toBe(true)
  })

  it('일본어 화면은 Pretendard JP를 앞세우고 한국식 자형의 Pretendard를 쓰지 않는다', () => {
    const stack = fontStackIn(base, ':root:lang(ja)')
    expect(stack, 'base.css has a ja font stack').not.toBeNull()
    expect(stack?.startsWith("'Pretendard JP Variable'")).toBe(true)
    expect(stack).not.toContain("'Pretendard Variable'")
    expect(stack).not.toMatch(/(^|, )Pretendard(,|$)/)
  })

  it('Pretendard JP를 앱 전체가 들여오지 않는다 - 한국어·영어 화면은 안 받는다', () => {
    // 전역 CSS에 들어가면 모든 화면이 그 @font-face를 싣는다. 일본어를 고를 때만 불러온다
    // (`src/i18n.ts`의 `LOCALE_FONTS`).
    const index = readFileSync(join(STYLES, 'index.css'), 'utf-8')
    expect(index).not.toContain('pretendard-jp')
  })

  it('검사기가 블록 밖의 값을 읽지 않는다', () => {
    expect(fontStackIn('a { --font-sans: x; }', ':root:lang(ja)')).toBeNull()
    expect(
      fontStackIn(':root:lang(ja) {\n  --font-sans:\n    a,\n    b;\n}', ':root:lang(ja)'),
    ).toBe('a, b')
  })
})
