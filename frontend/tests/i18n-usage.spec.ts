/**
 * i18n 사용 규약을 소스에서 강제한다 (CLAUDE.md 3).
 *
 * **로케일 파일이 완벽해도 화면은 깨질 수 있다.** 키 집합이 같고 보간 변수가 같아도,
 * 문장을 조각으로 이어 붙였으면 어순이 다른 언어에서 무너진다. tests/locales.spec.ts는
 * 파일 사이의 계약을 보고, 여기는 **그 문장을 쓰는 방식**을 본다.
 *
 * 사람의 주의로는 못 막는 종류다. 버튼 하나, 개수 표시 하나에서 슬금슬금 생기고
 * 리뷰에서는 자연스러워 보인다. 그래서 검사로 만든다 - 백엔드의 한글 리터럴 검사
 * (test_no_korean_literals.py)와 같은 성격이다.
 *
 * **검사기 자체를 먼저 검사한다.** 위반 표본을 잡아내는지, 정상 표본을 안 잡는지를
 * 고정해 둔다. 소스를 훑는 검사만 두면 지금은 통과하지만 정규식이 틀렸을 때
 * **아무것도 안 잡으면서 조용히 초록색**이 된다. 그게 제일 나쁜 상태다.
 *
 * **예외 통로를 두지 않았다.** 정말 필요한 경우가 나오면 그 사례를 손에 들고 그때 만든다.
 * 미리 만들어 두면 규칙이 아니라 권고가 된다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutComments } from './fixtures/source'

// jsdom 환경에서는 import.meta.url이 file: 스킴이 아니라 URL 계산을 못 한다.
// vitest는 vite.config.ts가 있는 곳에서 도므로 cwd가 frontend/ 다.
const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

interface Rule {
  /** 실패했을 때 무엇을 어겼는지. */
  readonly name: string
  readonly pattern: RegExp
  /** 패턴이 걸린 뒤 한 번 더 거르는 조건. 없으면 패턴이 곧 위반이다. */
  readonly only?: (line: string) => boolean
  /** 반드시 잡혀야 하는 줄. */
  readonly violations: readonly string[]
  /** 절대 잡히면 안 되는 줄. */
  readonly allowed: readonly string[]
}

const RULES: readonly Rule[] = [
  {
    name: 't()를 + 로 잇지 않는다',
    pattern: /\$?\bt\([^)]*\)\s*\+|\+\s*\$?\bt\(/,
    violations: [
      "const label = t('train.done') + ' ' + count",
      "const label = count + ' ' + t('models')",
      "const label = $t('a') + $t('b')",
    ],
    allowed: [
      "const label = t('train.done', { count })",
      'const total = left + right',
      // 이름이 t로 끝나는 다른 함수는 걸리지 않아야 한다.
      "const x = format('a') + 'b'",
      "const y = split('a') + 'b'",
    ],
  },
  {
    name: 't()를 템플릿 리터럴 안에 넣지 않는다',
    pattern: /`[^`]*\$\{[^}]*\$?\bt\(/,
    violations: ["const label = `${t('a')} ${count}`", "const label = `${count} ${t('b')}`"],
    allowed: [
      "const label = t('a', { count })",
      'const path = `${DIR.model}${run.id}.json`',
      'const key = `errors.${code}`',
    ],
  },
  {
    name: '한 텍스트 노드에 mustache를 둘 이상 두지 않는다',
    // **중괄호가 든 mustache도 본다.** 한때 `[^}]*`여서 보간 인자를 넘기는 호출
    // (`{{ t('a', { n }) }}`)에서는 매칭이 시작조차 안 됐다 — 이 규칙이 겨눈
    // "문장 + 수치"의 가장 흔한 모양이 바로 그것이다 (R8 감사 B-3).
    // `[^<>]`로 묶어 **한 텍스트 노드 안**으로 가둔다. 규칙이 말하는 것이 그것이다.
    pattern: /\{\{[^<>]*?\}\}[^<>]*\{\{/,
    // 적어도 한쪽이 번역이어야 한다. "3 / 10" 같은 수치 표시는 문장이 아니다.
    only: (line) => /\$?\bt\(/.test(line),
    violations: [
      '<p>{{ t("train.done") }} {{ count }}</p>',
      '<p>{{ count }}{{ t("models") }}</p>',
      "<p>{{ t('meta.runs', { n: 1 }) }} {{ done }}</p>",
    ],
    allowed: [
      '<p>{{ t("train.done", { count }) }}</p>',
      // 태그로 나뉜 것은 각자 완결된 문장이다.
      '<span>{{ t("a") }}</span><b>{{ x }}</b>',
      // 번역이 없는 수치 표시.
      '<p>{{ done }} / {{ total }}</p>',
    ],
  },
  {
    name: '로케일 태그를 코드에 박지 않는다',
    pattern: /['"`](ko|en|ja)-[A-Z]{2}['"`]/,
    violations: ["new Intl.NumberFormat('ko-KR')", 'const tag = "en-US"'],
    allowed: ['new Intl.NumberFormat(locale.value)', "const tag = 'ko'", "if (x === 'en') return"],
  },
]

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|vue)$/.test(entry) && !/\.spec\.ts$/.test(entry) ? [path] : []
  })
}

function hits(rule: Rule, line: string): boolean {
  return rule.pattern.test(line) && (rule.only?.(line) ?? true)
}

describe('검사기가 실제로 잡는다', () => {
  for (const rule of RULES) {
    describe(rule.name, () => {
      for (const line of rule.violations) {
        it(`위반을 잡는다: ${line}`, () => {
          expect(hits(rule, line)).toBe(true)
        })
      }
      for (const line of rule.allowed) {
        it(`정상을 안 잡는다: ${line}`, () => {
          expect(hits(rule, line)).toBe(false)
        })
      }
    })
  }

  it('주석은 걷어낸다 - 규칙을 설명하는 주석까지 걸리면 문서를 못 쓴다', () => {
    const source = ["// t('a') + t('b') 는 금지다", "/* new Intl.NumberFormat('ko-KR') */"].join(
      '\n',
    )
    expect(withoutComments(source).join('').trim()).toBe('')
  })

  it('따옴표 안의 //는 주석이 아니다', () => {
    expect(withoutComments("const url = 'https://a.b'")[0]).toContain('https://a.b')
  })

  it('한 줄에서 열고 닫는 주석 뒤의 코드는 살린다', () => {
    expect(withoutComments("/* 설명 */ const tag = 'ko-KR'")[0]).toContain('ko-KR')
  })

  it('여러 줄 주석은 통째로 걷어낸다', () => {
    const source = ['/*', " * t('a') + t('b')", ' */', 'const ok = 1'].join('\n')
    expect(withoutComments(source).join('\n').trim()).toBe('const ok = 1')
  })
})

describe('지금 소스에 위반이 없다', () => {
  for (const rule of RULES) {
    it(rule.name, () => {
      const found: string[] = []
      for (const path of sourceFiles(SRC)) {
        withoutComments(readFileSync(path, 'utf-8')).forEach((line, index) => {
          if (hits(rule, line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
      }
      expect(found).toEqual([])
    })
  }
})

describe('로케일 문장', () => {
  /** 조사는 앞 글자의 받침에 따라 갈린다. 값이 무엇일지 우리가 모르면 붙일 수 없다. */
  const PARTICLES = '은는이가을를와과'

  function particlesAfterPlaceholder(text: string): string[] {
    return [...text.matchAll(/\{(\w+)\}(.)/g)]
      .filter((match) => PARTICLES.includes(match[2] ?? ''))
      .map((match) => `{${match[1]}}${match[2]}`)
  }

  it('검사기가 조사를 잡고 단위는 안 잡는다', () => {
    expect(particlesAfterPlaceholder('{column}을 찾을 수 없습니다')).toEqual(['{column}을'])
    // {count}개를 에서 } 다음 글자는 '개'다. 단위는 받침이 정해져 있어 문제가 없다.
    expect(particlesAfterPlaceholder('{count}개를 담았습니다')).toEqual([])
    expect(particlesAfterPlaceholder('지원하지 않습니다. ({fileName})')).toEqual([])
  })

  it('자리표시자 바로 뒤에 조사가 없다', () => {
    const ko = readFileSync(join(SRC, 'locales', 'ko.json'), 'utf-8')
    expect(particlesAfterPlaceholder(ko)).toEqual([])
  })
})

/**
 * **부른 자리가 로케일이 요구하는 자리표시자를 다 넘기는가.**
 *
 * vue-i18n은 못 채운 자리표시자를 **조용히 지운다.** 실제로 그렇게 새 나갔다 —
 * `{index}번 군집`에 `{ cluster: … }`를 넘겨서 화면에 `번 군집`만 떴고, 검사도 타입도
 * 아무것도 안 잡았다 (2026-08-12).
 *
 * **키 집합 검사(tests/locales.spec.ts)로는 못 잡는다.** 그건 두 로케일 사이의 계약을
 * 보고, 여기는 **소스와 로케일 사이**를 본다.
 *
 * **모자란 것만 잡는다.** 남는 것(안 쓰는 값을 함께 넘기는 것)은 화면을 안 깨뜨리고,
 * 사유 파라미터를 통째로 펴 넘기는 자리가 실제로 있다.
 */
describe('자리표시자를 다 넘긴다', () => {
  /**
   * `t('a.b', { x: 1, y: z })` — 중첩 없는 객체 리터럴만 본다. 나머지는 넘긴다.
   *
   * **따옴표 두 벌을 다 본다.** 지금은 Prettier가 큰따옴표를 정규화해서 관문을
   * 먼저 막지만, 그건 이 검사가 넓어서가 아니라 포맷터가 앞에 서 있어서다.
   * 같은 것을 보는 `locales.spec.ts`의 정적 키 추출기는 처음부터 둘 다 봤다 —
   * **형제끼리 폭이 다르면 어느 쪽이 기준인지 다음 사람이 모른다** (R8 감사 A-3).
   */
  const CALL = /\$?\bt\(\s*['"]([\w.]+)['"]\s*,\s*\{([^{}]*)\}/g

  function placeholdersOf(text: string): string[] {
    return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? ''))]
  }

  function messageFor(locale: Record<string, unknown>, key: string): string | undefined {
    let current: unknown = locale
    for (const step of key.split('.')) {
      if (typeof current !== 'object' || current === null) return undefined
      current = (current as Record<string, unknown>)[step]
    }
    return typeof current === 'string' ? current : undefined
  }

  function missingIn(source: string, locale: Record<string, unknown>): string[] {
    const found: string[] = []
    for (const call of source.matchAll(CALL)) {
      const message = messageFor(locale, call[1] ?? '')
      if (message === undefined) continue
      // **줄임 표기도 센다** — `{ name, x: 1 }`의 `name`처럼 콜론이 없는 자리다.
      // 안 세면 멀쩡한 호출이 위반으로 잡히고, 그러면 이 검사부터 못 믿게 된다.
      const body = call[2] ?? ''
      const passed = new Set([
        ...[...body.matchAll(/(\w+)\s*:/g)].map((one) => one[1]),
        ...[...body.matchAll(/(?:^|,)\s*(\w+)\s*(?=,|$)/g)].map((one) => one[1]),
      ])
      const missing = placeholdersOf(message).filter((name) => !passed.has(name))
      if (missing.length > 0) found.push(`${call[1]} <- ${missing.join(', ')}`)
    }
    return found
  }

  const ko = JSON.parse(readFileSync(join(SRC, 'locales', 'ko.json'), 'utf-8')) as Record<
    string,
    unknown
  >

  it('검사기가 빠진 자리표시자를 잡는다', () => {
    const locale = { results: { clusterName: '{index}번 군집' } }
    expect(missingIn("t('results.clusterName', { cluster: group.cluster })", locale)).toEqual([
      'results.clusterName <- index',
    ])
    expect(missingIn("t('results.clusterName', { index: group.cluster })", locale)).toEqual([])
    // 자리표시자가 없는 문장에 값을 함께 넘기는 것은 화면을 안 깨뜨린다.
    expect(missingIn("t('a.b', { extra: 1 })", { a: { b: '그냥 문장' } })).toEqual([])
    // **줄임 표기를 위반으로 잡으면 안 된다.** 실제로 그렇게 쓰는 자리가 있다.
    expect(missingIn("t('a.b', { fileName })", { a: { b: '({fileName})' } })).toEqual([])
    expect(missingIn("t('a.b', { name, x: 1 })", { a: { b: '{name} {x}' } })).toEqual([])
    // 큰따옴표로 부른 것도 같다.
    expect(missingIn('t("a.b", { wrong: 1 })', { a: { b: '{count}장' } })).toEqual(['a.b <- count'])
  })

  it('지금 소스에 빠진 자리표시자가 없다', () => {
    const found: string[] = []
    for (const path of sourceFiles(SRC)) {
      for (const one of missingIn(readFileSync(path, 'utf-8'), ko)) {
        found.push(`${path.slice(SRC.length + 1)}  ${one}`)
      }
    }
    expect(found).toEqual([])
  })
})
