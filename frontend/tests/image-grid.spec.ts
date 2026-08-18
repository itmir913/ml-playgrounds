// @vitest-environment jsdom
// 이름표와 동작을 나란히 놓는다 - 이 축은 눈으로도 잘 안 보인다.
/**
 * 사진 격자의 [전체 선택] (`views/data/ImageGrid.vue`).
 *
 * **핸들러는 토글인데 이름표가 상수였다** (V11 R5 A-2). 사진 서른 장을 고른 학생이
 * "다 골랐나?" 하고 한 번 더 누르면 선택이 통째로 풀리고, 그 뒤에 [옮길 곳]을 누르면
 * 아무 일도 안 일어난다. **문구가 약속한 것과 정확히 반대의 동작**이고 그 자리가
 * 이 도구의 가장 반복적인 작업(범주 나누기) 한가운데다.
 *
 * `PredictFilters.vue`가 바로 옆에서 올바른 모양을 하고 있었다 —
 * `allOn(axis) ? t('common.clearAll') : t('common.selectAll')`.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ImageEntry } from '../src/project/images'
import ImageGrid from '../src/views/data/ImageGrid.vue'
import { i18n, setLocale } from '../src/i18n'

const ENTRIES = [
  { hash: 'a', path: 'dataset/data/개/a.jpg', category: '개' },
  { hash: 'b', path: 'dataset/data/개/b.jpg', category: '개' },
] as unknown as ImageEntry[]

function render(entries: readonly ImageEntry[], selected: readonly string[]) {
  return mount(ImageGrid, {
    props: {
      label: '개',
      entries,
      urls: new Map(entries.map((entry) => [entry.hash, `blob:${entry.hash}`])),
      selected: new Set(selected),
    },
    global: { plugins: [i18n] },
  })
}

/** 그 버튼의 지금 이름. */
function pickAllLabel(view: ReturnType<typeof render>): string {
  const button = view
    .findAll('button')
    .find((one) => one.text() === '전체 선택' || one.text() === '전체 해제')
  return button?.text() ?? ''
}

beforeEach(async () => {
  await setLocale('ko')
})

describe('[전체 선택]은 이름과 동작이 같은 판정을 본다', () => {
  it('하나도 안 골랐으면 전체 선택이다', () => {
    expect(pickAllLabel(render(ENTRIES, []))).toBe('전체 선택')
  })

  it('일부만 골랐어도 전체 선택이다', () => {
    expect(pickAllLabel(render(ENTRIES, ['a']))).toBe('전체 선택')
  })

  it('전부 골랐으면 전체 해제다 - 한 번 더 누르면 풀리기 때문이다', () => {
    expect(pickAllLabel(render(ENTRIES, ['a', 'b']))).toBe('전체 해제')
  })

  /**
   * 빈 칸에서는 버튼 자체가 안 그려진다(`v-if`). **그래도 판정을 확인한다** — `every`는
   * 빈 배열에 참이라, `v-if`가 사라지는 날 "전체 해제"가 뜨는 칸이 생긴다.
   */
  it('빈 칸에는 버튼이 없다 - 그래도 판정이 전체 해제로 기울면 안 된다', () => {
    expect(pickAllLabel(render([], []))).toBe('')
    // 사진이 하나라도 생기면 곧장 "전체 선택"이다.
    expect(pickAllLabel(render(ENTRIES.slice(0, 1), []))).toBe('전체 선택')
  })
})
