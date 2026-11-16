/**
 * **프로젝트 흐름도의 창은 앱에 하나다** (`architecture.md` §8.22). 대시보드 카드의 아이콘 단추([크게 보기])와 도구 막대의
 * 단추, 점검 화면의 단추가 모두 이 창 하나를 연다 — 창이 셋이면 확대·이동·고정한 강조의 규칙이 셋이 된다.
 *
 * 이 모듈은 **무엇을 열었는가만 쥔다.** 창을 그리는 것은 `components/FlowHost.vue`(앱 루트에 하나)이고,
 * 파일은 여는 쪽이 넘긴다 — **스토어를 읽지 않는다.** 그래야 점검 화면(스토어를 안 쓰는 쪽, `inspect-rules`)이
 * 같은 창을 열 수 있다.
 *
 * `opener`는 창을 닫을 때 초점을 돌려줄 단추다. 사파리는 단추를 눌러도 초점을 안 주므로 `activeElement`가
 * 아니라 **누른 요소**를 받는다.
 */

import { computed, shallowRef, type ComputedRef } from 'vue'

import type { ProjectFile } from '@/project/format'

export interface FlowRequest {
  readonly file: ProjectFile
  /** 점검이다 — 행 수를 구하지 않는다(`flowCountsLite`). */
  readonly lite: boolean
  readonly opener: HTMLElement | null
}

/** 모듈 하나가 쥔다. 창이 앱에 하나이기 때문이다. */
const current = shallowRef<FlowRequest | null>(null)

export interface FlowDialogHandle {
  readonly request: ComputedRef<FlowRequest | null>
  readonly open: (
    file: ProjectFile,
    options?: { readonly lite?: boolean; readonly opener?: EventTarget | null },
  ) => void
  /** 닫는다. 연 단추를 돌려준다 — 부르는 쪽이 초점을 거기로 보낸다. */
  readonly close: () => HTMLElement | null
}

export function useFlowDialog(): FlowDialogHandle {
  return {
    request: computed(() => current.value),
    open(file, options = {}) {
      const opener = options.opener instanceof HTMLElement ? options.opener : null
      current.value = { file, lite: options.lite === true, opener }
    },
    close() {
      const opener = current.value?.opener ?? null
      current.value = null
      return opener
    },
  }
}
