<script setup lang="ts">
/**
 * 군집 결과 — 산점도 · 군집 요약표 · 구성원 표 (architecture.md §8.13.2).
 *
 * **군집 전용이라는 사실은 여기가 아니라 등록부에 있다** (`ml/metric-panels.ts`).
 * 이 파일은 "어떻게 그리는가"만 안다.
 *
 * **셋이 한 패널인 이유는 재료가 하나이기 때문이다** — 전체 행의 군집 배정 하나에서
 * 셋이 다 나온다. 등록부에 줄을 셋 세우면 같은 계산을 세 번 하게 되고, 그 셋이 서로
 * 다른 배정을 들고 있을 자리가 생긴다 (`open-decisions.md` #28-6).
 *
 * **계산은 전부 `ml/clusters.ts`에 있다.** 여기 있는 것은 그리기와 고르기뿐이다 (§8.3).
 *
 * **Chart.js는 필요한 것만 등록한다.** 이 파일은 지연 로딩이므로(등록부의
 * `defineAsyncComponent`) 군집 결과를 여는 학생만 이 코드를 받는다.
 */

import {
  Chart,
  Legend,
  LinearScale,
  PointElement,
  ScatterController,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type PointStyle,
} from 'chart.js'
import { computed, onMounted, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { CLUSTER_MEMBER_ROW_COUNT, CLUSTER_SCATTER_POINT_LIMIT } from '@/limits'
import { clusterMaterialFor, clusterMembers, clusterSummaries, scatterPoints } from '@/ml/clusters'
import type { PanelInput } from '@/ml/metric-panels'
import { theme } from '@/theme'

Chart.register(ScatterController, PointElement, LinearScale, Tooltip, Legend)

const props = defineProps<{ input: PanelInput }>()

const { t } = useI18n()
const format = useFormat()

/**
 * 그림에 쓰는 재료 전부. **하나라도 없거나 못 읽으면 `null`이고, 그때 이 패널은 아무것도
 * 그리지 않는다** (§9.2 "없는 것을 이름으로 말하지 않는다").
 *
 * 여기 오는 실패는 **남이 편집한 파일이거나 데이터를 뺀 채로 받은 파일**이다. 등록부는
 * `run.model`이 담겼는지까지만 보는데(그건 run에 달린 사실이다) 데이터셋과 전처리기는
 * 파일에 달린 사실이라 등록부가 답할 수 없다.
 */
const material = computed(() => {
  const { dataset, preprocessor, modelBytes, experiment, run } = props.input
  if (!dataset) return null

  // **조립도 형식 판정도 `ml/clusters.ts`가 한다** — 예측 화면의 이웃이 같은 것을 쓰고,
  // 화면은 형식 이름도 과제 유형도 알지 않는다 (§9.1).
  const found = clusterMaterialFor(
    run.model?.format,
    modelBytes,
    dataset,
    preprocessor,
    experiment.settings,
  )
  return found ? { dataset, ...found } : null
})

/** 고른 축. **행렬 열 번호가 아니라 `axes` 안의 자리다.** */
const xAxis = ref(0)
const yAxis = ref(1)

/** 구성원을 펼쳐 볼 군집. 실험이나 run을 옮기면 첫 군집으로 돌아간다. */
const openedCluster = ref(0)

watch(
  material,
  () => {
    xAxis.value = 0
    yAxis.value = 1
    openedCluster.value = 0
  },
  { immediate: true },
)

const axes = computed(() => material.value?.axes ?? [])

/**
 * 그릴 점들. **상한을 넘으면 표본이고, 그 사실은 아래에서 화면이 말한다** (#28-5).
 *
 * 축을 바꿔도 표본은 그대로다 — 뽑기가 `randomState`에만 매여 있어서, 학생이 축을
 * 바꿀 때마다 점의 집합이 바뀌지 않는다.
 */
const scatter = computed(() => {
  const found = material.value
  if (!found) return null
  return scatterPoints(
    found.assignment,
    found.axes,
    found.columns,
    found.matrix,
    CLUSTER_SCATTER_POINT_LIMIT,
    props.input.experiment.settings.split.randomState,
  )
})

const summaries = computed(() => {
  const found = material.value
  return found ? clusterSummaries(found.assignment, found.axes, found.columns) : []
})

/** 펼친 군집의 구성원. **원본 표의 행 번호**라 아래 표가 그 줄을 그대로 보인다. */
const members = computed(() => {
  const found = material.value
  if (!found) return []
  return clusterMembers(found.assignment, openedCluster.value, CLUSTER_MEMBER_ROW_COUNT)
})

const memberTotal = computed(() => material.value?.assignment.counts[openedCluster.value] ?? 0)

/**
 * 배색 토큰의 실제 값. **캔버스는 CSS 클래스를 못 쓰므로 값을 읽어 와야 한다.**
 *
 * 어두운 배색은 같은 이름의 값을 바꾸므로(`styles/dark.css`) **배색이 바뀌면 다시
 * 읽는다** — 안 그러면 어두운 화면에 밝은 배색용 색이 남는다.
 */
const CHART_COLOR_COUNT = 7
const palette = ref<string[]>([])
const surface = ref('#ffffff')
const ink = ref('#475569')
const line = ref('#e2e8f0')

function readTokens(): void {
  if (typeof document === 'undefined') return
  const styles = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback

  palette.value = Array.from({ length: CHART_COLOR_COUNT }, (_value, index) =>
    token(`--color-chart-${index + 1}`, '#000000'),
  )
  surface.value = token('--color-surface', '#ffffff')
  ink.value = token('--color-ink-soft', '#475569')
  line.value = token('--color-line', '#e2e8f0')
}

onMounted(readTokens)
watch(theme, readTokens)

/**
 * 군집의 색과 모양. **일곱 색을 돌려 쓰고 여덟 번째부터 모양을 바꾼다** (#28-3).
 *
 * 색을 스무 개로 늘리지 않는다 — 늘리는 순간 이 팔레트가 색맹 안전(Okabe-Ito)이라는
 * 근거가 깨진다. 7 × 3 = 21이라 `n_clusters` 상한 20을 덮는다.
 */
const POINT_SHAPES: readonly PointStyle[] = ['circle', 'triangle', 'rect']

function colorOf(cluster: number): string {
  return palette.value[cluster % CHART_COLOR_COUNT] ?? ink.value
}

function shapeOf(cluster: number): PointStyle {
  return POINT_SHAPES[Math.floor(cluster / CHART_COLOR_COUNT) % POINT_SHAPES.length] ?? 'circle'
}

function clusterName(cluster: number): string {
  return t('results.clusterName', { index: cluster })
}

const axisName = (position: number): string => axes.value[position]?.name ?? ''

/**
 * 툴팁에 적는 좌표. **Chart.js는 좌표를 `null`일 수 있는 것으로 본다** — 빈 자리를 둘 수
 * 있는 차트 종류가 있어서다. 산점도에는 그런 점이 없지만 타입은 그것을 모른다.
 */
function coordinate(value: number | null): string {
  return value === null ? t('meta.none') : format.metric(value, 'number')
}

/**
 * 그리는 차례. **작을수록 위에 그려진다.**
 *
 * **배열에 나중에 넣는다고 위로 오지 않는다.** Chart.js는 데이터셋을 `order`(같으면
 * 배열 순서)로 정렬한 뒤 **뒤에서부터** 그린다(`_drawDatasets`). 그래서 배열 끝에 둔
 * 중심점이 **맨 아래에 깔려 점 수천 개에 묻혔다** — 2026-08-11에 화면에서 잡혔다.
 *
 * 셋을 명시적으로 나눈다: 점 → 흰 테두리 → 군집 색 ✕ 순으로 쌓인다.
 */
const DRAW_ORDER = { points: 2, halo: 1, centroid: 0 } as const

/**
 * 군집마다 데이터셋 하나, 그 위에 중심점 둘.
 *
 * **중심점을 두 겹으로 그린다** (#28-1의 "✕에 흰 테두리"). `crossRot`은 선으로만
 * 그려지므로 흰 굵은 선을 먼저 깔고 그 위에 군집 색을 얹는다 — 점이 몰린 자리에서
 * 중심점이 묻히지 않게 하는 것이 흰 테두리의 일이다.
 */
const chartData = computed<ChartData<'scatter'>>(() => {
  const found = material.value
  const drawn = scatter.value
  if (!found || !drawn) return { datasets: [] }

  const clusters = found.assignment.centroids.map((_centroid, cluster) => ({
    label: clusterName(cluster),
    data: drawn.points
      .filter((point) => point.cluster === cluster)
      .map((point) => ({ x: point.values[xAxis.value] ?? 0, y: point.values[yAxis.value] ?? 0 })),
    backgroundColor: colorOf(cluster),
    borderColor: colorOf(cluster),
    pointStyle: shapeOf(cluster),
    radius: 4,
    order: DRAW_ORDER.points,
  }))

  const centers = summaries.value.map((summary) => ({
    x: summary.means[xAxis.value] ?? 0,
    y: summary.means[yAxis.value] ?? 0,
  }))

  return {
    datasets: [
      ...clusters,
      {
        label: t('results.clusterCentroid'),
        data: centers,
        borderColor: surface.value,
        pointStyle: 'crossRot' as const,
        borderWidth: 6,
        radius: 9,
        order: DRAW_ORDER.halo,
      },
      {
        label: t('results.clusterCentroid'),
        data: centers,
        borderColor: summaries.value.map((summary) => colorOf(summary.cluster)),
        pointStyle: 'crossRot' as const,
        borderWidth: 3,
        radius: 9,
        order: DRAW_ORDER.centroid,
      },
    ],
  }
})

const chartOptions = computed<ChartOptions<'scatter'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  /**
   * **애니메이션을 끈다.** 기본값이 켬이라 축을 한 번 바꾸면 71프레임을 다시 그린다 —
   * 1만 점에서 799ms, 2만 점에서 4,210ms다(감사 실측). 점 수천 개가 날아다니는 것은
   * 이 화면이 원하는 장면도 아니다.
   *
   * **`limits.ts`의 `CLUSTER_SCATTER_POINT_LIMIT`이 이 줄에 매여 있다** — 상한의 근거가
   * 된 실측이 `animation: false`에서 나왔다 (open-decisions.md #28-5). 이 줄을 지우면
   * 그 숫자가 화면의 숫자가 아니게 된다.
   */
  animation: false,
  /**
   * **가리킨 것 하나만 말한다.** 산점도의 기본 모드는 `point`라 커서 아래에 겹친 점을
   * **전부** 세운다 — 촘촘한 자리에서 거의 같은 숫자가 열 줄씩 뜨고, 학생이 가리킨
   * 것이 그중 무엇인지 알 수 없다. `nearest`는 가장 가까운 하나를 준다.
   */
  interaction: { mode: 'nearest', intersect: true },
  // 축 이름은 학생의 열 이름이라 번역하지 않는다.
  scales: {
    x: {
      title: { display: true, text: axisName(xAxis.value), color: ink.value },
      ticks: { color: ink.value },
      grid: { color: line.value },
    },
    y: {
      title: { display: true, text: axisName(yAxis.value), color: ink.value },
      ticks: { color: ink.value },
      grid: { color: line.value },
    },
  },
  plugins: {
    legend: {
      labels: {
        color: ink.value,
        usePointStyle: true,
        // 흰 테두리 데이터셋은 범례에서 뺀다 - 중심점이 두 줄로 서면 둘의 차이를
        // 설명할 수 없다.
        filter: (item) => item.datasetIndex !== summaries.value.length,
        // **범례는 그리는 차례를 따라가지 않는다.** Chart.js가 범례 항목도 `order`로
        // 정렬하므로(`generateLabels`가 `_getSortedDatasetMetas`를 쓴다) 그대로 두면
        // 위에 그리려고 준 `order`가 범례에서는 "중심점이 맨 앞"이 된다. 읽는 차례는
        // 군집들 다음이 중심점이다.
        sort: (a, b) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0),
      },
    },
    tooltip: {
      /**
       * **표식이 그림과 같은 모양이어야 한다.** 기본은 색 네모라, 중심점을 가리켜도
       * 네모가 뜨고 그것이 ✕라는 것을 말해 주지 않는다. 켜면 점은 자기 모양대로,
       * 중심점은 ✕로 선다.
       */
      usePointStyle: true,
      // 흰 테두리는 아래에 깔린 획일 뿐이다. 안 빼면 중심점이 두 줄로 서고, 그중
      // 하나는 흰 표식에 같은 좌표라 학생이 둘의 차이를 물을 수밖에 없다.
      filter: (item) => item.datasetIndex !== summaries.value.length,
      callbacks: {
        // **한 문장은 한 키다** (docs/i18n.md 규칙 3). 조각을 이어 붙이면 어순이 언어마다
        // 다른 것을 담을 수 없다 — 여기서는 값이 괄호로 뒤에 붙는다(규칙 5).
        label: (item) =>
          t('results.clusterPoint', {
            name: item.dataset.label ?? '',
            x: coordinate(item.parsed.x),
            y: coordinate(item.parsed.y),
          }),
      },
    },
  },
}))

/** 원본 표의 한 줄. **학습에 안 쓴 열도 그대로 보인다** — 누가 그 군집인지는 거기 있다. */
function cellsOf(row: number): readonly string[] {
  return material.value?.dataset.rows[row] ?? []
}
</script>

<template>
  <section v-if="material && scatter" class="flex min-w-0 flex-col gap-5">
    <div class="flex min-w-0 flex-col gap-1.5">
      <h4 class="font-bold">{{ t('results.clusterScatter') }}</h4>
      <p class="text-ink-soft">{{ t('results.clusterScatterLead') }}</p>

      <!--
        **축 선택은 그림 위 왼쪽, 좁은 화면에서 세로로 쌓는다** (§8.10.1). 고를 것이
        둘뿐이면 자리 자체가 없다 — 없는 선택지를 회색으로 두면 학생이 고장으로 읽는다.
      -->
      <div v-if="axes.length > 2" class="flex flex-col gap-2 sm:flex-row sm:gap-5">
        <label class="flex items-center gap-2">
          <span class="font-bold text-ink-soft">{{ t('results.clusterAxisX') }}</span>
          <select
            v-model.number="xAxis"
            class="rounded-field border border-line-strong bg-surface px-2 py-1"
          >
            <option v-for="(axis, index) in axes" :key="axis.name" :value="index">
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
            <option v-for="(axis, index) in axes" :key="axis.name" :value="index">
              {{ axis.name }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="axes.length >= 2" class="h-96 min-w-0">
        <Scatter :data="chartData" :options="chartOptions" />
      </div>

      <!--
        **표본을 뽑았으면 말한다** (#28-5). 조용히 일부만 그리면 학생은 자기 데이터가
        다 거기 있다고 믿는다.
      -->
      <p v-if="scatter.drawn < scatter.total" class="text-ink-faint">
        {{ t('results.clusterSample', { drawn: scatter.drawn, total: scatter.total }) }}
      </p>
    </div>

    <!--
      **군집 요약표.** 값은 그 군집 구성원의 평균이고, 그것이 곧 중심점이다 (#28-6).
      줄을 누르면 아래에 구성원이 펼쳐진다 - 점수 표와 같은 문법이다 (§8.13).
    -->
    <div class="flex min-w-0 flex-col gap-1.5">
      <h4 class="font-bold">{{ t('results.clusterSummary') }}</h4>
      <p class="text-ink-soft">{{ t('results.clusterSummaryLead') }}</p>

      <AppTable>
        <thead>
          <tr>
            <th>{{ t('results.cluster') }}</th>
            <th>{{ t('results.clusterSize') }}</th>
            <th v-for="axis in axes" :key="axis.name">{{ axis.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="summary in summaries"
            :key="summary.cluster"
            class="cursor-pointer"
            :class="summary.cluster === openedCluster ? 'bg-brand-soft' : ''"
            @click="openedCluster = summary.cluster"
          >
            <th class="text-left">{{ clusterName(summary.cluster) }}</th>
            <td class="tabular-nums">{{ summary.size }}</td>
            <td v-for="(mean, position) in summary.means" :key="position" class="tabular-nums">
              {{ format.metric(mean, 'number') }}
            </td>
          </tr>
        </tbody>
      </AppTable>
    </div>

    <!--
      **구성원 표.** 원본 표의 열이 전부 선다 - 이름·번호처럼 학습에서 뺀 열이
      "누가 그 군집인가"에 답하는 유일한 열이다 (#28-6).
    -->
    <div class="flex min-w-0 flex-col gap-1.5">
      <h4 class="font-bold">
        {{ t('results.clusterMembers', { name: clusterName(openedCluster) }) }}
      </h4>
      <p class="text-ink-soft">{{ t('results.clusterMembersLead') }}</p>

      <AppTable>
        <thead>
          <tr>
            <th v-for="column in material.dataset.columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in members" :key="row">
            <td v-for="(cell, index) in cellsOf(row)" :key="index">{{ cell }}</td>
          </tr>
        </tbody>
      </AppTable>

      <p class="text-ink-faint">
        {{ t('results.clusterMemberCount', { shown: members.length, total: memberTotal }) }}
      </p>
    </div>
  </section>
</template>
