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
import { computed, ref } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import AppTeleport from '@/components/AppTeleport.vue'
import ChartFrame from './ChartFrame.vue'
import {
  colorsAreDistinct,
  scatterLayers,
  scatterOptions,
  scatterSeries,
} from '@/data/chart-config'
import { categoricalColumns, useChartControls, type ChartInput } from '@/data/charts'
import { type AxisCell } from '@/data/category-axis'
import { categoriesOf, columnCells, scatterRows } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { useElementSize } from '@/composables/useElementSize'
import { useFormat } from '@/composables/useFormat'
import { DATA_SCATTER_POINT_LIMIT } from '@/limits'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

/** 설정을 세울 자리. `BoxChart`와 같은 규칙이다. */
const controls = useChartControls()

/**
 * 학생이 **고른** 세로축. 아직 안 골랐으면 빈 값이다.
 *
 * **그리는 값(아래 `yColumn`)과 가른다** (`open-decisions.md` 55 *"끄지 않고 잠근다"*).
 * 전에는 가로축을 세로축과 같은 열로 바꾸면 세로축을 **다른 열로 덮어썼고**, 가로축을
 * 되돌려도 고른 세로축이 안 돌아왔다. 이제 고른 것은 남고, 쓸 수 없는 동안만 다른 값으로
 * 그린다.
 */
const chosenY = ref('')

/**
 * 세로축 후보. **고른 열은 뺀다** — 자기 자신과의 산점도는 대각선일 뿐이다.
 *
 * **수치 열만 주지 않는다** (2026-09-22, `open-decisions.md` "군집 산점도의 축"). 결과
 * 화면의 군집 산점도가 범주 열을 축으로 세우므로, 여기서 빼면 **같은 표의 같은 열이
 * 화면마다 다르게 취급된다.**
 */
const others = computed(() =>
  props.input.columns.map((one) => one.name).filter((name) => name !== props.input.column),
)

const colorable = computed(() => categoricalColumns(props.input.columns))

/**
 * **그릴 세로축.** 고른 것이 후보에 있으면 그것이고, 없으면(아직 안 골랐거나 가로축과 같은
 * 열이다) 첫 후보다. **고른 것을 덮어쓰지 않는다.** 첫 후보를 자동으로 세우는 이유는, 창을
 * 열자마자 그림이 보여야 하기 때문이다 — 빈 판을 띄우고 "세로축을 고르시오"라고 하면
 * 학생은 도구가 고장 난 줄 안다.
 *
 * **이전에 고른 열이 아직 후보에 있으면 지킨다.** 열을 옮겨 다니며 같은 세로축과
 * 견주는 것이 이 그림을 쓰는 방식이다.
 */
const yColumn = computed({
  get: () => (others.value.includes(chosenY.value) ? chosenY.value : (others.value[0] ?? '')),
  set: (name: string) => {
    chosenY.value = name
  },
})

/**
 * 점의 색을 가르는 범주 열. 빈 문자열이면 한 색이다.
 *
 * **세로축과 달리 고른 값과 그리는 값을 가르지 않는다.** 후보(`colorable`)는 표의 범주 열
 * 전부라 가로축을 바꿔도 안 줄고, 창이 모달이라 열려 있는 동안 표가 안 바뀐다 — 고른 열이
 * 후보에서 빠지는 길이 없다. 그 되돌림 가지가 있었는데 닿지 않는 코드였다(R38-D55 N10).
 */
const colorBy = ref('')

/**
 * 축이 범주 축인가. **`categories`가 있으면 그렇다** — `ml/cluster-chart.ts`의
 * `ClusterAxisScales`와 같은 표시다 (`data/category-axis.ts`).
 *
 * **자료형은 열 검사기가 이미 판정했다.** 여기서 다시 세면 판정이 두 벌이 되고, 두 벌은
 * 언젠가 갈린다.
 */
function categoriesFor(name: string): readonly string[] | undefined {
  const column = props.input.columns.find((one) => one.name === name)
  return column?.kind === 'categorical'
    ? categoriesOf(columnCells(props.input.dataset, name))
    : undefined
}

const axes = computed(() => ({
  x: categoriesFor(props.input.column),
  y: categoriesFor(yColumn.value),
}))

/** 점을 찍을 수 있는 행 전부. **표본을 안 뽑는다** — 거르는 것은 아래 `layers`다 (94). */
const sample = computed(() =>
  scatterRows(
    columnCells(props.input.dataset, props.input.column),
    columnCells(props.input.dataset, yColumn.value),
    colorBy.value === '' ? undefined : columnCells(props.input.dataset, colorBy.value),
    axes.value,
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

/** 그림 영역. **점을 거르는 칸이 이 픽셀이다** (`useElementSize`의 머리말). */
const areaEl = ref<HTMLElement | null>(null)
const area = useElementSize(areaEl)

/**
 * 거른 그림 (`open-decisions.md` "94. 그림이 드문 것을 숨기는가"). 성긴 칸은 점을 전부,
 * 붐빈 칸은 점 하나에 행 수를 실어 진하게 그린다 — **외딴 점은 반드시 남는다.** 묶음은 상한
 * 스위치가 끄지 않는다(`limits.ts`의 `DATA_SCATTER_POINT_LIMIT`).
 */
const layers = computed(() =>
  scatterLayers(series.value, paint.value, area.value, DATA_SCATTER_POINT_LIMIT, axes.value),
)

const data = computed(() => layers.value.data)

/**
 * 툴팁에 쓸 좌표 글자. **범주 축이면 흩뿌린 것을 되돌려 이름을 말한다**
 * (2026-09-22 R37 A-3).
 *
 * **되돌리는 일은 여기서 안 한다** (`chart-config.ts`가 `axisCellOf`를 거쳐 넘긴다).
 * 처음에는 이 함수가 되돌렸는데, 그러면 **다음 화면이 또 잊는다** — 실제로 그래서
 * `여` 자리에 `1.02`가 떴다. 화면에 남는 일은 **셀을 글자로 바꾸는 것**뿐이다.
 */
function coordinate(cell: AxisCell): string {
  if (cell.kind === 'category') return cell.name
  if (cell.kind === 'unknownCategory') return t('meta.none')
  return format.prediction(cell.value)
}

const options = computed(() =>
  scatterOptions(
    paint.value,
    {
      x: props.input.column,
      y: yColumn.value,
      point: (name, x, y) =>
        t('data.charts.scatter.point', {
          name,
          x: coordinate(x),
          y: coordinate(y),
        }),
      pointMany: (name, x, y, rows) =>
        t('data.charts.scatter.pointMany', {
          count: rows,
          name,
          x: coordinate(x),
          y: coordinate(y),
        }),
    },
    /**
     * **겹치는 범례는 안 세운다** (결정문 47). 자리를 먹는 것보다 먼저, 그 범례가
     * 가리키는 대응이 참이 아니다 — 대신 위 `note`가 겹친다는 사실과 **점을 가리키면
     * 이름이 나온다**는 것을 말한다.
     */
    colorBy.value !== '' && !colorsRepeat.value,
    axes.value,
  ),
)

/**
 * 색이 겹치는가. **팔레트가 일곱이라 갈래가 그보다 많으면 같은 색이 둘 이상을 가리킨다**
 * (`open-decisions.md` "47. 색 갈래가 팔레트보다 많을 때").
 *
 * **막지 않는다.** 그려지고 읽히는 그림이고, 다른 도구도 안 막는다 — 막는 것은 우리
 * 발명이 된다. 대신 **범례를 안 세우고 그 사실을 말한다**: 색 열넷이 같은 자리에서
 * 범례는 **없는 대응을 있다고 주장한다.**
 */
const colorsRepeat = computed(() => !colorsAreDistinct(series.value.length))

/**
 * 그림 아래 한 줄. **우리가 줄인 것과 데이터에 없는 것을 따로 말한다.**
 *
 * 묶은 점과 키운 칸은 우리가 한 일이고(94), 못 찍은 행은 데이터에 값이 없는 것이다.
 */
const note = computed(() => {
  const parts: string[] = []
  if (colorsRepeat.value) {
    parts.push(t('data.charts.scatter.colorsRepeat', { count: series.value.length }))
  }
  if (layers.value.merged) parts.push(t('data.charts.scatter.merged'))
  if (layers.value.widened) parts.push(t('data.charts.scatter.widened'))
  const skipped = sample.value.skipped
  if (skipped > 0) parts.push(t('data.charts.scatter.skipped', skipped))
  return parts.join(' · ')
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <!-- **설정은 창이 내준 자리로 보낸다** (§8.9.1). `BoxChart`와 같은 규칙이다. -->
    <AppTeleport :to="controls">
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
    </AppTeleport>

    <ChartFrame
      :empty="sample.points.length === 0 ? t('data.charts.noValues') : ''"
      :missing="0"
      :note="note"
    >
      <!-- **크기가 선 뒤에 그린다** — 0×0으로 거르면 모든 점이 한 칸에 모인다. -->
      <div ref="areaEl" class="h-full w-full">
        <Scatter v-if="area.width > 0 && area.height > 0" :data="data" :options="options" />
      </div>
    </ChartFrame>
  </div>
</template>
