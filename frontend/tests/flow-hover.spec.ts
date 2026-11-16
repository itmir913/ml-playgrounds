/**
 * **흐름도의 가리킴 판단** (`ml/flow-hover.ts`, `architecture.md` §8.22) — 강조의 깜빡임을 막는 순서.
 *
 * 소유자가 짚은 것은 **노드 사이의 틈을 지날 때 전체가 잠깐 켜졌다 다시 흐려지는 깜빡임**이다. 이 판단이
 * 순수 함수라 시계를 흉내 내지 않고 이벤트의 순서로 잰다 — 아래 `Clock`이 타이머 지시를 받아 시간이 다 된
 * 것처럼 `release`를 넣어 준다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FLOW_HOVER_RELEASE_MS } from '../src/limits'
import {
  HOVER_IDLE,
  hoverStep,
  type HoverEvent,
  type HoverState,
  type HoverStep,
} from '../src/ml/flow-hover'

/** 타이머 지시를 받아 두었다가 필요할 때 시간이 다 됐다고 알려 주는 대역. */
class Clock {
  state: HoverState = HOVER_IDLE
  /** 걸려 있는 타이머의 ms. 없으면 `null`. */
  scheduled: number | null = null
  /** 지금까지의 지시 기록. */
  log: HoverStep['timer'][] = []
  /** 지금까지 켜져 있던 대상의 기록 — 깜빡임은 여기 `null`이 끼는 것이다. */
  shown: (string | null)[] = []

  send(event: HoverEvent): HoverStep {
    const step = hoverStep(this.state, event)
    this.state = step.state
    this.log.push(step.timer)
    if (step.timer === 'cancel') this.scheduled = null
    else if (step.timer !== null) this.scheduled = step.timer.start
    this.shown.push(this.state.shown)
    return step
  }

  /** 시간이 다 됐다. 걸린 타이머가 없었으면 낡은 알림이 늦게 도착한 것이다 — 그래도 보낸다. */
  fire(): HoverStep {
    this.scheduled = null
    return this.send({ kind: 'release' })
  }
}

describe('가리킴', () => {
  it('노드에 들어서면 곧장 켜진다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    expect(clock.state.shown).toBe('file')
    expect(clock.scheduled).toBeNull()
  })

  it('노드를 떠나도 바로 풀리지 않고 풀림이 예약된다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    const step = clock.send({ kind: 'leave' })
    expect(clock.state.shown).toBe('file')
    expect(clock.state.releasing).toBe(true)
    expect(step.timer).toEqual({ start: FLOW_HOVER_RELEASE_MS })
  })

  it('시간이 다 되면 풀린다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.send({ kind: 'leave' })
    clock.fire()
    expect(clock.state).toEqual(HOVER_IDLE)
  })

  it('시간 안에 다음 노드에 들어서면 풀림이 취소되고 그 노드가 켜진다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.send({ kind: 'leave' })
    const step = clock.send({ kind: 'enter', target: 'learn' })
    expect(step.timer).toBe('cancel')
    expect(clock.scheduled).toBeNull()
    expect(clock.state).toEqual({ shown: 'learn', pinned: null, releasing: false })
  })

  it('취소한 뒤 낡은 시간이 늦게 도착해도 새 노드의 강조가 풀리지 않는다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.send({ kind: 'leave' })
    clock.send({ kind: 'enter', target: 'learn' })
    const stale = clock.fire()
    expect(stale.timer).toBeNull()
    expect(clock.state.shown).toBe('learn')
  })

  it('같은 노드로 되돌아와도 풀림이 취소된다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.send({ kind: 'leave' })
    expect(clock.send({ kind: 'enter', target: 'file' }).timer).toBe('cancel')
    expect(clock.state).toEqual({ shown: 'file', pinned: null, releasing: false })
  })

  it('떠남이 겹쳐도 타이머는 한 번만 건다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    expect(clock.send({ kind: 'leave' }).timer).toEqual({ start: FLOW_HOVER_RELEASE_MS })
    expect(clock.send({ kind: 'leave' }).timer).toBeNull()
  })

  it('켜진 것이 없을 때 떠나도 아무 일이 없다', () => {
    const clock = new Clock()
    expect(clock.send({ kind: 'leave' })).toEqual({ state: HOVER_IDLE, timer: null })
  })

  it('예약 없이 시간이 다 됐다는 알림이 와도 아무 일이 없다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.fire()
    expect(clock.state.shown).toBe('file')
  })
})

describe('깜빡임', () => {
  it('노드를 건너뛰며 지나도 켜진 대상이 한 번도 비지 않는다', () => {
    const clock = new Clock()
    // 포인터가 틈을 지나는 동안 떠남과 들어섬이 번갈아 온다.
    for (const target of ['file', 'train', 'p1', 'learn', 'exp']) {
      clock.send({ kind: 'enter', target })
      clock.send({ kind: 'leave' })
    }
    expect(clock.shown.every((entry) => entry !== null)).toBe(true)
    // 마지막 노드를 떠난 뒤 시간이 다 되어서야 푼다.
    clock.fire()
    expect(clock.shown.at(-1)).toBeNull()
    expect(clock.shown.slice(0, -1).every((entry) => entry !== null)).toBe(true)
  })

  it('틈을 지나는 동안 시간이 다 돼도 다음 들어섬이 먼저면 비지 않는다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.send({ kind: 'leave' })
    clock.send({ kind: 'enter', target: 'train' })
    clock.fire()
    clock.send({ kind: 'leave' })
    clock.send({ kind: 'enter', target: 'p1' })
    clock.fire()
    expect(clock.shown.every((entry) => entry !== null)).toBe(true)
  })
})

describe('고정', () => {
  it('누르면 그 대상이 고정되고 가리킴이 바꾸지 못한다', () => {
    const clock = new Clock()
    clock.send({ kind: 'pin', target: 'exp' })
    expect(clock.state).toEqual({ shown: 'exp', pinned: 'exp', releasing: false })
    expect(clock.send({ kind: 'enter', target: 'file' })).toEqual({
      state: clock.state,
      timer: null,
    })
    expect(clock.send({ kind: 'leave' }).timer).toBeNull()
    clock.fire()
    expect(clock.state.shown).toBe('exp')
  })

  it('예약된 풀림이 있을 때 누르면 그 예약을 거둔다', () => {
    const clock = new Clock()
    clock.send({ kind: 'enter', target: 'file' })
    clock.send({ kind: 'leave' })
    expect(clock.send({ kind: 'pin', target: 'file' }).timer).toBe('cancel')
    clock.fire()
    expect(clock.state.shown).toBe('file')
  })

  it('고정을 풀면 아무것도 안 켜진 처음으로 돌아간다', () => {
    const clock = new Clock()
    clock.send({ kind: 'pin', target: 'exp' })
    clock.send({ kind: 'unpin' })
    expect(clock.state).toEqual(HOVER_IDLE)
  })

  it('고정을 풀 때 예약이 남아 있으면 거둔다', () => {
    const state: HoverState = { shown: 'a', pinned: 'a', releasing: true }
    expect(hoverStep(state, { kind: 'unpin' })).toEqual({ state: HOVER_IDLE, timer: 'cancel' })
  })
})

describe('모든 짧은 순서에서 지켜지는 것', () => {
  const EVENTS: HoverEvent[] = [
    { kind: 'enter', target: 'a' },
    { kind: 'enter', target: 'b' },
    { kind: 'leave' },
    { kind: 'release' },
    { kind: 'pin', target: 'a' },
    { kind: 'unpin' },
  ]

  /** 길이 4까지의 모든 순서. */
  function* sequences(depth: number): Generator<HoverEvent[]> {
    if (depth === 0) {
      yield []
      return
    }
    for (const rest of sequences(depth - 1)) {
      yield rest
      for (const event of EVENTS) yield [...rest, event]
    }
  }

  it('불변식이 어떤 순서에서도 깨지지 않는다', () => {
    let count = 0
    const seen = new Set<string>()
    for (const sequence of sequences(4)) {
      const key = JSON.stringify(sequence)
      if (seen.has(key)) continue
      seen.add(key)
      let state: HoverState = HOVER_IDLE
      let scheduled = false
      for (const event of sequence) {
        const before = state
        const frozen = JSON.stringify(before)
        const step = hoverStep(state, event)
        state = step.state
        // 입력은 바뀌지 않는다.
        expect(JSON.stringify(before), key).toBe(frozen)
        // 예약은 켜진 것이 있을 때만, 고정이 없을 때만 있다.
        if (state.releasing) {
          expect(state.shown, key).not.toBeNull()
          expect(state.pinned, key).toBeNull()
        }
        // 고정되면 켜진 것이 그것이다.
        if (state.pinned !== null) expect(state.shown, key).toBe(state.pinned)
        // 타이머 지시는 예약의 변화와 맞는다.
        if (step.timer !== null && step.timer !== 'cancel') {
          expect(before.releasing, key).toBe(false)
          expect(state.releasing, key).toBe(true)
        }
        if (step.timer === 'cancel') {
          expect(before.releasing, key).toBe(true)
          expect(state.releasing, key).toBe(false)
        }
        // 걸린 타이머가 있는지를 지시만으로 따라가도 상태의 예약과 같다.
        if (step.timer === 'cancel') scheduled = false
        else if (step.timer !== null) scheduled = true
        if (event.kind === 'release') scheduled = false
        expect(scheduled, key).toBe(state.releasing)
      }
      count += 1
    }
    // 순서를 실제로 훑었다 — 0이면 생성기가 썩은 것이다.
    expect(count).toBeGreaterThan(1000)
  })
})

describe('이 모듈은 풀림 시간을 limits.ts에서 읽는다', () => {
  it('숫자를 다시 적지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ml', 'flow-hover.ts'), 'utf-8')
    expect(source).toMatch(/import \{[^}]*FLOW_HOVER_RELEASE_MS[^}]*\} from '@\/limits'/s)
  })
})
