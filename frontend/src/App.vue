<script setup lang="ts">
/**
 * 루트 컴포넌트. **셸이 여기 있다** (architecture.md §8.6).
 *
 * 목록이든 단계든 전부 같은 껍데기 안에서 가운데만 바뀐다. 별도의 홈이 없다 —
 * 앱을 열면 이미 작업실이다.
 *
 * 알림은 셸 바깥이다. 라우트를 넘어서도 살아 있어야 하고, 도구 막대와 상태 표시줄
 * 위에 떠야 한다.
 *
 * 자연어 문자열 리터럴 금지 - 전부 t()를 거친다 (CLAUDE.md §3).
 */

import AppShell from '@/components/AppShell.vue'
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <AppToast />
</template>
