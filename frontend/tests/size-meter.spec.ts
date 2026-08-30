// @vitest-environment jsdom
// 막대의 폭과 색은 그려 봐야 보인다 - 숫자만 보면 클램프가 빠진 것을 못 본다.
/**
 * 포트폴리오 크기 막대 (`views/portfolio/SizeMeter.vue`).
 *
 * **68줄짜리 이 부품에 단언이 하나도 없었다** (2026-08-31 사각 감사 C-1). 화면을
 * 마운트하는 `portfolio-view.spec.ts`는 진행 막대를 `aria-valuemax === '1'`로
 * 골라내며 이 부품을 일부러 비켜 간다.
 *
 * 여기서 보는 것 셋이다.
 *
 * - **넘겼을 때는 올려서 보인다.** 안 올리면 상한을 넘긴 파일이 화면에서 정확히
 *   상한으로 보이고, 학생은 왜 저장이 거절됐는지 못 읽는다 (V11 R5 C-5에서 고친 자리다).
 * - **빨강은 넘긴 순간부터다.** 정확히 상한인 것은 아직 넘긴 것이 아니다.
 * - **막대는 상자를 안 넘는다.** 클램프가 빠지면 막대가 칸 밖으로 뻗는다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import SizeMeter from '../src/views/portfolio/SizeMeter.vue'
import { i18n, setLocale } from '../src/i18n'

const MB = 1_000_000

function render(used: number, limit = 10 * MB) {
  return mount(SizeMeter, { props: { used, limit }, global: { plugins: [i18n] } })
}

/** 막대 자체. 바깥 상자가 아니라 채워진 쪽이다. */
const barOf = (view: ReturnType<typeof render>) =>
  view.findAll('div').find((one) => one.attributes('style')?.includes('width'))!

beforeEach(async () => {
  await setLocale('ko')
})

describe('넘긴 것은 넘긴 것으로 보인다', () => {
  it('넘겼으면 올려서 적는다 - 상한과 같은 수로 보이면 안 된다', () => {
    // 10MB 상한에 10.04MB. 내림하면 화면이 `10.0MB / 10.0MB`가 되어 넘긴 것이 안 보인다.
    expect(render(10.04 * MB).text()).toContain('10.1MB / 10.0MB')
  })

  it('안 넘겼으면 안 올린다 - 같은 값이라도 그렇다', () => {
    // 같은 10.04MB인데 상한이 크면 넘긴 것이 아니다. 올림은 넘겼을 때만이다.
    expect(render(10.04 * MB, 20 * MB).text()).toContain('10.0MB / 20.0MB')
  })

  it('넘기면 빨강이다', () => {
    expect(render(10.5 * MB).html()).toContain('text-danger')
  })

  it('정확히 상한이면 아직 빨강이 아니다', () => {
    expect(render(10 * MB).html()).not.toContain('text-danger')
  })
})

describe('막대는 상자를 안 넘는다', () => {
  it('절반이면 절반이다', () => {
    expect(barOf(render(5 * MB)).attributes('style')).toContain('50%')
  })

  it('넘겨도 100%에서 멈춘다', () => {
    expect(barOf(render(30 * MB)).attributes('style')).toContain('100%')
  })
})
