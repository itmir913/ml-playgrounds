/**
 * 화면 구석에 잠깐 뜨는 알림.
 *
 * **문장이 아니라 로케일 키를 담는다.** 백엔드가 코드만 돌려주는 것과 같은 이유다
 * (CLAUDE.md §1.4) — 알림이 떠 있는 동안 학생이 언어를 바꿔도 문장이 따라와야 하고,
 * 스토어에 완성된 문장이 들어가는 순간 그 자리는 번역 밖으로 나간다.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

import { toMessage } from '@/errors'
import { TOAST_DURATION_MS } from '@/limits'

export const TOAST_TONES = ['info', 'success', 'caution', 'danger'] as const

export type ToastTone = (typeof TOAST_TONES)[number]

export interface Toast {
  readonly id: number
  readonly tone: ToastTone
  /** 로케일 키. 예: `client.STORAGE_QUOTA_EXCEEDED` */
  readonly key: string
  readonly params: Readonly<Record<string, unknown>>
}

/**
 * 저절로 사라지지 않는 어조.
 *
 * **실패는 학생이 읽고 닫아야 한다.** 몇 초 뒤에 사라지면 무엇이 왜 안 됐는지
 * 못 읽은 채로 다음 시도를 하게 된다.
 */
const STICKY: ReadonlySet<ToastTone> = new Set<ToastTone>(['danger'])

export const useToastStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([])
  let lastId = 0

  function dismiss(id: number): void {
    items.value = items.value.filter((toast) => toast.id !== id)
  }

  function push(tone: ToastTone, key: string, params: Record<string, unknown> = {}): number {
    lastId += 1
    const id = lastId
    items.value = [...items.value, { id, tone, key, params }]
    if (!STICKY.has(tone)) {
      setTimeout(() => {
        dismiss(id)
      }, TOAST_DURATION_MS)
    }
    return id
  }

  /**
   * 잡은 예외를 그대로 알림으로 만든다.
   *
   * **변환은 `errors.ts`의 `toMessage` 하나다.** 학습 화면도 같은 실패를 버튼 옆에
   * 남겨야 하는데, 변환이 두 벌이면 한쪽만 고쳐져 어긋난다.
   */
  function pushError(error: unknown): number {
    const { key, params } = toMessage(error)
    return push('danger', key, params)
  }

  function clear(): void {
    items.value = []
  }

  return { items, push, pushError, dismiss, clear }
})
