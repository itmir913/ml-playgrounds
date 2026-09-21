<script setup lang="ts">
/**
 * 손실 곡선 — **학습이 지나간 길** (`open-decisions.md` "인공신경망을 넣는다").
 *
 * **계산은 없다.** 곡선을 꺼내는 것은 `ml/loss-curve.ts`이고 여기는 그것을 캔버스에
 * 얹는 일만 한다 (§8.3).
 *
 * **Chart.js 등록이 여기 있다.** 이 패널이 지연 로딩이라(`ml/metric-panels.ts`) 신경망을
 * 안 돌린 학생은 차트 라이브러리를 받지 않는다 — `ClusterScatter.vue`와 같은 이유다.
 */

import {
  CategoryScale,
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js'
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { LOSS_CURVE_TICK_COUNT } from '@/limits'
import { lossCurveOf, lossDescended } from '@/ml/loss-curve'
import type { PanelInput } from '@/ml/metric-panels'

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip)

const props = defineProps<{ input: PanelInput }>()

const { t } = useI18n()
const format = useFormat()

const points = computed(() => lossCurveOf(props.input.run.model?.format, props.input.modelBytes))

/**
 * 배색 토큰의 실제 값. **캔버스는 CSS 클래스를 못 쓴다** — 읽는 자리는 컴포저블
 * 하나이고, 배색이 바뀌면 다시 읽는 것도 거기서 한다 (2026-09-22에 합쳤다).
 */
const paint = useChartTokens()

const chartData = computed(() => ({
  labels: (points.value ?? []).map((point) => String(point.epoch)),
  datasets: [
    {
      label: t('results.lossCurveAxis'),
      data: (points.value ?? []).map((point) => point.loss),
      borderColor: paint.value.brand,
      backgroundColor: paint.value.brand,
      // **점을 안 찍는다.** 에폭이 200개라 점을 찍으면 선이 안 보인다.
      pointRadius: 0,
      borderWidth: 2,
      tension: 0,
    },
  ],
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  scales: {
    x: {
      title: { display: true, text: t('results.lossCurveEpoch'), color: paint.value.ink },
      ticks: { color: paint.value.ink, maxTicksLimit: LOSS_CURVE_TICK_COUNT },
      grid: { color: paint.value.line },
    },
    y: {
      title: { display: true, text: t('results.lossCurveAxis'), color: paint.value.ink },
      ticks: { color: paint.value.ink },
      grid: { color: paint.value.line },
    },
  },
  plugins: { legend: { display: false } },
}))

/** 마지막 에폭에서의 손실. **곡선이 어디에 도착했는지가 한 줄로 필요하다.** */
const finalLoss = computed(() => points.value?.[points.value.length - 1]?.loss)
const descended = computed(() => (points.value ? lossDescended(points.value) : false))
</script>

<template>
  <!--
    **곡선이 없으면 자리 자체가 없다** (§9.2). 모델이 파일에 안 담긴 실행이 그렇고,
    그 사유는 다른 자리가 말한다.
  -->
  <section v-if="points" class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.lossCurve') }}</h4>
    <p class="text-ink-soft">{{ t('results.lossCurveLead') }}</p>

    <!--
      **높이를 상자가 쥔다.** `maintainAspectRatio: false`인 차트는 부모의 높이를 그대로
      쓰고, 안 주면 캔버스가 0px로 접힌다.
    -->
    <div class="h-64 min-w-0">
      <Line :data="chartData" :options="chartOptions" />
    </div>

    <p class="text-ink-soft">
      {{
        descended
          ? t('results.lossCurveDescended', {
              epochs: points.length,
              loss: format.metric(finalLoss ?? 0, 'number'),
            })
          : t('results.lossCurveFlat', { epochs: points.length })
      }}
    </p>
  </section>
</template>
