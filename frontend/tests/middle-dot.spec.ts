/**
 * **화면의 가운뎃점(·)은 두 자리뿐이다** (2026-10-01, 코드 소유자).
 *
 * - 상태 표시줄(`AppStatusBar.vue`)의 구분자.
 * - 학습 환경의 이름(`runtimes.*`) — `ml.js · 내 컴퓨터`.
 *
 * 나머지는 문장을 잇는 자리면 띄어쓰기, 값과 이름을 잇는 자리면 쉼표다. 회귀 차트 아래에
 * `…표시했습니다. · 점이 많이 겹치는…`처럼 두 문장 사이에 점이 서서 잡혔다 — 코드가 문장을
 * `' · '`로 이어 붙이고 있었다. 그래서 로케일과 소스를 함께 본다.
 *
 * **주석은 안 본다** — 주석의 `학번·이름` 같은 글은 화면에 안 간다. 파서가 가른 자리로 걷는다
 * (`fixtures/parsed-source.ts`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseSfc } from 'vue/compiler-sfc'

import { scriptWithoutComments, templateOf } from './fixtures/parsed-source'
import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'

const DOT = '·'

/** 로케일에서 가운뎃점을 써도 되는 키. */
const LOCALE_ALLOWED = /^runtimes\./

/** 소스에서 가운뎃점을 써도 되는 파일 — 상태 표시줄의 구분자 하나다. */
const SOURCE_ALLOWED: Readonly<Record<string, number>> = {
  'src/components/AppStatusBar.vue': 1,
}

const ROOT = resolve(__dirname, '..')

function flatten(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]]
  if (node === null || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, value]) =>
    flatten(value, prefix === '' ? key : `${prefix}.${key}`),
  )
}

function dotsInLocale(messages: unknown): string[] {
  return flatten(messages)
    .filter(([key, value]) => value.includes(DOT) && !LOCALE_ALLOWED.test(key))
    .map(([key]) => key)
}

/** 화면에 갈 수 있는 글자 — 주석을 걷은 스크립트와 템플릿. */
function visibleCode(path: string, source: string): string {
  if (!path.endsWith('.vue')) return scriptWithoutComments(source)
  const { descriptor } = parseSfc(source, { filename: path })
  const scripts = [descriptor.script, descriptor.scriptSetup]
    .map((block) => (block ? scriptWithoutComments(block.content) : ''))
    .join('\n')
  return `${templateOf(path, source)}\n${scripts}`
}

function countDots(text: string): number {
  return text.split(DOT).length - 1
}

function codeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return codeFiles(path)
    return /\.(?:ts|vue)$/.test(entry) ? [path] : []
  })
}

describe('화면의 가운뎃점은 상태 표시줄과 학습 환경 이름뿐이다', () => {
  it('검사기가 잡는다: 문장을 잇는 가운뎃점', () => {
    expect(dotsInLocale({ a: { b: '한 문장입니다. · 둘째 문장입니다.' } })).toEqual(['a.b'])
    expect(countDots(visibleCode('probe.ts', "parts.join(' · ')"))).toBe(1)
    expect(
      countDots(visibleCode('probe.vue', '<template><p>a <span> · </span> b</p></template>')),
    ).toBe(1)
  })

  it('검사기가 안 잡는다: 학습 환경 이름과 주석', () => {
    expect(dotsInLocale({ runtimes: { mljs: 'ml.js · 내 컴퓨터' } })).toEqual([])
    expect(countDots(visibleCode('probe.ts', '// 학번·이름\nconst a = 1'))).toBe(0)
    expect(
      countDots(visibleCode('probe.vue', '<template><!-- 학번·이름 --><p>a</p></template>')),
    ).toBe(0)
  })

  it('로케일 문구에 가운뎃점이 없다', () => {
    expect([...dotsInLocale(ko), ...dotsInLocale(en)]).toEqual([])
  })

  it('소스가 화면에 가운뎃점을 내지 않는다', () => {
    const offenders = codeFiles(join(ROOT, 'src')).flatMap((path) => {
      const name = relative(ROOT, path).replaceAll('\\', '/')
      const found = countDots(visibleCode(path, readFileSync(path, 'utf-8')))
      return found === (SOURCE_ALLOWED[name] ?? 0) ? [] : [`${name}: ${found} middle dot(s)`]
    })
    expect(offenders).toEqual([])
  })
})
