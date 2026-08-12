<script setup lang="ts">
/**
 * 학습 화면 머리의 문맥 — **표의 것.**
 *
 * **여기 있어야 하는 이유는 "타깃"과 "특성 n개"가 표에만 있는 말이기 때문이다**
 * (architecture.md §9.3.2). 학습 화면은 데이터 종류를 가리지 않고 뜨는데 머리에는
 * 열 이야기가 박혀 있었고, 그건 타입이 못 잡는 자리였다 — 이미지에는 타깃 열이 없고
 * 특성을 학생이 고르지도 않는다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import { summarizeColumns } from '@/data/columns'
import { columnPlan } from '@/ml/selection'
import { readDataset } from '@/project/dataset'
import { tabularDataOf } from '@/project/schema'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const data = computed(() => tabularDataOf(project.file?.document))
const dataset = computed(() => readDataset(project.file))

/** 지금 설정으로 학습에 들어갈 특성 수. 0이면 전처리로 돌아가야 한다. */
const usableFeatures = computed(() => {
  const table = dataset.value
  const current = data.value
  if (!table || !current) return 0
  return columnPlan({
    columns: summarizeColumns(table),
    rowCount: table.rows.length,
    taskType: project.taskType,
    target: current.target,
    features: current.features,
    preprocessing: current.preprocessing,
  }).usableFeatures
})
</script>

<template>
  <div class="flex items-baseline gap-1.5">
    <dt>
      <AppBadge>{{ t('meta.tabular.target') }}</AppBadge>
    </dt>
    <dd class="max-w-48 truncate font-bold text-ink">
      {{ data?.target ?? t('meta.none') }}
    </dd>
  </div>
  <div class="flex items-baseline gap-1.5">
    <dt>
      <AppBadge>{{ t('meta.tabular.features') }}</AppBadge>
    </dt>
    <dd class="font-bold tabular-nums text-ink">{{ t('meta.countUnit', usableFeatures) }}</dd>
  </div>
</template>
