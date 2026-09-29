/**
 * **탭을 닫거나 새로고침할 때 메모리에만 있는 편집이 있으면 브라우저가 경고한다**
 * (open-decisions.md 74).
 *
 * 앱 안의 이동은 라우터 가드가 멈추고 확인 창을 띄운다(`LeaveGuard.vue`). 탭 닫기와 새로고침은
 * 가드를 안 지나므로 브라우저의 기본 경고(`beforeunload`)만 쓸 수 있다 — 문구는 브라우저가 정한다.
 *
 * **판정은 스토어의 `stranded` 하나다.** 저장이 성공하는 정상 상태에서는 거짓이라 **절대 안
 * 뜬다** — 모든 탭 닫기에 경고가 뜨면 학생은 그것을 읽지 않게 된다.
 *
 * **모바일 사파리는 `beforeunload`를 자주 안 보낸다**(`App.vue`의 `flushOnHide`). 그래서 이것은
 * 보장이 아니라 데스크톱 브라우저의 그물이다. 무는 검사: `leave-unsaved.spec.ts`.
 */

import { onBeforeUnmount, onMounted } from 'vue'

import { useProjectStore } from '@/stores/project'

export function useUnloadWarning(): void {
  const project = useProjectStore()

  function warn(event: BeforeUnloadEvent): void {
    if (!project.stranded) return
    event.preventDefault()
    // 옛 크로뮴은 `preventDefault`만으로는 안 묻고 이 값을 요구한다. 문구는 안 보인다.
    event.returnValue = ''
  }

  onMounted(() => window.addEventListener('beforeunload', warn))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', warn))
}
