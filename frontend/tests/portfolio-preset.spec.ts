// @vitest-environment jsdom
// 지원 언어 목록을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
// 밝히지 않으면 그 가드의 대체 경로를 검사하게 된다 (ui-rules.spec.ts).
/**
 * 지원 언어와 내장 양식 파일이 어긋나면 운다 (mlpx-spec.md §8.7, docs/i18n.md).
 *
 * **없는 언어는 en으로 떨어지는데, 떨어진 것과 빠뜨린 것을 화면에서 구분할 수 없다.**
 * 로케일 JSON은 이미 검사를 받고 있었고 `public/`의 마크다운은 여태 아무도 안 봤다.
 *
 * **양쪽으로 본다.** 언어가 늘었는데 파일이 없는 것도, 파일이 남았는데 언어가 없는
 * 것도 잡는다 - 뒤엣것은 아무도 안 읽는 파일이 조용히 배포에 실려 나가는 것이다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES } from '../src/i18n'
import { parsePortfolioForm } from '../src/project/portfolio-form'
import { presetFileName } from '../src/project/portfolio-presets'

const PUBLIC = join(process.cwd(), 'public')
if (!existsSync(PUBLIC)) throw new Error(`public을 찾지 못했다: ${PUBLIC}`)

/** 우리가 쓰는 프리셋 파일들. 이름 규칙은 `presetFileName`이 갖는다. */
const PRESETS = readdirSync(PUBLIC).filter((name) => /^portfolio\.preset\..*\.md$/.test(name))

function read(locale: string): string {
  return readFileSync(join(PUBLIC, `portfolio.preset.${locale}.md`), 'utf-8')
}

describe('내장 양식은 지원 언어마다 하나씩 있다', () => {
  it('파일을 실제로 찾았다 - 없으면 아래가 조용히 통과한다', () => {
    expect(PRESETS.length).toBeGreaterThan(0)
  })

  it.each(SUPPORTED_LOCALES)('%s 양식이 있다', (locale) => {
    expect(PRESETS).toContain(presetFileName(locale))
  })

  it('지원 언어에 없는 양식 파일이 남아 있지 않다', () => {
    const expected = SUPPORTED_LOCALES.map(presetFileName)
    expect(PRESETS.filter((name) => !expected.includes(name))).toEqual([])
  })
})

describe('내장 양식은 우리 파서가 읽을 수 있다', () => {
  it.each(SUPPORTED_LOCALES)('%s 양식에 문항이 있다', (locale) => {
    const sections = parsePortfolioForm(read(locale)).sections
    expect(sections.length).toBeGreaterThan(0)
    for (const section of sections) {
      expect(section.title).not.toBe('')
      expect(section.description).toBeDefined()
    }
  })

  it.each(SUPPORTED_LOCALES)('%s 양식의 문항마다 id가 박혀 있다', (locale) => {
    // **우리가 내보내는 양식에는 id를 주석으로 박는다** (§8.2). 없으면 제목 슬러그로
    // 떨어지는데, 그러면 언어마다 id가 갈리고 제목을 다듬는 순간 답이 떨어져 나간다.
    for (const section of parsePortfolioForm(read(locale)).sections) {
      expect(section.id, section.title).toBeDefined()
    }
  })

  it('언어가 달라도 문항 id와 순서가 같다', () => {
    const ids = SUPPORTED_LOCALES.map((locale) =>
      parsePortfolioForm(read(locale)).sections.map((section) => section.id),
    )
    for (const one of ids) {
      expect(one).toEqual(ids[0])
    }
  })
})
