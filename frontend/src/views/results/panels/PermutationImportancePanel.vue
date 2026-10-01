<script setup lang="ts">
/**
 * 순열 특성 중요도 (`open-decisions.md` "99. 모델이 어느 특성에 기댔는지 보일 것인가").
 *
 * 열마다 "섞었더니 점수가 얼마나 떨어졌나"의 평균을 가로 막대로, 평균이 큰 것부터 세운다. 표준편차는
 * Chart.js 코어에 오차 막대가 없어 툴팁이 말한다. 계산은 `ml/permutation-importance.ts`가 한다.
 * 다시 잰 기준 점수가 파일과 다르면 그림 대신 그 사실을 말한다.
 *
 * **[계산]을 눌러야 계산한다** (99의 감사 뒤) — 열 수 × 5번 다시 예측하므로 KNN 큰 데이터에서 화면을 여는
 * 순간 멈췄다. 단추가 몇 번째 측정인지 말한다.
 */

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  Tooltip,
  type ChartOptions,
} from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { useStepWork } from '@/composables/useStepWork'
import { PERMUTATION_REPEATS } from '@/limits'
import type { PanelInput } from '@/ml/metric-panels'
import {
  permutationImportanceAvailable,
  permutationImportanceFor,
  permutationSteps,
} from '@/ml/permutation-importance'
import { readTestDataset } from '@/project/dataset'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{ input: PanelInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

const material = computed(() => ({
  run: props.input.run,
  experiment: props.input.experiment,
  dataset: props.input.dataset,
  testDataset: readTestDataset(props.input.file),
  preprocessor: props.input.preprocessor,
  modelBytes: props.input.modelBytes,
}))
const available = computed(() => permutationImportanceAvailable(material.value))
const total = computed(() => permutationSteps(material.value))
const done = ref(0)

const work = useStepWork((control) => {
  done.value = 0
  return permutationImportanceFor(material.value, {
    ...control,
    onStep: (count) => {
      done.value = count
    },
  })
})
// 보이는 실행이 바뀌면 그 전 실행의 막대를 버린다.
watch(material, work.reset)

const result = work.result
const importance = computed(() =>
  result.value?.kind === 'importance' ? result.value.importance : null,
)

/** 점수의 단위. 정확도는 백분율, 결정계수는 수다(`ml/metrics.ts`의 `METRIC_DISPLAY`). */
const unit = computed(() => (importance.value?.metric === 'accuracy' ? 'percent' : 'number'))
const show = (value: number) => format.metric(value, unit.value)

const data = computed(() => ({
  labels: (importance.value?.weights ?? []).map((one) => one.feature),
  datasets: [
    {
      data: (importance.value?.weights ?? []).map((one) => one.mean),
      backgroundColor: paint.value.brand,
      borderWidth: 0,
    },
  ],
}))

const options = computed((): ChartOptions<'bar'> => ({
  indexAxis: 'y',
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  scales: {
    x: {
      title: {
        display: true,
        text:
          importance.value?.metric === 'accuracy'
            ? t('results.importance.axisAccuracy')
            : t('results.importance.axisR2'),
        color: paint.value.ink,
      },
      // 눈금도 점수와 같은 단위다 — 정확도면 백분율, 결정계수면 수다(아래 한 줄과 맞춘다).
      ticks: { color: paint.value.ink, callback: (value) => show(Number(value)) },
      grid: { color: paint.value.line },
      border: { color: paint.value.line },
    },
    y: {
      ticks: { color: paint.value.ink },
      grid: { display: false },
      border: { color: paint.value.line },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (item) => {
          const weight = importance.value?.weights[item.dataIndex]
          if (!weight) return ''
          return t('results.importance.point', {
            mean: show(weight.mean),
            std: show(weight.std),
            feature: weight.feature,
          })
        },
      },
    },
  },
}))
</script>

<template>
  <section v-if="available" class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.importance.title') }}</h4>
    <p class="text-ink-soft">
      {{ t('results.importance.lead', { count: PERMUTATION_REPEATS }) }}
    </p>

    <div v-if="result === undefined">
      <AppButton variant="secondary" :action="work.start">
        {{ t('results.replay.start') }}
        <template #pending>{{ t('results.replay.measuring', { done, total }) }}</template>
      </AppButton>
    </div>

    <p v-else-if="result === null" class="text-ink-soft">{{ t('results.replay.failed') }}</p>

    <p v-else-if="result.kind === 'mismatch'" class="text-ink-soft">
      {{ t('results.importance.mismatch') }}
    </p>

    <template v-else-if="importance">
      <div class="h-80 min-w-0">
        <Bar :data="data" :options="options" />
      </div>
      <p class="text-ink-faint">
        {{ t('results.importance.baseline', { score: show(importance.baseline) }) }}
      </p>
    </template>
  </section>
</template>
