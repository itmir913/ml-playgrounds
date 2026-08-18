<script setup lang="ts">
/**
 * 실험 목록. **이 세로줄이 곧 변경 이력이다** (architecture.md §8.13).
 *
 * 최신이 위다. 줄마다 몇 번째 학습인지 · 언제인지 · 직전에서 무엇이 바뀌었는지 ·
 * **대표 점수 하나**를 둔다.
 *
 * **숫자를 하나로 제한하는 것이 규칙이다.** 여기에 지표를 여럿 늘어놓으면 그 순간
 * 순위표가 되고, 이 화면이 하려는 일은 그 반대다. 어느 모델이 그 점수를 냈는지는
 * 오른쪽에서 본다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormat } from '@/composables/useFormat'
import { experimentOrder, headlineOf } from '@/ml/results'
import type { Experiment } from '@/project/schema'

const props = defineProps<{
  /** 파일에 든 순서 그대로. 뒤집는 것은 여기서 한다. */
  experiments: readonly Experiment[]
  selected: string | null
}>()

const emit = defineEmits<{ pick: [id: string] }>()

const { t } = useI18n()
const format = useFormat()

/**
 * 최신이 위. **번호는 파일 순서에서 오므로 뒤집기 전에 매긴다** — 목록을 뒤집었다고
 * 첫 학습이 마지막 번호가 되면 안 된다.
 */
const rows = computed(() => {
  const order = experimentOrder(props.experiments)
  return props.experiments
    .map((experiment) => ({
      experiment,
      index: order.get(experiment.id) ?? 0,
      headline: headlineOf(experiment),
    }))
    .reverse()
})
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <h3 class="font-bold text-ink-soft">{{ t('results.experimentTitle') }}</h3>
    <ul class="flex flex-col gap-2">
      <li v-for="row in rows" :key="row.experiment.id">
        <!--
          **줄 전체가 누를 자리다.** 학생이 노리는 것은 줄이지 그 안의 글자가 아니다.
          테두리는 늘 있고 색만 바뀐다 — 고른 줄에만 테두리를 주면 목록이 한 픽셀씩 움직인다.
        -->
        <button
          type="button"
          class="flex w-full flex-col gap-1 rounded-panel border p-3 text-left transition-colors"
          :class="
            props.selected === row.experiment.id
              ? 'border-brand bg-brand-soft'
              : 'border-line bg-surface hover:bg-surface-sunken'
          "
          :aria-pressed="props.selected === row.experiment.id"
          @click="emit('pick', row.experiment.id)"
        >
          <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="font-bold">{{ t('results.experimentName', { index: row.index }) }}</span>
            <span class="text-ink-faint">{{ format.dateTime(row.experiment.startedAt) }}</span>
          </span>

          <!--
            **점수가 없는 실험도 있다** — 모델이 전부 실패한 경우다. 그때 0을 보이면
            정확도 0%로 학습된 것처럼 읽히므로 아예 숫자를 안 낸다.
          -->
          <span v-if="row.headline" class="flex items-baseline gap-2">
            <span class="text-ink-soft">{{ t(`metrics.${row.headline.display.name}`) }}</span>
            <span class="font-bold tabular-nums">
              {{ format.metric(row.headline.value, row.headline.display.format) }}
            </span>
          </span>
          <span v-else class="text-ink-faint">{{ t('results.noSuccess') }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
