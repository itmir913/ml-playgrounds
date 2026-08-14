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

import { prefersTop, stickyCover } from '../src/screen'

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

  it('읽을 수 없는 값이 와도 판정이 죽지 않는다', () => {
    // 이 속성을 모르는 브라우저가 빈 문자열을 준다. NaN이 rootMargin에 들어가면 던진다.
    const element = {} as unknown as Element
    const original = globalThis.getComputedStyle
    globalThis.getComputedStyle = (() => ({
      scrollMarginTop: '',
    })) as unknown as typeof getComputedStyle
    try {
      expect(stickyCover(element)).toBe(0)
    } finally {
      globalThis.getComputedStyle = original
    }
  })
})
