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

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { CLUSTER_NEIGHBOR_ROW_COUNT } from '@/limits'
import { clusterMaterialFor, clusterSummaries, nearestMembers } from '@/ml/clusters'
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
}

/**
 * 무리로 설명할 수 있는 답마다 한 덩어리.
 *
 * **이 화면은 과제 유형도 모델 형식도 모른다** (§9.1). 무엇이 무리로 설명되는지는
 * `ml/clusters.ts`가 알고, 여기서는 재료가 왔는지만 본다 — `loadModelProba`가 확률을
 * 낼 수 있는 모델만 골라 주는 것과 같은 모양이다.
 */
const neighborhoods = computed<Neighborhood[]>(() => {
  const dataset = props.dataset

  const found: Neighborhood[] = []
  for (const model of props.models) {
    const { experiment, run } = model
    if (model.reason) continue

    const answer = props.answers.get(run.id)?.value
    const preprocessor = props.preprocessors.get(experiment.id)
    const bytes = run.model?.path === undefined ? undefined : props.modelFiles.get(run.model.path)
    const material = clusterMaterialFor(
      run.model?.format,
      bytes,
      dataset,
      preprocessor,
      experiment.settings,
    )
    if (answer === undefined || !preprocessor || !dataset || !material) continue

    try {
      const cluster = Number(answer)
      const summary = clusterSummaries(material.assignment, material.axes, material.columns).find(
        (entry) => entry.cluster === cluster,
      )
      if (!summary) continue

      const vector = inputVector(experiment, preprocessor, props.values)
      const rows = nearestMembers(material, cluster, vector, CLUSTER_NEIGHBOR_ROW_COUNT)

      found.push({
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
      })
    } catch {
      // 남이 편집한 파일이거나 데이터가 바뀐 파일이다. 답은 이미 위 카드에 있고,
      // 못 만든 것은 이 설명뿐이라 그 자리에 아무것도 안 그린다.
    }
  }
  return found
})
</script>

<template>
  <section v-if="neighborhoods.length > 0" class="mt-5 flex min-w-0 flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h4 class="font-bold">{{ t('predict.clusterNeighborTitle') }}</h4>
      <p class="text-ink-soft">{{ t('predict.clusterNeighborLead') }}</p>
    </div>

    <div
      v-for="place in neighborhoods"
      :key="place.runId"
      class="flex min-w-0 flex-col gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <div class="flex flex-col gap-1">
        <p class="font-bold">
          {{
            t('predict.modelName', {
              algorithm: t(`algorithms.${place.algorithm}`),
              runtime: t(place.runtimeKey),
            })
          }}
        </p>
        <p class="text-ink-soft">{{ place.experimentName }}</p>
      </div>

      <!-- **이름은 배지, 값은 plaintext** (§8.16). 평균은 되돌린 중심점이다. -->
      <dl class="flex flex-wrap gap-x-6 gap-y-1.5">
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('results.cluster') }}</AppBadge>
          </dt>
          <dd class="font-bold">{{ t('results.clusterName', { index: place.cluster }) }}</dd>
        </div>
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('results.clusterSize') }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums">{{ place.size }}</dd>
        </div>
        <div v-for="mean in place.means" :key="mean.name" class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ mean.name }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums">{{ mean.value }}</dd>
        </div>
      </dl>

      <AppTable>
        <thead>
          <tr>
            <th v-for="column in place.columns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in place.rows" :key="index">
            <td v-for="(cell, position) in row" :key="position">{{ cell }}</td>
          </tr>
        </tbody>
      </AppTable>

      <p class="text-ink-faint">
        {{ t('results.clusterMemberCount', { shown: place.rows.length, total: place.total }) }}
      </p>
    </div>
  </section>
</template>
