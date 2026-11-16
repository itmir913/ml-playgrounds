<script setup lang="ts">
/**
 * **프로젝트 흐름도의 오류 경계** (`architecture.md` §8.22). 흐름도는 대시보드와 도구 막대에 들어가므로
 * **흐름도 쪽 오류가 대시보드나 프로젝트 열기를 막으면 안 된다.** 안쪽 부품이 그리다가(계산, 지연 로딩한 코드)
 * 던지면 여기서 받아 **자리만 비운다** — 나머지 화면은 그대로 그려진다.
 *
 * 오류는 삼키되 **콘솔에는 남긴다**(`console.error`) — 조용히 사라지는 것이 가장 나쁘다. 지연 로딩이 실패한 경우
 * (`defineAsyncComponent`)도 같은 길이다. 실패하면 `failed`를 올려 부르는 쪽이 자기 상태(열린 창)를 정리하게 한다.
 *
 * 부모가 \`:key\`로 프로젝트마다 새로 세우면 다른 프로젝트에서 다시 시도한다.
 */

import { onErrorCaptured, ref } from 'vue'

const emit = defineEmits<{ failed: [error: unknown] }>()

const failed = ref(false)

onErrorCaptured((error) => {
  failed.value = true
  console.error('project flow diagram failed to render', error)
  emit('failed', error)
  // 위로 올리지 않는다 — 앱의 오류 처리가 화면을 깨뜨리지 않게.
  return false
})
</script>

<template>
  <slot v-if="!failed" />
</template>
