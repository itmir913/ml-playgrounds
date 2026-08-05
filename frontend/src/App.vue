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
 * **단계가 바뀔 때 아주 짧게 흐린다** (`styles/base.css`의 `route-*`). 셸은 그대로 있고
 * 작업 공간만 바뀌는데, 내용이 즉시 갈리면 같은 자리에서 화면이 튀는 것으로 보인다.
 * 길면 안 된다 — 학생이 레일을 연달아 누르는 화면이라 0.1초대여야 응답이 느려졌다는
 * 느낌을 안 준다. `out-in`이라 두 화면이 겹쳐 뛰지 않는다. 모션을 줄이도록 설정한
 * 기기에서는 base.css가 전역으로 꺼 준다.
 *
 * 자연어 문자열 리터럴 금지 - 전부 t()를 거친다 (CLAUDE.md §3).
 */

import AppShell from '@/components/AppShell.vue'
import AppToast from '@/components/AppToast.vue'
</script>

<template>
  <AppShell>
    <RouterView v-slot="{ Component }">
      <Transition name="route" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </AppShell>
  <AppToast />
</template>
