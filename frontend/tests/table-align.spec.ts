// @vitest-environment jsdom
// 명렬을 진짜로 띄워서 머리 칸과 몸 칸을 나란히 센다.
/**
 * **표의 머리와 칸은 같은 쪽으로 선다** (2026-09-18, 사용자).
 *
 * 명렬의 `상태` 열이 **머리는 왼쪽, 칸은 오른쪽**이었다. 원인이 둘이고 둘 다 조용했다.
 *
 * 1. **머리에 적은 `text-right`가 죽어 있었다.** `data-table`의 `& th`가 `text-align: left`를
 *    박는데 그 선택자(`.data-table th`)의 특정도가 `.text-right`보다 높다. 클래스는 붙어
 *    있고 아무 일도 안 일어난다 — **혼동 행렬의 `text-center`도 같이 죽어 있었다.**
 * 2. **머리와 칸이 서로 다른 자리에서 정렬을 정하고 있었다.** 머리는 `COLUMNS`의 v-for에서,
 *    칸은 손으로 적은 `<td>`에서. 한쪽만 고치면 갈리고, 갈려도 아무것도 안 운다.
 *
 * 그래서 검사도 둘이다. **정적 훑기**는 표 열셋 전부를 보고 머리와 칸이 정렬을 각자
 * 적었는지를 잡고, **마운트 검사**는 실제로 그려진 명렬에서 열마다 두 쪽을 견준다.
 * 앞의 것은 넓고 얕으며 뒤의 것은 좁고 깊다 — 하나로는 이 결함을 못 잡는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { setLocale } from '../src/i18n'
import { brokenFile, mountInspect, submissionFile } from './fixtures/inspect-screen'
import { sourceFiles } from './fixtures/source'

const SRC = join(process.cwd(), 'src')

/** 칸이 설 수 있는 쪽. 기본은 왼쪽이다 (`data-table`의 `:where(&) th`). */
type Align = 'left' | 'center' | 'right'

/** 정렬을 정하는 유틸리티. **여기 없는 것은 정렬을 안 건드린다.** */
const ALIGN_CLASSES: Readonly<Record<string, Align>> = {
  'text-left': 'left',
  'text-center': 'center',
  'text-right': 'right',
}

describe('정렬 기본값은 칸이 덮을 수 있어야 한다', () => {
  const css = readFileSync(join(SRC, 'styles', 'utilities.css'), 'utf8')

  /** `@utility data-table { ... }` 의 몸통. */
  function dataTableBlock(): string {
    const start = css.indexOf('@utility data-table {')
    expect(start, 'data-table utility not found').toBeGreaterThan(-1)
    let depth = 0
    for (let index = css.indexOf('{', start); index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') {
        depth -= 1
        if (depth === 0) return css.slice(start, index + 1)
      }
    }
    throw new Error('data-table utility is not closed')
  }

  it('data-table이 정렬을 특정도 0으로만 정한다', () => {
    const block = dataTableBlock()
    const offenders: string[] = []
    // `선택자 { 몸통 }` 짝. 중첩이 한 겹뿐이라 이것으로 충분하다.
    for (const [, selector, body] of block.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
      if (!body?.includes('text-align')) continue
      // **`:where()` 밖에서 정하면 칸에 붙인 `text-right`가 진다.** `.data-table th`는
      // (0,1,1)이고 `.text-right`는 (0,1,0)이다.
      if (!selector?.includes(':where(')) offenders.push(selector?.trim() ?? '')
    }
    expect(offenders, 'sets text-align where a cell class cannot win').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    const bait = '& th { text-align: left; }'
    const rules = [...bait.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    expect(
      rules.some(
        ([, selector, body]) => body?.includes('text-align') && !selector?.includes(':where('),
      ),
    ).toBe(true)
  })
})

/**
 * **정적 훑기는 열 번호를 본다** (2026-09-18 R28 A-2).
 *
 * 처음에는 정렬 클래스를 **모아서**(다중집합) 견줬다. 머리말은 *"머리와 칸이 정렬을 각자
 * 적었는지를 잡는다"*라고 적혀 있었는데, 머리의 1열과 칸의 6열이 각각 `text-right`이면
 * **양쪽 다 `[text-right]`이라 조용했다** — 열이 어긋났는데 초록이다. 짝짓기도 화면
 * 안의 `<thead>`와 `<tbody>`를 **순서로** 맞춰서, 머리 없는 표가 하나 끼면 그 뒤가 통째로
 * 밀렸다.
 */
describe('머리와 칸이 정렬을 각자 적지 않는다', () => {
  /** 주석과 스크립트를 걷어낸 화면 본문. 주석 안의 `<thead>`에 속지 않는다. */
  function templateOf(text: string): string {
    return text.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '')
  }

  /** `<th …>` · `<td …>` 여는 태그의 속성 부분만. **자식은 안 본다** — 칸의 정렬이다. */
  const CELL_TAG = /<t([hd])\b([^>]*)>/g

  /**
   * 칸 하나가 먹는 자리.
   *
   * **몇 칸인지 모르는 칸이 있다** — `v-for`로 도는 머리와 코드가 정하는 `colspan`이다.
   * 그 폭은 정적으로 못 세므로 **"여럿"이라고만 적고** 머리와 칸이 같은 자리에서 같은
   * 모양인지를 본다.
   */
  interface Slot {
    readonly align: Align
    readonly many: boolean
  }

  /** 그 줄의 칸들. 여는 태그 하나가 자리 하나다. */
  function slotsOf(row: string): Slot[] {
    return [...row.matchAll(CELL_TAG)].map(([, , attributes]) => {
      const text = attributes ?? ''
      const found = Object.entries(ALIGN_CLASSES).find(([name]) => text.includes(name))
      return { align: found?.[1] ?? 'left', many: /\bv-for\b|colspan/.test(text) }
    })
  }

  /** 그 구역의 줄들. */
  function rowsOf(region: string): string[] {
    return [...region.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr>/g)].map((row) => row[0])
  }

  /** 자리들을 실패 문구에 실을 한 줄로. */
  function shown(slots: Slot[]): string {
    return slots.map((slot) => `${slot.align}${slot.many ? '*' : ''}`).join(' ')
  }

  /**
   * 한 화면 안의 표들. **껍데기 단위로 자른다** — `<table>`이거나 `<AppTable>`이다.
   *
   * `<thead>`와 `<tbody>`를 화면 전체에서 순서로 맞추던 때는 **머리 없는 표가 하나만
   * 끼어도 짝이 통째로 밀렸고**, 그러면 남의 표의 머리와 이 표의 칸을 견준다.
   */
  function tables(template: string): { head: string; body: string }[] {
    const found: { head: string; body: string }[] = []
    for (const [block] of template.matchAll(/<(table|AppTable)\b[\s\S]*?<\/\1>/g)) {
      const head = block.match(/<thead[\s\S]*?<\/thead>/)?.[0] ?? ''
      const body = block.match(/<tbody[\s\S]*?<\/tbody>/)?.[0] ?? ''
      if (head !== '' && body !== '') found.push({ head, body })
    }
    return found
  }

  /**
   * **머리가 두 줄이고 `rowspan`으로 아래까지 걸치는 표.** 열 번호를 정적으로 셀 수
   * 없다 — 위 줄의 칸이 아래 줄의 자리를 먹고, 그 옆의 `colspan`은 코드가 정한다.
   *
   * **이 둘은 사람 확인이다.** 면제를 숨기지 않고 여기 이름으로 적어 두고, 아래 검사가
   * **면제가 아직 필요한지**를 판정한다 — 표가 평평해지는 날 이 목록이 먼저 운다.
   */
  const STACKED_HEADS = ['ConfusionMatrixPanel.vue', 'TabularPrepPreview.vue']

  const screens = sourceFiles(SRC).filter((path) => path.endsWith('.vue'))

  it('한 표의 머리와 칸이 열마다 같은 정렬을 적는다', () => {
    const offenders: string[] = []
    for (const path of screens) {
      if (STACKED_HEADS.some((name) => path.endsWith(name))) continue
      for (const { head, body } of tables(templateOf(readFileSync(path, 'utf8')))) {
        const headRow = rowsOf(head).at(-1)
        if (headRow === undefined) continue
        const wanted = slotsOf(headRow)
        for (const row of rowsOf(body)) {
          const got = slotsOf(row)
          if (shown(got) !== shown(wanted)) {
            offenders.push(
              `${path.slice(SRC.length + 1)}  머리[${shown(wanted)}] 칸[${shown(got)}]`,
            )
          }
        }
      }
    }
    // 갈리면 정렬을 열 정의 한 자리에 두고 머리와 칸이 거기서 받아라 (`InspectView`의 `COLUMNS`).
    expect(
      offenders,
      'a column declares one alignment in the header and another in the cell',
    ).toEqual([])
  })

  it('면제한 표는 실제로 머리가 두 줄이다 - 면제가 낡으면 여기서 선다', () => {
    for (const name of STACKED_HEADS) {
      const path = screens.find((one) => one.endsWith(name))
      expect(path, `exempted screen not found: ${name}`).toBeDefined()
      const heads = tables(templateOf(readFileSync(path ?? '', 'utf8'))).map(({ head }) =>
        rowsOf(head),
      )
      expect(
        heads.some((rows) => rows.length > 1),
        `${name} no longer stacks its header`,
      ).toBe(true)
    }
  })

  it('검사기가 열이 어긋난 것을 잡는다', () => {
    const head = '<tr><th class="text-right">a</th><th>b</th></tr>'
    const body = '<tr><td>1</td><td class="text-right">2</td></tr>'
    // **모아서 견주면 둘 다 `[right]`이라 조용하다.** 자리를 봐야 갈린다.
    expect(shown(slotsOf(head))).not.toBe(shown(slotsOf(body)))
    expect(shown(slotsOf(head))).toBe('right left')
    expect(shown(slotsOf(body))).toBe('left right')
  })

  it('머리 없는 표가 끼어도 짝이 안 밀린다', () => {
    const template =
      '<table><tbody><tr><td class="text-right">x</td></tr></tbody></table>' +
      '<AppTable><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></AppTable>'
    const found = tables(template)
    expect(found).toHaveLength(1)
    expect(shown(slotsOf(rowsOf(found[0]!.body)[0] ?? ''))).toBe('left')
  })

  it('몇 칸인지 모르는 칸은 여럿으로 센다', () => {
    expect(slotsOf('<th :colspan="3" class="text-center">예측</th>')[0]).toEqual({
      align: 'center',
      many: true,
    })
    expect(slotsOf('<td v-for="one in list" :key="one">x</td>')[0]).toEqual({
      align: 'left',
      many: true,
    })
  })
})

/** 그려진 칸이 실제로 서는 쪽. **안쪽 가로 배치까지 본다.** */
function alignOf(cell: Element): Align {
  const own = [...cell.classList].map((name) => ALIGN_CLASSES[name]).find((align) => align)
  return own ?? 'left'
}

/**
 * 칸 안에서 폭을 다 먹는 flex 줄이 미는 쪽. **없으면 칸의 정렬이 그대로 글자의 정렬이다.**
 *
 * 정렬 단추가 이 모양이다 — `text-align`은 폭을 다 먹는 flex 안에서 아무 일도 안 하므로,
 * 여기가 칸과 반대쪽을 보면 **클래스는 맞는데 눈에는 어긋난다.**
 */
function innerAlign(cell: Element): Align | null {
  const row = cell.querySelector('.flex.w-full')
  if (!row) return null
  const names = [...row.classList]
  if (names.includes('justify-end')) return 'right'
  if (names.includes('flex-row-reverse')) return names.includes('justify-start') ? 'right' : 'left'
  if (names.includes('justify-center')) return 'center'
  return 'left'
}

/** 한 줄의 칸들. `colspan`은 그만큼 늘려 세어 열 번호가 안 밀린다. */
function cellsOf(row: Element): Align[] {
  const aligns: Align[] = []
  for (const cell of row.querySelectorAll(':scope > th, :scope > td')) {
    const span = Number(cell.getAttribute('colspan') ?? '1')
    for (let index = 0; index < span; index += 1) aligns.push(alignOf(cell))
  }
  return aligns
}

describe('명렬을 띄워서 본다', () => {
  beforeEach(() => {
    setLocale('ko')
  })

  /** 읽히는 제출물 하나와 못 읽는 것 하나. **둘 다 줄을 갖는다.** */
  async function submissions(): Promise<File[]> {
    return [await submissionFile('hong.mlpx'), brokenFile('broken.mlpx')]
  }

  it('열마다 머리와 칸이 같은 쪽으로 선다', async () => {
    const wrapper = await mountInspect(await submissions())
    const table = wrapper.find('table').element
    const head = table.querySelector('thead tr')
    const rows = [...table.querySelectorAll('tbody tr')]
    expect(head).not.toBeNull()
    expect(rows.length).toBe(2)

    const headAligns = cellsOf(head as Element)
    for (const row of rows) {
      expect(cellsOf(row), `${wrapper.vm.$options.name ?? 'InspectView'} row`).toEqual(headAligns)
    }
    wrapper.unmount()
  })

  it('머리 칸 안의 가로 배치도 그 칸과 같은 쪽을 본다', async () => {
    const wrapper = await mountInspect(await submissions())
    for (const cell of wrapper.find('thead tr').element.querySelectorAll('th')) {
      const inner = innerAlign(cell)
      if (inner) expect(inner, cell.textContent?.trim()).toBe(alignOf(cell))
    }
    wrapper.unmount()
  })

  it('검사기가 실제로 잡는다', () => {
    const table = document.createElement('table')
    table.innerHTML =
      '<thead><tr><th>a</th></tr></thead><tbody><tr><td class="text-right">1</td></tr></tbody>'
    const head = table.querySelector('thead tr')
    const body = table.querySelector('tbody tr')
    expect(cellsOf(head as Element)).toEqual(['left'])
    expect(cellsOf(body as Element)).toEqual(['right'])
  })
})
