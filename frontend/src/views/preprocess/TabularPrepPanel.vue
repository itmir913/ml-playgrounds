<script setup lang="ts">
/**
 * 표 데이터의 전처리 작업 공간 — 열 고르기와 정리하기.
 *
 * **이 화면이 표 전용이라는 사실은 `data/kinds.ts`에 있다** (architecture.md §9.1).
 * `PreprocessView`는 종류를 모른 채 판을 하나 그리고, 이미지가 들어오면 여기가 아니라
 * 등록부에 줄이 하나 는다.
 *
 * **레이아웃도 판의 몫이다.** 표는 열이 수십 개라 넓은 칸을 갖지만(§8.9) 이미지 판은
 * 전혀 다른 모양이 된다. 그래서 그리드를 여기서 짜고, **모든 종류에 공통인 것(평가
 * 데이터 나누기)은 `<slot>`으로 받아 자리만 정해 준다** — 나누기는 표에만 있는 개념이
 * 아니므로 이 파일이 그 내용을 알면 안 된다.
 *
 * 스토어를 직접 본다. `data/TabularPanel.vue`와 같은 방식이다 — 판마다 필요한 것이
 * 다르므로 프롭으로 받으면 등록부의 계약이 표 모양이 되어 버린다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { summarizeColumns } from '@/data/columns'
import { columnPlan, requiredTargetKind, rowUsage } from '@/ml/selection'
import { readDataset } from '@/project/dataset'
import {
  CATEGORICAL_ENCODINGS,
  MISSING_STRATEGIES,
  SCALING_METHODS,
  type Preprocessing,
  type ProjectDocument,
} from '@/project/schema'
import { withFeatures, withPreprocessing, withTarget } from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import ColumnPicker from './ColumnPicker.vue'

const { t } = useI18n()
const project = useProjectStore()

const settings = computed(() => project.file?.document.settings ?? null)
const dataset = computed(() => readDataset(project.file))
const columns = computed(() => (dataset.value ? summarizeColumns(dataset.value) : []))

const trainRowUsage = computed(() => {
  const current = settings.value
  if (!current) return null
  return rowUsage(dataset.value, current.features, current.target, current.preprocessing.missing)
})

const plan = computed(() => {
  const current = settings.value
  if (!current || !dataset.value) return null
  return columnPlan({
    columns: columns.value,
    rowCount: dataset.value.rows.length,
    taskType: project.taskType,
    target: current.target,
    features: current.features,
    preprocessing: current.preprocessing,
  })
})

/**
 * 유형이 타깃에 요구하는 것. **아직 안 골랐으면 없다** — 그때는 어떤 열도 자격을 잃지
 * 않는다. 회귀를 고른 뒤 이 화면에 돌아오면 그때 문자 열의 타깃 칸이 꺼진다.
 */
const targetRule = computed(() => requiredTargetKind(project.taskType)?.code)

/**
 * 특성 상태 한 줄. **세 가지 상태를 가른다** — 아직 안 골랐다 / 골랐는데 하나도 안
 * 들어간다 / 몇 개가 들어간다. 가운데만 빨갛다.
 */
const featureSummary = computed(() => {
  if ((settings.value?.features.length ?? 0) === 0) {
    return { text: t('preprocess.noFeatureChosen'), tone: 'text-ink-soft' }
  }
  if ((plan.value?.usableFeatures ?? 0) === 0) {
    return { text: t('preprocess.noUsableFeature'), tone: 'font-bold text-danger' }
  }
  return {
    text: t('preprocess.featureSummary', plan.value?.usableFeatures ?? 0),
    tone: 'text-ink-soft',
  }
})

function apply(next: ProjectDocument): void {
  const file = project.file
  if (file) project.update({ ...file, document: next })
}

function now(): string {
  return new Date().toISOString()
}

function pickTarget(name: string): void {
  const file = project.file
  if (file) apply(withTarget(file.document, name, now()))
}

function toggleFeature(name: string, on: boolean): void {
  const file = project.file
  if (!file) return
  const features = file.document.settings.features
  const next = on ? [...features, name] : features.filter((feature) => feature !== name)
  apply(withFeatures(file.document, next, now()))
}

/** 전부 고를 때도 못 쓰는 열은 뺀다 — 골라도 학습이 거부할 것을 체크해 주지 않는다. */
function setAllFeatures(on: boolean): void {
  const current = plan.value
  const file = project.file
  if (!current || !file) return
  const names = on
    ? current.columns
        .filter((column) => column.role !== 'target' && column.featureIssue === undefined)
        .map((column) => column.summary.name)
    : []
  apply(withFeatures(file.document, names, now()))
}

function setCleaning(patch: Partial<Preprocessing>): void {
  const file = project.file
  if (file) apply(withPreprocessing(file.document, patch, now()))
}
</script>

<template>
  <!--
    **표가 넓은 쪽을 갖는다** (architecture.md §8.9). 열이 수십 개인 표를 반쪽 칸에
    가두면 그 안에서만 옆으로 스크롤하게 된다. 다만 2 대 1은 표에 과했다 - 오른쪽
    설정들이 라디오 줄이라 좁으면 글자마다 접힌다. **6 대 4**로 다섯 칸을 나눈다.
  -->
  <div v-if="settings && plan" class="grid gap-5 md:grid-cols-5">
    <section class="min-w-0 rounded-panel border border-line bg-surface p-4 md:col-span-3">
      <h2 class="font-bold">{{ t('preprocess.columnsTitle') }}</h2>
      <p class="mt-1 text-ink-soft">{{ t('preprocess.columnsLead') }}</p>

      <div class="mt-3">
        <ColumnPicker
          :plan="plan"
          :target-rule="targetRule"
          @pick-target="pickTarget"
          @toggle-feature="toggleFeature"
          @set-all-features="setAllFeatures"
        />
      </div>

      <!--
          **아직 안 고른 것과 골랐는데 못 쓰는 것은 다르다.** 처음 들어온 학생에게
          빨간 글씨를 보여주면 자기가 뭘 잘못한 줄 안다.
        -->
      <p class="mt-3" :class="featureSummary.tone">{{ featureSummary.text }}</p>
      <!-- 빠진 행이 0이면 아무 말도 안 한다 (trainRowUsage가 그때 null이다).
           학생이 반드시 알고 있어야 하는 서술은 다른 컬러를 사용하여 주의를 끌어야 한다. -->
      <p v-if="trainRowUsage" class="mt-1 text-caution">
        {{ t('preprocess.rowsUsable', trainRowUsage) }}
      </p>
    </section>

    <div class="flex min-w-0 flex-col gap-5 md:col-span-2">
      <section class="rounded-panel border border-line bg-surface p-4">
        <h2 class="font-bold">{{ t('preprocess.cleaningTitle') }}</h2>

        <div class="mt-3 flex flex-col gap-4">
          <div>
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.missing') }}</h3>
            <div class="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
              <label
                v-for="strategy in MISSING_STRATEGIES"
                :key="strategy"
                class="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="missing"
                  class="size-4 accent-brand"
                  :checked="settings.preprocessing.missing === strategy"
                  @change="setCleaning({ missing: strategy })"
                />
                {{ t(`missingStrategy.${strategy}`) }}
              </label>
            </div>
            <p class="mt-1 text-ink-faint">{{ t('preprocess.missingNote') }}</p>
          </div>

          <div>
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.scaling') }}</h3>
            <div class="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
              <label
                v-for="method in SCALING_METHODS"
                :key="method"
                class="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="scaling"
                  class="size-4 accent-brand"
                  :checked="settings.preprocessing.scaling === method"
                  @change="setCleaning({ scaling: method })"
                />
                {{ t(`scalingMethod.${method}`) }}
              </label>
            </div>
            <p class="mt-1 text-ink-faint">{{ t('preprocess.scalingNote') }}</p>
          </div>

          <div>
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.encoding') }}</h3>
            <div class="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
              <label
                v-for="encoding in CATEGORICAL_ENCODINGS"
                :key="encoding"
                class="flex cursor-pointer items-center gap-2"
              >
                <input
                  type="radio"
                  name="encoding"
                  class="size-4 accent-brand"
                  :checked="settings.preprocessing.categoricalEncoding === encoding"
                  @change="setCleaning({ categoricalEncoding: encoding })"
                />
                {{ t(`categoricalEncoding.${encoding}`) }}
              </label>
            </div>
            <p class="mt-1 text-ink-faint">{{ t('preprocess.encodingNote') }}</p>
          </div>
        </div>
      </section>
      <!-- 모든 데이터 종류에 공통이다. 내용은 PreprocessView가 넣는다. -->
      <slot />
    </div>
  </div>
</template>
