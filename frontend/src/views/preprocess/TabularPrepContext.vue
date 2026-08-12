<script setup lang="ts">
/**
 * 전처리 화면 머리의 문맥 — **표의 것.**
 *
 * **여기 있어야 하는 이유는 "열 수"가 표에만 있는 말이기 때문이다** (architecture.md
 * §9.3.2). 전처리 화면은 데이터 종류를 모르는 화면인데 머리에는 행 수와 열 수가 박혀
 * 있었고, 그건 타입이 못 잡는 자리였다 — 이미지에는 열이 없다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import { readDataset } from '@/project/dataset'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

/** 정본을 파싱한 표. 바이트가 같으면 다시 파싱하지 않는다 (project/dataset.ts). */
const dataset = computed(() => readDataset(project.file))
</script>

<template>
  <template v-if="dataset">
    <div class="flex items-baseline gap-1.5">
      <dt>
        <AppBadge>{{ t('data.tabular.rows') }}</AppBadge>
      </dt>
      <dd class="font-bold tabular-nums text-ink">{{ dataset.rows.length }}</dd>
    </div>
    <div class="flex items-baseline gap-1.5">
      <dt>
        <AppBadge>{{ t('data.tabular.columns') }}</AppBadge>
      </dt>
      <dd class="font-bold tabular-nums text-ink">{{ dataset.columns.length }}</dd>
    </div>
  </template>
</template>
