<script setup lang="ts">
/**
 * 상자 그림 — 수치 열의 다섯 수와 이상치 (Orange3의 `Box Plot`).
 *
 * **범주 열로 갈라 볼 수 있다.** Orange3의 Box Plot이 `Subgroups`로 하는 일이고,
 * 이 그림의 값어치가 대부분 거기 있다 — 상자 하나는 평균과 결측 수가 이미 말한 것을
 * 다시 말하지만, *"남녀별 키"*는 열 검사기가 못 하는 말이다.
 *
 * **둘째 열을 묻는 것은 이 부품이다. 창이 아니다** (`architecture.md` §8.9.1) —
 * 화면이 *"이 도구는 열이 둘이다"*를 아는 순간 §9.1이 막으려던 분기가 거기 생긴다.
 *
 * **상자만 Chart.js가 그린다.** 수염·중앙값·이상치는 `boxWhiskers` 플러그인이 그린다
 * (`data/chart-config.ts`) — 상자 그림 하나 때문에 플러그인을 받지 않기로 한 자리다.
 */

import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import ChartFrame from './ChartFrame.vue'
import { boxData, boxOptions, boxWhiskers, type BoxSeries } from '@/data/chart-config'
import { categoricalColumns, type ChartInput } from '@/data/charts'
import { boxSummary, columnCells, frequencies, numericValues } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { CATEGORY_BAR_LIMIT } from '@/limits'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

/** 갈라 볼 범주 열. 빈 문자열이면 안 가른다. */
const groupBy = ref('')

const groupable = computed(() => categoricalColumns(props.input.columns))

/**
 * **고른 열이 바뀌면 가르기를 푼다.** 안 풀면 다른 열로 옮겼을 때 이전 열에서 고른
 * 가르기가 그대로 남고, 그 열이 표에서 사라진 경우에는 **상자가 하나도 없는 그림**이 된다.
 */
watch(
  () => props.input.column,
  () => {
    groupBy.value = ''
  },
)

const read = computed(() => numericValues(columnCells(props.input.dataset, props.input.column)))

/**
 * 그릴 상자들.
 *
 * **가르는 값도 도수가 큰 것부터 남긴다** (`frequencies`). 값 종류가 수백인 열로 가르면
 * 상자가 수백 개 서서 아무것도 안 읽힌다.
 */
const split = computed<{ series: readonly BoxSeries[]; ungrouped: number }>(() => {
  if (groupBy.value === '') {
    const summary = boxSummary(read.value.values)
    return { series: summary ? [{ name: props.input.column, summary }] : [], ungrouped: 0 }
  }

  const cells = columnCells(props.input.dataset, props.input.column)
  const groups = columnCells(props.input.dataset, groupBy.value)
  const tally = frequencies(groups, CATEGORY_BAR_LIMIT)

  const series = tally.bars.flatMap((bar) => {
    const picked: string[] = []
    for (let row = 0; row < cells.length; row += 1) {
      if (groups[row] === bar.value) picked.push(cells[row] ?? '')
    }
    const summary = boxSummary(numericValues(picked).values)
    return summary ? [{ name: bar.value, summary }] : []
  })

  /**
   * **어느 상자에도 안 들어간 행.** 가르는 열이 빈 칸인 행과, 값 종류가 너무 많아
   * 밀려난 행이다.
   *
   * **둘을 합쳐 세는 이유는 학생에게 같은 사실이기 때문이다** — *"이만큼은 그림에
   * 없다"*. 안 세면 성별이 비어 있는 학생들이 어느 상자에도 없이 **조용히 사라진다**
   * (2026-09-21).
   */
  return { series, ungrouped: tally.missing + tally.omitted }
})

const series = computed(() => split.value.series)

const data = computed(() => boxData(series.value, paint.value))

const options = computed(() =>
  boxOptions(paint.value, {
    x: groupBy.value === '' ? '' : groupBy.value,
    y: props.input.column,
    point: (name) => {
      const found = series.value.find((one) => one.name === name)?.summary
      if (!found) return name
      /**
       * **다섯 수는 수염 끝이 아니라 실제 최솟값·최댓값이다** (2026-09-21).
       *
       * 처음에는 수염 끝을 넘겼는데, **이상치가 있으면 그것은 최솟값이 아니다** —
       * 문구는 `최솟값`이라 적혀 있고 학생은 그 수를 자기 데이터의 가장 작은 값으로
       * 읽는다. 수염이 어디서 멈추는지는 **그림이 이미 보여 주고 있다.**
       */
      return t('data.charts.box.point', {
        min: format.stat(found.min),
        q1: format.stat(found.q1),
        median: format.stat(found.median),
        q3: format.stat(found.q3),
        max: format.stat(found.max),
      })
    },
  }),
)

/** 수염·중앙값·이상치를 그리는 플러그인. **상자와 같은 재료를 본다.** */
const plugins = computed(() => [boxWhiskers(series.value, paint.value)])

/** 이상치가 몇 개인지. 0이면 아무 말도 안 한다. */
const outliers = computed(() =>
  series.value.reduce((sum, one) => sum + one.summary.outliers.length, 0),
)

/**
 * 그림 아래 한 줄. **이상치와 빠진 행은 다른 사실이라 따로 말한다** — 앞엣것은 그림
 * 안에 점으로 있고 뒤엣것은 그림에 아예 없다.
 */
const note = computed(() => {
  const parts: string[] = []
  /**
   * **`t()`에 `.value`를 바로 넘기지 않는다** (`ui-rules`의 "t()의 인자는 새 객체다").
   * 여기 넘기는 것은 수라서 vue-i18n이 써 넣을 자리가 없지만, **그물은 수와 객체를 못
   * 가른다** — 넓혀서 멀쩡한 코드를 물게 하는 것보다 부르는 쪽이 한 줄 더 쓰는 것이 싸다.
   */
  const outlierCount = outliers.value
  if (outlierCount > 0) parts.push(t('data.charts.box.outliers', outlierCount))
  if (split.value.ungrouped > 0) {
    parts.push(t('data.charts.box.ungrouped', { count: split.value.ungrouped }))
  }
  return parts.join(' · ')
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <!--
      **가를 수 있는 열이 없으면 선택기 자체가 없다** (§8.2). 빈 드롭다운을 회색으로
      두면 학생이 고장으로 읽는다.
    -->
    <label v-if="groupable.length > 0" class="flex items-center gap-2">
      <span class="font-bold text-ink-soft">{{ t('data.charts.box.groupBy') }}</span>
      <select
        v-model="groupBy"
        class="rounded-field border border-line-strong bg-surface px-2 py-1"
      >
        <option value="">{{ t('data.charts.box.groupNone') }}</option>
        <option v-for="name in groupable" :key="name" :value="name">{{ name }}</option>
      </select>
    </label>

    <ChartFrame
      :empty="series.length === 0 ? t('data.charts.noValues') : ''"
      :missing="read.missing"
      :note="note"
    >
      <Bar :data="data" :options="options" :plugins="plugins" />
    </ChartFrame>
  </div>
</template>
