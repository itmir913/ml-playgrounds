<script setup lang="ts">
/**
 * 알림 더미. 앱 껍데기에 한 번만 놓는다.
 *
 * `aria-live="polite"`로 두어 스크린리더가 읽던 것을 끊지 않게 한다. 학습이 끝났다는
 * 알림 때문에 읽던 문장이 잘리면 안 된다.
 */

import { useI18n } from 'vue-i18n'

import { ACTION_ICONS } from '@/icons'
import { type Toast, type ToastTone, useToastStore } from '@/stores/toasts'

const { t } = useI18n()
const toasts = useToastStore()

function detailOf(toast: Toast): string {
  return typeof toast.params.detail === 'string' ? toast.params.detail : ''
}

const TONES: Readonly<Record<ToastTone, string>> = {
  info: 'border-brand-line bg-info-soft text-ink',
  success: 'border-positive/30 bg-positive-soft text-ink',
  caution: 'border-caution/30 bg-caution-soft text-ink',
  danger: 'border-danger/30 bg-danger-soft text-ink',
}

const BARS: Readonly<Record<ToastTone, string>> = {
  info: 'bg-info',
  success: 'bg-positive',
  caution: 'bg-caution',
  danger: 'bg-danger',
}
</script>

<template>
  <!--
    **하단 바를 덮지 않는다** (architecture.md §8.6). `md` 미만에서는 레일과 상태
    표시줄이 `fixed`로 화면 아래에 붙어 있어서, `bottom-0`이면 알림이 그 둘을 통째로
    가린다 — 단계를 옮길 수도, 저장 상태를 볼 수도 없게 된다(2026-08-14 실기기).
    `md` 이상에서는 `--shell-bottom`이 0이라 예전과 같은 자리다.
  -->
  <div
    class="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-3 p-4 toast-stack sm:items-end sm:p-6"
    aria-live="polite"
  >
    <div
      v-for="toast in toasts.items"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-md items-start gap-3 overflow-hidden rounded-panel border bg-surface pr-3 shadow-pop"
      :class="TONES[toast.tone]"
    >
      <span class="w-1.5 self-stretch" :class="BARS[toast.tone]" aria-hidden="true" />

      <div class="flex-1 py-4">
        <p class="text-base leading-relaxed font-medium">{{ t(toast.key, toast.params) }}</p>
        <!--
          남의 라이브러리가 던진 원문. 번역되지 않으므로 우리 문장과 섞지 않고
          아래에 기술 정보로 붙인다 (errors.ts의 failureDetail).
        -->
        <p v-if="detailOf(toast)" class="mt-1 text-base break-all text-ink-soft">
          {{ detailOf(toast) }}
        </p>
      </div>

      <button
        type="button"
        class="mt-3 rounded-field px-2 py-1 text-base font-bold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
        :aria-label="t('common.dismiss')"
        @click="toasts.dismiss(toast.id)"
      >
        <component :is="ACTION_ICONS.dismiss" :size="18" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
