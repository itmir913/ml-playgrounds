<script setup lang="ts">
/**
 * **전처리 요약** — 지금 설정으로 학습하면 무엇이 되는가 (open-decisions.md "전처리
 * 요약 카드").
 *
 * **아무것도 계산하지 않는다.** 숫자는 전부 `planRun`에서 오고, 그것은 학습이 부르는
 * 그 함수다 (architecture.md §9.1.3). 화면이 따로 세기 시작하면 반올림·뽑기 순서·
 * 훈련셋 기준 셋 중 하나에서 반드시 어긋난다.
 *
 * **여기 모으는 것은 흩어져 있던 결과 문장들이다.** 다만 **입력 옆의 즉시 피드백은
 * 남긴다** — 특성 줄은 열 고르기 표 아래에, 뽑기 요약은 행 수 입력 옆에 있어야 학생이
 * 손을 움직이는 자리에서 반응을 본다. 카드로 오는 것은 **입력 옆이 아닌데 파이프라인
 * 전체를 말하던 것**이다.
 *
 * **거부 사유도 결과다.** 지금까지는 [학습]을 눌러야 알 수 있었다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { errorMessageKey } from '@/errors'
import { planRun } from '@/ml/plan'
import { readDataset, readTestDataset } from '@/project/dataset'
import { tabularDataOf } from '@/project/schema'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const data = computed(() => tabularDataOf(project.file?.document))

const dataset = computed(() => readDataset(project.file))

/**
 * 지금 설정의 계획. **유형을 안 골랐어도 부른다** — 그때 `pending`이 오고, 화면은
 * "유형을 고르면 정해집니다"라고 말한다.
 */
const plan = computed(() => {
  const file = project.file
  const table = dataset.value
  if (!file || !table) return null
  return planRun({
    dataset: table,
    testDataset: readTestDataset(file),
    settings: file.document.settings,
    taskType: project.taskType,
  })
})

/** 계획이 섰을 때의 사실들. 막혔거나 아직이면 `null`이다. */
const facts = computed(() => {
  const current = plan.value
  return current?.ok === true ? current : null
})

/** 학습이 거부하는 사유. 있으면 나머지 숫자는 아직 뜻이 없다. */
const blocked = computed(() => {
  const current = plan.value
  if (current === null || current.ok || current.reason.kind !== 'error') return null
  return t(errorMessageKey(current.reason.code), current.reason.params)
})

/** 아직 유형을 안 골랐는가. 실패가 아니라 정해지지 않은 상태다. */
const pending = computed(() => plan.value?.ok === false && plan.value.reason.kind === 'pending')

const rows = (count: number): string => t('preprocess.tabular.summaryRowUnit', count)
const features = (count: number): string => t('preprocess.tabular.summaryFeatureUnit', count)

/**
 * 인코딩 뒤 특성 수. **원-핫이면 열 하나가 범주 수만큼 늘어난다** — 학생이 다음에
 * 만날 개념이고 지금은 아무 데서도 안 보인다. 안 늘어났으면 이 줄이 없다.
 */
const expanded = computed(() => {
  const current = facts.value
  if (!current) return null
  const { columns, featureNames } = current.preprocessor
  return featureNames.length === columns.length ? null : featureNames.length
})

/** 안 뽑힌 행. 뽑기를 안 켰으면 없다. */
const unused = computed(() => {
  const current = facts.value
  if (!current) return null
  const rest = current.usable.length - current.sampled.length
  return rest > 0 ? rest : null
})
</script>

<template>
  <section v-if="data" class="rounded-panel border border-line bg-surface p-4">
    <h2 class="font-bold">{{ t('preprocess.summaryTitle') }}</h2>

    <!-- 거부 사유는 두 열 위에 전체 폭으로. 막혀 있으면 아래 숫자는 아직 뜻이 없다. -->
    <p v-if="blocked" class="mt-2 font-bold text-danger">{{ blocked }}</p>

    <!--
      **위 두 카드와 세로로 짝을 맞춘다** — 왼쪽에서 고른 것의 결과가 왼쪽 아래,
      오른쪽 설정의 결과가 오른쪽 아래다. 높이는 맞추지 않는다(줄 수가 상태마다 변한다).
    -->
    <div class="mt-3 grid items-start gap-x-8 gap-y-5 md:grid-cols-2">
      <dl class="flex flex-col gap-1.5">
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.roleTarget') }}</dt>
          <dd class="truncate">{{ data.target ?? t('meta.none') }}</dd>
        </div>

        <div v-if="facts" class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryFeatures') }}</dt>
          <dd class="tabular-nums">{{ features(facts.preprocessor.columns.length) }}</dd>
        </div>

        <div v-if="expanded !== null" class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryEncoded') }}</dt>
          <dd class="tabular-nums">{{ features(expanded) }}</dd>
        </div>

        <div
          v-if="facts && facts.preprocessor.excludedColumns.length > 0"
          class="flex justify-between gap-4"
        >
          <dt class="shrink-0 font-bold text-ink-soft">
            {{ t('preprocess.tabular.summaryExcluded') }}
          </dt>
          <dd class="truncate">
            {{ facts.preprocessor.excludedColumns.map((column) => column.name).join(', ') }}
          </dd>
        </div>

        <!--
          **설정 셋은 언제나 말한다.** 계획이 막혀도 학생이 고른 것은 그대로이고,
          무엇이 켜져 있는지 모르는 채로 사유만 보는 것이 더 나쁘다.
        -->
        <div class="mt-2 flex justify-between gap-4 border-t border-line pt-2">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.missing') }}</dt>
          <dd>{{ t(`missingStrategy.${data.preprocessing.missing}`) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.scaling') }}</dt>
          <dd>{{ t(`scalingMethod.${data.preprocessing.scaling}`) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.encoding') }}</dt>
          <dd>{{ t(`categoricalEncoding.${data.preprocessing.categoricalEncoding}`) }}</dd>
        </div>

        <!-- 데이터 누수를 말하는 자리다. 지금까지는 코드 주석에만 있었다. -->
        <p v-if="facts" class="mt-1 text-ink-faint">
          {{ t('preprocess.tabular.summaryFitNote') }}
        </p>
      </dl>

      <dl class="flex flex-col gap-1.5">
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryTotal') }}</dt>
          <!-- **계획이 못 서도 전체 행 수는 안다.** 정본을 읽은 것이 곧 그 숫자다. -->
          <dd class="tabular-nums">{{ rows(dataset?.rows.length ?? 0) }}</dd>
        </div>

        <template v-if="facts">
          <div class="flex justify-between gap-4">
            <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryUsable') }}</dt>
            <dd class="tabular-nums">{{ rows(facts.usable.length) }}</dd>
          </div>

          <div v-if="unused !== null" class="flex justify-between gap-4">
            <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summarySampled') }}</dt>
            <dd class="tabular-nums">{{ rows(facts.sampled.length) }}</dd>
          </div>

          <!--
            **군집이어도 이 자리를 비우지 않는다.** 학생이 정한 설정이 어디 갔는지
            모르게 되기 때문이다 (open-decisions.md).
          -->
          <p v-if="facts.isClustering" class="mt-2 border-t border-line pt-2 text-ink-soft">
            {{ t('preprocess.tabular.summaryClustering') }}
          </p>

          <template v-else>
            <div class="mt-2 flex justify-between gap-4 border-t border-line pt-2">
              <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryTrain') }}</dt>
              <dd class="tabular-nums">{{ rows(facts.split.trainIndices.length) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="font-bold text-ink-soft">
                {{
                  facts.testFromProvided
                    ? t('preprocess.tabular.summaryTestFile')
                    : t('preprocess.tabular.summaryTest')
                }}
              </dt>
              <dd class="tabular-nums">{{ rows(facts.split.testIndices.length) }}</dd>
            </div>
          </template>
        </template>

        <p v-if="pending" class="text-ink-soft">{{ t('preprocess.tabular.summaryPending') }}</p>
      </dl>
    </div>
  </section>
</template>
