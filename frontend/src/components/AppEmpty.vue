<script setup lang="ts">
/**
 * 빈 상태 (architecture.md §8.9).
 *
 * **고장처럼 보이면 안 된다.** 그래서 둘을 반드시 받는다 — **왜 비어 있는지**(`reason`)와
 * **무엇을 하면 열리는지**(`next`). "결과가 없습니다"로 끝내면 학생은 자기가 뭘 잘못한
 * 줄 안다.
 *
 * 둘 다 필수 props다. 하나를 빠뜨리면 컴파일이 깨진다 — 규칙을 사람의 성실함에
 * 맡기지 않는다.
 */
defineProps<{
  reason: string
  next: string
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <p class="font-bold text-ink-soft">{{ reason }}</p>
    <p class="max-w-md text-sm leading-relaxed text-ink-faint">{{ next }}</p>
    <div v-if="$slots.default" class="mt-2">
      <slot />
    </div>
  </div>
</template>
