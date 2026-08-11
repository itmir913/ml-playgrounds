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

import { Chart, Legend, LinearScale, PointElement, ScatterController, Tooltip } from 'chart.js'
import { computed, onMounted, ref, watch } from 'vue'
import { Scatter } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { CLUSTER_MEMBER_ROW_COUNT, CLUSTER_SCATTER_POINT_LIMIT } from '@/limits'
import { clusterChartData, clusterChartOptions } from '@/ml/cluster-chart'
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
  return found ? clusterSummaries(found.assignment, found.axes, found.columns, found.matrix) : []
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
 * 배색 토큰을 그림이 쓰는 모양으로 묶는다. **캔버스는 CSS 클래스를 못 쓴다.**
 */
const tokens = computed(() => ({
  palette: palette.value,
  surface: surface.value,
  ink: ink.value,
  line: line.value,
}))

function clusterName(cluster: number): string {
  return t('results.clusterName', { index: cluster })
}

const axisName = (position: number): string => axes.value[position]?.name ?? ''

/**
 * 툴팁에 적는 좌표. **Chart.js는 좌표를 `null`일 수 있는 것으로 본다** — 빈 자리를 둘 수
 * 있는 차트 종류가 있어서다. 산점도에는 그런 점이 없지만 타입은 그것을 모른다.
 *
 * **지표 포맷터를 쓰지 마라** (`useFormat.ts`의 `formatPrediction` 머리말). 이 값은
 * 되돌린 좌표라 **학생의 데이터 단위**다 — 지표처럼 소수 셋으로 자르면 농도 열은
 * 전부 `0.000`이 되고 집값 열은 뒤가 잘린다.
 */
function coordinate(value: number | null): string {
  return value === null ? t('meta.none') : format.prediction(value)
}

/** **그림을 만드는 계산은 화면 밖에 있다** (§8.13.2의 4번, `ml/cluster-chart.ts`). */
const chartData = computed(() =>
  clusterChartData(
    scatter.value ?? { points: [], drawn: 0, total: 0 },
    summaries.value,
    { x: xAxis.value, y: yAxis.value },
    tokens.value,
    { clusterName, centroid: t('results.clusterCentroid') },
  ),
)

const chartOptions = computed(() =>
  clusterChartOptions(summaries.value.length, tokens.value, {
    axisX: axisName(xAxis.value),
    axisY: axisName(yAxis.value),
    point: (name, x, y) => t('results.clusterPoint', { name, x: coordinate(x), y: coordinate(y) }),
  }),
)

/** 원본 표의 한 줄. **학습에 안 쓴 열도 그대로 보인다** — 누가 그 군집인지는 거기 있다. */
function cellsOf(row: number): readonly string[] {
  return material.value?.dataset.rows[row] ?? []
}
</script>

<template>
  <section v-if="material && scatter" class="flex min-w-0 flex-col gap-5">
    <!--
      **축이 둘 미만이면 이 자리가 통째로 없다** (§9.2 "없는 것을 이름으로 말하지
      않는다"). 수치 특성이 하나뿐이면 x·y를 세울 수 없는데, 제목과 설명만 남기면
      화면이 **없는 그림의 이름을 부르고** 학생은 고장으로 읽는다. 군집 요약표와
      구성원 표는 그때도 선다 - 그 둘은 축이 필요 없다.
    -->
    <div v-if="axes.length >= 2" class="flex min-w-0 flex-col gap-1.5">
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

      <div class="h-96 min-w-0">
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
      **군집 요약표.** 값은 그 군집에 실제로 담긴 행들의 평균이다 (#28-6) — 중심점이
      아니다. 둘은 수렴하지 못한 학습에서 갈리고, 그림의 ✕가 중심점 쪽이다.
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
              {{ format.prediction(mean) }}
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
