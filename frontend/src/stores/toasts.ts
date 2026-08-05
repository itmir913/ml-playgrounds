/**
 * 화면 구석에 잠깐 뜨는 알림.
 *
 * **문장이 아니라 로케일 키를 담는다.** 백엔드가 코드만 돌려주는 것과 같은 이유다
 * (CLAUDE.md §1.4) — 알림이 떠 있는 동안 학생이 언어를 바꿔도 문장이 따라와야 하고,
 * 스토어에 완성된 문장이 들어가는 순간 그 자리는 번역 밖으로 나간다.
 */

import { ref } from 'vue'
import { defineStore } from 'pinia'

import { errorMessageKey, failureDetail, isClientError } from '@/errors'
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
   * 우리 코드가 아니면 UNEXPECTED_ERROR로 떨어지고 **원문은 버리지 않고 detail로
   * 함께 실린다.** 남의 라이브러리가 던진 영어 문장이라 번역되지 않으므로 화면이
   * 우리 문장과 섞지 않고 기술 정보로 따로 붙인다 (errors.ts의 failureDetail).
   */
  function pushError(error: unknown): number {
    return isClientError(error)
      ? push('danger', error.messageKey, error.params)
      : push('danger', errorMessageKey('UNEXPECTED_ERROR'), failureDetail(error))
  }

  function clear(): void {
    items.value = []
  }

  return { items, push, pushError, dismiss, clear }
})
