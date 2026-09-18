// @vitest-environment jsdom
// 팝오버를 열고 실제로 입력한다 — 고침은 화면의 상태라 띄워야 보인다.
/**
 * **교사가 고쳐 두는 학번과 이름** (§8.21, 2026-09-18 R28 C-19).
 *
 * 학생이 잘못 적어 내면 명렬이 그 값으로 서고, 교사는 **정렬하기 전에** 그것을 고쳐야
 * 한다. 그 고침은 화면에만 살고 원본 `.mlpx`는 안 건드린다
 * (open-decisions.md "점검은 읽기 전용 열람기다").
 *
 * **이 경로를 지나는 검사가 하나도 없었다.** 팝오버의 입력에서 명렬의 칸과 정렬까지가
 * 한 줄로 이어지는데, 그 줄의 어느 마디를 끊어도 조용했다 — 화면은 멀쩡히 그려지고
 * 고친 값만 아무 데도 안 간다.
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { mountInspect, pickFiles, submissionFile } from './fixtures/inspect-screen'

/** 다른 프로젝트에서 나온 파일들. 묶음 표시가 열을 하나 더 세우지 않게 갈라 둔다. */
const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
] as const

type Screen = Awaited<ReturnType<typeof mountInspect>>

/** 그 글자가 적힌 단추. */
function button(wrapper: Screen, label: string) {
  const found = wrapper.findAll('button').find((one) => one.text().trim() === label)
  expect(found, `button not found: ${label}`).toBeTruthy()
  return found!
}

/** 열린 팝오버 안의 칸들. **패널은 body로 텔레포트된다**(`AppPopover`). */
function fields(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.popover-panel input[type="text"]')]
}

/** 팝오버를 열고 그 칸에 적는다. **교사가 하는 동작 그대로다.** */
async function correct(wrapper: Screen, field: '학번' | '이름', value: string): Promise<void> {
  if (fields().length === 0) {
    await button(wrapper, i18n.global.t('inspect.editStudent')).trigger('click')
    await flushPromises()
  }
  const input = fields()[field === '학번' ? 0 : 1]
  expect(input, `field not found: ${field}`).toBeTruthy()
  input!.value = value
  input!.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

/** 명렬의 줄들을 글자로. 순서가 곧 정렬 결과다. */
function rows(wrapper: Screen): string[] {
  return wrapper.findAll('tbody tr').map((row) => row.text().replace(/\s+/g, ' '))
}

/** 그 열 머리를 눌러 정렬한다. */
async function sortBy(wrapper: Screen, label: string): Promise<void> {
  const head = wrapper.findAll('thead th button').find((one) => one.text().trim() === label)
  expect(head, `sortable column not found: ${label}`).toBeTruthy()
  await head!.trigger('click')
  await flushPromises()
}

describe('교사가 학번·이름을 고친다', () => {
  beforeEach(() => {
    setLocale('ko')
  })

  /** 이름이 뒤바뀌어 들어온 두 제출물. 고쳐야 정렬이 뜻을 갖는 상태다. */
  async function opened(): Promise<Screen> {
    const wrapper = await mountInspect([
      await submissionFile('01.mlpx', IDS[0], { studentId: '10101', name: '홍길동' }),
      await submissionFile('02.mlpx', IDS[1], { studentId: '10102', name: '가나다' }),
    ])
    await flushPromises()
    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    return wrapper
  }

  it('고친 이름이 그 줄의 칸에 선다', async () => {
    const wrapper = await opened()
    await correct(wrapper, '이름', '김하나')
    expect(rows(wrapper)[0]).toContain('김하나')
    expect(rows(wrapper)[0], 'the file value is replaced, not appended').not.toContain('홍길동')
    wrapper.unmount()
  })

  /**
   * **고치는 이유가 정렬이다.** 표시만 바뀌고 정렬이 파일의 값으로 서면 교사는 고쳐
   * 놓고도 명렬을 손으로 훑는다.
   */
  it('고친 값으로 정렬한다', async () => {
    const wrapper = await opened()
    await sortBy(wrapper, i18n.global.t('inspect.studentName'))
    // 파일의 값으로는 `가나다`가 먼저다.
    expect(rows(wrapper)[0]).toContain('02.mlpx')

    await correct(wrapper, '이름', '가가가')
    expect(rows(wrapper)[0], 'sorting reads the corrected value').toContain('01.mlpx')
    wrapper.unmount()
  })

  /**
   * **빈 칸도 고침이다.** 얹기만 하면 교사가 지운 이름이 파일의 이름으로 되살아난다
   * (`withEdit`).
   */
  it('칸을 비우면 안 적힌 것으로 선다', async () => {
    const wrapper = await opened()
    await correct(wrapper, '이름', '')
    expect(rows(wrapper)[0]).toContain(i18n.global.t('inspect.noStudentName'))
    wrapper.unmount()
  })

  /**
   * **명렬을 갈아 끼우면 고침도 함께 버린다.** 다른 폴더의 줄에 앞 반의 이름이 얹히면
   * 그 줄은 이 반 학생의 이름을 남의 것으로 말한다.
   */
  it('다른 폴더를 고르면 고침이 사라진다', async () => {
    const wrapper = await opened()
    await correct(wrapper, '이름', '김하나')
    expect(rows(wrapper)[0]).toContain('김하나')

    await pickFiles(wrapper, [
      await submissionFile('01.mlpx', IDS[0], { studentId: '20201', name: '이두리' }),
    ])
    await flushPromises()
    expect(rows(wrapper)[0]).toContain('이두리')
    expect(rows(wrapper)[0], 'a correction from the previous class must not stick').not.toContain(
      '김하나',
    )
    wrapper.unmount()
  })

  /**
   * **아무도 안 적은 명렬에서 교사가 적으면 그 순간 열이 선다** (`studentFieldsInUse`).
   * 파일의 값만 세면 고쳐 넣은 값이 설 자리가 없다.
   */
  it('아무도 안 적은 칸도 교사가 적으면 열이 선다', async () => {
    const wrapper = await mountInspect([
      await submissionFile('01.mlpx', IDS[0]),
      await submissionFile('02.mlpx', IDS[1]),
    ])
    await flushPromises()
    const heads = () => wrapper.findAll('thead th').map((one) => one.text().trim())
    expect(heads()).not.toContain(i18n.global.t('inspect.studentName'))

    await wrapper.findAll('tbody tr')[0]!.trigger('click')
    await flushPromises()
    await correct(wrapper, '이름', '김하나')
    expect(heads()).toContain(i18n.global.t('inspect.studentName'))
    expect(heads(), 'the other column stays down - they are counted apart').not.toContain(
      i18n.global.t('inspect.studentId'),
    )
    wrapper.unmount()
  })
})
