/**
 * **프로젝트를 떠나려다 멈춘 이동** (open-decisions.md 74).
 *
 * 브라우저 저장이 실패한 채 메모리에만 있는 편집을 두고 목록·점검·다른 프로젝트로 가려 하면
 * 라우터 가드가 이동을 멈추고 여기에 목적지를 둔다. 확인 창(`components/LeaveGuard.vue`)이 이것을
 * 보고 뜬다 — [머무르기] / [파일로 저장] / [저장하지 않고 이동].
 *
 * **가드와 창을 잇는 것만 한다.** 멈출지의 판정은 프로젝트 스토어의 `stranded`가 갖는다.
 */

import { shallowRef } from 'vue'
import { defineStore } from 'pinia'

export const useLeaveStore = defineStore('leave', () => {
  /** 멈춘 이동의 목적지(`fullPath`). 확인을 기다리는 동안만 값이 있다. */
  const target = shallowRef<string | null>(null)

  /**
   * [저장하지 않고 이동]으로 한 번 통과시킬 목적지. **불리언이 아니라 목적지로 쥔다** — 통과가 다른
   * 이동에 새면 그 이동의 확인을 건너뛴다.
   */
  let passing: string | null = null

  function ask(to: string): void {
    target.value = to
  }

  function stay(): void {
    target.value = null
  }

  /** 확인 없이 한 번 통과시킬 목적지를 세우고 그 목적지를 돌려준다. 창은 닫는다. */
  function allow(): string | null {
    const to = target.value
    target.value = null
    passing = to
    return to
  }

  /** 가드가 묻는다: 이 이동은 [저장하지 않고 이동]으로 허락된 것인가. **한 번만 참이다.** */
  function consume(to: string): boolean {
    if (passing === null || passing !== to) return false
    passing = null
    return true
  }

  /** 허락한 이동이 끝나지 못했으면(취소·리다이렉트) 통과를 거둔다. */
  function forget(): void {
    passing = null
  }

  return { target, ask, stay, allow, consume, forget }
})
