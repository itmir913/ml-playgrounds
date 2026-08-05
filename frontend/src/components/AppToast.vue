<script setup lang="ts">
/**
 * 알림 더미. 앱 껍데기에 한 번만 놓는다.
 *
 * `aria-live="polite"`로 두어 스크린리더가 읽던 것을 끊지 않게 한다. 학습이 끝났다는
 * 알림 때문에 읽던 문장이 잘리면 안 된다.
 */

import { useI18n } from 'vue-i18n'

import { type ToastTone, useToastStore } from '@/stores/toasts'

const { t } = useI18n()
const toasts = useToastStore()

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
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-3 p-4 sm:items-end sm:p-6"
    aria-live="polite"
  >
    <div
      v-for="toast in toasts.items"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-md items-start gap-3 overflow-hidden rounded-panel border bg-surface pr-3 shadow-pop"
      :class="TONES[toast.tone]"
    >
      <span class="w-1.5 self-stretch" :class="BARS[toast.tone]" aria-hidden="true" />

      <p class="flex-1 py-4 text-sm leading-relaxed font-medium">
        {{ t(toast.key, toast.params) }}
      </p>

      <button
        type="button"
        class="mt-3 rounded-field px-2 py-1 text-sm font-bold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
        :aria-label="t('common.dismiss')"
        @click="toasts.dismiss(toast.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>
