<script setup lang="ts">
/**
 * 화면의 기본 덩어리. 흰 면 + 큰 모서리 + 옅은 그림자.
 *
 * 색·모서리·그림자는 전부 토큰이다 (architecture.md §8.4). 카드 안에 다시 면을 둘
 * 때는 `rounded-panel bg-surface-sunken`을 쓴다 — 모서리는 바깥이 크고 안으로 갈수록
 * 작아야 어긋나 보이지 않는다.
 *
 * 문구는 전부 호출하는 쪽이 t()로 만들어 넘긴다.
 */
defineProps<{
  title?: string
  description?: string
}>()
</script>

<template>
  <section class="rounded-card border border-line bg-surface shadow-card">
    <header v-if="title !== undefined" class="border-b border-line px-6 pt-6 pb-5 md:px-8">
      <h2 class="text-xl font-bold tracking-tight md:text-2xl">{{ title }}</h2>
      <p v-if="description !== undefined" class="mt-2 leading-relaxed text-ink-soft">
        {{ description }}
      </p>
      <slot name="header" />
    </header>

    <div class="p-6 md:p-8">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="border-t border-line bg-surface-sunken px-6 py-4 md:px-8">
      <slot name="footer" />
    </footer>
  </section>
</template>
