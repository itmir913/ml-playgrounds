<script setup lang="ts">
/**
 * 결정 경계 (`open-decisions.md` "69. 훈련 데이터가 2·3차원일 때 결과를 그림으로 보일 것인가").
 *
 * scikit-learn `DecisionBoundaryDisplay`와 같은 그림이다 — 배경은 그 자리의 값을 넣으면 모델이 고를
 * 범주(옅은 색), 점은 테스트 데이터의 실제 범주(진한 색). **입력 열이 수치 정확히 둘일 때만** 선다 —
 * 그 판단과 계산은 `ml/decision-boundary.ts`가 한다. 모델이 저장된 혼동 행렬을 다시 내지 않으면 그림 대신
 * 그 사실을 말한다.
 *
 * **배경은 인라인 플러그인이 그린다.** Chart.js 코어에 히트맵이 없어 격자를 작은 이미지로 만들어 그림
 * 영역에 늘려 깐다(박스 플롯의 `boxWhiskers`와 같은 선례). 플러그인은 **그릴 때 지금 값을 읽는다** —
 * `vue-chartjs`는 `plugins`가 바뀌어도 차트를 다시 만들지 않는다(`BoxChart.vue`의 머리말).
 */

import {
  Chart,
  Legend,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
  type Plugin,
} from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useChartTokens } from '@/composables/useChartTokens'
import { useElementSize } from '@/composables/useElementSize'
import { useFormat } from '@/composables/useFormat'
import { useStepWork } from '@/composables/useStepWork'
import {
  colorsAreDistinct,
  scatterLayers,
  scatterOptions,
  seriesSoftColor,
} from '@/data/chart-config'
import type { AxisCell } from '@/data/category-axis'
import { RESULT_SCATTER_POINT_LIMIT } from '@/limits'
import { decisionBoundaryAvailable, decisionBoundaryFor } from '@/ml/decision-boundary'
import type { PanelInput } from '@/ml/metric-panels'
import { readTestDataset } from '@/project/dataset'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend)

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
const available = computed(() => decisionBoundaryAvailable(material.value))

/**
 * **[계산]을 눌러야 계산한다** (69의 감사 뒤) — 격자 1만 점을 다시 예측하므로 KNN 큰 데이터에서 화면을 여는
 * 순간 멈췄다. 나눠 예측하며 화면에 양보한다(`composables/useStepWork.ts`).
 */
const work = useStepWork((control) => decisionBoundaryFor(material.value, control))
// 보이는 실행이 바뀌면 그 전 실행의 그림을 버린다.
watch(material, work.reset)
const result = work.result
const boundary = computed(() => (result.value?.kind === 'boundary' ? result.value.boundary : null))

const areaEl = ref<HTMLElement | null>(null)
const area = useElementSize(areaEl)

/** 범주마다 갈래 하나. **혼동 행렬의 차례 그대로다** — 배경의 색이 같은 차례를 쓴다. */
const layers = computed(() => {
  const found = boundary.value
  if (!found) return null
  const series = found.labels.map((name, label) => ({
    name,
    points: found.points.filter((point) => point.label === label),
  }))
  return scatterLayers(series, paint.value, area.value, RESULT_SCATTER_POINT_LIMIT)
})

/** 격자를 한 칸이 한 픽셀인 이미지로 굽는다. 그릴 때 그림 영역에 늘려 깐다. */
const image = computed(() => {
  const found = boundary.value
  if (!found || typeof document === 'undefined') return null
  const width = found.xs.length
  const height = found.ys.length
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = context.createImageData(width, height)
  const rgb = found.labels.map((_name, label) => rgbOf(seriesSoftColor(paint.value, label)))
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const color = rgb[found.classes[j * width + i] ?? -1]
      if (!color) continue
      // 이미지는 위에서 아래로, 격자의 세로는 아래에서 위로 오른다.
      const at = ((height - 1 - j) * width + i) * 4
      pixels.data[at] = color[0]
      pixels.data[at + 1] = color[1]
      pixels.data[at + 2] = color[2]
      pixels.data[at + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  return canvas
})

function rgbOf(color: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return null
  return [
    parseInt(match[1] ?? '0', 16),
    parseInt(match[2] ?? '0', 16),
    parseInt(match[3] ?? '0', 16),
  ]
}

/** 배경. 점보다 먼저 깐다. 칸의 가운데가 격자 좌표이므로 반 칸씩 바깥까지 덮는다. */
const background: Plugin<'scatter'> = {
  id: 'decisionBoundary',
  beforeDatasetsDraw(chart) {
    const found = boundary.value
    const baked = image.value
    if (!found || !baked) return
    const { ctx, scales } = chart
    const x = scales['x']
    const y = scales['y']
    if (!x || !y) return
    const half = (values: readonly number[]) =>
      values.length > 1 ? ((values.at(-1) ?? 0) - (values[0] ?? 0)) / (values.length - 1) / 2 : 0
    const left = x.getPixelForValue((found.xs[0] ?? 0) - half(found.xs))
    const right = x.getPixelForValue((found.xs.at(-1) ?? 0) + half(found.xs))
    const top = y.getPixelForValue((found.ys.at(-1) ?? 0) + half(found.ys))
    const bottom = y.getPixelForValue((found.ys[0] ?? 0) - half(found.ys))
    ctx.save()
    ctx.beginPath()
    ctx.rect(
      chart.chartArea.left,
      chart.chartArea.top,
      chart.chartArea.width,
      chart.chartArea.height,
    )
    ctx.clip()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(baked, left, top, right - left, bottom - top)
    ctx.restore()
  },
}
const plugins = [background]

function coordinate(cell: AxisCell): string {
  return cell.kind === 'number' ? format.prediction(cell.value) : t('meta.none')
}

const options = computed(() => {
  const found = boundary.value
  const base = scatterOptions(
    paint.value,
    {
      x: found?.features[0] ?? '',
      y: found?.features[1] ?? '',
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
    // 색이 겹치면 범례가 없는 대응을 주장한다(결정 47).
    colorsAreDistinct(found?.labels.length ?? 0),
  )
  if (!found) return base
  // **축을 격자에 맞춘다** — 안 그러면 Chart.js가 눈금을 둥글게 넓혀 배경 밖의 빈 띠가 생긴다.
  const scales = base.scales ?? {}
  return {
    ...base,
    scales: {
      ...scales,
      // **끝 눈금은 안 세운다** — 축 끝이 격자의 끝이라 `81.10` 같은 값이 둥근 눈금 사이에 끼었다(사람 확인).
      x: {
        ...scales['x'],
        min: found.xs[0],
        max: found.xs.at(-1),
        ticks: { ...scales['x']?.ticks, includeBounds: false },
      },
      y: {
        ...scales['y'],
        min: found.ys[0],
        max: found.ys.at(-1),
        ticks: { ...scales['y']?.ticks, includeBounds: false },
      },
    },
  }
})
</script>

<template>
  <section v-if="available" class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.boundary.title') }}</h4>
    <p class="text-ink-soft">{{ t('results.boundary.lead') }}</p>

    <div v-if="result === undefined">
      <AppButton variant="secondary" :action="work.start">
        {{ t('results.replay.start') }}
        <template #pending>{{ t('results.replay.computing') }}</template>
      </AppButton>
    </div>

    <p v-else-if="result === null" class="text-ink-soft">{{ t('results.replay.failed') }}</p>

    <p v-else-if="result.kind === 'mismatch'" class="text-ink-soft">
      {{ t('results.boundary.mismatch') }}
    </p>

    <template v-else-if="boundary && layers">
      <!-- **크기가 선 뒤에 그린다** — 0×0으로 거르면 모든 점이 한 칸에 모인다. -->
      <div ref="areaEl" class="h-96 min-w-0">
        <Scatter
          v-if="area.width > 0 && area.height > 0"
          :data="layers.data"
          :options="options"
          :plugins="plugins"
        />
      </div>
      <p class="text-ink-faint">
        {{ t('results.boundary.rows', { count: boundary.points.length }) }}
        <template v-if="layers.merged"> {{ t('data.charts.scatter.merged') }}</template>
      </p>
    </template>
  </section>
</template>
