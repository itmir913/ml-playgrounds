<script setup lang="ts">
/**
 * 박스 플롯 — 수치 열의 다섯 수와 이상치 (Orange3의 `Box Plot`).
 *
 * **범주 열로 갈라 볼 수 있다.** Orange3의 Box Plot이 `Subgroups`로 하는 일이고,
 * 이 그림의 값어치가 대부분 거기 있다 — 상자 하나는 평균과 결측 수가 이미 말한 것을
 * 다시 말하지만, *"남녀별 키"*는 열 검사기가 못 하는 말이다.
 *
 * **둘째 열을 묻는 것은 이 부품이다. 창이 아니다** (`architecture.md` §8.9.1) —
 * 화면이 *"이 도구는 열이 둘이다"*를 아는 순간 §9.1이 막으려던 분기가 거기 생긴다.
 *
 * **상자만 Chart.js가 그린다.** 수염·중앙값·이상치는 `boxWhiskers` 플러그인이 그린다
 * (`data/chart-config.ts`) — 박스 플롯 하나 때문에 플러그인을 받지 않기로 한 자리다.
 */

import { BarController, BarElement, CategoryScale, Chart, LinearScale, Tooltip } from 'chart.js'
import { computed, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import ChartFrame from './ChartFrame.vue'
import { boxData, boxOptions, boxWhiskers, type BoxSeries } from '@/data/chart-config'
import { categoricalColumns, useChartControls, type ChartInput } from '@/data/charts'
import { boxSummary, columnCells, frequencies, numericValues } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { CATEGORY_BAR_LIMIT } from '@/limits'

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

/** 설정을 세울 자리. 창 밖에서 마운트되면 `null`이고, 그때는 제자리에 그린다. */
const controls = useChartControls()

/** 갈라 볼 범주 열. 빈 문자열이면 안 가른다. */
const groupBy = ref('')

const groupable = computed(() => categoricalColumns(props.input.columns))

/*
 * **열을 바꿔도 가르기를 안 푼다** (2026-09-23 R38-V V-B1, `architecture.md` §8.9.1.1).
 * 전에는 풀었는데 그 이유(*"그 열이 표에서 사라진다"*)는 창이 모달이라 닿지 않고, 가르는
 * 열(범주)과 상자를 세우는 열(수치)은 같은 열이 될 수 없다. 같은 가르기로 열을 옮겨 다니며
 * 견주는 것이 이 그림을 쓰는 방식이다. 창을 닫으면 잊는다 — 부모가 창을 `v-if`로 내린다
 * (`TabularPanel.vue`).
 * `chart-handles.spec.ts`의 *"창 안에서 열을 바꿔도 가르기가 남는다"*가 문다.
 */

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
  boxOptions(series.value, paint.value, {
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

/**
 * 수염·중앙값·이상치를 그리는 플러그인.
 *
 * **재료를 안 넘긴다.** 플러그인은 데이터셋에 실려 간 것을 그릴 때 읽는다
 * (`chart-config.ts`의 `BoxExtras`) — `vue-chartjs`가 `plugins` 프롭이 바뀌어도 차트를
 * 다시 만들지 않아서, 넘기면 **가르기를 바꾼 뒤에도 옛 상자를 그린다.**
 *
 * 그래서 이 값은 한 번 만들어 두고 안 바꾼다.
 */
const plugins = [boxWhiskers()]

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
      **설정은 창이 내준 자리로 보낸다** (§8.9.1). 무엇을 물을지는 이 부품이 알고,
      어디에 세울지는 창이 안다 — 창이 도구별로 갈래를 세우면 §9.1이 막으려던 분기가
      거기 생기고, 부품이 자리를 정하면 창의 레이아웃이 도구 수만큼 갈린다.

      **가를 수 있는 열이 없으면 선택기 자체가 없다** (§8.2). 빈 드롭다운을 회색으로
      두면 학생이 고장으로 읽는다.
    -->
    <Teleport :to="controls" :disabled="controls === null">
      <label v-if="groupable.length > 0" class="flex min-w-0 flex-col gap-1.5">
        <span class="font-bold text-ink-soft">{{ t('data.charts.box.groupBy') }}</span>
        <select
          v-model="groupBy"
          class="w-full min-w-0 rounded-field border border-line-strong bg-surface px-2 py-1.5"
        >
          <option value="">{{ t('data.charts.box.groupNone') }}</option>
          <option v-for="name in groupable" :key="name" :value="name">{{ name }}</option>
        </select>
      </label>
    </Teleport>

    <ChartFrame
      :empty="series.length === 0 ? t('data.charts.noValues') : ''"
      :missing="read.missing"
      :note="note"
    >
      <Bar :data="data" :options="options" :plugins="plugins" />
    </ChartFrame>
  </div>
</template>
