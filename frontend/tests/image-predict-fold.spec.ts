/**
 * 사진 예측의 모델 카드 접힘 (architecture.md §8.13.4).
 *
 * 스위치 하나와 사진별 예외다. **예외가 남아 있으면 스위치를 바꿔도 그 사진은 안
 * 따라온다** — 스위치와 같아진 예외는 지워져야 한다.
 */
import { describe, expect, it } from 'vitest'

import { cardTone, rankTally, tallyTone } from '../src/views/predict/answer-tones'
import {
  overrideCards,
  photoCardsOpen,
  switchCards,
  togglePhotoCards,
} from '../src/views/predict/fold'

describe('photoCardsOpen', () => {
  it('예외가 없으면 스위치를 따른다', () => {
    expect(photoCardsOpen(true, new Map(), 'a')).toBe(true)
    expect(photoCardsOpen(false, new Map(), 'a')).toBe(false)
  })

  it('예외가 스위치를 이긴다 - 꺼 둔 채 한 장만 펼친다', () => {
    const overrides = overrideCards(false, new Map(), 'a', true)
    expect(photoCardsOpen(false, overrides, 'a')).toBe(true)
    expect(photoCardsOpen(false, overrides, 'b')).toBe(false)
  })

  it('켜 둔 채 한 장만 접는다', () => {
    const overrides = overrideCards(true, new Map(), 'a', false)
    expect(photoCardsOpen(true, overrides, 'a')).toBe(false)
    expect(photoCardsOpen(true, overrides, 'b')).toBe(true)
  })
})

describe('overrideCards', () => {
  it('스위치와 같아지면 예외를 지운다', () => {
    const opened = overrideCards(false, new Map(), 'a', true)
    expect(overrideCards(false, opened, 'a', false).size).toBe(0)
  })

  it('스위치와 같은 값으로는 예외가 생기지 않는다', () => {
    expect(overrideCards(true, new Map(), 'a', true).size).toBe(0)
    expect(overrideCards(false, new Map(), 'a', false).size).toBe(0)
  })

  it('받은 지도를 고치지 않는다', () => {
    const before = new Map([['a', true]])
    overrideCards(false, before, 'b', true)
    expect([...before]).toEqual([['a', true]])
  })
})

/** 화면이 들고 있는 것을 바꾸는 함수들 (코드 감사 C-4 — 화면 안에 있던 규칙이다). */
describe('switchCards · togglePhotoCards', () => {
  it('스위치를 바꾸면 예외가 비워진다', () => {
    const fold = togglePhotoCards({ all: true, overrides: new Map() }, 'a')
    expect(fold.overrides.size).toBe(1)
    const switched = switchCards(false)
    expect(switched).toEqual({ all: false, overrides: new Map() })
    expect(photoCardsOpen(switched.all, switched.overrides, 'a')).toBe(false)
  })

  it('사진 한 장을 두 번 뒤집으면 예외가 없다', () => {
    const start = { all: false, overrides: new Map<string, boolean>() }
    const once = togglePhotoCards(start, 'a')
    expect(photoCardsOpen(once.all, once.overrides, 'a')).toBe(true)
    expect(togglePhotoCards(once, 'a').overrides.size).toBe(0)
  })
})

describe('rankTally', () => {
  it('화면 전체의 등수 차례로 늘어놓는다 - 카드 색의 1등이 맨 앞이다', () => {
    const tally = [
      { value: 'cat', count: 1 },
      { value: 'dog', count: 2 },
    ]
    const ranks = new Map([
      ['dog', 0],
      ['cat', 1],
    ])
    expect(rankTally(tally, ranks).map((entry) => entry.value)).toEqual(['dog', 'cat'])
  })

  it('등수가 없으면 받은 차례 그대로다', () => {
    const tally = [{ value: 'cat', count: 1 }]
    expect(rankTally(tally, null)).toEqual(tally)
  })
})

/**
 * **칩과 카드가 같은 값이면 같은 색이다** (`answer-tones.ts`, 코드 재감사 C-A). 색이 늘 무채색으로
 * 떨어져도 차례 검사만으로는 초록이었다.
 */
describe('cardTone · tallyTone', () => {
  const ranks = new Map([
    ['a', 0],
    ['b', 1],
  ])

  it('같은 등수면 칩과 카드가 같은 색이고, 등수마다 색이 다르다', () => {
    expect(tallyTone('a', ranks)).toBe(cardTone(0))
    expect(cardTone(0)).toMatch(/^border-chart-\d bg-chart-\d-soft$/)
    expect(cardTone(0)).not.toBe(cardTone(1))
  })

  it('등수가 없으면 무채색이다', () => {
    expect(cardTone(null)).toBe('border-line bg-surface-sunken')
    expect(tallyTone('z', ranks)).toBe('border-line-strong bg-surface')
  })
})
