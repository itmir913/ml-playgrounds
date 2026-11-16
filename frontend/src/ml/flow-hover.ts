/**
 * 프로젝트 흐름도의 **가리킴(호버) 판단** — 마우스가 노드를 지날 때 강조가 켜지고 풀리는 순서
 * (`architecture.md` §8.22). 시계도 DOM도 모른다. 이벤트 하나를 받아 다음 상태와 **타이머에 시킬 일**을
 * 돌려주고, 컴포넌트가 그대로 타이머를 걸거나 취소한다.
 *
 * **풀림은 늦춘다.** 노드와 노드 사이의 틈을 지나는 동안 포인터가 어느 노드 위에도 없는 순간이 있다. 그때
 * 바로 풀면 전체가 잠깐 켜졌다 다시 흐려져 깜빡인다. 포인터가 떠나면 풀림을 `FLOW_HOVER_RELEASE_MS` 뒤로
 * 미루고, 그 안에 다음 노드에 들어서면 풀림이 취소된다.
 *
 * **고정한 것은 가리킴이 못 바꾼다.** 누르면 그 강조가 고정되고 풀 때까지 포인터가 움직여도 그대로다.
 * 키보드 초점도 같은 이벤트로 흘려 넣는다.
 *
 * **대상은 문자열 하나다** — 노드의 이름이나 막대 조각의 이름(`ml/flow-highlight.ts`). 어느 쪽인지는 이
 * 모듈이 알 필요가 없다. 무는 검사: `tests/flow-hover.spec.ts`.
 */

import { FLOW_HOVER_RELEASE_MS } from '@/limits'

export interface HoverState {
  /** 지금 켜져 있는 대상. 없으면 `null`. */
  readonly shown: string | null
  /** 눌러서 고정한 대상. 있으면 가리킴이 `shown`을 못 바꾼다. */
  readonly pinned: string | null
  /** 풀림이 예약되어 있는가. */
  readonly releasing: boolean
}

export type HoverEvent =
  | { readonly kind: 'enter'; readonly target: string }
  | { readonly kind: 'leave' }
  /** 예약한 풀림의 시간이 지났다. 그 사이 취소됐으면 아무 일도 없다. */
  | { readonly kind: 'release' }
  | { readonly kind: 'pin'; readonly target: string }
  | { readonly kind: 'unpin' }

/** 타이머에 시킬 일. `start`는 `ms` 뒤에 `release`를 보내도록 걸고, `cancel`은 걸린 시간을 거둔다. */
export type HoverTimer = { readonly start: number } | 'cancel' | null

export interface HoverStep {
  readonly state: HoverState
  readonly timer: HoverTimer
}

export const HOVER_IDLE: HoverState = { shown: null, pinned: null, releasing: false }

/** 이벤트 하나를 받아 다음 상태와 타이머에 시킬 일을 돌려준다. 입력 상태는 바꾸지 않는다. */
export function hoverStep(state: HoverState, event: HoverEvent): HoverStep {
  switch (event.kind) {
    case 'enter':
      // 고정된 동안은 가리킴이 대상을 못 바꾼다.
      if (state.pinned !== null) return { state, timer: null }
      // 다음 노드에 들어서면 예약된 풀림을 거두고 곧장 그 노드를 켠다.
      return {
        state: { ...state, shown: event.target, releasing: false },
        timer: state.releasing ? 'cancel' : null,
      }
    case 'leave':
      if (state.pinned !== null || state.shown === null) return { state, timer: null }
      // 끄지 않고 늦춘다. 이미 예약됐으면 시간을 다시 걸지 않는다.
      return {
        state: { ...state, releasing: true },
        timer: state.releasing ? null : { start: FLOW_HOVER_RELEASE_MS },
      }
    case 'release':
      // 시간이 지났을 때 아직 예약이 살아 있어야 푼다. 그 사이 다음 노드에 들어섰으면 낡은 시간이다.
      if (!state.releasing || state.pinned !== null) return { state, timer: null }
      return { state: { ...state, shown: null, releasing: false }, timer: null }
    case 'pin':
      return {
        state: { shown: event.target, pinned: event.target, releasing: false },
        timer: state.releasing ? 'cancel' : null,
      }
    case 'unpin':
      return { state: HOVER_IDLE, timer: state.releasing ? 'cancel' : null }
  }
}
