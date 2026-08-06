<script setup lang="ts">
/**
 * 열 검사기. 열마다 자료형·결측 수·값 종류·예시를 늘어놓는다.
 *
 * **넓은 화면에서는 표 옆에 서고 좁은 화면에서는 표 아래에 접힌다** (architecture.md §8.9).
 * 그래서 자리를 스스로 정하지 않는다 — 바깥이 준 만큼 채우고, 넘치면 **자기 안에서**
 * 스크롤한다. 여기서 높이를 박으면 두 자리 중 한쪽에서 반드시 틀린다.
 *
 * **`h-full`이 아니라 `min-h-0 flex-1`로 받는다** (§8.14). `h-full`은 부모가 얼마나
 * 작든 그만큼 따라 줄어들어 머리만 남는다.
 *
 * 판단은 하나도 안 한다. `data/columns.ts`가 요약한 것을 그리기만 한다.
 */

import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import type { ColumnSummary } from '@/data/columns'

const props = defineProps<{ columns: readonly ColumnSummary[] }>()

const { t } = useI18n()
</script>

<template>
  <AppTable class="min-h-0 flex-1">
    <thead class="sticky top-0 z-10">
      <tr>
        <th>{{ t('data.columnName') }}</th>
        <th>{{ t('data.kind') }}</th>
        <th>{{ t('data.missing') }}</th>
        <th>{{ t('data.unique') }}</th>
        <th>{{ t('data.samples') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="column in props.columns" :key="column.name">
        <td class="font-bold">{{ column.name }}</td>
        <td>{{ t(`columnKind.${column.kind}`) }}</td>
        <td>{{ column.missing }}</td>
        <td>{{ column.unique }}</td>
        <td class="text-ink-soft">{{ column.samples.join(', ') }}</td>
      </tr>
    </tbody>
  </AppTable>
</template>
