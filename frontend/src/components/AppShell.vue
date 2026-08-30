<script setup lang="ts">
/**
 * 작업실 껍데기. **상시 존재하는 것은 넷뿐이다** (architecture.md §8.6) —
 * 도구 막대, 레일, 작업 공간, 상태 표시줄.
 *
 * 목록 화면도 이 안에 있다. 별도의 홈이 없고, 앱을 열면 이미 작업실이며 가운데만
 * 바뀐다. 그래야 웹사이트가 아니라 프로그램처럼 느껴진다.
 *
 * **스크롤하는 것이 폭에 따라 갈린다** (architecture.md §8.6).
 *
 * `md` 이상에서는 바깥이 절대 스크롤되지 않는다 — 작업 공간 안에서만 일어나야 도구
 * 막대와 상태 표시줄이 제자리에 남고, 결과 화면처럼 **두 판이 각자 스크롤하는 구조**가
 * 성립한다.
 *
 * **`md` 미만에서는 문서가 스크롤한다.** iOS는 상단 탭으로 맨 위 가기와 주소창 접기를
 * 메인 프레임 스크롤러에만 주는데, 안쪽 상자가 스크롤하면 그 둘이 영영 안 온다. 그
 * 폭에서는 도구 막대가 `sticky`, 레일과 상태 표시줄이 `fixed`로 제자리를 지킨다.
 */

import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'

import { SCROLL_TOP_DURATION_MS } from '@/limits'
import AppStatusBar from '@/components/AppStatusBar.vue'
import AppToolbar from '@/components/AppToolbar.vue'
import StepRail from '@/components/StepRail.vue'

/**
 * 레일에서 단계를 옮기면 작업 공간을 맨 위로 되돌린다. 안 그러면 직전 단계에서
 * 스크롤해 둔 위치가 그대로 남아, 새 단계인데 중간부터 보이는 것처럼 느껴진다.
 *
 * **네이티브 `scroll-behavior: smooth`를 안 쓴다.** 그 지속 시간은 브라우저가
 * 정하고 손댈 수 없는데, 원하는 것은 "부드럽지만 짧게"다. 그래서 직접 `duration`을
 * 쥔 애니메이션을 돈다 — 저사양 PC 기준으로 `transform`이 아니라 `scrollTop` 하나만
 * 매 프레임 바꾸므로 가볍다.
 *
 * `prefers-reduced-motion`을 따로 확인한다. `base.css`의 전역 규칙은
 * CSS 트랜지션·애니메이션만 잡고, `requestAnimationFrame`으로 도는 이 스크롤은
 * 잡지 못한다.
 */
const route = useRoute()
const mainEl = ref<HTMLElement | null>(null)

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * 실제로 스크롤하고 있는 것. **폭으로 판정하지 않는다** — 중단점을 CSS와 여기 두 곳에
 * 적으면 한쪽만 고쳐진다. 넘치는 쪽이 스크롤하는 쪽이다.
 */
function scroller(): HTMLElement | null {
  const main = mainEl.value
  if (main && main.scrollHeight > main.clientHeight) return main
  const root = document.scrollingElement
  return root instanceof HTMLElement ? root : null
}

function scrollToTopFast(el: HTMLElement): void {
  const from = el.scrollTop
  if (from === 0) return

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = 0
    return
  }

  const start = performance.now()

  function step(now: number): void {
    const t = Math.min(1, (now - start) / SCROLL_TOP_DURATION_MS)
    el.scrollTop = from * (1 - easeOutCubic(t))
    if (t < 1) requestAnimationFrame(step)
  }

  requestAnimationFrame(step)
}

watch(
  () => route.name,
  () => {
    const el = scroller()
    if (el) scrollToTopFast(el)
  },
)
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-canvas md:h-full md:overflow-hidden">
    <AppToolbar />

    <!--
      좁은 화면에서는 레일이 **아래로 내려간다**(order-last) — 상태 표시줄 바로 위,
      휴대폰 앱의 탭 바 자리다. 기준을 md로 잡은 것은 640~768px의 좁은 창에서도
      세로 레일이 이미 부족한 가로 폭을 깎기 때문이다.
    -->
    <div class="flex min-h-0 flex-1 flex-col md:flex-row">
      <StepRail />
      <!--
        작업 공간이 **레일에서 열린 것처럼** 보여야 한다. 레일은 가라앉은 색이고
        여기는 흰 면인데, 지금 있는 단계 칸이 같은 흰색이라 둘이 이어져 보인다.
      -->
      <!--
        **스크롤 막대의 자리를 늘 비워 둔다.** 안 그러면 내용이 긴 단계와 짧은 단계를
        오갈 때마다 작업 공간의 폭이 막대 하나만큼 달라져 화면 전체가 옆으로 튄다.
      -->
      <!--
        **`md` 미만에서는 이 상자가 스크롤하지 않는다** — 문서가 한다. 그 폭에서는
        하단 바가 `fixed`라 흐름에서 빠져 있으므로, 가려지는 만큼을 아래 여백으로
        비워 둔다(`pad-below-shell`, `md` 이상에서는 0이다).
      -->
      <main
        ref="mainEl"
        class="min-w-0 flex-1 bg-surface pad-below-shell md:overflow-auto md:scroll-gutter-stable"
      >
        <slot />
      </main>
    </div>

    <AppStatusBar />
  </div>
</template>
