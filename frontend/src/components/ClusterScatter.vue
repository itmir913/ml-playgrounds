<script setup lang="ts">
/**
 * 군집 산점도 (`open-decisions.md` #28, `architecture.md` §8.13.2).
 *
 * **두 화면이 같은 부품을 쓴다** (#28-7) — 결과 화면의 군집 패널과 예측 화면의 이웃.
 * 축 선택·표본 안내·배색 토큰 읽기가 전부 여기 있고, 부르는 쪽은 **재료와 새 점만**
 * 넘긴다. 두 벌로 두면 축 규칙이나 색 규칙이 한쪽에서만 고쳐질 자리가 생긴다.
 *
 * **계산은 없다.** 그림을 만드는 것은 `ml/cluster-chart.ts`이고 여기는 그것을 캔버스에
 * 얹는 일과 학생이 축을 고르는 일만 한다 (§8.13.2의 5번).
 *
 * **Chart.js 등록이 여기 있다.** 이 파일이 두 화면 모두에서 **지연 로딩**되므로
 * (`defineAsyncComponent`) 군집을 안 보는 학생은 차트 라이브러리를 받지 않는다.
 */

import { Chart, Legend, LinearScale, PointElement, ScatterController, Tooltip } from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import { useChartTokens } from '@/composables/useChartTokens'
import { useElementSize } from '@/composables/useElementSize'
import { useFormat } from '@/composables/useFormat'
import {
  clusterChartData,
  clusterChartOptions,
  drawsCentroid,
  type ClusterHighlight,
} from '@/ml/cluster-chart'
import { CLUSTER_SCATTER_POINT_LIMIT } from '@/limits'
import { axisCellOf, type ClusterAxis, type ClusterSummary, type ScatterData } from '@/ml/clusters'
import {
  clusterPlot,
  plotAxes,
  plotAxesKey,
  rawColumnReader,
  type WidePlotSource,
} from '@/ml/cluster-plot'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend)

const props = defineProps<{
  axes: readonly ClusterAxis[]
  summaries: readonly ClusterSummary[]
  scatter: ScatterData
  /** 학생이 방금 넣은 한 줄. **예측 화면에만 있다** (#28-7). */
  highlight?: ClusterHighlight | undefined
  /**
   * 학습에 쓰지 않은 열까지 축으로 세울 재료 (`open-decisions.md` 115). **결과 화면만 넘긴다.**
   * 새 점과 함께 오면 특성 축만 선다 — 그 판정은 `plotAxes`가 한다.
   */
  wide?: WidePlotSource | undefined
  /**
   * 제목과 설명. **부품이 제 제목까지 든다** — 축이 둘 미만이면 그림이 통째로 없어야
   * 하는데(§9.2), 제목을 부르는 쪽에 두면 그때 **제목만 남아 없는 그림의 이름을 부른다.**
   */
  title: string
  lead: string
  /**
   * ✕를 안 그리는 그림의 설명 (범주 축·원본 칸 그림, `open-decisions.md` 115). **설명이 ✕를
   * 말하는데 그림에 ✕가 없으면 학생이 고장으로 읽는다.** 무는 검사:
   * `tests/cluster-scatter.spec.ts` "✕가 없으면 ✕를 말하지 않는다".
   */
  leadPlain: string
}>()

const { t } = useI18n()
const format = useFormat()

/**
 * 고를 수 있는 축. **특성이 앞이고 학습에 쓰지 않은 열이 뒤다** (115) — 첫 화면이 지금까지와
 * 같다.
 */
const choices = computed(() => plotAxes(props.axes, props.wide, props.highlight !== undefined))
const features = computed(() => choices.value.filter((axis) => axis.source === 'feature'))
const others = computed(() => choices.value.filter((axis) => axis.source === 'raw'))

/** 고른 축. **행렬 열 번호가 아니라 `choices` 안의 자리다.** */
const xAxis = ref(0)
const yAxis = ref(1)

/**
 * 축 목록이 바뀌면(다른 실험·다른 모델) 처음 둘로 돌아간다. **배열이 아니라 이름표를
 * 감시한다** — 새 점이 바뀔 때마다 배열은 새로 선다 (`plotAxesKey`).
 */
watch(
  () => plotAxesKey(choices.value),
  () => {
    xAxis.value = 0
    yAxis.value = 1
  },
)

/** 원본 열은 열마다 한 번만 읽는다 (115). 표가 바뀌면 새로 읽는다. */
const reader = computed(() => (props.wide ? rawColumnReader(props.wide) : undefined))

/**
 * 고른 두 축으로 그릴 그림. **둘 다 특성이면 받은 재료 그대로이고, 하나라도 아니면 두 축 모두
 * 원본 칸이다** (115 — 그림 하나에 규칙 하나).
 */
const plot = computed(() => {
  const x = choices.value[xAxis.value]
  const y = choices.value[yAxis.value]
  if (!x || !y) return null
  return clusterPlot(props.axes, props.scatter, props.summaries, x, y, props.wide, reader.value)
})

/**
 * 배색 토큰의 실제 값. **캔버스는 CSS 클래스를 못 쓰므로 값을 읽어 와야 한다.**
 *
 * **읽는 자리는 컴포저블 하나다** — 한때 이 파일이 제 몫을 따로 읽었고, 그때
 * 배색이 바뀌면 다시 읽는 규칙이 화면마다 따로 살았다 (2026-09-22에 합쳤다).
 * `ChartTokens`는 `ClusterChartTokens`를 그대로 만족한다.
 */
const tokens = useChartTokens()

const axisName = (position: number): string => choices.value[position]?.name ?? ''

/**
 * 고른 두 축이 범주 축인가, 원본 칸 그림인가. **그림의 눈금·흩뿌림·중심점이 전부 여기서
 * 갈린다** (`open-decisions.md` "군집 산점도의 축", 115).
 */
const scales = computed(() => ({
  x: plot.value?.scales.x,
  y: plot.value?.scales.y,
  raw: plot.value?.raw,
}))

/** 흩뿌린 그림인가. **그 사실을 화면이 말해야 한다** — 안 그러면 학생이 위치를 읽는다. */
const jittered = computed(() => scales.value.x !== undefined || scales.value.y !== undefined)

/**
 * 툴팁에 적는 좌표. **Chart.js는 좌표를 `null`일 수 있는 것으로 본다** — 빈 자리를 둘 수
 * 있는 차트 종류가 있어서다. 산점도에는 그런 점이 없지만 타입은 그것을 모른다.
 *
 * **지표 포맷터를 쓰지 마라** (`useFormat.ts`의 `formatPrediction` 머리말). 이 값은
 * 되돌린 좌표라 **학생의 데이터 단위**다.
 */
function coordinate(value: number | null, categories?: readonly string[]): string {
  if (value === null) return t('meta.none')
  // **판정은 여기서 하지 않는다** (`ml/clusters.ts`의 `axisCellOf`). 화면 셋이 같은
  // 규칙을 손으로 세 벌 쓰고 있었고, 갈래를 뒤집어도 조용했다 (2026-08-31 사각 감사 A-2).
  const cell = axisCellOf(categories, value)
  if (cell.kind === 'category') return cell.name
  if (cell.kind === 'unknownCategory') return t('meta.none')
  return format.prediction(cell.value)
}

/** 그림 영역. **점을 거르는 칸이 이 픽셀이다** (`useElementSize`의 머리말). */
const areaEl = ref<HTMLElement | null>(null)
const area = useElementSize(areaEl)

/**
 * 거른 그림 (`open-decisions.md` "94. 그림이 드문 것을 숨기는가"). 붐빈 칸만 점 하나로 묶고
 * 외딴 점은 반드시 남긴다. 묶음은 상한 스위치가 끄지 않는다(`CLUSTER_SCATTER_POINT_LIMIT`).
 */
const layers = computed(() =>
  clusterChartData(
    plot.value?.scatter ?? props.scatter,
    plot.value?.summaries ?? props.summaries,
    plot.value?.axis ?? { x: xAxis.value, y: yAxis.value },
    tokens.value,
    {
      clusterName: (cluster: number) => t('results.clusterName', { index: cluster }),
      centroid: t('results.tabular.clusterCentroid'),
      highlight: t('predict.tabular.clusterInputPoint'),
    },
    { area: area.value, budget: CLUSTER_SCATTER_POINT_LIMIT },
    props.highlight,
    scales.value,
  ),
)

const chartData = computed(() => layers.value.data)

const chartOptions = computed(() =>
  clusterChartOptions(
    layers.value.pointSets,
    tokens.value,
    {
      axisX: axisName(xAxis.value),
      axisY: axisName(yAxis.value),
      point: (name, x, y) =>
        t('results.tabular.clusterPoint', {
          name,
          x: coordinate(x, scales.value.x),
          y: coordinate(y, scales.value.y),
        }),
      pointMany: (name, x, y, rows) =>
        t('results.tabular.clusterPointMany', {
          count: rows,
          name,
          x: coordinate(x, scales.value.x),
          y: coordinate(y, scales.value.y),
        }),
    },
    scales.value,
  ),
)
</script>

<template>
  <!--
    **축이 둘 미만이면 그리는 대신 이유를 말한다** (§9.4, open-decisions.md "군집
    산점도의 축"). 예전에는 이 자리가 통째로 없었는데, **요약표와 구성원 표는 뜨는데
    그림만 없으니 교실에서 고장으로 읽혔다** — 실물 파일에서 그렇게 걸렸다.
    잠기는 것에는 이유가 있어야 하고, 그것을 아는 자리가 여기다.
  -->
  <div v-if="choices.length < 2" class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ props.title }}</h4>
    <p class="text-ink-soft">
      {{ t('results.tabular.clusterScatterNoAxes', { count: choices.length }) }}
    </p>
  </div>

  <div v-else class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ props.title }}</h4>
    <p class="text-ink-soft">{{ drawsCentroid(scales) ? props.lead : props.leadPlain }}</p>

    <!--
      **축 선택은 그림 위 왼쪽, 좁은 화면에서 세로로 쌓는다** (§8.10.1). 고를 것이
      둘뿐이면 자리 자체가 없다 — 없는 선택지를 회색으로 두면 학생이 고장으로 읽는다.
    -->
    <!--
      **흩뿌렸다는 것을 말한다** (open-decisions.md "군집 산점도의 축"). 범주 칸 안에서
      점을 조금씩 옮겨 놓았으므로, 안 말하면 학생이 그 미세한 위치 차이를 데이터로 읽는다.
    -->
    <p v-if="jittered" class="text-ink-soft">{{ t('results.tabular.clusterJitter') }}</p>

    <!--
      **원본 칸 그림이면 그 사실과 뺀 행, 중심점이 없는 이유를 말한다** (open-decisions.md 115).
      안 말하면 학생이 ✕가 사라진 것을 고장으로, 점 수가 줄어든 것을 데이터로 읽는다.
    -->
    <template v-if="plot?.raw">
      <p class="text-ink-soft">{{ t('results.tabular.clusterRawPlot') }}</p>
      <p class="text-ink-soft">{{ t('results.tabular.clusterNoCentroidRaw') }}</p>
      <p v-if="plot.dropped > 0" class="text-ink-soft">
        {{ t('results.tabular.clusterRawDropped', { count: plot.dropped }) }}
      </p>
    </template>
    <p v-else-if="plot && plot.filled > 0" class="text-ink-soft">
      {{ t('results.tabular.clusterFilledRows', { count: plot.filled }) }}
    </p>

    <!--
      **특성과 학습에 쓰지 않은 열을 묶어 가른다** (115). 안 가르면 학생이 "위도로도 나눴다"고
      읽는다. 학습에 쓰지 않은 열이 없으면 묶음 없이 지금까지와 같다.
    -->
    <div v-if="choices.length > 2" class="flex flex-col gap-2 sm:flex-row sm:gap-5">
      <label class="flex items-center gap-2">
        <span class="font-bold text-ink-soft">{{ t('results.tabular.clusterAxisX') }}</span>
        <select
          v-model.number="xAxis"
          class="rounded-field border border-line-strong bg-surface px-2 py-1"
        >
          <template v-if="others.length > 0">
            <optgroup :label="t('results.tabular.clusterAxisFeatures')">
              <option v-for="(axis, index) in features" :key="axis.name" :value="index">
                {{ axis.name }}
              </option>
            </optgroup>
            <optgroup :label="t('results.tabular.clusterAxisOthers')">
              <option
                v-for="(axis, index) in others"
                :key="axis.name"
                :value="features.length + index"
              >
                {{ axis.name }}
              </option>
            </optgroup>
          </template>
          <template v-else>
            <option v-for="(axis, index) in choices" :key="axis.name" :value="index">
              {{ axis.name }}
            </option>
          </template>
        </select>
      </label>

      <label class="flex items-center gap-2">
        <span class="font-bold text-ink-soft">{{ t('results.tabular.clusterAxisY') }}</span>
        <select
          v-model.number="yAxis"
          class="rounded-field border border-line-strong bg-surface px-2 py-1"
        >
          <template v-if="others.length > 0">
            <optgroup :label="t('results.tabular.clusterAxisFeatures')">
              <option v-for="(axis, index) in features" :key="axis.name" :value="index">
                {{ axis.name }}
              </option>
            </optgroup>
            <optgroup :label="t('results.tabular.clusterAxisOthers')">
              <option
                v-for="(axis, index) in others"
                :key="axis.name"
                :value="features.length + index"
              >
                {{ axis.name }}
              </option>
            </optgroup>
          </template>
          <template v-else>
            <option v-for="(axis, index) in choices" :key="axis.name" :value="index">
              {{ axis.name }}
            </option>
          </template>
        </select>
      </label>
    </div>

    <!-- **크기가 선 뒤에 그린다** — 0×0으로 거르면 모든 점이 한 칸에 모인다. -->
    <div ref="areaEl" class="h-96 min-w-0">
      <Scatter v-if="area.width > 0 && area.height > 0" :data="chartData" :options="chartOptions" />
    </div>

    <!--
      **묶었으면 말한다** (94). 붐빈 자리의 점 하나가 여러 행을 대신하므로, 안 말하면 학생은
      점 하나를 한 행으로 읽는다 — 위 설명(`clusterScatterLead`)이 그렇게 말하고 있다.
    -->
    <p v-if="layers.merged" class="text-ink-faint">{{ t('results.tabular.clusterMerged') }}</p>
    <p v-if="layers.widened" class="text-ink-faint">{{ t('results.tabular.clusterWidened') }}</p>
  </div>
</template>
