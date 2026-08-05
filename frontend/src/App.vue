<script setup lang="ts">
/**
 * 루트 컴포넌트. **화면은 라우터가 정한다** (architecture.md §8.2).
 *
 * 여기 남는 것은 화면 위에 얹히는 것들뿐이다. 알림은 라우트를 넘어서도 살아 있어야
 * 하므로 — 저장이 끝나고 다른 단계로 넘어가도 결과는 보여야 한다 — 이 층에 둔다.
 *
 * 자연어 문자열 리터럴 금지 - 전부 t()를 거친다 (CLAUDE.md §3).
 */

import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <RouterView />
  <AppToast />
</template>
