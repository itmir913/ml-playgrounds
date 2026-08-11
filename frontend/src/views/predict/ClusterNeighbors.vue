<script setup lang="ts">
/**
 * 군집 답 옆에 딸리는 이웃 (architecture.md §8.13.1 "군집의 답에는 이웃이 딸린다").
 *
 * **`2번 군집`이라는 답만 주면 학생에게는 정수 하나다.** 그 다음 말이 "그래서 이거랑
 * 비슷한 게 뭔데"이고, 그 답을 못 하면 이 화면에서 군집은 아무것도 가르치지 않는다
 * (`open-decisions.md` #28-6).
 *
 * **정렬은 입력과의 거리다.** 결과 화면의 구성원 표(중심점에 가까운 순 = 가장 전형적인
 * 것)와 **다른 질문에 답한다.** 계산은 `ml/clusters.ts`의 `nearestMembers`가 한다.
 *
 * **데이터가 없으면 답은 나오고 이 자리만 없다** (§9.5). `mlpx-kmeans-v1`은 중심점만으로
 * 군집 번호를 답하므로(`needsTrainingRows: false`), 여기서 모델을 통째로 끄면 지금 되던
 * 것이 안 되게 된다.
 */

import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppChoices from '@/components/AppChoices.vue'
import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { CLUSTER_NEIGHBOR_ROW_COUNT, CLUSTER_SCATTER_POINT_LIMIT } from '@/limits'
import type { ClusterHighlight } from '@/ml/cluster-chart'
import {
  axisValues,
  clusterMaterialFor,
  explainsAsClusters,
  clusterSummaries,
  nearestMembers,
  scatterPoints,
  type ClusterAxis,
  type ClusterMaterial,
  type ClusterSummary,
  type ScatterData,
} from '@/ml/clusters'
import { inputVector, type Answer, type PredictableModel } from '@/ml/predict'
import type { Dataset, Preprocessor } from '@/ml/preprocess'
import { whereTrainedKeyOf } from '@/ml/results'

const props = defineProps<{
  models: readonly PredictableModel[]
  /** run id -> 답. 아직 안 눌렀으면 비어 있다. */
  answers: ReadonlyMap<string, Answer>
  dataset: Dataset | null
  /** 실험 id -> 그 실험의 전처리기. `PredictView`가 파일에서 읽어 검증한 것이다. */
  preprocessors: ReadonlyMap<string, Preprocessor>
  /** 모델 경로 -> 바이트. */
  modelFiles: ReadonlyMap<string, Uint8Array>
  /** 학생이 넣은 한 줄. 답을 낸 그 값이다. */
  values: Readonly<Record<string, string>>
  experimentNames: ReadonlyMap<string, string>
}>()

const ClusterScatter = defineAsyncComponent(() => import('@/components/ClusterScatter.vue'))

const { t } = useI18n()
const format = useFormat()

interface Neighborhood {
  readonly runId: string
  readonly algorithm: string
  readonly runtimeKey: string
  readonly experimentName: string
  readonly cluster: number
  readonly size: number
  /** 축 이름과 그 군집의 평균. 되돌린 중심점이다 (#28-6). */
  readonly means: readonly { readonly name: string; readonly value: string }[]
  readonly columns: readonly string[]
  /** 원본 표의 줄들. **학습에 안 쓴 열도 그대로 보인다.** */
  readonly rows: readonly (readonly string[])[]
  readonly total: number
  /** 그림에 넘길 것들 (#28-7). 결과 화면과 같은 부품이 그린다. */
  readonly axes: readonly ClusterAxis[]
  readonly summaries: readonly ClusterSummary[]
  readonly scatter: ScatterData
  /** 학생이 넣은 한 줄의 자리. **축 순서의 되돌린 좌표다.** */
  readonly highlight: ClusterHighlight
}

/**
 * 실험·모델마다 재료 한 벌. **한 번 만들어 들고 있는다** (#28-6).
 *
 * **computed 안에서 만들면 안 된다** — 재료의 알맹이는 학습 행렬이고 그건 파일에만
 * 달려 있는데, computed는 학생이 [예측]을 누를 때마다(답이 바뀔 때마다) 통째로 다시
 * 돈다. 10만 행짜리 행렬을 그때마다 다시 만들면 저사양 학교 PC에서 그 버튼이 멈춘다.
 *
 * **`null`도 담는다.** "아직 안 만들어 봤다"와 "만들어 봤는데 무리로 설명할 수 없다"를
 * 가르지 않으면 군집이 아닌 모델마다 매번 다시 시도하게 된다.
 */
const materials = new Map<string, ClusterMaterial | null>()

/** 표가 가리키는 것이 통째로 바뀌는 유일한 경로다. 그때 들고 있던 것을 버린다. */
watch(
  () => props.dataset,
  () => materials.clear(),
)

function materialFor(model: PredictableModel): ClusterMaterial | null {
  const { experiment, run } = model
  const path = run.model?.path
  const key = `${experiment.id}|${path ?? ''}`

  const cached = materials.get(key)
  if (cached !== undefined) return cached

  const built = clusterMaterialFor(
    run.model?.format,
    path === undefined ? undefined : props.modelFiles.get(path),
    props.dataset,
    props.preprocessors.get(experiment.id),
    experiment.settings,
  )
  materials.set(key, built)
  return built
}

/**
 * 설명할 수 있는 답들. **여기서는 아무것도 무겁지 않다** (#28-7).
 *
 * 목록을 세우는 데 필요한 것은 **답과 모델 형식뿐**이고, 학습 행렬은 아래에서 고른
 * 하나에만 만든다. 목록을 세우려고 행렬을 스무 개 만들면 하나를 고르는 의미가 없어진다.
 *
 * **이 화면은 과제 유형도 모델 형식도 모른다** (§9.1). 무엇이 무리로 설명되는지는
 * `ml/clusters.ts`가 안다.
 */
const candidates = computed(() =>
  props.models
    .filter((model) => {
      if (model.reason) return false
      if (props.answers.get(model.run.id)?.value === undefined) return false
      if (!props.preprocessors.has(model.experiment.id) || !props.dataset) return false
      return explainsAsClusters(model.run.model?.format)
    })
    .map((model) => ({
      id: model.run.id,
      // **몇 번째 학습인지가 먼저다.** 학생이 설정을 바꿔 가며 같은 알고리즘을 여러 번
      // 돌리므로(그것이 이 도구의 핵심 활동이다) **회차가 빠지면 칩 둘이 같은 글자가
      // 된다** — 2026-08-11에 화면에서 그렇게 났다.
      label: t('predict.clusterModelLabel', {
        round: props.experimentNames.get(model.experiment.id) ?? model.experiment.id,
        model: t('predict.modelName', {
          algorithm: t(`algorithms.${model.run.algorithm}`),
          runtime: t(whereTrainedKeyOf(model.run)),
        }),
      }),
      enabled: true,
    })),
)

/**
 * 설명을 펼쳐 볼 모델. **하나뿐이면 학생은 아무것도 안 눌러도 된다.**
 *
 * 목록이 바뀌면(필터를 좁혔거나 다시 예측했거나) 첫 줄로 돌아간다 — 없어진 모델을
 * 고른 채로 두면 아무것도 안 보이는 자리가 조용히 생긴다.
 */
const picked = ref<string | null>(null)

watch(
  candidates,
  (list) => {
    if (!list.some((one) => one.id === picked.value)) picked.value = list[0]?.id ?? null
  },
  { immediate: true },
)

/**
 * 고른 모델 하나의 설명. **차트도 학습 행렬도 여기서만 산다** (#28-7).
 *
 * 덩어리마다 그리면 군집 실험이 스물 쌓인 파일에서 차트 스물이 서고 행렬 스물이 살아
 * 있는다 — 저사양 학교 PC에서 그것은 화면이 멈추는 것이다.
 */
const neighborhood = computed<Neighborhood | null>(() => {
  const dataset = props.dataset
  const model = props.models.find((one) => one.run.id === picked.value)
  if (!model || !dataset) return null

  const { experiment, run } = model
  const answer = props.answers.get(run.id)?.value
  const preprocessor = props.preprocessors.get(experiment.id)
  if (answer === undefined || !preprocessor) return null

  const material = materialFor(model)
  if (!material) return null

  try {
    const cluster = Number(answer)
    const vector = inputVector(experiment, preprocessor, props.values)
    const rows = nearestMembers(material, cluster, vector, CLUSTER_NEIGHBOR_ROW_COUNT)
    const summaries = clusterSummaries(
      material.assignment,
      material.axes,
      material.columns,
      material.matrix,
    )

    const summary = summaries.find((entry) => entry.cluster === cluster)
    if (!summary) return null

    return {
      runId: run.id,
      algorithm: run.algorithm,
      runtimeKey: whereTrainedKeyOf(run),
      experimentName: props.experimentNames.get(experiment.id) ?? experiment.id,
      cluster,
      size: summary.size,
      means: material.axes.map((axis, position) => ({
        name: axis.name,
        // 지표가 아니라 학생의 데이터 단위다 (`useFormat.ts`의 `formatPrediction`).
        value: format.prediction(summary.means[position] ?? 0),
      })),
      columns: dataset.columns,
      rows: rows.map((row) => dataset.rows[row] ?? []),
      total: summary.size,
      axes: material.axes,
      summaries,
      scatter: scatterPoints(
        material.assignment,
        material.axes,
        material.columns,
        material.matrix,
        CLUSTER_SCATTER_POINT_LIMIT,
        experiment.settings.split.randomState,
      ),
      // **같은 함수로 되돌린다** — 점과 새 점이 다른 좌표계에 찍히면 그림이 거짓말한다.
      highlight: { values: axisValues(vector, material.axes, material.columns), cluster },
    }
  } catch {
    // 남이 편집한 파일이거나 데이터가 바뀐 파일이다. 답은 이미 위 카드에 있고,
    // 못 만든 것은 이 설명뿐이라 그 자리에 아무것도 안 그린다.
    return null
  }
})
</script>

<template>
  <section v-if="neighborhood" class="mt-5 flex min-w-0 flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h4 class="font-bold">{{ t('predict.clusterNeighborTitle') }}</h4>
      <p class="text-ink-soft">{{ t('predict.clusterNeighborLead') }}</p>
    </div>

    <!--
      **한 번에 하나만 그린다** (#28-7). 덩어리마다 그리면 군집 실험이 스물 쌓인 파일에서
      차트 스물이 서고 학습 행렬 스물이 살아 있는다. **고를 것이 하나면 이 자리도 없다**
      (§9.2) — 군집 실험 하나가 보통이고, 그때 학생은 아무것도 안 눌러도 된다.
    -->
    <AppChoices
      v-if="candidates.length > 1"
      :label="t('predict.clusterModelPick')"
      :items="candidates"
      :selected="picked ?? undefined"
      @pick="picked = $event"
    />

    <div class="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-surface p-4">
      <div class="flex flex-col gap-1">
        <p class="font-bold">
          {{
            t('predict.modelName', {
              algorithm: t(`algorithms.${neighborhood.algorithm}`),
              runtime: t(neighborhood.runtimeKey),
            })
          }}
        </p>
        <p class="text-ink-soft">{{ neighborhood.experimentName }}</p>
      </div>

      <!-- **이름은 배지, 값은 plaintext** (§8.16). 평균은 그 군집 구성원의 평균이다. -->
      <dl class="flex flex-wrap gap-x-6 gap-y-1.5">
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('results.cluster') }}</AppBadge>
          </dt>
          <dd class="font-bold">{{ t('results.clusterName', { index: neighborhood.cluster }) }}</dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('results.clusterSize') }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums">{{ neighborhood.size }}</dd>
        </div>
        <div
          v-for="mean in neighborhood.means"
          :key="mean.name"
          class="flex items-baseline gap-1.5"
        >
          <dt>
            <AppBadge>{{ mean.name }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums">{{ mean.value }}</dd>
        </div>
      </dl>

      <!--
        **입력한 데이터가 어디쯤 있는지** (#28-7). 이웃 표가 "비슷하다"고 말한 것을
        점 하나로 보여주는 자리라 표보다 위에 둔다.
      -->
      <ClusterScatter
        :axes="neighborhood.axes"
        :summaries="neighborhood.summaries"
        :scatter="neighborhood.scatter"
        :highlight="neighborhood.highlight"
        :title="t('predict.clusterScatterTitle')"
        :lead="t('predict.clusterScatterLead')"
      />

      <AppTable>
        <thead>
          <tr>
            <th v-for="column in neighborhood.columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in neighborhood.rows" :key="index">
            <td v-for="(cell, position) in row" :key="position">{{ cell }}</td>
          </tr>
        </tbody>
      </AppTable>

      <p class="text-ink-faint">
        {{
          t('results.clusterMemberCount', {
            shown: neighborhood.rows.length,
            total: neighborhood.total,
          })
        }}
      </p>
    </div>
  </section>
</template>
