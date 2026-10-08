/**
 * 사진 예측의 모델 카드 접힘 (architecture.md §8.13.4).
 *
 * 스위치 하나와 사진별 예외다. **예외가 남아 있으면 스위치를 바꿔도 그 사진은 안
 * 따라온다** — 스위치와 같아진 예외는 지워져야 한다.
 */
import { describe, expect, it } from 'vitest'

import { rankTally } from '../src/views/predict/answer-tones'
import { overrideCards, photoCardsOpen } from '../src/views/predict/fold'

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
