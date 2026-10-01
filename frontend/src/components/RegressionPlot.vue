<script setup lang="ts">
/**
 * 회귀 그림 하나 — 실제 vs 예측, 잔차 vs 예측, 또는 회귀선 (`open-decisions.md` "97. 학습한 회귀
 * 모델을 그림으로 보일 것인가").
 *
 * **점은 거른다** (결정 94, `data/scatter-thin.ts`). 그림 영역의 픽셀로 거르므로 크기가 서기 전에는
 * 안 그린다(`useElementSize`). 기준선(대각선·0선·모델의 선)은 점 위에 긋는다 — 점이 몰린 자리에서도
 * 선이 보여야 그림을 읽는다.
 *
 * **계산은 없다.** 점과 선은 `ml/regression-fit.ts`의 `regressionPlot`이 만든다.
 */

import { Chart, LinearScale, LineElement, PointElement, ScatterController, Tooltip } from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import { useChartTokens } from '@/composables/useChartTokens'
import { useElementSize } from '@/composables/useElementSize'
import { useFormat } from '@/composables/useFormat'
import { scatterLayers, scatterOptions, type ScatterDot } from '@/data/chart-config'
import type { AxisCell } from '@/data/category-axis'
import { REGRESSION_SCATTER_POINT_LIMIT } from '@/limits'
import type { RegressionPlot } from '@/ml/regression-fit'

// 기준선(`showLine`)은 선 요소로 그린다 — 등록이 없으면 `"line" is not a registered element`로
// 그림이 안 선다. jsdom은 캔버스를 못 그려 검사가 못 본다(사람 확인, 브라우저).
Chart.register(ScatterController, PointElement, LineElement, LinearScale, Tooltip)

const props = defineProps<{
  plot: RegressionPlot
  title: string
  axisX: string
  axisY: string
  /** 기준선의 이름. 범례는 안 서지만 화면 낭독기와 데이터셋 이름에 쓰인다. */
  reference: string
}>()

const emit = defineEmits<{
  /** 붐빈 칸을 묶었는가. 패널이 그림 셋을 모아 한 줄로 말한다. */
  merged: [value: boolean]
}>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

const areaEl = ref<HTMLElement | null>(null)
const area = useElementSize(areaEl)

const layers = computed(() =>
  scatterLayers(
    [{ name: t('results.regression.series'), points: props.plot.points }],
    paint.value,
    area.value,
    REGRESSION_SCATTER_POINT_LIMIT,
  ),
)

watch(
  () => layers.value.merged || layers.value.widened,
  (value) => emit('merged', value),
  { immediate: true },
)

/** 기준선. **배열 앞에 둔다** — Chart.js는 앞의 데이터셋을 위에 그린다(`ml/cluster-chart.ts`의 `DRAW_ORDER`). */
const data = computed(() => {
  const line: ScatterDot[] = props.plot.reference.map((point) => ({ ...point, rows: 1 }))
  return {
    datasets: [
      {
        label: props.reference,
        data: line,
        showLine: true,
        borderColor: paint.value.ink,
        backgroundColor: paint.value.ink,
        borderWidth: 2,
        pointRadius: 0,
        // 선의 점은 가리켜도 안 잡힌다 — 툴팁은 데이터 점의 것이다.
        pointHitRadius: 0,
        pointHoverRadius: 0,
      },
      ...layers.value.data.datasets,
    ],
  }
})

function coordinate(cell: AxisCell): string {
  return cell.kind === 'number' ? format.prediction(cell.value) : t('meta.none')
}

const options = computed(() =>
  scatterOptions(
    paint.value,
    {
      x: props.axisX,
      y: props.axisY,
      point: (name, x, y) =>
        t('data.charts.scatter.point', { name, x: coordinate(x), y: coordinate(y) }),
      pointMany: (name, x, y, rows) =>
        t('data.charts.scatter.pointMany', {
          count: rows,
          name,
          x: coordinate(x),
          y: coordinate(y),
        }),
    },
    false,
  ),
)
</script>

<template>
  <figure class="flex min-w-0 flex-col gap-1.5">
    <figcaption class="font-bold">{{ props.title }}</figcaption>
    <!-- **크기가 선 뒤에 그린다** — 0×0으로 거르면 모든 점이 한 칸에 모인다. -->
    <div ref="areaEl" class="h-72 min-w-0">
      <Scatter v-if="area.width > 0 && area.height > 0" :data="data" :options="options" />
    </div>
  </figure>
</template>
