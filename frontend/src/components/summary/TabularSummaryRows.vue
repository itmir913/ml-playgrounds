<script setup lang="ts">
/**
 * 프로젝트 요약에서 **표만 답할 수 있는 줄들** — 파일 이름·행·열·타깃·특성.
 *
 * **요약 화면이 이걸 알면 안 된다** (architecture.md §9.3.2). 이미지 프로젝트에서
 * `타깃: 없음 · 특성: 0개`가 그대로 떴고, 그건 **없는 것이 아니라 애초에 그 종류에
 * 없는 항목**이다 — 화면은 "아직 안 골랐다"로 읽히게 말하고 있었다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { readDataset } from '@/project/dataset'
import { tabularDataOf } from '@/project/schema'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

/**
 * 표의 크기는 **정본 CSV를 파싱해서 센다.** 저장해 둔 숫자가 아니라 실제 바이트에서
 * 세는 이유는, 파일을 손으로 고친 남의 프로젝트에서도 맞아야 하기 때문이다.
 */
const dataset = computed(() => {
  const file = project.file
  const table = readDataset(file)
  const reference = file === null ? undefined : tabularDataOf(file.document)?.dataset
  if (table === null || reference === undefined) return null
  return {
    fileName: reference.originalFileName,
    rows: table.rows.length,
    columns: table.columns.length,
  }
})

const data = computed(() => tabularDataOf(project.file?.document))
</script>

<template>
  <div class="flex justify-between gap-4">
    <dt class="shrink-0 font-bold text-ink-soft">{{ t('meta.tabular.dataset') }}</dt>
    <dd class="truncate">{{ dataset?.fileName ?? t('meta.none') }}</dd>
  </div>

  <div v-if="dataset" class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.tabular.rows') }}</dt>
    <dd class="tabular-nums">{{ dataset.rows }}</dd>
  </div>

  <div v-if="dataset" class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.tabular.columns') }}</dt>
    <dd class="tabular-nums">{{ dataset.columns }}</dd>
  </div>

  <div class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.tabular.target') }}</dt>
    <dd class="truncate">{{ data?.target ?? t('meta.none') }}</dd>
  </div>

  <div class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.tabular.features') }}</dt>
    <dd class="tabular-nums">{{ t('meta.countUnit', data?.features.length ?? 0) }}</dd>
  </div>
</template>
