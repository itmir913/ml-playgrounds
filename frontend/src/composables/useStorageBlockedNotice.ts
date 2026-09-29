/**
 * **저장소가 다른 탭에 막혀 있는 동안 알린다** (open-decisions.md 77, `STORAGE_BLOCKED`).
 *
 * 옛 배포판을 연 탭이 연결을 안 놓으면 이 탭의 저장소 열기가 **실패하지 않고 멈춘다** — 목록이
 * 안 뜨고 저장이 끝나지 않는다. 그 탭을 닫으면 그대로 이어지므로 실패로 끊지 않고, **기다리는
 * 동안만** "다른 탭을 닫아 주세요"를 띄우고 **풀리면 걷는다.**
 *
 * **앱 껍데기가 한 번 부른다**(`App.vue`). 막힘은 화면이 뜨기 전(언어 읽기)에 설 수 있는데,
 * `onStorageBlocked`가 붙는 순간 지금 상태를 알려 주므로 놓치지 않는다.
 *
 * 무는 검사: `storage-blocked.spec.ts`.
 */

import { onBeforeUnmount, onMounted } from 'vue'

import { errorMessageKey } from '@/errors'
import { onStorageBlocked } from '@/project/storage'
import { useToastStore } from '@/stores/toasts'

export function useStorageBlockedNotice(): void {
  const toasts = useToastStore()
  let shown: number | null = null
  let detach: (() => void) | null = null

  function react(blocked: boolean): void {
    if (blocked && shown === null) {
      shown = toasts.push('caution', errorMessageKey('STORAGE_BLOCKED'))
    } else if (!blocked && shown !== null) {
      toasts.dismiss(shown)
      shown = null
    }
  }

  onMounted(() => {
    detach = onStorageBlocked(react)
  })
  onBeforeUnmount(() => {
    detach?.()
    detach = null
  })
}
