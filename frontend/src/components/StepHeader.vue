<script setup lang="ts">
/**
 * 작업 공간의 머리 (architecture.md §8.9).
 *
 * 이 단계가 무엇을 하는 곳인지 한 줄, 그리고 지금의 맥락. **길잡이 역할은 하지
 * 않는다** — 이동은 레일이 쥔다. 히어로가 아니라서 낮고 조용하다.
 */
defineProps<{
  title: string
  purpose: string
}>()
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
    <div>
      <h2 class="text-lg font-bold tracking-tight">{{ title }}</h2>
      <p class="mt-0.5 text-base text-ink-soft">{{ purpose }}</p>
    </div>

    <dl class="flex flex-wrap items-center gap-x-5 gap-y-1 text-base text-ink-soft">
      <slot name="context" />
    </dl>
  </header>
</template>
