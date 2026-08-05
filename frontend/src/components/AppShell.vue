<script setup lang="ts">
/**
 * 작업실 껍데기. **상시 존재하는 것은 넷뿐이다** (architecture.md §8.6) —
 * 도구 막대, 레일, 작업 공간, 상태 표시줄.
 *
 * 목록 화면도 이 안에 있다. 별도의 홈이 없고, 앱을 열면 이미 작업실이며 가운데만
 * 바뀐다. 그래야 웹사이트가 아니라 프로그램처럼 느껴진다.
 *
 * **바깥은 절대 스크롤되지 않는다.** 스크롤은 작업 공간 안에서만 일어나야
 * 도구 막대와 상태 표시줄이 제자리에 남는다.
 */

import AppStatusBar from '@/components/AppStatusBar.vue'
import AppToolbar from '@/components/AppToolbar.vue'
import StepRail from '@/components/StepRail.vue'
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-canvas">
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
      <main class="min-w-0 flex-1 overflow-auto bg-surface">
        <slot />
      </main>
    </div>

    <AppStatusBar />
  </div>
</template>
