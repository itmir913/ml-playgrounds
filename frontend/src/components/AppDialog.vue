<script setup lang="ts">
/**
 * 모달 대화상자.
 *
 * **브라우저의 `<dialog>`를 쓴다.** 직접 만들면 포커스 가두기, Esc, 바깥 클릭,
 * 스크롤 잠금, `aria-modal`을 전부 우리가 짜야 하고 그중 하나는 반드시 빠진다.
 *
 * 열고 닫는 것은 `open` prop이 쥔다. Esc나 바깥을 눌러 닫히면 `close`를 올려
 * **부모가 상태의 유일한 출처로 남게** 한다 - 안에서 몰래 닫으면 다시 열 수 없다.
 */

import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
}>()

const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    const element = dialog.value
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  },
  { flush: 'post' },
)

// 라우트가 바뀌면서 열린 채로 사라질 수 있다. 남으면 화면이 잠긴다.
onBeforeUnmount(() => dialog.value?.close())

function onBackdrop(event: MouseEvent): void {
  // <dialog> 자신이 대상이면 바깥을 누른 것이다. 안쪽 요소는 여기까지 안 온다.
  if (event.target === dialog.value) emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto w-full max-w-lg rounded-card border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-slate-900/40"
    @close="emit('close')"
    @click="onBackdrop"
  >
    <div class="p-6 md:p-8">
      <h2 class="text-xl font-bold tracking-tight md:text-2xl">{{ title }}</h2>
      <!--
        **리듬이 두 단이다** — 이름과 그 설명 사이는 1.5, 덩어리와 덩어리 사이는 6.
        칸 안의 `AppField`·`AppChoices`가 같은 두 값을 쓰므로, 대화상자 제목부터
        버튼까지 내려오는 간격이 한 벌로 읽힌다.
      -->
      <p v-if="description !== undefined" class="mt-1.5 leading-relaxed text-ink-soft">
        {{ description }}
      </p>

      <div v-if="$slots.default" class="mt-6">
        <slot />
      </div>

      <div class="mt-6 flex flex-wrap justify-end gap-3">
        <slot name="actions" />
      </div>
    </div>
  </dialog>
</template>
