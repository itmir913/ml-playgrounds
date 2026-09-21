<script setup lang="ts">
/**
 * 산점도 — 두 수치 열의 관계 (Orange3의 `Scatter Plot`).
 *
 * **군집 산점도(`ClusterScatter.vue`)와 다른 부품이다.** 저쪽은 모델이 매긴 군집 번호를
 * 그리고 축이 전처리된 행렬의 열이라, 흩뿌림·중심점·되돌리기가 전부 거기 있다.
 * 이쪽은 학생이 고른 **원본 두 열**이다 — 같은 부품에 담으면 계약이 둘 다 흐려진다.
 *
 * **둘째 축과 색 열을 묻는 것은 이 부품이다** (`architecture.md` §8.9.1).
 */

import { Chart, Legend, LinearScale, PointElement, ScatterController, Tooltip } from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import ChartFrame from './ChartFrame.vue'
import { scatterData, scatterOptions, scatterSeries } from '@/data/chart-config'
import {
  categoricalColumns,
  numericColumns,
  useChartControls,
  type ChartInput,
} from '@/data/charts'
import { columnCells, scatterSample } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { dataScatterPointLimit } from '@/limits-switch'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

/** 설정을 세울 자리. `BoxChart`와 같은 규칙이다. */
const controls = useChartControls()

/** 세로축이 될 열. **가로축은 학생이 검사기에서 고른 열이다.** */
const yColumn = ref('')
/** 점의 색을 가르는 범주 열. 빈 문자열이면 한 색이다. */
const colorBy = ref('')

/** 세로축 후보. **고른 열은 뺀다** — 자기 자신과의 산점도는 대각선일 뿐이다. */
const others = computed(() =>
  numericColumns(props.input.columns).filter((name) => name !== props.input.column),
)

const colorable = computed(() => categoricalColumns(props.input.columns))

/**
 * **고른 열이 바뀌면 세로축을 다시 고른다.** 첫 후보를 자동으로 세우는 이유는, 창을
 * 열자마자 그림이 보여야 하기 때문이다 — 빈 판을 띄우고 "세로축을 고르시오"라고 하면
 * 학생은 도구가 고장 난 줄 안다.
 *
 * **이전에 고른 열이 아직 후보에 있으면 지킨다.** 열을 옮겨 다니며 같은 세로축과
 * 견주는 것이 이 그림을 쓰는 방식이다.
 */
watch(
  others,
  (list) => {
    if (!list.includes(yColumn.value)) yColumn.value = list[0] ?? ''
  },
  { immediate: true },
)

watch(colorable, (list) => {
  if (colorBy.value !== '' && !list.includes(colorBy.value)) colorBy.value = ''
})

const sample = computed(() =>
  scatterSample(
    columnCells(props.input.dataset, props.input.column),
    columnCells(props.input.dataset, yColumn.value),
    dataScatterPointLimit(),
    props.input.randomState,
    colorBy.value === '' ? undefined : columnCells(props.input.dataset, colorBy.value),
  ),
)

/**
 * 갈래로 나눈 점.
 *
 * **색 열을 골랐을 때의 이름이 다르다.** 색 열의 값이 빈 칸인 행은 갈래 이름이 없는데,
 * 그때 `데이터`라는 이름으로 묶으면 `남`·`여` 옆에 **정체를 알 수 없는 세 번째 갈래**가
 * 선다 — 학생은 그것을 또 하나의 값으로 읽는다. 그 자리의 참말은 `없음`이다
 * (2026-09-21).
 */
const series = computed(() =>
  scatterSeries(
    sample.value.points,
    colorBy.value === '' ? t('data.charts.scatter.series') : t('meta.none'),
  ),
)

const data = computed(() => scatterData(series.value, paint.value))

const options = computed(() =>
  scatterOptions(
    paint.value,
    {
      x: props.input.column,
      y: yColumn.value,
      point: (name, x, y) =>
        t('data.charts.scatter.point', {
          name,
          x: x === null ? t('meta.none') : format.prediction(x),
          y: y === null ? t('meta.none') : format.prediction(y),
        }),
    },
    colorBy.value !== '',
  ),
)

/**
 * 그림 아래 한 줄. **표본을 뽑았으면 말하고, 못 찍은 행이 있으면 그것도 말한다.**
 *
 * 둘은 다른 사실이다 — 앞엣것은 우리가 줄인 것이고 뒤엣것은 데이터에 값이 없는 것이다.
 */
const note = computed(() => {
  const parts: string[] = []
  if (sample.value.drawn < sample.value.total) {
    parts.push(
      t('data.charts.scatter.sampled', {
        drawn: sample.value.drawn,
        total: sample.value.total,
      }),
    )
  }
  if (sample.value.skipped > 0) {
    parts.push(t('data.charts.scatter.skipped', { count: sample.value.skipped }))
  }
  return parts.join(' · ')
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <!-- **설정은 창이 내준 자리로 보낸다** (§8.9.1). `BoxChart`와 같은 규칙이다. -->
    <Teleport :to="controls" :disabled="controls === null">
      <label class="flex min-w-0 flex-col gap-1.5">
        <span class="font-bold text-ink-soft">{{ t('data.charts.scatter.yAxis') }}</span>
        <select
          v-model="yColumn"
          class="w-full min-w-0 rounded-field border border-line-strong bg-surface px-2 py-1.5"
        >
          <option v-for="name in others" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>

      <label v-if="colorable.length > 0" class="flex min-w-0 flex-col gap-1.5">
        <span class="font-bold text-ink-soft">{{ t('data.charts.scatter.colorBy') }}</span>
        <select
          v-model="colorBy"
          class="w-full min-w-0 rounded-field border border-line-strong bg-surface px-2 py-1.5"
        >
          <option value="">{{ t('data.charts.scatter.colorNone') }}</option>
          <option v-for="name in colorable" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
    </Teleport>

    <ChartFrame
      :empty="sample.drawn === 0 ? t('data.charts.noValues') : ''"
      :missing="0"
      :note="note"
    >
      <Scatter :data="data" :options="options" />
    </ChartFrame>
  </div>
</template>
