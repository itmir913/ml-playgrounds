// @vitest-environment jsdom
// 지원 언어 목록을 `i18n.ts`에서 가져오고, 그 파일에 DOM 부재 가드가 있다.
// 밝히지 않으면 그 가드의 대체 경로를 검사하게 된다 (ui-rules.spec.ts).
/**
 * 등록된 프리셋과 `public/`의 파일이 어긋나면 운다 (mlpx-spec.md §8.7, docs/i18n.md).
 *
 * **프리셋은 파일만 더하면 는다** - 목록도 이름도 `public/portfolio/index.json`에 있고
 * 코드에는 없다. 그래서 **어긋나는 자리가 셋**이다: 등록됐는데 파일이 없는 것, 파일이
 * 있는데 등록이 없는 것, 등록됐는데 어떤 언어의 이름이 없는 것.
 *
 * 없는 언어는 en으로 떨어지게 되어 있는데 **떨어지는 것과 빠뜨린 것을 화면에서 구분할
 * 수 없다.** 로케일 JSON은 이미 검사를 받고 `public/`은 여태 아무도 안 보고 있었다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SUPPORTED_LOCALES } from '../src/i18n'
import { parsePortfolioForm } from '../src/project/portfolio-form'
import { parsePresetIndex, presetFileName, presetName } from '../src/project/portfolio-presets'

const DIRECTORY = join(process.cwd(), 'public', 'portfolio')
if (!existsSync(DIRECTORY)) throw new Error(`preset directory not found: ${DIRECTORY}`)

const PRESETS = parsePresetIndex(readFileSync(join(DIRECTORY, 'index.json'), 'utf-8'))
const FILES = readdirSync(DIRECTORY).filter((name) => name.endsWith('.md'))

/** 등록된 프리셋 × 지원 언어. 검사가 이 축 둘을 함께 돈다. */
const PAIRS = PRESETS.flatMap((preset) => SUPPORTED_LOCALES.map((locale) => ({ preset, locale })))

function read(id: string, locale: string): string {
  return readFileSync(join(DIRECTORY, `${id}.${locale}.md`), 'utf-8')
}

describe('등록된 프리셋과 파일이 맞는다', () => {
  it('프리셋과 파일을 실제로 찾았다 - 없으면 아래가 조용히 통과한다', () => {
    expect(PRESETS.length).toBeGreaterThan(0)
    expect(FILES.length).toBeGreaterThan(0)
  })

  it.each(PAIRS)('$preset.id의 $locale 양식이 있다', ({ preset, locale }) => {
    expect(FILES).toContain(presetFileName(preset.id, locale))
  })

  it.each(PAIRS)('$preset.id에 $locale 이름이 있다', ({ preset, locale }) => {
    // **이름이 없으면 id가 그대로 뜬다.** 화면에서는 그것이 빠뜨린 것으로 안 보인다.
    expect(preset.names[locale]?.trim() ?? '').not.toBe('')
    expect(presetName(preset, locale)).not.toBe(preset.id)
  })

  it('등록되지 않은 양식 파일이 남아 있지 않다', () => {
    // 아무도 안 읽는 파일이 조용히 배포에 실려 나가는 것을 막는다.
    const expected = PAIRS.map(({ preset, locale }) => presetFileName(preset.id, locale))
    expect(FILES.filter((name) => !expected.includes(name))).toEqual([])
  })
})

describe('내장 양식은 우리 파서가 읽을 수 있다', () => {
  it.each(PAIRS)('$preset.id의 $locale 양식에 문항이 있다', ({ preset, locale }) => {
    const sections = parsePortfolioForm(read(preset.id, locale)).sections
    expect(sections.length).toBeGreaterThan(0)
    for (const section of sections) {
      expect(section.title).not.toBe('')
      expect(section.description).toBeDefined()
    }
  })

  it.each(PAIRS)('$preset.id의 $locale 문항마다 id가 박혀 있다', ({ preset, locale }) => {
    // **우리가 내보내는 양식에는 id를 주석으로 박는다** (§8.2). 없으면 제목 슬러그로
    // 떨어지는데, 그러면 언어마다 id가 갈리고 제목을 다듬는 순간 답이 떨어져 나간다.
    for (const section of parsePortfolioForm(read(preset.id, locale)).sections) {
      expect(section.id, section.title).toBeDefined()
    }
  })

  it.each(PRESETS)('$id는 언어가 달라도 문항 id와 순서가 같다', (preset) => {
    const ids = SUPPORTED_LOCALES.map((locale) =>
      parsePortfolioForm(read(preset.id, locale)).sections.map((section) => section.id),
    )
    for (const one of ids) {
      expect(one).toEqual(ids[0])
    }
  })
})

describe('목록 파일이 깨져 있으면 프리셋이 없는 것으로 친다', () => {
  it('JSON이 아니면 던진다', () => {
    expect(() => parsePresetIndex('{')).toThrow()
  })

  it('모양이 다르면 던진다 - 이름이 언어별 문자열이어야 한다', () => {
    expect(() => parsePresetIndex('{ "hello": "이름" }')).toThrow()
  })

  it('주소에 못 쓸 id는 버린다 - 우리가 남의 파일을 받아 오는 통로가 된다', () => {
    const parsed = parsePresetIndex('{ "../secret": { "ko": "이름" }, "ok": { "ko": "이름" } }')
    expect(parsed.map((preset) => preset.id)).toEqual(['ok'])
  })
})
