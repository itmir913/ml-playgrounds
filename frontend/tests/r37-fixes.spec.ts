/**
 * R37이 잡은 A-2·A-3을 무는 검사 (`docs/audit/report-R37.md`).
 *
 * **둘 다 "한 시점의 계산"을 겨냥하는 돌연변이가 원리적으로 못 보던 자리다.** 무는 방법도
 * 그래서 다르다 — **남이 준 이름을 열쇠로 넣고**(A-2), **그림이 만든 콜백을 직접
 * 부른다**(A-3). A-1은 순서를 쥐어야 해서 `r37-tab-lock.spec.ts`가 따로 문다.
 */

import { describe, expect, it } from 'vitest'

import {
  attachmentsOf,
  isPortfolioAnswered,
  portfolioSections,
  withImportedSections,
} from '../src/project/portfolio'
import { parsePortfolioForm } from '../src/project/portfolio-form'
import { emptyProjectFile } from './fixtures/project'
import { axisCellOf, placed } from '../src/data/category-axis'
import { scatterOptions, type ChartPaint } from '../src/data/chart-config'

describe('A-2 — 문항 id가 프로토타입의 이름이어도 안 선다', () => {
  /**
   * **입구는 교사의 양식이다.** `{#constructor}`가 `HEADING_ID` 정규식을 통과하고,
   * 그 뒤 `answers[id] ?? ''`가 **함수**를 내준다 — `.trim()`이 던지고
   * `isPortfolioAnswered`가 던지므로 라우터 가드와 체크리스트까지 함께 선다.
   */
  const NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']

  /** 빈 포트폴리오. 프로젝트를 만드는 경로가 내는 그대로다. */
  const emptyPortfolio = () => emptyProjectFile().document.portfolio

  /**
   * **진짜 입구로 만든다** (「진짜 입구로 재현하라」). 교사가 쓴 양식 문자열을 그대로
   * 파스해 `withImportedSections`로 받는다 — 손으로 조립하면 그 자리에 있는 방어선을
   * 건너뛰고, 이 지적의 요지가 *"문은 멀쩡한데 읽는 쪽이 무너진다"*이므로 문을 꼭 지나야 한다.
   */
  function portfolioWith(id: string) {
    const parsed = parsePortfolioForm(`## 느낀 점 {#${id}}

무엇을 느꼈나요?
`)
    return withImportedSections(emptyPortfolio(), parsed.sections, 'ko')
  }

  it('양식의 id가 그대로 문항 id가 된다 — 이 검사의 전제다', () => {
    for (const name of NAMES) {
      expect(portfolioWith(name).template.sections[0]?.id, `section id for ${name}`).toBe(name)
    }
  })

  it.each(NAMES)('%s — 답을 읽어도 안 던진다', (id) => {
    const portfolio = portfolioWith(id)
    expect(() => portfolioSections(portfolio)).not.toThrow()
    expect(portfolioSections(portfolio)[0]?.answer).toBe('')
  })

  it.each(NAMES)('%s — 다 썼는지 물어도 안 던진다', (id) => {
    expect(isPortfolioAnswered(portfolioWith(id))).toBe(false)
  })

  it.each(NAMES)('%s — 사진을 물어도 배열이다', (id) => {
    expect(attachmentsOf(portfolioWith(id), id)).toEqual([])
  })

  /** 진짜로 담긴 값은 그대로 읽힌다 — 고침이 정상 경로를 안 막았다. */
  it('own 속성은 그대로 읽는다', () => {
    const made = portfolioWith('느낀점')
    const portfolio = { ...made, answers: { [made.template.sections[0]?.id ?? '']: '좋았다' } }
    expect(portfolioSections(portfolio)[0]?.answer).toBe('좋았다')
    expect(isPortfolioAnswered(portfolio)).toBe(true)
  })
})

describe('A-3 — 범주 축의 툴팁이 흩뿌린 수를 말하지 않는다', () => {
  const PAINT: ChartPaint = {
    palette: ['#000000'],
    softPalette: ['#ffffff'],
    surface: '#ffffff',
    ink: '#475569',
    line: '#e2e8f0',
  }

  /**
   * **그림이 만든 콜백을 직접 부른다.** 툴팁은 Chart.js 안에서만 불리므로, 이 자리가
   * 캔버스 없이 무는 유일한 길이다 (`cluster-chart.spec.ts`가 같은 모양을 쓴다).
   */
  it('흩뿌린 값이 범주 이름으로 돌아온다', () => {
    const categories = ['남', '여']
    const drawn = placed(1, 7, categories)
    expect(Number.isInteger(drawn)).toBe(false)

    const seen: string[] = []
    const options = scatterOptions(
      PAINT,
      {
        x: '성별',
        y: '키',
        point: (_name, x) => {
          seen.push(x.kind === 'category' ? x.name : JSON.stringify(x))
          return ''
        },
      },
      false,
      { x: categories },
    )
    const label = options.plugins?.tooltip?.callbacks?.label as
      | ((item: { dataset: { label: string }; parsed: { x: number; y: number } }) => string)
      | undefined
    expect(label).toBeTypeOf('function')
    label?.({ dataset: { label: '데이터' }, parsed: { x: drawn, y: 170 } })

    // 고치기 전에는 화면이 `1.02`를 그대로 적었다. 이제 **그림이 되돌린 것**이 온다.
    expect(seen).toEqual(['여'])
  })

  /** 수치 축은 되돌리지 않는다 — 없는 반올림을 넣으면 그쪽이 거짓말한다. */
  it('수치 축은 값을 그대로 말한다', () => {
    expect(axisCellOf(undefined, 1.02)).toEqual({ kind: 'number', value: 1.02 })
  })
})
