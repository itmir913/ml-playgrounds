/**
 * **흐름도의 글자와 선이 바탕 위에서 읽힌다** (`styles/utilities.css`의 `flow-*`, `architecture.md` §8.22).
 *
 * 흐름도의 색은 토큰을 `color-mix(in srgb, …)`로 섞어 만든다. 그래서 토큰만 재서는 화면에 나오는 색을 못
 * 잰다 — 이 검사는 **utilities.css의 식을 그대로 읽어** 두 배색(라이트 `theme.css`, 다크 `dark.css`)의 토큰으로
 * 계산한다. 식을 고치면 이 검사가 그 식을 다시 잰다. 계산기는 `fixtures/contrast.ts`(`theme.spec.ts`가 먼저 자를
 * 잰다)다.
 *
 * - 원 안 글자는 원의 바탕(그러데이션의 두 끝) 위에서 4.5.
 * - 카드 머리 글자는 카드(`surface`) 위에서 4.5.
 * - 윤곽 상자·원의 글자와 기준 글자는 그림 바탕(`surface-sunken`) 위에서 4.5와 4.3(`theme.css`가 적은 줄무늬의 하한).
 * - 선과 화살촉은 `surface-sunken` 위에서 3(WCAG 1.4.11). **96이 걸린 색은 예외로 표기한다** — 팔레트를 안 건드린다.
 * - **회색 몫(`flow-bar-gray`)은 재지 않는다.** 정보가 아니라 비어 있음의 표시이고 이름표와 누르면 나오는 수가 말한다
 *   (`docs/rule-coverage.md`).
 *
 * **빛 번짐은 꾸밈이라 재지 않는다** — 사람이 본다(성능이 나쁘면 가장 먼저 뺀다).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { contrast, mixSrgb, token } from './fixtures/contrast'

const CSS = readFileSync(join(process.cwd(), 'src', 'styles', 'utilities.css'), 'utf-8')
/** 흐름도 색 블록. 시작 주석부터 파일 끝까지다. */
const FLOW_BLOCK = CSS.slice(CSS.indexOf('프로젝트 흐름도의 색'))

const THEMES = ['theme.css', 'dark.css'] as const

/** `@utility <이름> { … }`의 몸통. */
function utility(name: string): string {
  const found = new RegExp(`@utility ${name} \\{([^}]*)\\}`).exec(FLOW_BLOCK)
  if (!found?.[1]) throw new Error(`utility not found: ${name}`)
  return found[1]
}

/** 몸통에서 속성 하나의 값. 여러 줄에 걸칠 수 있다. */
function declaration(name: string, property: string): string {
  const found = new RegExp(`(?:^|[\\s;])${property}:\\s*([^;]+);`).exec(utility(name))
  if (!found?.[1]) throw new Error(`${name} has no ${property}`)
  return found[1].trim()
}

interface Context {
  readonly file: string
  /** `var(--flow)`가 가리키는 토큰 이름. */
  readonly flow: string
  /** 투명한 쪽이 얹히는 바탕. */
  readonly under: string
}

/** 괄호 깊이 0의 쉼표로 나눈다. */
function splitTop(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0) {
      parts.push(text.slice(start, at).trim())
      start = at + 1
    }
  }
  parts.push(text.slice(start).trim())
  return parts
}

/**
 * 색 식을 hex로 계산한다. 아는 것은 `var(--flow)`, `var(--color-…)`, `color-mix(in srgb, A p%, B)`와
 * `transparent`뿐이다 — **모르는 식은 던진다**(조용히 넘기면 못 잰 색이 초록이 된다).
 */
function evaluate(expression: string, context: Context): string {
  const text = expression.trim()
  const variable = /^var\(--([\w-]+)\)$/.exec(text)
  if (variable?.[1]) {
    const name = variable[1] === 'flow' ? context.flow : variable[1]
    return token(context.file, name.replace(/^color-/, ''))
  }
  if (text === 'transparent') return context.under
  const mix = /^color-mix\((.*)\)$/s.exec(text)
  if (mix?.[1]) {
    const [space, first, second] = splitTop(mix[1])
    if (space !== 'in srgb' || first === undefined || second === undefined) {
      throw new Error(`only color-mix(in srgb, A p%, B) is measured: ${text}`)
    }
    const share = /^(.*)\s+(\d+(?:\.\d+)?)%$/s.exec(first)
    if (!share?.[1] || !share[2]) throw new Error(`mix needs a percentage: ${first}`)
    // 투명한 쪽은 바탕 위에 얹힌 값이므로 같은 식이다: 색 p + 바탕 (1 - p).
    return mixSrgb(evaluate(share[1], context), Number(share[2]), evaluate(second, context))
  }
  throw new Error(`cannot measure: ${text}`)
}

const FLOWS = {
  file: 'color-chart-2',
  train: 'color-chart-3',
  test: 'color-chart-6',
  new: 'color-chart-7',
  model: 'color-chart-5',
  basis: 'color-ink-faint',
} as const

/** `flow-tint-<흐름>`이 정한 토큰. CSS를 읽어 낸다 — 이 표와 CSS가 갈리면 운다. */
function tintToken(name: keyof typeof FLOWS): string {
  const found = /var\(--([\w-]+)\)/.exec(declaration(`flow-tint-${name}`, '--flow'))
  if (!found?.[1]) throw new Error(`no tint for ${name}`)
  return found[1]
}

describe('식을 읽는 계산기', () => {
  const context: Context = { file: 'theme.css', flow: 'color-chart-5', under: '#ffffff' }

  it('토큰과 투명과 섞기를 계산한다', () => {
    expect(evaluate('var(--color-surface)', context)).toBe(token('theme.css', 'surface'))
    expect(evaluate('var(--flow)', context)).toBe(token('theme.css', 'chart-5'))
    // 투명끼리 섞으면 바탕이 그대로 나온다.
    expect(evaluate('transparent', { ...context, under: '#808080' })).toBe('#808080')
    expect(
      evaluate('color-mix(in srgb, var(--color-ink) 50%, transparent)', {
        ...context,
        under: '#ffffff',
      }),
    ).toBe(mixSrgb(token('theme.css', 'ink'), 50, '#ffffff'))
  })

  it('안에 든 섞기도 계산한다', () => {
    const inner = 'color-mix(in srgb, var(--flow) 25%, var(--color-surface))'
    expect(evaluate(`color-mix(in srgb, ${inner} 50%, var(--color-ink))`, context)).toBe(
      mixSrgb(
        mixSrgb(token('theme.css', 'chart-5'), 25, token('theme.css', 'surface')),
        50,
        token('theme.css', 'ink'),
      ),
    )
  })

  it('srgb가 아닌 섞기와 모르는 식은 던진다', () => {
    expect(() => evaluate('color-mix(in oklab, red 50%, blue)', context)).toThrow()
    expect(() => evaluate('#ffffff', context)).toThrow()
  })
})

describe('색 블록의 규칙', () => {
  it('블록을 실제로 찾았다', () => {
    expect(FLOW_BLOCK.length).toBeGreaterThan(500)
    expect(FLOW_BLOCK).toContain('@utility flow-tint-file')
  })

  it('hex를 적지 않는다 — 색은 토큰에서만 온다', () => {
    expect(FLOW_BLOCK.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
    expect(FLOW_BLOCK).not.toMatch(/\b(?:rgb|hsl|oklch|oklab)a?\(/)
  })

  it('섞을 때는 in srgb만 쓴다', () => {
    const mixes = [...FLOW_BLOCK.matchAll(/color-mix\(\s*in\s+(\w+)/g)].map((m) => m[1])
    expect(mixes.length).toBeGreaterThan(10)
    expect(mixes.filter((space) => space !== 'srgb')).toEqual([])
  })

  it('흐르는 것마다 토큰이 하나씩 있고 이 표와 같다', () => {
    for (const name of Object.keys(FLOWS) as (keyof typeof FLOWS)[]) {
      expect(`color-${tintToken(name).replace(/^color-/, '')}`, name).toBe(FLOWS[name])
    }
  })

  it('전환은 불투명도뿐이다', () => {
    const transitions = [...FLOW_BLOCK.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1] ?? '')
    expect(transitions.length).toBeGreaterThan(0)
    for (const value of transitions)
      expect(value.trim() === 'none' || value.trim().startsWith('opacity'), value).toBe(true)
  })
})

describe.each(THEMES)('%s에서의 대비', (file) => {
  const surface = token(file, 'surface')
  const sunken = token(file, 'surface-sunken')
  const under = (ground: string, flow: string): Context => ({ file, flow, under: ground })

  it('원 안 글자가 원의 바탕 두 끝에서 4.5 이상이다', () => {
    const text = declaration('flow-circle', 'color')
    const background = declaration('flow-circle', 'background')
    const stops = [...background.matchAll(/color-mix\((?:[^()]|\([^()]*\))*\)/g)].map((m) => m[0])
    expect(stops).toHaveLength(2)
    for (const flow of ['model', 'new'] as const) {
      const context = under(sunken, tintToken(flow))
      for (const stop of stops) {
        const ratio = contrast(evaluate(text, context), evaluate(stop, context))
        expect(ratio, `${file} ${flow} ${stop}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('카드 머리 글자가 카드 위에서 4.5 이상이다', () => {
    const text = declaration('flow-text-head', 'color')
    for (const flow of ['file', 'train', 'test', 'new'] as const) {
      const ratio = contrast(evaluate(text, under(surface, tintToken(flow))), surface)
      expect(ratio, `${file} ${flow}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('이름표 글자가 이름표 바탕 위에서 4.5 이상이다', () => {
    const context = under(sunken, tintToken('model'))
    const ratio = contrast(
      evaluate(declaration('flow-tag', 'color'), context),
      evaluate(declaration('flow-tag', 'background'), context),
    )
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('상자의 글자가 상자 바탕 위에서 4.5 이상이다', () => {
    const context = under(sunken, tintToken('train'))
    const solid = contrast(
      evaluate(declaration('flow-node', 'color'), context),
      evaluate(declaration('flow-node', 'background'), context),
    )
    expect(solid).toBeGreaterThanOrEqual(4.5)
    // 윤곽 상자는 바탕이 비쳐서 그림 바탕 위에 반투명 면이 얹힌다.
    const pending = contrast(
      evaluate(declaration('flow-node-pending', 'color'), context),
      evaluate(declaration('flow-node-pending', 'background'), context),
    )
    expect(pending, `${file} pending node`).toBeGreaterThanOrEqual(4.5)
  })

  it('윤곽 원의 글자가 비친 바탕 위에서 4.5 이상이다', () => {
    for (const flow of ['model', 'new'] as const) {
      const context = under(sunken, tintToken(flow))
      const ratio = contrast(
        evaluate(declaration('flow-circle-pending', 'color'), context),
        evaluate(declaration('flow-circle-pending', 'background'), context),
      )
      expect(ratio, `${file} ${flow}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('기준 글자가 그림 바탕 위에서 4.3 이상이다', () => {
    const ratio = contrast(
      evaluate(declaration('flow-text-dim', 'color'), under(sunken, tintToken('basis'))),
      sunken,
    )
    expect(ratio).toBeGreaterThanOrEqual(4.3)
  })

  /**
   * **96이 걸린 색.** 라이트 배색의 차트 색 가운데 그림 바탕(`surface-sunken`)과 3:1을 못 넘는 것은 팔레트의
   * 문제다(`open-decisions.md` 96) — 이번에 팔레트를 안 건드리므로 선·화살촉 검사에서 예외로 적는다. **예외는
   * 이름으로 적고 값을 적지 않는다.** 목록 밖의 색이 못 넘으면 운다. 그리고 예외가 실제로 못 넘는지도 잰다
   * — 96이 풀려 넘는 날 이 목록에서 지우라고 운다.
   */
  const KNOWN_96: Readonly<Record<string, readonly (keyof typeof FLOWS)[]>> = {
    'theme.css': ['file', 'new'],
    'dark.css': [],
  }

  it('선과 화살촉의 색이 그림 바탕 위에서 3 이상이다 (96 예외는 이름으로)', () => {
    const exempt = new Set(KNOWN_96[file])
    const failing: string[] = []
    for (const name of Object.keys(FLOWS) as (keyof typeof FLOWS)[]) {
      const ratio = contrast(evaluate('var(--flow)', under(sunken, tintToken(name))), sunken)
      if (ratio < 3) failing.push(name)
    }
    expect(
      failing.filter((name) => !exempt.has(name as keyof typeof FLOWS)),
      'a line color under 3:1 that 96 does not cover',
    ).toEqual([])
    expect(
      [...exempt].filter((name) => !failing.includes(name)),
      'an exemption that now passes',
    ).toEqual([])
  })
})
