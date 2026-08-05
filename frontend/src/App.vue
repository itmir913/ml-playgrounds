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
 * **라우트 전환에 트랜지션을 두지 않는다 (2026-08-05).** 짧게 흐리는 것을 넣었다가
 * 작업 공간이 통째로 비고 `<main>`에 `<!---->`만 남는 일을 겪어 되돌렸다. `out-in`은
 * 나가는 쪽이 끝나야 들어오는 쪽이 붙는데, **그 조건이 어긋나면 화면이 아예 안 그려진다.**
 * 새로고침하면 멀쩡해서 원인을 짚기도 어렵다.
 *
 * 다시 넣는다면 `mode`를 빼고(겹쳐서 바꾸고) 화면마다 루트가 하나인 것을 먼저 확인해야
 * 한다. 그건 `tests/ui-rules.spec.ts`가 이제 막는다. **부드러움은 화면이 뜨는 것보다
 * 뒤에 온다.**
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
