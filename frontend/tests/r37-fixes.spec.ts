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
  withAttachmentRemoved,
  withImportedSections,
} from '../src/project/portfolio'
import { readProject, writeProject, type ProjectFile } from '../src/project/format'
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

  /**
   * **사진을 한 장 떼면 나머지가 남는다** (2026-09-23 R37-V, A-2의 이웃).
   *
   * 읽는 쪽만 고쳤더니 **쓰는 쪽에 같은 병이 있었다**: `attachments[sectionId] = kept`는
   * id가 `__proto__`일 때 **own 속성을 안 만들고 프로토타입을 바꾼다.** 그러면 `own()`이
   * 못 찾아 **그 문항의 사진이 전부 조용히 사라진다** — 학생이 한 장을 뗐는데 넷이 없어진다.
   */
  it.each(NAMES)('%s — 한 장을 제거하면 나머지가 남는다', (id) => {
    const made = portfolioWith(id)
    const portfolio = {
      ...made,
      attachments: { [id]: ['portfolio/attachments/1.webp', 'portfolio/attachments/2.webp'] },
    }

    const next = withAttachmentRemoved(portfolio, id, 'portfolio/attachments/1.webp')
    expect(attachmentsOf(next, id)).toEqual(['portfolio/attachments/2.webp'])
  })

  /**
   * **나가는 파일에서도 안 사라진다.** `writeProject`가 첨부를 다시 세우는 자리도 같은
   * 색인 대입이었다 — 거기서 사라지면 **제출된 `.mlpx`에 사진이 없다.**
   *
   * **`__proto__`는 빼고 넷만 잰다.** 재고 나서 빼는 것이다(2026-09-23): 계산된 열쇠를 쓴
   * 리터럴은 own 속성을 만들고 `JSON` 왕복도 그것을 지키는데, **`zod`의 `z.record` 파스가
   * 색인 대입으로 레코드를 다시 세워 거기서 사라진다.** 라이브러리 안이라 우리 코드로는
   * 못 막는다. 문에서 막을지는 `open-decisions.md` 49가 갖는다 — 지금은 **크래시는 없고
   * 그 하나만 저장이 안 된다.**
   */
  it.each(NAMES.filter((name) => name !== '__proto__'))(
    '%s — 저장하고 열어도 사진이 남는다',
    async (id) => {
      const made = portfolioWith(id)
      const base = emptyProjectFile()
      const file: ProjectFile = {
        ...base,
        document: {
          ...base.document,
          portfolio: { ...made, attachments: { [id]: ['portfolio/attachments/1.webp'] } },
        },
        attachments: new Map([['portfolio/attachments/1.webp', new Uint8Array([1, 2, 3])]]),
      }

      const { blob } = await writeProject(file, '# 포트폴리오\n')
      const reopened = await readProject(new Uint8Array(await blob.arrayBuffer()))
      expect(attachmentsOf(reopened.project.document.portfolio, id)).toEqual([
        'portfolio/attachments/1.webp',
      ])
    },
  )

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

  /**
   * **값이 없는 칸은 수가 아니다** (2026-09-23 R37-V §3.3). 이 갈래를
   * `{ kind: 'number', value: 0 }`으로 바꿔도 **전체 스위트가 조용했다** — 두 뜻을 한
   * 이름에 합친 판단은 그대로 두고(화면 둘 다 `없음`을 적는다), **무검사인 것만 닫는다.**
   *
   * 조용하면 무슨 일이 나는가: 결측치가 `0`으로 읽혀 **툴팁이 첫 범주의 이름을 말한다** —
   * 빈 칸이 `남`이 된다.
   */
  it('값이 없으면 수로 읽지 않는다', () => {
    expect(axisCellOf(['남', '여'], null)).toEqual({ kind: 'unknownCategory' })
    expect(axisCellOf(undefined, null)).toEqual({ kind: 'unknownCategory' })
  })

  /** 범주 축인데 그 번호에 이름이 없는 경우도 같은 칸이다 — 합친 뜻의 다른 쪽. */
  it('범주 번호에 이름이 없으면 같은 칸을 준다', () => {
    expect(axisCellOf(['남', '여'], 7)).toEqual({ kind: 'unknownCategory' })
  })
})
