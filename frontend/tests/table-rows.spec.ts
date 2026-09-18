/**
 * **표의 줄은 마우스를 따라오고, 두 강조는 다른 말을 한다** (2026-09-18, 사용자).
 *
 * 표가 열셋인데 마우스를 얹어도 아무 일이 안 일어나는 표가 그중 열둘이었다. 줄이 길면
 * 교사는 **가로로 눈을 옮기다 줄을 잃는다** — 명렬에서 `실험 0개`인 줄이 누구인지 찾는
 * 그 동작이 정확히 그렇다.
 *
 * **얹힌 줄은 어두워지고, 고른 줄은 색이 든다.** 둘을 같은 색으로 두면 마우스가 지나간
 * 줄이 "골라진 것"으로 읽힌다. 그래서 얹힌 줄은 `surface-hover`(한 단계 어둡게), 고른
 * 줄은 `brand-soft`에 굵게다. **표마다 다르면 안 된다** — 같은 앱의 표라는 것이 색으로
 * 보여야 한다.
 *
 * **줄무늬 표가 얹힌 색의 조건을 정했다.** 두 표가 `odd:bg-surface even:bg-surface-sunken`
 * 이라, 얹힌 색이 그중 하나면 **그 줄에서는 아무 일도 안 일어난다.** 그래서 줄무늬 두
 * 색보다 한 단계 더 어둡다. (`hover:`가 `odd:`/`even:`보다 뒤에 깔리는 것은 빌드 CSS에서
 * 재 봤다 — 특정도가 같아 순서가 정한다.)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { sourceFiles } from './fixtures/source'

const SRC = join(process.cwd(), 'src')

/** 고른 줄의 색. **`theme.css`의 토큰 이름이다.** */
const CHOSEN = 'brand-soft'

/** 얹힌 줄의 색. **고른 줄과 달라야 한다** — 그것이 이 파일이 지키는 것이다. */
const HOVER = 'surface-hover'

/** `data-table`이 사는 곳. 표의 껍데기는 여기 하나다 (`components/AppTable.vue`). */
const UTILITIES = join(SRC, 'styles', 'utilities.css')

/** `<tbody>` 안의 줄 여는 태그. 속성이 여러 줄에 걸쳐도 `[^>]`가 줄바꿈을 먹는다. */
const BODY_ROW = /<tr\b[^>]*>/g

/** 화면 본문만. 주석 안의 예문과 스크립트의 문자열에 안 속는다. */
function templateOf(text: string): string {
  return text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
}

/** 이 화면의 `<tbody>` 안 줄들. */
function bodyRows(path: string): string[] {
  const template = templateOf(readFileSync(path, 'utf8'))
  return [...template.matchAll(/<tbody[\s\S]*?<\/tbody>/g)].flatMap((body) =>
    [...body[0].matchAll(BODY_ROW)].map((row) => row[0]),
  )
}

/** 표가 있는 화면들. */
function screensWithTables(): string[] {
  return sourceFiles(SRC).filter((path) => path.endsWith('.vue') && bodyRows(path).length > 0)
}

/** 한 줄로 줄인 태그. 실패 문구에 그대로 싣는다. */
function oneLine(tag: string): string {
  return tag.split(/\s+/).join(' ').slice(0, 80)
}

describe('마우스가 얹힌 줄', () => {
  const css = readFileSync(UTILITIES, 'utf8')

  /**
   * **껍데기가 모든 표에 준다.** 열셋이 각자 클래스를 붙이면 그중 하나가 빠져도 화면은
   * 멀쩡히 그려지고, 빠진 것을 아무도 못 본다 — 실제로 열둘이 빠져 있었다.
   */
  it('data-table이 몸통 줄에 강조를 준다', () => {
    expect(css, 'data-table has no row hover').toMatch(
      new RegExp(String.raw`&\s*tbody\s+tr[^{]*:hover\s*\{[^}]*--color-` + HOVER),
    )
  })

  /**
   * **얹힌 색과 고른 색은 다른 것이다.** 하나로 합치면 마우스가 지나간 줄과 열어 둔 줄이
   * 같은 모양이 된다 (2026-09-18에 한 번 그렇게 만들었다가 사용자가 잡았다).
   */
  it('얹힌 색과 고른 색이 다르다', () => {
    const rule = css.match(/&\s*tbody\s+tr[^{]*:hover\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule, 'no row hover rule to read').not.toBe('')
    expect(rule, 'hover wears the chosen colour').not.toContain(`--color-${CHOSEN}`)
  })

  /**
   * **고른 줄에는 안 건다.** 안 빼면 고른 줄에 마우스를 얹는 순간 그 줄이 회색이 되어
   * 고른 표시가 풀린 것처럼 보인다 — 줄의 `:hover`가 칸의 클래스보다 특정도가 높다.
   */
  it('고른 줄은 얹혀도 색이 안 바뀐다', () => {
    expect(css, 'hover repaints the chosen row').toMatch(
      new RegExp(String.raw`&\s*tbody\s+tr:not\(\.bg-` + CHOSEN + String.raw`\):hover`),
    )
  })

  /**
   * **줄 이름표 칸이 줄 배경을 가리면 강조가 반쪽이다.** `& th`가 머리글 색을 칠하는데
   * 그 칸(모델 이름, 혼동 행렬의 실제 값)은 몸통에 있어서, 얹힌 줄도 고른 줄도 **첫
   * 칸만 회색인 채로** 칠해졌다. 칸의 배경은 줄의 배경을 언제나 이긴다.
   */
  it('몸통의 줄 이름표 칸은 제 배경을 안 갖는다', () => {
    expect(css, 'a row label cell paints over the row').toMatch(
      /&\s*tbody\s+th\s*\{[^}]*background-color:\s*transparent/,
    )
  })

  it('화면이 다른 색으로 덮지 않는다', () => {
    const offenders: string[] = []
    for (const path of screensWithTables()) {
      for (const row of bodyRows(path)) {
        for (const [, token] of row.matchAll(/hover:bg-([\w-]+)/g)) {
          if (token !== HOVER) offenders.push(`${path.slice(SRC.length + 1)}  ${oneLine(row)}`)
        }
      }
    }
    expect(offenders, 'a table row hovers in a different colour').toEqual([])
  })
})

describe('고른 줄', () => {
  /** 누를 수 있는 줄인가. **고를 수 있는 표만 고른 줄을 갖는다.** */
  function clickable(row: string): boolean {
    return row.includes('@click')
  }

  /** 그 줄의 `:class`에 적힌 것 — 고른 줄의 표시가 여기 산다. */
  function dynamicClass(row: string): string {
    const found = row.match(/:class="([\s\S]*?)"/)
    return found?.[1] ?? ''
  }

  it('고른 줄의 색이 표마다 같다', () => {
    const offenders: string[] = []
    for (const path of screensWithTables()) {
      for (const row of bodyRows(path)) {
        for (const [, token] of dynamicClass(row).matchAll(/(?<!:)\bbg-([\w-]+)/g)) {
          if (token !== CHOSEN) offenders.push(`${path.slice(SRC.length + 1)}  bg-${token}`)
        }
      }
    }
    expect(offenders, 'a chosen row uses a colour of its own').toEqual([])
  })

  /**
   * **색만으로 말하지 않는다.** 고른 줄의 색은 연한 남색 한 겹이라, 표가 길면 화면 밖
   * 줄들과의 차이가 훑는 눈에 약하다 — 굵기가 그 줄을 멀리서도 찾아 준다. 이 앱이
   * 색만으로 뜻을 말하지 않는 다른 자리들과 같은 규칙이다(`ACTION_ICONS.written`).
   */
  it('누를 수 있는 줄은 굵기로도 갈린다', () => {
    const offenders: string[] = []
    for (const path of screensWithTables()) {
      for (const row of bodyRows(path)) {
        if (!clickable(row)) continue
        if (!dynamicClass(row).includes('font-bold')) {
          offenders.push(`${path.slice(SRC.length + 1)}  ${oneLine(row)}`)
        }
      }
    }
    expect(offenders, 'a chosen row is not bold').toEqual([])
  })
})

describe('검사기가 실제로 잡는다', () => {
  const chosen =
    '<tr class="cursor-pointer" :class="on ? \'bg-brand-soft font-bold\' : \'\'" @click="pick">'

  it('줄을 세는 자리가 머리글에 안 속는다', () => {
    const screen = `<template><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></template>`
    const rows = [...(screen.match(/<tbody[\s\S]*?<\/tbody>/) ?? [''])[0].matchAll(BODY_ROW)]
    expect(rows).toHaveLength(1)
  })

  it('다른 색과 안 굵은 고른 줄을 가른다', () => {
    expect(/hover:bg-([\w-]+)/.exec('<tr class="hover:bg-surface-sunken">')?.[1]).toBe(
      'surface-sunken',
    )
    expect(chosen.includes('font-bold')).toBe(true)
    expect('<tr :class="on ? \'bg-brand-soft\' : \'\'" @click="pick">'.includes('font-bold')).toBe(
      false,
    )
  })
})
