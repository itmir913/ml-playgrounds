<script setup lang="ts">
/**
 * preprocess 단계 — **데이터 얘기만 한다.**
 *
 * 타깃·특성·결측치·스케일링·인코딩·분할이 전부이고 모델은 없다 (architecture.md §8.2).
 * 타깃과 특성은 **데이터의 성질**이라 분류인지 회귀인지와 무관하게 정해진다 — 모델을
 * 골라야 열을 고를 수 있다면 워크플로가 거꾸로 선다. 유형이 좁히는 것은 모델 목록이고
 * 그래서 학습 화면에 있다
 * (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
 *
 * **원본은 안 건드린다.** 정본 `dataset/data.csv`는 가져오기 시점에 확정된 뒤 아무도
 * 손대지 않고, 변환은 학습할 때 메모리에서만 일어난다. 파일에 남는 것은 변환된 데이터가
 * 아니라 파라미터다 (`ml/preprocess.ts`). 그래서 스케일링을 켰다 꺼도 되돌아온다.
 *
 * **판단은 전부 이 파일 밖에 있다** — 열 판정은 `ml/selection.ts`, 설정 고치기는
 * `project/settings.ts`다. 여기서 하는 일은 이어 붙이는 것뿐이다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useFormat } from '@/composables/useFormat'
import { summarizeColumns } from '@/data/columns'
import { columnPlan, requiredTargetKind } from '@/ml/selection'
import { newRandomState } from '@/project/create'
import { readDataset } from '@/project/dataset'
import {
  CATEGORICAL_ENCODINGS,
  MISSING_STRATEGIES,
  SCALING_METHODS,
  type Preprocessing,
  type ProjectDocument,
} from '@/project/schema'
import {
  withFeatures,
  withPreprocessing,
  withRandomState,
  withSplit,
  withTarget,
} from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import ColumnPicker from './preprocess/ColumnPicker.vue'

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()

/** 평가용 비율 슬라이더의 눈금. 스키마는 0과 1 사이면 받는다. */
const TEST_SIZE = { min: 0.05, max: 0.5, step: 0.05 }

const settings = computed(() => project.file?.document.settings ?? null)

/** 정본을 파싱한 표. 바이트가 같으면 다시 파싱하지 않는다 (project/dataset.ts). */
const dataset = computed(() => readDataset(project.file))

/** 열 요약. `dataset`이 그대로면 다시 세지 않는다 — 클릭마다 도는 계산이다. */
const columns = computed(() => (dataset.value ? summarizeColumns(dataset.value) : []))

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

function onTestSize(event: Event): void {
  const file = project.file
  if (!file) return
  const testSize = Number((event.target as HTMLInputElement).value)
  apply(withSplit(file.document, { testSize }, now()))
}

function onStratify(event: Event): void {
  const file = project.file
  if (!file) return
  const stratify = (event.target as HTMLInputElement).checked
  apply(withSplit(file.document, { stratify }, now()))
}

/**
 * 씨앗을 다시 뽑기 전에 한 번 막는다
 * (`open-decisions.md` "난수 씨앗은 고정이 기본이고, 다시 뽑는 것은 경고 뒤에 준다").
 *
 * **누르자마자 바뀌면 안 된다.** 되돌릴 수 없고, 지금까지의 실험과 점수를 나란히
 * 비교할 수 없게 되는 조작이다.
 */
const reseeding = ref(false)

function reseed(): void {
  const file = project.file
  reseeding.value = false
  if (!file) return
  apply(withRandomState(file.document, newRandomState(), now()))
}
</script>

<template>
  <div v-if="settings && plan" class="flex flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.preprocess.label')" :purpose="t('steps.preprocess.purpose')">
      <template #context>
        <div class="flex gap-1.5">
          <dt>{{ t('data.rows') }}</dt>
          <dd class="font-bold tabular-nums text-ink">{{ dataset?.rows.length ?? 0 }}</dd>
        </div>
        <div class="flex gap-1.5">
          <dt>{{ t('data.columns') }}</dt>
          <dd class="font-bold tabular-nums text-ink">{{ columns.length }}</dd>
        </div>
      </template>
    </StepHeader>

    <StepChecklist step="preprocess" />

    <!--
      **표가 넓은 쪽을 갖는다** (architecture.md §8.9). 열이 수십 개인 표를 반쪽 칸에
      가두면 그 안에서만 옆으로 스크롤하게 된다. 다만 2 대 1은 표에 과했다 - 오른쪽
      설정들이 라디오 줄이라 좁으면 글자마다 접힌다. **6 대 4**로 다섯 칸을 나눈다.
    -->
    <div class="grid gap-5 md:grid-cols-5">
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

        <section class="rounded-panel border border-line bg-surface p-4">
          <h2 class="font-bold">{{ t('preprocess.splitTitle') }}</h2>

          <div class="mt-3 flex flex-col gap-4">
            <!--
              **평가 데이터를 파일로 받는 화면은 아직 여기 없다**
              (open-decisions.md "학습용과 평가용 파일이 따로일 수 있다"). 그때까지는
              `holdout`이 유일한 방식이라 고를 것 없이 항상 나눈다.
            -->
            <div>
              <!--
                **이름과 값은 기준선으로 맞춘다.** items-center는 글자가 아니라 상자를
                맞추므로, 값이 길어져 이름이 두 줄로 접히면 한 줄짜리 값이 두 줄 높이의
                가운데로 떠서 첫 줄보다 위에 놓인다. 영어는 같은 이름이 30% 정도 길어
                한국어에서 안 접히는 폭에서도 접힌다.
              -->
              <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 class="font-bold text-ink-soft">{{ t('preprocess.testSize') }}</h3>
                <output class="font-bold tabular-nums">
                  {{ format.percent(settings.split.testSize) }}
                </output>
              </div>
              <input
                type="range"
                class="mt-1.5 w-full accent-brand"
                :min="TEST_SIZE.min"
                :max="TEST_SIZE.max"
                :step="TEST_SIZE.step"
                :value="settings.split.testSize"
                :aria-label="t('preprocess.testSize')"
                @input="onTestSize"
              />
              <p class="mt-1 text-ink-faint">{{ t('preprocess.testSizeNote') }}</p>
            </div>

            <label class="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                class="size-4 accent-brand"
                :checked="settings.split.stratify"
                @change="onStratify"
              />
              <span class="font-bold">{{ t('preprocess.stratify') }}</span>
            </label>

            <div>
              <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 class="font-bold text-ink-soft">{{ t('preprocess.randomState') }}</h3>
                <span class="tabular-nums">{{ settings.split.randomState }}</span>
              </div>
              <p class="mt-1 text-ink-faint">{{ t('preprocess.randomStateNote') }}</p>
              <AppButton class="mt-2" variant="secondary" @click="reseeding = true">
                {{ t('preprocess.reseed') }}
              </AppButton>
            </div>
          </div>
        </section>
      </div>
    </div>

    <!--
      **누르자마자 바뀌지 않는다.** 되돌릴 수 없고 지금까지의 실험과 점수를 나란히
      비교할 수 없게 되는 조작이다 (§8.2).
    -->
    <AppDialog
      :open="reseeding"
      :title="t('preprocess.reseedTitle')"
      :description="t('preprocess.reseedDescription')"
      @close="reseeding = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="reseeding = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="danger" @click="reseed">{{ t('preprocess.reseedConfirm') }}</AppButton>
      </template>
    </AppDialog>
  </div>

  <AppEmpty v-else :reason="t('preprocess.emptyReason')" :next="t('preprocess.emptyNext')" />
</template>
