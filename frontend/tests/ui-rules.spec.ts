/**
 * 화면 코드가 지켜야 하는 규칙.
 *
 * 둘 다 **사람의 주의로는 못 지키는 종류다.** 급할 때 `text-sm` 하나, 안 맞을 때
 * `w-[327px]` 하나가 들어가고 리뷰에서는 자연스러워 보인다. i18n 규칙을 검사로
 * 만든 것과 같은 이유로 여기도 검사로 만든다 (tests/i18n-usage.spec.ts).
 *
 * **검사기 자체를 먼저 검사한다.** 정규식이 틀렸을 때 아무것도 안 잡으면서 조용히
 * 초록색이 되는 것이 제일 나쁜 상태다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(process.cwd(), 'src')
if (!existsSync(SRC)) throw new Error(`src를 찾지 못했다: ${SRC}`)

interface Rule {
  readonly name: string
  readonly why: string
  readonly pattern: RegExp
  readonly violations: readonly string[]
  readonly allowed: readonly string[]
}

const RULES: readonly Rule[] = [
  {
    name: 'text-base보다 작은 글씨를 쓰지 않는다',
    why: '중고등학생이 교실 모니터로 본다. 촘촘함은 글자를 줄여서가 아니라 여백으로 얻는다.',
    pattern: /\btext-(xs|sm)\b/,
    violations: ['<p class="text-sm text-ink-soft">', 'class="mt-1 text-xs"'],
    allowed: [
      '<p class="text-base">',
      '<h2 class="text-lg font-bold">',
      // 낱말 안에 우연히 들어간 경우는 걸리지 않아야 한다.
      'class="context-small"',
    ],
  },
  {
    name: 'Tailwind 임의 값을 쓰지 않는다',
    why: '기본 클래스만 쓴다. 임의 값이 흩뿌려지면 눈금이 사라지고 디자인 교체가 전수 조사가 된다.',
    // class 속성 안의 `[...]`만 본다. :class 바인딩의 배열·객체는 자바스크립트다.
    pattern: /\sclass="[^"]*\[[^"]*\]/,
    violations: [
      '<div class="w-[327px]">',
      '<span class="text-[0.625rem] font-bold">',
      '<table class="[&_th]:px-4">',
    ],
    allowed: [
      '<div class="w-full max-w-xs">',
      // 바인딩 안의 대괄호는 클래스가 아니라 코드다.
      ":class=\"[CELL, active ? 'bg-brand' : '']\"",
      'v-for="(row, index) in rows"',
    ],
  },
]

function vueFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return vueFiles(path)
    return entry.endsWith('.vue') ? [path] : []
  })
}

/**
 * 주석을 걷어낸 줄들. 규칙을 설명하려면 금지된 모양을 주석에 적어야 하는데,
 * 그것까지 걸리면 문서를 못 쓴다. `.vue`에는 HTML 주석과 JS 주석이 함께 있다.
 */
function withoutComments(source: string): string[] {
  const stripped = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  return stripped.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, ''))
}

describe('검사기가 실제로 잡는다', () => {
  for (const rule of RULES) {
    describe(rule.name, () => {
      for (const line of rule.violations) {
        it(`위반을 잡는다: ${line}`, () => {
          expect(rule.pattern.test(line)).toBe(true)
        })
      }
      for (const line of rule.allowed) {
        it(`정상을 안 잡는다: ${line}`, () => {
          expect(rule.pattern.test(line)).toBe(false)
        })
      }
    })
  }

  it('주석은 걷어낸다', () => {
    const source = [
      '<!-- text-sm 은 금지다 -->',
      '/* w-[327px] 도 금지 */',
      '// text-xs 금지',
    ].join('\n')
    expect(withoutComments(source).join('').trim()).toBe('')
  })
})

describe('지금 화면 코드에 위반이 없다', () => {
  for (const rule of RULES) {
    it(`${rule.name} — ${rule.why}`, () => {
      const found: string[] = []
      for (const path of vueFiles(SRC)) {
        withoutComments(readFileSync(path, 'utf-8')).forEach((line, index) => {
          if (rule.pattern.test(line)) {
            found.push(`${path.slice(SRC.length + 1)}:${index + 1}  ${line.trim()}`)
          }
        })
      }
      expect(found).toEqual([])
    })
  }
})
