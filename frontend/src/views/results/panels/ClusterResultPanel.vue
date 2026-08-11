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
 * **그림은 예측 화면과 같은 부품이다** (`components/ClusterScatter.vue`, #28-7). 그것도
 * 지연 로딩이라 군집을 안 보는 학생은 차트 라이브러리를 받지 않는다.
 */

import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import TermPopover from '@/components/TermPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { CLUSTER_MEMBER_ROW_COUNT, CLUSTER_SCATTER_POINT_LIMIT } from '@/limits'
import {
  axisOverviews,
  clusterMaterialFor,
  clusterMembers,
  clusterSummaries,
  scatterPoints,
} from '@/ml/clusters'
import type { PanelInput } from '@/ml/metric-panels'

const ClusterScatter = defineAsyncComponent(() => import('@/components/ClusterScatter.vue'))

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

/** 구성원을 펼쳐 볼 군집. 실험이나 run을 옮기면 첫 군집으로 돌아간다. */
const openedCluster = ref(0)

watch(material, () => {
  openedCluster.value = 0
})

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
 * 축마다 전체 데이터의 평균과 범위. **요약표 머리글의 설명이 이것을 쓴다** (#28-6).
 *
 * "이 군집의 평균 45"만으로는 그것이 높은 값인지 낮은 값인지 알 수 없고, 그 판단이
 * 이 표를 보는 이유다.
 */
const overviews = computed(() => {
  const found = material.value
  return found ? axisOverviews(found.matrix, found.axes, found.columns) : []
})

/** 머리글 설명 한 문장. **키를 조립하지 않는다** (`TermPopover`의 머리말). */
function axisHelp(position: number): string {
  const overview = overviews.value[position]
  return t('results.clusterMeanHelp', {
    overall: format.prediction(overview?.mean ?? 0),
    min: format.prediction(overview?.min ?? 0),
    max: format.prediction(overview?.max ?? 0),
  })
}

function clusterName(cluster: number): string {
  return t('results.clusterName', { index: cluster })
}

/** 원본 표의 한 줄. **학습에 안 쓴 열도 그대로 보인다** — 누가 그 군집인지는 거기 있다. */
function cellsOf(row: number): readonly string[] {
  return material.value?.dataset.rows[row] ?? []
}
</script>

<template>
  <section v-if="material && scatter" class="flex min-w-0 flex-col gap-5">
    <ClusterScatter
      :axes="axes"
      :summaries="summaries"
      :scatter="scatter"
      :title="t('results.clusterScatter')"
      :lead="t('results.clusterScatterLead')"
    />

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
            <!--
              **머리글을 눌러 설명을 연다** (§8.13, 점수 표와 같은 문법). 제목은 우리
              어휘가 아니라 학생의 열 이름이라 번역하지 않는다 - 설명만 우리가 쓴다.
            -->
            <th v-for="(axis, position) in axes" :key="axis.name">
              <TermPopover :title="axis.name" :body="axisHelp(position)" />
            </th>
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
