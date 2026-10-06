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

  /**
   * **일본어의 `break-keep`은 문절에서 끊고, 모르는 브라우저에서는 `keep-all`로 남는다.**
   * 앞에 `normal`을 두면 사파리·파이어폭스에서 레일의 `ポート​フォリオ`가 글자마다 끊긴다 —
   * 그래서 이 블록은 `auto-phrase` 한 줄뿐이어야 한다.
   */
  it('일본어의 break-keep은 auto-phrase 한 줄로만 푼다', () => {
    const utilities = readFileSync(join(STYLES, 'utilities.css'), 'utf-8')
    const start = utilities.indexOf('.break-keep:lang(ja) {')
    expect(start, 'utilities.css lifts break-keep for ja').toBeGreaterThanOrEqual(0)
    const block = utilities.slice(start, utilities.indexOf('}', start))
    expect([...block.matchAll(/word-break:\s*([\w-]+)/g)].map((match) => match[1])).toEqual([
      'auto-phrase',
    ])
  })

  /**
   * **일본어 화면의 본문은 문절에서 끊고, 모르는 브라우저에서는 글자 단위로 떨어진다**
   * (`docs/i18n.md` 규칙 9의 예외, `base.css`의 `body:lang(ja)`). 본문은 `break-keep`과 달리 앞에
   * `normal`이 있어야 한다 — 없으면 `auto-phrase`를 모르는 브라우저가 상속된 `keep-all`로 남아
   * 일본어 문장이 칸을 넘친다. 0.33.3 최종 감사(J-code A-2)까지 이 블록을 지키는 검사가 없었다.
   */
  it('일본어 화면의 본문은 normal 다음 auto-phrase로 끊는다', () => {
    const start = base.indexOf('body:lang(ja) {')
    expect(start, 'base.css sets word-break for ja body').toBeGreaterThanOrEqual(0)
    const block = base.slice(start, base.indexOf('}', start))
    expect([...block.matchAll(/word-break:\s*([\w-]+)/g)].map((match) => match[1])).toEqual([
      'normal',
      'auto-phrase',
    ])
  })

  it('검사기가 블록 밖의 값을 읽지 않는다', () => {
    expect(fontStackIn('a { --font-sans: x; }', ':root:lang(ja)')).toBeNull()
    expect(
      fontStackIn(':root:lang(ja) {\n  --font-sans:\n    a,\n    b;\n}', ':root:lang(ja)'),
    ).toBe('a, b')
  })
})
