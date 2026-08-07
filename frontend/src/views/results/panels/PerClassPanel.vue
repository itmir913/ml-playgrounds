<script setup lang="ts">
/**
 * 값 종류별 점수. **분류 전용이라는 사실은 등록부에 있다** (`ml/metric-panels.ts`).
 *
 * 혼동 행렬과 나란히 서지만 서로를 모른다. 하나가 빠진 파일이 실제로 있으므로
 * (mlpx-spec.md §4.2) 둘을 한 컴포넌트에 묶으면 한쪽이 없을 때 나머지도 못 그린다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { isWeakestPerClass, weakestPerClass } from '@/ml/results'
import type { Run } from '@/project/schema'

const props = defineProps<{ run: Run }>()

const { t } = useI18n()
const format = useFormat()

const weakest = computed(() => weakestPerClass(props.run.perClass ?? []))
</script>

<template>
  <section v-if="props.run.perClass" class="flex flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.perClass') }}</h4>

    <AppTable>
      <thead>
        <tr>
          <th>{{ t('results.label') }}</th>
          <th>{{ t('metrics.precision') }}</th>
          <th>{{ t('metrics.recall') }}</th>
          <th>{{ t('metrics.f1') }}</th>
          <th>{{ t('results.support') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in props.run.perClass" :key="entry.label">
          <th class="text-left">{{ entry.label }}</th>
          <!--
            **가장 약한 값 종류를 지표마다 캐션 색으로 짚는다.** 혼동 행렬의
            대각선(맞힌 칸, `bg-positive-soft`)과 반대 방향이다 — 저기는 "옳다"를
            말하고 여기는 "여기를 다시 보라"를 말하므로 색을 다르게 둔다.
          -->
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'precision')
                ? 'bg-caution-soft font-bold'
                : ''
            "
          >
            {{ format.percent(entry.precision) }}
          </td>
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'recall') ? 'bg-caution-soft font-bold' : ''
            "
          >
            {{ format.percent(entry.recall) }}
          </td>
          <td
            :class="
              isWeakestPerClass(weakest, entry.label, 'f1') ? 'bg-caution-soft font-bold' : ''
            "
          >
            {{ format.percent(entry.f1) }}
          </td>
          <td>{{ entry.support }}</td>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
