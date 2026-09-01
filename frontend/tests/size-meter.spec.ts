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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { applyLimitsOff, maxPortfolioBytes } from '../src/limits-switch'
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

/**
 * **상한을 껐을 때** (2026-09-01, `limits-switch.ts`).
 *
 * `Infinity`를 그대로 넘기면 막대는 `(used/Infinity)*100 = 0`이라 멀쩡해 보이고 **글자만
 * `0.3MB / InfinityMB`가 된다** — 감사가 이 가지를 아무도 안 지나간다고 짚은 자리다.
 */
describe('상한이 없으면 상한을 말하지 않는다', () => {
  const open = () => render(0.3 * MB, Number.POSITIVE_INFINITY)

  it('`Infinity`라는 글자가 화면에 안 뜬다', () => {
    const text = open().text()
    expect(text).not.toContain('Infinity')
    expect(text).not.toContain('NaN')
  })

  it('담긴 양은 그대로 말한다 - 상한이 없어도 볼 거리다', () => {
    expect(open().text()).toContain('0.3')
  })

  /** 끝을 모르는 막대에 `aria-valuemax`를 적으면 읽는 기계가 비율을 지어낸다. */
  it('끝이 없으면 `aria-valuemax`를 안 적는다', () => {
    const box = open().find('[role="progressbar"]')
    expect(box.attributes('aria-valuemax')).toBeUndefined()
  })

  it('막대는 비어 있고 넘긴 색이 아니다', () => {
    const bar = barOf(open())
    expect(bar.attributes('style')).toContain('width: 0%')
    expect(bar.classes()).not.toContain('bg-danger')
  })
})

/**
 * **부품과 화면을 잇는 줄** (2026-09-01 감사 B-3).
 *
 * 위 검사들은 프롭을 **손으로** 넣는다. 그래서 화면이 `:used`와 `:limit`을 **뒤바꿔
 * 넘겨도** 226개가 초록이었다 — 상한을 끈 상태에서 그 뒤바뀜은 화면에
 * `포트폴리오 InfinityMB / 0.3MB`를 띄운다.
 *
 * `limits-switch.ts`가 *"`Infinity`가 그대로 안 통하는 자리 셋"*이라 적었고, 페이지 크기
 * 둘은 `limits-rules.spec.ts`가 소스로 문다. **눈금 하나만 그 이음매가 비어 있었다.**
 */
describe('화면이 넘기는 것이 상한이다', () => {
  it('`PortfolioView`가 눈금의 상한으로 스위치를 거친 값을 넘긴다', () => {
    const view = readFileSync(join(process.cwd(), 'src', 'views', 'PortfolioView.vue'), 'utf-8')
    expect(view).toMatch(/<SizeMeter[^>]*:limit="maxPortfolioBytes\(\)"/s)
    expect(view).toMatch(/<SizeMeter[^>]*:used="usedBytes"/s)
  })

  /** **진짜 입구로 한 번 지나간다** — 손으로 만든 `Infinity`가 아니라 스위치가 낸 값이다. */
  it('스위치를 켜면 눈금이 상한을 말하지 않는다', () => {
    applyLimitsOff(true)
    try {
      const view = render(0.3 * MB, maxPortfolioBytes())
      expect(view.text()).not.toContain('Infinity')
      expect(view.text()).toContain('0.3')
    } finally {
      applyLimitsOff(false)
    }
  })
})
