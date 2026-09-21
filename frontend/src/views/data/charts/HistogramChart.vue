<script setup lang="ts">
/**
 * 히스토그램 — 수치 열의 분포 (Orange3의 `Distributions`).
 *
 * **계산은 하나도 없다.** 구간 나누기는 `data/stats.ts`, Chart.js 설정은
 * `data/chart-config.ts`이고 여기는 그것을 캔버스에 얹는 일만 한다
 * (`architecture.md` §8.9.1).
 *
 * **Chart.js 등록이 여기 있다.** 이 부품이 지연 로딩되므로(`data/charts.ts`) 시각화를
 * 안 여는 학생은 차트 라이브러리를 안 받는다.
 */

import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js'
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import ChartFrame from './ChartFrame.vue'
import { barOptions, binLabels, histogramData } from '@/data/chart-config'
import type { ChartInput } from '@/data/charts'
import { columnCells, histogram, numericValues } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { HISTOGRAM_BIN_LIMIT } from '@/limits'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

const read = computed(() => numericValues(columnCells(props.input.dataset, props.input.column)))
const made = computed(() => histogram(read.value.values, HISTOGRAM_BIN_LIMIT))
const labels = computed(() => binLabels(made.value.edges, (value) => format.stat(value)))

const data = computed(() =>
  histogramData(made.value, labels.value, paint.value, t('data.charts.histogram.series')),
)

const options = computed(() =>
  barOptions(paint.value, {
    x: props.input.column,
    y: t('data.charts.axisCount'),
    point: (label, count) => t('data.charts.histogram.point', { range: label, count }),
  }),
)
</script>

<template>
  <!--
    **그릴 값이 하나도 없으면 그림 대신 이유를 말한다** (§9.2). 열 전체가 빈 칸인
    표가 실제로 있고, 그때 빈 격자만 뜨면 학생은 앱이 고장 난 줄 안다.
  -->
  <ChartFrame
    :empty="made.counts.length === 0 ? t('data.charts.noValues') : ''"
    :missing="read.missing"
    :note="made.capped ? t('data.charts.histogram.capped', { count: made.counts.length }) : ''"
  >
    <Bar :data="data" :options="options" />
  </ChartFrame>
</template>
