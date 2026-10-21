// @vitest-environment jsdom
/**
 * **문장 안의 수가 그 언어로 찍히는가** (open-decisions.md "119. 화면의 세는 수를 어디서 포맷하는가").
 *
 * **진짜 입구(`i18n.global.t`)로 돈다.** 감싼 컴파일러(`src/i18n-numbers.ts`)를 직접 부르면, 메시지를 미리 함수로
 * 컴파일하는 플러그인이 들어와 컴파일러를 건너뛰는 날에도 초록이다. 기대값은 같은 `Intl`로 만들지 않고 글자로 적는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { i18n, setLocale, SUPPORTED_LOCALES } from '../src/i18n'
import {
  COUNT_PLACEHOLDERS,
  MEGABYTE_PLACEHOLDERS,
  placeholderValue,
  RAW_PLACEHOLDERS,
} from '../src/i18n-numbers'
import en from '../src/locales/en.json'
import ja from '../src/locales/ja.json'
import ko from '../src/locales/ko.json'

const t = i18n.global.t

afterEach(async () => {
  await setLocale('ko')
})

describe('문장 안의 세는 수', () => {
  it('세는 수는 그 언어의 자리 구분 기호를 갖는다', async () => {
    await setLocale('ko')
    expect(t('data.tabular.pageNote', { total: 100000, from: 1, to: 20 }, 100000)).toBe(
      '전체 100,000행 중 1–20행을 표시합니다.',
    )
    await setLocale('ja')
    expect(t('data.tabular.pageNote', { total: 100000, from: 1, to: 20 }, 100000)).toBe(
      '全100,000行中1–20行を表示しています。',
    )
    await setLocale('en')
    expect(t('data.tabular.pageNote', { total: 100000, from: 1, to: 20 }, 100000)).toBe(
      'Showing rows 1–20 of 100,000 rows.',
    )
  })

  it('복수 선택은 숫자로 그대로 고른다', async () => {
    await setLocale('en')
    expect(t('data.tabular.pageNote', { total: 1, from: 1, to: 1 }, 1)).toBe(
      'Showing rows 1–1 of 1 row.',
    )
  })

  it('복수 인자만 넘긴 {count}도 포맷된다', async () => {
    await setLocale('ko')
    expect(t('data.tabular.previewProbeNote', 12345)).toContain('12,345')
  })

  it('학생 데이터의 값은 묶지 않는다 - 연도 2001은 2,001이 아니다', async () => {
    await setLocale('ko')
    expect(t('errors.FEATURE_NOT_NUMBER', { feature: '연도', value: 2001 })).toContain('2001')
    expect(t('errors.FEATURE_NOT_NUMBER', { feature: '연도', value: 2001 })).not.toContain('2,001')
  })

  it('순서 인코딩의 마지막 코드값은 데이터에 들어가는 모양 그대로다', async () => {
    await setLocale('en')
    expect(t('encodingBasis.ordinal', { last: 1000 })).toContain('1000')
    expect(t('encodingBasis.ordinal', { last: 1000 })).not.toContain('1,000')
  })

  it('문자열로 온 값은 이름이 세는 수여도 손대지 않는다', () => {
    expect(placeholderValue('en', 'used', '1.5.2')).toBe('1.5.2')
  })

  it('메가바이트는 정수는 그대로, 소수는 한 자리까지', () => {
    expect(placeholderValue('en', 'limitMb', 50)).toBe('50')
    expect(placeholderValue('ko', 'limitMb', 12.5)).toBe('12.5')
    expect(placeholderValue('en', 'limitMb', 1500)).toBe('1,500')
  })

  it('세는 수 자리에 소수가 오면 검사에서 던진다 - 값을 반올림해 바꾸지 않는다', () => {
    expect(() => placeholderValue('en', 'count', 2.5)).toThrow(/non-integer/)
  })
})

/**
 * **감싼 컴파일러는 vue-i18n이 쓰는 그 `@intlify/core-base`여야 한다.** vue-i18n만 오르면 core-base가 두 벌 깔려
 * 번들에 둘이 들어가고 타입이 갈린다 — 둘은 함께 올린다(코드 소유자가 정확한 버전으로 더했다, 결정 119).
 */
describe('core-base는 vue-i18n과 같은 판이다', () => {
  it('직접 의존성의 버전이 vue-i18n이 요구하는 버전과 같다', () => {
    const own = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    const vueI18n = JSON.parse(
      readFileSync(join(process.cwd(), 'node_modules', 'vue-i18n', 'package.json'), 'utf-8'),
    ) as { dependencies: Record<string, string> }
    expect(own.dependencies['@intlify/core-base'], 'bump @intlify/core-base with vue-i18n').toBe(
      vueI18n.dependencies['@intlify/core-base'],
    )
  })
})

/** 로케일 파일의 자리표시자 이름 전부. */
function placeholderNames(value: unknown, into: Set<string>): Set<string> {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/\{(\w+)\}/g)) into.add(match[1]!)
  } else if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) placeholderNames(inner, into)
  }
  return into
}

describe('자리표시자는 닫힌 목록이다', () => {
  const locales = { en, ko, ja } as const

  it.each(SUPPORTED_LOCALES)('%s의 모든 자리표시자가 셋 중 정확히 하나에 있다', (locale) => {
    const unclassified: string[] = []
    const doubled: string[] = []
    for (const name of placeholderNames(locales[locale], new Set())) {
      const hits = [COUNT_PLACEHOLDERS, MEGABYTE_PLACEHOLDERS, RAW_PLACEHOLDERS].filter((set) =>
        set.has(name),
      ).length
      if (hits === 0) unclassified.push(name)
      if (hits > 1) doubled.push(name)
    }
    expect(unclassified, 'classify these in src/i18n-numbers.ts').toEqual([])
    expect(doubled, 'placeholders in more than one list').toEqual([])
  })

  it('목록에 로케일에 없는 이름이 남지 않는다', () => {
    const used = new Set<string>()
    for (const locale of SUPPORTED_LOCALES) placeholderNames(locales[locale], used)
    const stale = [...COUNT_PLACEHOLDERS, ...MEGABYTE_PLACEHOLDERS, ...RAW_PLACEHOLDERS].filter(
      (name) => !used.has(name),
    )
    expect(stale, 'names no locale uses').toEqual([])
  })
})
