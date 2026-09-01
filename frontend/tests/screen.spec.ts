// @vitest-environment jsdom
/**
 * `screen.ts`의 순수 판정들 — 팝오버가 어느 쪽으로 열리나(`prefersTop`)와 붙박이 바가
 * 얼마나 덮나(`stickyCover`).
 *
 * **화면에서는 "왜 이번엔 아래로 열리지"로만 보이는 판정이라** 순수 함수로 빼서 여기서
 * 못 박는다. 컴포넌트 안에 두면 이 표를 확인하려고 브라우저를 띄워야 하고, 그러면
 * 아무도 확인하지 않는다.
 */

import { describe, expect, it } from 'vitest'

import { nearestScrollport, prefersTop, stickyCover, yieldToScreen } from '../src/screen'

/** 패널 높이는 고정해 두고 위아래 여백만 바꾼다. */
const HEIGHT = 400

function topWanted(above: number, below: number): boolean {
  return prefersTop({ above, below, height: HEIGHT, wantsTop: true })
}

function bottomWanted(above: number, below: number): boolean {
  return prefersTop({ above, below, height: HEIGHT, wantsTop: false })
}

describe('요청한 쪽이 원칙이다', () => {
  it('요청한 쪽에 들어가면 그대로 연다', () => {
    expect(topWanted(500, 500)).toBe(true)
    // 반대쪽이 훨씬 넓어도 옮기지 않는다. 들어가는데 옮길 이유가 없다.
    expect(topWanted(400, 5000)).toBe(true)
    expect(bottomWanted(5000, 400)).toBe(false)
  })

  it('요청한 쪽에 안 들어가고 반대쪽에 들어가면 뒤집는다', () => {
    expect(topWanted(100, 500)).toBe(false)
    expect(bottomWanted(500, 100)).toBe(true)
  })
})

/**
 * **여기가 2026-08-14에 바뀐 자리다.** 예전에는 더 넓은 쪽(`above > below`)을 골랐다.
 */
describe('둘 다 모자라면 요청한 쪽으로 돌아온다', () => {
  it('반대쪽이 조금 더 넓어도 안 뒤집는다', () => {
    // **1픽셀에 방향이 뒤집히던 자리다.** 답 카드가 세로로 늘어선 화면에서 흔하다.
    expect(topWanted(330, 331)).toBe(true)
    expect(topWanted(331, 330)).toBe(true)
    expect(bottomWanted(331, 330)).toBe(false)
  })

  /**
   * **반대쪽이 훨씬 넓어도 마찬가지다.** 낮은 상자는 굴리면 복구되고 천장이 잘림을
   * 막지만(`popover-panel`의 `--popover-room`), 방향이 뒤집히는 것은 복구할 방법이 없다.
   * 여기에 "뚜렷하게 넓으면"을 넣으려면 근거 없는 상수가 필요하다.
   */
  it('반대쪽이 훨씬 넓어도 안 뒤집는다', () => {
    expect(topWanted(60, 399)).toBe(true)
  })

  it('자리가 아예 없어도 요청한 쪽이다', () => {
    expect(topWanted(0, 0)).toBe(true)
    expect(bottomWanted(0, 0)).toBe(false)
  })
})

/**
 * 붙박이 바가 덮는 만큼 (`stickyCover`).
 *
 * **요소가 이미 갖고 있는 값을 읽을 뿐이라는 것**이 이 함수의 전부다. 여기서 따로 재기
 * 시작하면 스크롤이 멈추는 선과 "여기부터가 지금 것"인 선이 갈린다.
 */
describe('덮는 만큼은 요소에서 읽는다', () => {
  it('scroll-margin-top을 픽셀로 준다', () => {
    const element = document.createElement('div')
    element.style.setProperty('scroll-margin-top', '84px')
    document.body.append(element)

    expect(stickyCover(element)).toBe(84)
  })

  it('아무것도 안 걸려 있으면 0이다 - 덮는 것이 없다', () => {
    const element = document.createElement('div')
    document.body.append(element)

    expect(stickyCover(element)).toBe(0)
  })

  it('굴리는 상자를 찾는다 - 여백은 뷰포트 기준이고 여백값은 그 상자 기준이다', () => {
    // AppShell의 모양이다: 바깥은 잘라내기만 하고(hidden), 굴리는 것은 <main>이다.
    const outer = document.createElement('div')
    outer.style.setProperty('overflow', 'hidden')
    const scroller = document.createElement('div')
    scroller.style.setProperty('overflow-y', 'auto')
    const section = document.createElement('div')
    outer.append(scroller)
    scroller.append(section)
    document.body.append(outer)

    // 잘라내기만 하는 상자는 지나친다 - 그건 굴리지 않는다.
    expect(nearestScrollport(section)).toBe(scroller)
  })

  it('굴리는 조상이 없으면 문서가 굴린다', () => {
    const section = document.createElement('div')
    document.body.append(section)

    expect(nearestScrollport(section)).toBe(null)
  })

  it('읽을 수 없는 값이 와도 판정이 죽지 않는다', () => {
    // 이 속성을 모르는 브라우저가 빈 문자열을 준다. NaN이 rootMargin에 들어가면 던진다.
    const element = document.createElement('div')
    document.body.append(element)
    const original = globalThis.getComputedStyle
    globalThis.getComputedStyle = (() => ({
      scrollMarginTop: '',
      overflowY: 'visible',
    })) as unknown as typeof getComputedStyle
    try {
      expect(stickyCover(element)).toBe(0)
    } finally {
      globalThis.getComputedStyle = original
    }
  })
})

/**
 * **양보가 실제로 작업 경계를 넘는가** (`yieldToScreen`).
 *
 * 이 파일의 머리말이 *"이것이 없으면 [예측] 같은 단추의 이중 실행 방지가 통째로
 * 무력해진다 … 연타하면 브라우저가 먹통이 된다(2026-08-14, 사용자가 이미지 예측
 * 화면에서 겪었다)"*고 적어 둔 자리다.
 *
 * 그런데 무는 것이 없어서 `Promise.resolve()`로 바꿔도 조용했다 (R14-5 감사 A-6).
 * `ui-rules.spec.ts`는 **부르는 자리의 수**만 세고, **부른 것이 무엇을 하는지**는
 * 아무도 안 봤다. 마이크로태스크만 비우면 렌더가 안 끼어들어 꺼짐이 한 번도
 * 안 그려지고, 그 사이 쌓인 클릭이 전부 한 번씩 더 돈다.
 */
describe('화면에 자리를 내준다', () => {
  it('마이크로태스크만으로는 안 끝난다 - 그래야 꺼짐이 그려진다', async () => {
    let done = false
    const settled = yieldToScreen().then(() => {
      done = true
    })

    for (let round = 0; round < 10; round += 1) await Promise.resolve()
    expect(done, 'already finished after draining microtasks ten times').toBe(false)

    await settled
    expect(done).toBe(true)
  })
})
