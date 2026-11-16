<script setup lang="ts">
/**
 * **프로젝트 흐름도의 창** (`architecture.md` §8.22) — 앱에 하나이고(`composables/useFlowDialog.ts`) 지연해서
 * 싣는다(`components/FlowHost.vue`가 `defineAsyncComponent`로 부른다). 화면의 95%를 쓰는 `AppDialog fill`이고,
 * 안은 확대·이동하는 판(`FlowCanvas`) 하나다.
 *
 * **윤곽을 먼저 띄우고 수를 나중에 채운다.** 창이 열리는 순간 계획이 돌면 창이 뜨는 것까지 늦어진다 —
 * `useFlowCounts`가 다음 틱에 구한다. 점검(`lite`)은 행 수 없이 윤곽으로 둔다.
 *
 * **`Esc`는 두 단계다** — 고정한 강조가 있으면 그것을 풀고, 없으면 창을 닫는다(`ml/flow-zoom.ts`의
 * `escapeStep`). **바깥을 눌러도 안 닫힌다**(`persistent`) — 판을 끌다 커서가 밖으로 나가 놓으면 창이 닫혔다.
 *
 * **파일만 받는다. 스토어를 읽지 않는다.**
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppDialog from '@/components/AppDialog.vue'
import FlowCanvas from '@/components/flow/FlowCanvas.vue'
import { useFlowCounts } from '@/composables/useFlowCounts'
import { escapeStep } from '@/ml/flow-zoom'
import type { ProjectFile } from '@/project/format'

const props = defineProps<{
  file: ProjectFile
  /** 점검이다 — 행 수 없이 그린다. */
  lite: boolean
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const { counts, bars } = useFlowCounts(
  () => props.file,
  () => props.lite,
  () => props.open,
)

const pinned = ref<string | null>(null)

/**
 * `Esc`. **고정한 강조가 있으면 keydown에서 막고 그것만 푼다** — `cancel`을 막는 것에만 기대면 크롬이 연달아
 * 막힌 `cancel`을 취소 불가로 보내 창이 닫힌다. 고정이 없으면 건드리지 않아 창이 닫힌다.
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (escapeStep({ pinned: pinned.value !== null }).closeDialog) return
  event.preventDefault()
  pinned.value = null
}

/** 뒷길: 그래도 `cancel`이 오면(고정이 남은 채로) 같은 순서를 따른다. */
function onCancel(event: Event): void {
  if (escapeStep({ pinned: pinned.value !== null }).closeDialog) return
  event.preventDefault()
  pinned.value = null
}
</script>

<template>
  <AppDialog
    fill
    persistent
    focus-panel
    :close-label="t('common.dismiss')"
    :open="props.open"
    :title="t('flow.title')"
    @cancel="onCancel"
    @keydown="onKeydown"
    @close="emit('close')"
  >
    <FlowCanvas v-model:pinned="pinned" :file="props.file" :counts="counts" :bars="bars" />
  </AppDialog>
</template>
