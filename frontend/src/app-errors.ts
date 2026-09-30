/**
 * **화면 부품이 오류로 멈추면 알린다** (open-decisions.md 85, architecture.md §8.1).
 *
 * 처리기가 없으면 배포판 Vue는 렌더에서 던진 부품을 빈 주석으로 바꾸고 콘솔에만 남긴다 — 학생은 판이
 * 말없이 사라진 것만 본다. 화면 안의 지연 부품(`defineAsyncComponent`)이 청크를 못 받아도 같다.
 *
 * **받는 것은 잡히지 않고 빠져나온 오류뿐이다** — 렌더·수명 주기 훅·감시자·이벤트 처리기가 돌려준 거절·
 * 지연 부품 로더의 거절. 라우트 화면의 청크는 라우터 가드가 먼저 받고 `SCREEN_LOAD_FAILED`를 스스로 알리므로
 * 여기 오지 않는다(`router/index.ts`).
 *
 * `tests/app-error-notice.spec.ts`가 문다.
 */

import type { App } from 'vue'

import { toMessage } from './errors'
import { useToastStore } from './stores/toasts'

/** 앱에 전역 오류 처리기를 단다. `main.ts`가 부른다. */
export function installErrorNotice(app: App): void {
  app.config.errorHandler = (error, _instance, info) => {
    noticeError(error, info)
  }
}

/**
 * 빠져나온 오류 하나를 알린다. **알림은 있는 길(`pushError`)을 지난다** — 우리 오류면 그 문장, 아니면
 * `UNEXPECTED_ERROR`와 원문이다. 새 코드를 만들지 않는다.
 *
 * **같은 알림이 떠 있으면 다시 밀지 않는다.** 스토어의 `push`는 같은 알림을 빼고 새 id로 다시 미는데,
 * 그것이 목록을 바꾼다 — 알림 목록을 읽는 부품이 렌더에서 던지면 그리기와 밀기가 끝없이 돈다. 목록을 안
 * 건드려야 고리가 끊긴다. 같은 스펙의 *"알림 목록을 읽는 부품이 던져도 알림을 끝없이 밀지 않는다"*가 문다.
 * **같은 알림**은 어조·키·파라미터가 다 같은 것이다 — 키만 같고 원문이 다른 오류는 따로 알린다(같은 스펙의
 * *"다른 오류는 따로 알린다"*).
 *
 * **한계: 문장이 매번 다르면 고리를 못 끊는다.** 알림 목록을 읽는 부품이 던질 때마다 다른 원문(세는 값이 든
 * 문장 따위)을 내면 매번 새 알림이라 그리기와 밀기가 다시 돈다. 그때는 Vue의 재귀 상한이 멈춘다. 드문 모양이라
 * 두지 않았다.
 *
 * **원문은 콘솔에도 남긴다** — Vue가 넘긴 (어디서 났는가)와 함께. 처리기가 있으면 Vue는 콘솔에 안 남기므로,
 * 안 남기면 개발자가 스택과 부품 자리를 잃는다. 같은 스펙의 진입점 검사가 문다.
 */
function noticeError(error: unknown, info: string): void {
  console.error(error, info)
  const toasts = useToastStore()
  const { key, params } = toMessage(error)
  const shown = toasts.items.some(
    (toast) =>
      toast.tone === 'danger' &&
      toast.key === key &&
      JSON.stringify(toast.params) === JSON.stringify(params),
  )
  if (shown) return
  toasts.pushError(error)
}
