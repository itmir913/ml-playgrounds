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
 * 자연어 문자열 리터럴 금지 - 전부 t()를 거친다 (docs/i18n.md).
 */

import { onBeforeUnmount, onMounted } from 'vue'

import AppShell from '@/components/AppShell.vue'
import AppToast from '@/components/AppToast.vue'
import { useProjectStore } from '@/stores/project'

const project = useProjectStore()

/**
 * **탭을 떠날 때 미뤄 둔 저장을 지금 한다** (V11 R4 C-3).
 *
 * 라우터 가드는 **앱 안의 이동만** 비운다. 탭을 닫거나 주소를 바꿔 나가면 마지막
 * `AUTOSAVE_DELAY_MS`만큼의 편집이 그대로 사라졌다 — `limits.ts`가 "브라우저 저장이
 * 지켜 주는 것은 새로고침과 크래시"라고 적어 둔 그 둘이 정확히 안 덮이는 구간이다.
 *
 * **`visibilitychange`를 쓴다.** `beforeunload`는 모바일 사파리에서 안 오는 일이
 * 흔하고, `pagehide`보다 이쪽이 먼저 그리고 더 확실하게 온다 — 이 도구는 휴대폰도
 * 기준 기기다 (`open-decisions.md` "모바일에서도 동작한다").
 *
 * **보장은 아니다.** IndexedDB 쓰기는 비동기라 브라우저가 탭을 먼저 죽이면 못 끝낸다.
 * 그래도 지금은 **시도조차 안 하고 있었다** — 잃는 구간을 800ms에서 "쓰기가 못
 * 끝난 경우"로 줄이는 것이 이 줄의 값이고, 없애는 것은 아니다.
 */
function flushOnHide(): void {
  if (document.visibilityState !== 'hidden') return
  void project.flush().catch(() => {
    // 떠나는 중이라 알릴 화면이 없다. 여기서 던지면 unhandledrejection만 남는다.
  })
}

onMounted(() => document.addEventListener('visibilitychange', flushOnHide))
onBeforeUnmount(() => document.removeEventListener('visibilitychange', flushOnHide))
</script>

<template>
  <AppShell>
    <RouterView />
  </AppShell>
  <AppToast />
</template>
