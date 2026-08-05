<script setup lang="ts">
/**
 * 입력 하나를 감싸는 껍데기 — 라벨, 도움말, 오류.
 *
 * **라벨과 입력을 잇는 id를 컴포넌트가 만든다.** 화면마다 손으로 붙이면 언젠가
 * 빠뜨리고, 빠진 라벨은 눈으로는 멀쩡해 보인다. 슬롯으로 내려주는 값을 그대로 쓴다.
 *
 * ```
 * <AppField :label="t('data.fileName')">
 *   <template #default="field"><input v-bind="field" /></template>
 * </AppField>
 * ```
 *
 * 오류가 있으면 도움말 자리를 오류가 차지한다. 둘을 같이 띄우면 어느 쪽을 읽어야
 * 하는지 알 수 없다.
 */

import { computed, useId } from 'vue'

const props = defineProps<{
  label: string
  hint?: string | undefined
  /** 있으면 도움말 자리를 차지한다. 조건부로 넘기는 자리라 undefined를 받는다. */
  error?: string | undefined
}>()

const inputId = useId()
const noteId = useId()

const note = computed(() => props.error ?? props.hint)
</script>

<template>
  <div class="flex flex-col gap-2">
    <label :for="inputId" class="text-base font-bold text-ink-soft">{{ label }}</label>

    <slot
      :id="inputId"
      :aria-describedby="note === undefined ? undefined : noteId"
      :aria-invalid="error !== undefined"
    />

    <p
      v-if="note !== undefined"
      :id="noteId"
      class="text-base"
      :class="error === undefined ? 'text-ink-faint' : 'font-medium text-danger'"
    >
      {{ note }}
    </p>
  </div>
</template>
