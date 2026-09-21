<script setup lang="ts">
/**
 * 막대그래프 — 범주 열의 도수 (Orange3의 `Bar Plot` · `Distributions`).
 *
 * **히스토그램과 다른 그림이다** (`terms.md`). 가로축이 이어진 수가 아니라 서로 다른
 * 값들이고, 그래서 막대 사이가 벌어져 있다 — 학생이 그 차이를 그림의 모양에서 배운다.
 *
 * 계산은 `data/stats.ts`, 설정은 `data/chart-config.ts`다.
 */

import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js'
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import ChartFrame from './ChartFrame.vue'
import { barData, barOptions } from '@/data/chart-config'
import type { ChartInput } from '@/data/charts'
import { columnCells, frequencies } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { CATEGORY_BAR_LIMIT } from '@/limits'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const paint = useChartTokens()

const tally = computed(() =>
  frequencies(columnCells(props.input.dataset, props.input.column), CATEGORY_BAR_LIMIT),
)

const data = computed(() => barData(tally.value, paint.value, t('data.charts.bar.series')))

const options = computed(() =>
  barOptions(paint.value, {
    x: props.input.column,
    y: t('data.charts.axisCount'),
    point: (label, count) => t('data.charts.bar.point', { value: label, count }),
  }),
)

/**
 * 밀려난 값이 있으면 말한다. **값 종류 수까지 함께 말한다** — "서른 개만 그렸다"는
 * 몇 개 중 서른인지를 알기 전에는 아무것도 안 알려준다.
 */
const note = computed(() =>
  tally.value.omitted > 0
    ? t('data.charts.bar.omitted', {
        shown: tally.value.bars.length,
        distinct: tally.value.distinct,
        rows: tally.value.omitted,
      })
    : '',
)
</script>

<template>
  <ChartFrame
    :empty="tally.bars.length === 0 ? t('data.charts.noValues') : ''"
    :missing="tally.missing"
    :note="note"
  >
    <Bar :data="data" :options="options" />
  </ChartFrame>
</template>
