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

    <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
      <StepRail />
      <main class="min-w-0 flex-1 overflow-auto">
        <slot />
      </main>
    </div>

    <AppStatusBar />
  </div>
</template>
