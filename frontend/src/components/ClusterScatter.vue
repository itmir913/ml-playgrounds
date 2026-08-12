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
import { computed, onMounted, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import { useFormat } from '@/composables/useFormat'
import {
  FALLBACK_PALETTE,
  clusterChartData,
  clusterChartOptions,
  type ClusterHighlight,
} from '@/ml/cluster-chart'
import type { ClusterAxis, ClusterSummary, ScatterData } from '@/ml/clusters'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend)

const props = defineProps<{
  axes: readonly ClusterAxis[]
  summaries: readonly ClusterSummary[]
  scatter: ScatterData
  /** 학생이 방금 넣은 한 줄. **예측 화면에만 있다** (#28-7). */
  highlight?: ClusterHighlight | undefined
  /**
   * 제목과 설명. **부품이 제 제목까지 든다** — 축이 둘 미만이면 그림이 통째로 없어야
   * 하는데(§9.2), 제목을 부르는 쪽에 두면 그때 **제목만 남아 없는 그림의 이름을 부른다.**
   */
  title: string
  lead: string
}>()

const { t } = useI18n()
const format = useFormat()

/** 고른 축. **행렬 열 번호가 아니라 `axes` 안의 자리다.** */
const xAxis = ref(0)
const yAxis = ref(1)

/** 축 목록이 바뀌면(다른 실험·다른 모델) 처음 둘로 돌아간다. */
watch(
  () => props.axes,
  () => {
    xAxis.value = 0
    yAxis.value = 1
  },
)

/**
 * 배색 토큰의 실제 값. **캔버스는 CSS 클래스를 못 쓰므로 값을 읽어 와야 한다.**
 *
 * 어두운 배색은 같은 이름의 값을 바꾸므로(`styles/dark.css`) **배색이 바뀌면 다시
 * 읽는다** — 안 그러면 어두운 화면에 밝은 배색용 색이 남는다.
 */
const palette = ref<readonly string[]>(FALLBACK_PALETTE)
const surface = ref('#ffffff')
const ink = ref('#475569')
const line = ref('#e2e8f0')

function readTokens(): void {
  if (typeof document === 'undefined') return
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback

  // **대체값이 색마다 달라야 한다** — 전부 같으면 토큰을 못 읽는 순간 모든 군집이
  // 한 색이 되고, 그림은 멀쩡해 보인다 (`FALLBACK_PALETTE`).
  palette.value = FALLBACK_PALETTE.map((fallback, index) =>
    token(`--color-chart-${index + 1}`, fallback),
  )
  surface.value = token('--color-surface', '#ffffff')
  ink.value = token('--color-ink-soft', '#475569')
  line.value = token('--color-line', '#e2e8f0')
}

onMounted(readTokens)

/**
 * 배색이 바뀌면 다시 읽는다.
 *
 * **`theme` ref를 직접 보지 않고 `data-theme`을 본다** — 이 부품은 배색을 고르는 장치를
 * 알 필요가 없고, 값이 실제로 바뀌는 자리는 그 속성이다.
 */
watch(
  () => (typeof document === 'undefined' ? '' : (document.documentElement.dataset['theme'] ?? '')),
  readTokens,
)

const axisName = (position: number): string => props.axes[position]?.name ?? ''

/**
 * 툴팁에 적는 좌표. **Chart.js는 좌표를 `null`일 수 있는 것으로 본다** — 빈 자리를 둘 수
 * 있는 차트 종류가 있어서다. 산점도에는 그런 점이 없지만 타입은 그것을 모른다.
 *
 * **지표 포맷터를 쓰지 마라** (`useFormat.ts`의 `formatPrediction` 머리말). 이 값은
 * 되돌린 좌표라 **학생의 데이터 단위**다.
 */
function coordinate(value: number | null): string {
  return value === null ? t('meta.none') : format.prediction(value)
}

const tokens = computed(() => ({
  palette: palette.value,
  surface: surface.value,
  ink: ink.value,
  line: line.value,
}))

const chartData = computed(() =>
  clusterChartData(
    props.scatter,
    props.summaries,
    { x: xAxis.value, y: yAxis.value },
    tokens.value,
    {
      clusterName: (cluster: number) => t('results.clusterName', { index: cluster }),
      centroid: t('results.clusterCentroid'),
      highlight: t('predict.tabular.clusterInputPoint'),
    },
    props.highlight,
  ),
)

const chartOptions = computed(() =>
  clusterChartOptions(props.summaries.length, tokens.value, {
    axisX: axisName(xAxis.value),
    axisY: axisName(yAxis.value),
    point: (name, x, y) => t('results.clusterPoint', { name, x: coordinate(x), y: coordinate(y) }),
  }),
)
</script>

<template>
  <!--
    **축이 둘 미만이면 이 자리가 통째로 없다** (§9.2). 수치 특성이 하나뿐이면 x·y를
    세울 수 없는데, 제목과 설명만 남기면 화면이 없는 그림의 이름을 부른다.
  -->
  <div v-if="props.axes.length >= 2" class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ props.title }}</h4>
    <p class="text-ink-soft">{{ props.lead }}</p>

    <!--
      **축 선택은 그림 위 왼쪽, 좁은 화면에서 세로로 쌓는다** (§8.10.1). 고를 것이
      둘뿐이면 자리 자체가 없다 — 없는 선택지를 회색으로 두면 학생이 고장으로 읽는다.
    -->
    <div v-if="props.axes.length > 2" class="flex flex-col gap-2 sm:flex-row sm:gap-5">
      <label class="flex items-center gap-2">
        <span class="font-bold text-ink-soft">{{ t('results.clusterAxisX') }}</span>
        <select
          v-model.number="xAxis"
          class="rounded-field border border-line-strong bg-surface px-2 py-1"
        >
          <option v-for="(axis, index) in props.axes" :key="axis.name" :value="index">
            {{ axis.name }}
          </option>
        </select>
      </label>

      <label class="flex items-center gap-2">
        <span class="font-bold text-ink-soft">{{ t('results.clusterAxisY') }}</span>
        <select
          v-model.number="yAxis"
          class="rounded-field border border-line-strong bg-surface px-2 py-1"
        >
          <option v-for="(axis, index) in props.axes" :key="axis.name" :value="index">
            {{ axis.name }}
          </option>
        </select>
      </label>
    </div>

    <div class="h-96 min-w-0">
      <Scatter :data="chartData" :options="chartOptions" />
    </div>

    <!--
      **표본을 뽑았으면 말한다** (#28-5). 조용히 일부만 그리면 학생은 자기 데이터가
      다 거기 있다고 믿는다.
    -->
    <p v-if="props.scatter.drawn < props.scatter.total" class="text-ink-faint">
      {{
        t('results.clusterSample', {
          drawn: props.scatter.drawn,
          total: props.scatter.total,
        })
      }}
    </p>
  </div>
</template>
