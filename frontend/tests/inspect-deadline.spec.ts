// @vitest-environment jsdom
// 팝오버를 열고 실제로 입력한다 — 마감은 화면의 상태라 띄워야 보인다.
/**
 * **점검 화면의 마감** (open-decisions.md 121, architecture.md §8.21).
 *
 * 팝오버의 입력에서 명렬의 열·칸 색·요약 카드의 강조까지가 한 줄로 이어진다. 판정 자체는
 * `deadline.spec.ts`가 물고, 여기는 **그 판정이 화면의 어디에 서고 언제 사라지는가**를 문다.
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { brokenFile, mountInspect, pickFiles, submissionFile } from './fixtures/inspect-screen'

type Screen = Awaited<ReturnType<typeof mountInspect>>

/** 다른 프로젝트에서 나온 파일들. 묶음 열이 끼지 않게 갈라 둔다. */
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const

/** 마감은 교사 브라우저의 시간대로 읽는다 — 기대값도 같은 생성자로 짓는다. */
const DEADLINE_INPUT = '2026-11-20T23:59'
const DEADLINE = new Date(2026, 10, 20, 23, 59).getTime()
const ON_TIME = new Date(DEADLINE + 59_000).toISOString()
const LATE = new Date(DEADLINE + 60_000).toISOString()

const tr = (key: string) => i18n.global.t(key)

function button(wrapper: Screen, label: string) {
  const found = wrapper.findAll('button').find((one) => one.text().trim() === label)
  expect(found, `button not found: ${label}`).toBeTruthy()
  return found!
}

/** 열린 팝오버의 시각 칸. **패널은 body로 텔레포트된다**(`AppPopover`). */
function field(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>('.popover-panel input[type="datetime-local"]')
}

/** 칸에 적는다. `leave`면 칸을 떠난다(`blur`). 고치는 도중의 `change`로는 해제하지 않는다. */
async function typeDeadline(wrapper: Screen, value: string, leave = false): Promise<void> {
  if (field() === null) {
    await button(wrapper, tr('inspect.deadline.set')).trigger('click')
    await flushPromises()
  }
  const input = field()
  expect(input, 'deadline field not found').toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  input!.dispatchEvent(new Event('change', { bubbles: true }))
  if (leave) input!.dispatchEvent(new FocusEvent('blur'))
  await flushPromises()
}

function headers(wrapper: Screen): string[] {
  return wrapper.findAll('thead th').map((cell) => cell.text().trim())
}

/** 이름표 → 마감 칸. */
function deadlineCells(wrapper: Screen): Map<string, { text: string; danger: boolean }> {
  const column = headers(wrapper).indexOf(tr('inspect.deadline.column'))
  expect(column, 'the roster has a deadline column').toBeGreaterThanOrEqual(0)
  return new Map(
    wrapper.findAll('tbody tr').map((row) => {
      const cells = row.findAll('td')
      const cell = cells[column]!
      return [
        cells[0]!.text().trim(),
        { text: cell.text().trim(), danger: cell.find('.text-danger').exists() },
      ]
    }),
  )
}

async function opened(): Promise<Screen> {
  const wrapper = await mountInspect([
    await submissionFile('late.mlpx', IDS[0], undefined, LATE),
    await submissionFile('ontime.mlpx', IDS[1], undefined, ON_TIME),
  ])
  await flushPromises()
  return wrapper
}

describe('교사가 마감을 정한다', () => {
  beforeEach(async () => {
    await setLocale('ko')
    document.body.innerHTML = ''
  })

  it('마감을 안 정하면 열이 없다', async () => {
    const wrapper = await opened()
    expect(headers(wrapper)).not.toContain(tr('inspect.deadline.column'))
  })

  it('정하면 열이 서고, 지난 줄만 경고색이다 - 그 분까지는 이내다', async () => {
    const wrapper = await opened()
    await typeDeadline(wrapper, DEADLINE_INPUT)

    const cells = deadlineCells(wrapper)
    expect(cells.get('late.mlpx')).toEqual({ text: tr('inspect.deadline.late'), danger: true })
    expect(cells.get('ontime.mlpx')).toEqual({ text: tr('inspect.deadline.onTime'), danger: false })
    // 열은 `상태` 바로 앞이다.
    const all = headers(wrapper)
    expect(all.indexOf(tr('inspect.deadline.column'))).toBe(all.indexOf(tr('inspect.state')) - 1)
  })

  it('지난 파일을 열면 요약 카드의 수정한 날짜가 굵은 경고색이다', async () => {
    const wrapper = await opened()
    await typeDeadline(wrapper, DEADLINE_INPUT)

    const updated = () => {
      const term = wrapper.findAll('dt').find((one) => one.text().trim() === tr('meta.updated'))
      expect(term, 'summary card has a modified row').toBeTruthy()
      return term!.element.nextElementSibling!.className
    }
    for (const [label, late] of [
      ['late.mlpx', true],
      ['ontime.mlpx', false],
    ] as const) {
      const row = wrapper.findAll('tbody tr').find((one) => one.text().includes(label))!
      await row.trigger('click')
      for (let turn = 0; turn < 5; turn += 1) await flushPromises()
      expect(updated().includes('text-danger'), label).toBe(late)
      expect(updated().includes('font-bold'), label).toBe(late)
    }
  })

  /**
   * **두 방향을 따로 본다.** 오름차순(이내가 위)에서 풀면 기준이 돌아왔는지가, 내림차순(지난 것이
   * 위)에서 풀면 방향이 돌아왔는지가 보인다 — 이름표 오름차순이 `late`, `ontime`이다.
   */
  for (const clicks of [1, 2] as const) {
    it(`해제하면 열이 사라지고 정렬이 이름표 오름차순으로 돌아간다 (머리 ${clicks}번)`, async () => {
      const wrapper = await opened()
      await typeDeadline(wrapper, DEADLINE_INPUT)
      const head = wrapper
        .findAll('thead th button')
        .find((one) => one.text().trim() === tr('inspect.deadline.column'))!
      for (let click = 0; click < clicks; click += 1) await head.trigger('click')
      await flushPromises()
      const first = () => wrapper.findAll('tbody tr')[0]!.findAll('td')[0]!.text().trim()
      expect(first()).toBe(clicks === 1 ? 'ontime.mlpx' : 'late.mlpx')

      const clear = [...document.querySelectorAll<HTMLButtonElement>('.popover-panel button')].find(
        (one) => one.textContent?.trim() === tr('inspect.deadline.clear'),
      )
      expect(clear, 'clear button in the popover').toBeTruthy()
      clear!.click()
      await flushPromises()

      expect(headers(wrapper)).not.toContain(tr('inspect.deadline.column'))
      expect(wrapper.findAll('tbody tr').map((row) => row.findAll('td')[0]!.text().trim())).toEqual(
        ['late.mlpx', 'ontime.mlpx'],
      )
    })
  }

  it('고치는 도중에 칸이 비어도 마감은 그대로다 - 분 하나 지운 것으로 열이 사라지지 않는다', async () => {
    const wrapper = await opened()
    await typeDeadline(wrapper, DEADLINE_INPUT)
    await typeDeadline(wrapper, '')
    expect(headers(wrapper)).toContain(tr('inspect.deadline.column'))
  })

  it('비운 채로 떠나면 해제다', async () => {
    const wrapper = await opened()
    await typeDeadline(wrapper, DEADLINE_INPUT)
    await typeDeadline(wrapper, '', true)
    expect(headers(wrapper)).not.toContain(tr('inspect.deadline.column'))
  })

  /** 1024px에서 여덟 열이 안 들어가 `상태`가 비킨다 (open-decisions.md 121). 폭은 jsdom이 못 재고 클래스를 본다. */
  it('마감을 켜면 상태는 넓은 화면에서만 선다', async () => {
    const wrapper = await opened()
    const stateHead = () =>
      wrapper.findAll('thead th').find((one) => one.text().trim() === tr('inspect.state'))!.element
    expect(stateHead().classList.contains('hidden')).toBe(false)
    await typeDeadline(wrapper, DEADLINE_INPUT)
    expect([...stateHead().classList]).toEqual(expect.arrayContaining(['hidden', 'xl:table-cell']))
    const column = headers(wrapper).indexOf(tr('inspect.state'))
    for (const row of wrapper.findAll('tbody tr')) {
      expect(row.findAll('td')[column]!.classes()).toEqual(
        expect.arrayContaining(['hidden', 'xl:table-cell']),
      )
    }
  })

  it('못 여는 파일은 마감 칸이 그 사유를 회색으로 말한다 - 상태가 접혀도 표에서 안 사라진다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('late.mlpx', IDS[0], undefined, LATE),
      brokenFile('broken.mlpx'),
    ])
    for (let turn = 0; turn < 5; turn += 1) await flushPromises()
    await typeDeadline(wrapper, DEADLINE_INPUT)
    const column = headers(wrapper).indexOf(tr('inspect.deadline.column'))
    const row = wrapper.findAll('tbody tr').find((one) => one.text().includes('broken.mlpx'))!
    const cell = row.findAll('td')[column]!
    expect(cell.text().trim()).toBe(tr('inspect.unreadable'))
    expect(cell.find('.text-ink-faint').exists()).toBe(true)
  })

  /** 수정절 10 — `table-align.spec.ts`의 마운트 검사는 마감을 안 정한 화면만 띄운다. */
  it('마감 열의 머리와 칸은 같은 쪽으로 정렬된다', async () => {
    const wrapper = await opened()
    await typeDeadline(wrapper, DEADLINE_INPUT)
    const column = headers(wrapper).indexOf(tr('inspect.deadline.column'))
    const right = (element: Element) => element.classList.contains('text-right')
    const head = wrapper.findAll('thead th')[column]!.element
    for (const row of wrapper.findAll('tbody tr')) {
      expect(right(row.findAll('td')[column]!.element)).toBe(right(head))
    }
  })

  it('명렬을 갈아 끼워도 마감은 남는다', async () => {
    const wrapper = await opened()
    await typeDeadline(wrapper, DEADLINE_INPUT)
    await pickFiles(wrapper, [await submissionFile('other.mlpx', IDS[2], undefined, LATE)])
    for (let turn = 0; turn < 5; turn += 1) await flushPromises()
    expect(deadlineCells(wrapper).get('other.mlpx')).toEqual({
      text: tr('inspect.deadline.late'),
      danger: true,
    })
  })
})
