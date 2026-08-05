<script setup lang="ts">
/**
 * 화면 맨 위의 그라데이션 머리. 알약 배지 + 제목 + 한 줄 설명.
 *
 * 앱의 정체성이 하나이므로 **그라데이션도 하나다** — 색은 `hero-surface` 유틸리티에
 * 한 번만 적혀 있다 (style.css).
 *
 * 강의노트가 아니라 앱이라 낮게 잡는다. 학생은 여기를 읽으러 온 것이 아니라
 * 아래에서 무언가를 하러 왔고, 머리가 화면을 절반 먹으면 매번 스크롤해야 한다.
 */
defineProps<{
  badge: string
  title: string
  description?: string
}>()
</script>

<template>
  <header class="hero-surface text-ink-invert">
    <div class="mx-auto flex max-w-shell flex-col gap-4 px-6 py-10 md:py-14">
      <slot name="above" />

      <div>
        <span
          class="inline-block rounded-pill bg-white/20 px-4 py-1.5 text-sm font-bold shadow-sm backdrop-blur-md"
        >
          {{ badge }}
        </span>
      </div>

      <h1 class="text-3xl leading-tight font-black tracking-tight md:text-4xl lg:text-5xl">
        {{ title }}
      </h1>

      <p v-if="description !== undefined" class="max-w-2xl text-lg leading-relaxed opacity-90">
        {{ description }}
      </p>

      <slot />
    </div>
  </header>
</template>
