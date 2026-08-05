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
  /** 패턴이 걸린 뒤 한 번 더 거르는 조건. 없으면 패턴이 곧 위반이다. */
  readonly only?: (line: string) => boolean
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
  {
    name: '작업 공간 래퍼의 세로 간격이 화면마다 같다',
    why:
      '단계를 옮길 때마다 내용이 몇 px씩 위아래로 뛴다. 한 화면만 gap-4였던 것이 실제로 ' +
      '그랬고, 원인을 짚기 어려운 만큼 더 나쁘다 — 학생은 화면이 불안하다고만 느낀다.',
    // 작업 공간의 바깥 여백은 `p-4 sm:p-5`로 고정돼 있다. 그 래퍼의 gap이 gap-5가
    // 아니면 그 화면만 다른 리듬으로 선다.
    pattern: /\sclass="[^"]*p-4 sm:p-5[^"]*"/,
    only: (line) => /gap-\d/.test(line) && !/gap-5/.test(line),
    violations: [
      '<div class="flex flex-col gap-4 p-4 sm:p-5">',
      '<div class="flex h-full flex-col gap-3 p-4 sm:p-5">',
    ],
    allowed: [
      '<div class="flex flex-col gap-5 p-4 sm:p-5">',
      '<div class="flex h-full flex-col gap-5 p-4 sm:p-5">',
      // 래퍼가 아닌 곳의 gap-4는 상관없다.
      '<div class="mt-3 flex flex-col gap-4">',
    ],
  },
]

function hits(rule: Rule, line: string): boolean {
  return rule.pattern.test(line) && (rule.only?.(line) ?? true)
}

/**
 * `<AppButton ... @click="이름">`인데 그 `이름`이 같은 파일의 `async function`인 경우.
 *
 * **오래 걸리는 일은 `action`으로 줘야 버튼이 스스로 꺼진다**(CLAUDE.md §4).
 * `@click`은 리스너의 반환값을 기다려 주지 않으므로 두 번 눌리는 것을 못 막는다.
 */
function unguardedButtons(source: string): string[] {
  const asyncNames = new Set(
    [...source.matchAll(/async function (\w+)/g)].map((match) => match[1] ?? ''),
  )
  const template = source.slice(source.indexOf('<template>'))
  return [...template.matchAll(/<AppButton[^>]*?@click="(\w+)"/gs)]
    .map((match) => match[1] ?? '')
    .filter((name) => asyncNames.has(name))
}

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

  it('주석은 걷어낸다', () => {
    const source = [
      '<!-- text-sm 은 금지다 -->',
      '/* w-[327px] 도 금지 */',
      '// text-xs 금지',
    ].join('\n')
    expect(withoutComments(source).join('').trim()).toBe('')
  })
})

describe('버튼이 두 번 눌리지 않는다', () => {
  const NEWLINE = String.fromCharCode(10)

  it('검사기가 안 막힌 버튼을 잡는다', () => {
    const source = [
      'async function save() {}',
      '<template>',
      '<AppButton @click="save">x</AppButton>',
    ].join(NEWLINE)
    expect(unguardedButtons(source)).toEqual(['save'])
  })

  it('검사기가 action과 동기 핸들러는 안 잡는다', () => {
    const source = [
      'async function save() {}',
      'function close() {}',
      '<template>',
      '<AppButton :action="save">x</AppButton>',
      '<AppButton @click="close">x</AppButton>',
    ].join(NEWLINE)
    expect(unguardedButtons(source)).toEqual([])
  })

  it('지금 소스에 안 막힌 버튼이 없다', () => {
    const found = vueFiles(SRC).flatMap((path) =>
      unguardedButtons(readFileSync(path, 'utf-8')).map(
        (name) => `${path.slice(SRC.length + 1)}  ${name}`,
      ),
    )
    expect(found).toEqual([])
  })
})

describe('지금 화면 코드에 위반이 없다', () => {
  for (const rule of RULES) {
    it(`${rule.name} — ${rule.why}`, () => {
      const found: string[] = []
      for (const path of vueFiles(SRC)) {
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
