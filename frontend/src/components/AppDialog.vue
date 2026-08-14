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

      <!--
        **고르는 것 둘의 너비가 같아야 한다** (2026-08-15, 사용자). `취소`와 `지우기`처럼
        글자 수가 다른 짝에서 폭이 갈리면 **무게가 글자 수로 정해진다** - 무엇이 무거운
        선택인지는 변종이 말해야 하고, 폭은 아무 말도 하면 안 된다.

        `AppEmpty`가 나란한 단추를 세우는 것과 같은 방식이다 - 격자로 놓고 칸을 같은
        너비로 나눈다(`auto-cols-fr`). 좁은 화면에서는 위아래로 쌓이고, 그때도 서로
        같은 너비다.
      -->
      <div class="mt-6 ml-auto grid w-fit gap-3 sm:grid-flow-col sm:auto-cols-fr">
        <slot name="actions" />
      </div>
    </div>
  </dialog>
</template>
