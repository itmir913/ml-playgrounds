<script setup lang="ts">
/**
 * **자리가 있으면 그리로 옮겨 그리고, 없으면 제자리에 그린다.**
 *
 * 도구의 설정 칸이 차트 창의 둘째 열로 옮겨 가는 데 쓴다(`data/charts.ts`의 `CHART_CONTROLS`).
 * 창 밖(결과 화면)에서는 옮길 자리가 없어 제자리에 선다.
 *
 * **잠금이 아니다.** Vue `Teleport`의 그 속성은 "제자리에 그린다"는 뜻인데, 낱말이 잠금
 * 낱말이라 화면 파일에 둘 수 없다(결정문 65 — 예외를 무늬로 두지 않는다). 그래서 이 부품이
 * `@/locks`의 `LOCK_PRIMITIVES`에 이유와 함께 선다.
 */

defineProps<{
  /** 옮겨 갈 자리. `null`이면 제자리에 그린다. */
  to: HTMLElement | null
}>()
</script>

<template>
  <Teleport :to="to" :disabled="to === null">
    <slot />
  </Teleport>
</template>
