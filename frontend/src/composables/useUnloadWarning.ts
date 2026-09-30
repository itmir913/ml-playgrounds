/**
 * **탭을 닫거나 새로고침할 때 잃을 것이 있으면 브라우저가 경고한다**
 * (open-decisions.md 74·83).
 *
 * 앱 안의 이동은 라우터 가드가 멈추고 확인 창을 띄운다(`LeaveGuard.vue`, 학습 화면의 떠나기 창).
 * 탭 닫기와 새로고침은 가드를 안 지나므로 브라우저의 기본 경고(`beforeunload`)만 쓸 수 있다 —
 * 문구는 브라우저가 정한다.
 *
 * **판정은 `unloadWarningReasons` 하나다.** 잃을 것은 메모리에만 있는 편집(스토어의
 * `stranded`, 결정 74)과 도는 학습·굽기(`useWork`의 `workHoldsPage`, 결정 83). 저장이 성공하고
 * 도는 일이 없는 정상 상태에서는 이유가 비어 **안 뜬다** — 모든 탭 닫기에 경고가 뜨면 학생은
 * 그것을 읽지 않게 된다.
 *
 * **모바일 사파리는 `beforeunload`를 자주 안 보낸다**(`App.vue`의 `flushOnHide`). 그래서 이것은
 * 보장이 아니라 데스크톱 브라우저의 그물이다. 무는 검사: `leave-unsaved.spec.ts`, `unload-work.spec.ts`.
 */

import { onBeforeUnmount, onMounted } from 'vue'

import { workHoldsPage } from '@/composables/useWork'
import { useProjectStore } from '@/stores/project'

/** 탭을 닫으면 잃는 것. */
export type UnloadReason = 'UNSAVED_EDITS' | 'WORK_RUNNING'

/** 판정이 보는 상태. */
export interface UnloadState {
  /** 브라우저에도 파일에도 안 나간 편집이 메모리에만 있다 (스토어의 `stranded`). */
  readonly stranded: boolean
  /** 경고를 건 학습·굽기가 돈다 (`useWork`의 `workHoldsPage`). */
  readonly workHoldsPage: boolean
}

/**
 * **탭을 닫으면 잃는 것들.** 비었으면 묻지 않는다 (architecture.md §10 — 판정은 순수 함수가,
 * 리스너는 결과만). `unload-work.spec.ts`의 *"판정은 한 곳이다"*가 문다.
 */
export function unloadWarningReasons(state: UnloadState): UnloadReason[] {
  const reasons: UnloadReason[] = []
  if (state.stranded) reasons.push('UNSAVED_EDITS')
  if (state.workHoldsPage) reasons.push('WORK_RUNNING')
  return reasons
}

export function useUnloadWarning(): void {
  const project = useProjectStore()

  function warn(event: BeforeUnloadEvent): void {
    const reasons = unloadWarningReasons({
      stranded: project.stranded,
      workHoldsPage: workHoldsPage.value,
    })
    if (reasons.length === 0) return
    event.preventDefault()
    // 옛 크로뮴은 `preventDefault`만으로는 안 묻고 이 값을 요구한다. 문구는 안 보인다.
    event.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', warn))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', warn))
}
