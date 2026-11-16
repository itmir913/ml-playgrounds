<script setup lang="ts">
/**
 * **프로젝트 흐름도의 창이 사는 자리** (`architecture.md` §8.22). 앱 루트에 하나다 — 열고 닫는 것은
 * `useFlowDialog`가 쥐고, 이 부품은 요청이 있을 때만 창을 지연해서 싣는다(`defineAsyncComponent`).
 * 흐름도를 안 여는 학생은 창 코드를 받지 않는다.
 *
 * **닫으면 연 단추로 초점을 돌려준다.** 브라우저도 `<dialog>`를 닫을 때 앞서 초점이 있던 곳으로 돌리지만
 * 사파리는 단추를 눌러도 초점을 안 주므로 열 때 받아 둔 요소로 직접 보낸다.
 */

import { defineAsyncComponent, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'

import FlowGuard from '@/components/flow/FlowGuard.vue'
import { useFlowDialog } from '@/composables/useFlowDialog'

const FlowDialog = defineAsyncComponent(() => import('@/components/flow/FlowDialog.vue'))

const dialog = useFlowDialog()
const route = useRoute()

// 라우트가 바뀌면 창을 닫는다 — 창이 열린 채 다른 프로젝트나 화면으로 넘어가면 옛 파일의 그림이 남는다.
watch(
  () => route.fullPath,
  () => {
    if (dialog.request.value !== null) dialog.close()
  },
)

function onClose(): void {
  // 창이 사라지며 `close`가 한 번 더 온다. 그때는 이미 닫혀 있다.
  if (dialog.request.value === null) return
  const opener = dialog.close()
  void nextTick(() => {
    if (opener?.isConnected === true) opener.focus()
  })
}
</script>

<template>
  <!-- 창을 그리다 던지거나 지연 로딩이 실패하면 창만 닫고 앱은 그대로다(`FlowGuard`). -->
  <FlowGuard v-if="dialog.request.value !== null" @failed="onClose">
    <FlowDialog
      :file="dialog.request.value.file"
      :lite="dialog.request.value.lite"
      open
      @close="onClose"
    />
  </FlowGuard>
</template>
