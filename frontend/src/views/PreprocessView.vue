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
import { useRadioGroupGuard } from '@/composables/useRadioGroupGuard'
import { summarizeColumns } from '@/data/columns'
import { importTable, openTable, type TableDocument } from '@/data/table'
import { columnPlan, requiredTargetKind, rowUsage } from '@/ml/selection'
import { newRandomState } from '@/project/create'
import {
  applyTestDataset,
  readDataset,
  readTestDataset,
  removeTestDataset,
} from '@/project/dataset'
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
import { useToastStore } from '@/stores/toasts'
import ColumnPicker from './preprocess/ColumnPicker.vue'

/** 평가용 파일이 받아들이는 형식. 표 데이터 종류가 쓰는 것과 같다 (data/kinds.ts). */
const TEST_DATA_ACCEPT = '.csv,.xlsx'

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()
const toasts = useToastStore()

/** 평가용 비율 슬라이더의 눈금. 스키마는 0과 1 사이면 받는다. */
const TEST_SIZE = { min: 0.05, max: 0.5, step: 0.05 }

const settings = computed(() => project.file?.document.settings ?? null)

/** 정본을 파싱한 표. 바이트가 같으면 다시 파싱하지 않는다 (project/dataset.ts). */
const dataset = computed(() => readDataset(project.file))

/** 평가 데이터를 파싱한 표. `split.method`가 `provided`가 아니면 없다. */
const testDataset = computed(() => readTestDataset(project.file))

/** 열 요약. `dataset`이 그대로면 다시 세지 않는다 — 클릭마다 도는 계산이다. */
const columns = computed(() => (dataset.value ? summarizeColumns(dataset.value) : []))

/** 순수 함수는 ml/selection.ts에 있다 - 컴포넌트 밖에서 테스트한다. */
const trainRowUsage = computed(() => {
  const current = settings.value
  if (!current) return null
  return rowUsage(dataset.value, current.features, current.target, current.preprocessing.missing)
})
const testRowUsage = computed(() => {
  const current = settings.value
  if (!current) return null
  return rowUsage(
    testDataset.value,
    current.features,
    current.target,
    current.preprocessing.missing,
  )
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

const experimentCount = computed(() => project.file?.document.runs.experiments.length ?? 0)

/** 타깃이 정해진 뒤에만 평가용 파일을 받을 수 있다 (mlpx-spec.md §1.1). */
const targetChosen = computed(() => settings.value?.target !== undefined)

/**
 * 화면이 지금 보여주는 선택. **커밋 전 임시 선택이 실제 값을 덮는다.**
 *
 * 파일을 아직 안 올린 채 "②"를 누른 상태는 `settings.split.method`에 없다 - 그건
 * `applyTestDataset`이 성공해야 생기는 값이다. 그 사이를 이 값이 메운다.
 */
const manualTestChoice = ref<'holdout' | 'provided' | null>(null)
const testChoice = computed(
  () =>
    manualTestChoice.value ??
    (settings.value?.split.method === 'provided' ? 'provided' : 'holdout'),
)

const testFileInput = ref<HTMLInputElement | null>(null)
/** "①"/"②" 라디오 그룹의 되돌리기 (`architecture.md` §8.15). */
const testChoiceRadios = useRadioGroupGuard<'holdout' | 'provided'>()
const testDragging = ref(false)
const testBusy = ref(false)
/** 아직 확정하지 않은 평가용 파일. 확정하면 비운다. */
const openedTest = ref<{ document: TableDocument; fileName: string } | null>(null)
const testSheetName = ref<string | undefined>(undefined)
const testHasHeader = ref(true)
const testAttaching = ref(false)
const testRemoving = ref(false)

/**
 * "①"을 고른다. 이미 붙어 있던 평가 데이터가 있으면 뗀다(경고를 거친다).
 *
 * **취소하면 그룹을 직접 되돌린다** (`architecture.md` §8.15) - 확인을 거치는 동안
 * `testChoice`는 그대로 `'provided'`라 Vue가 다시 렌더링해도 라디오의 `checked`를
 * 다시 안 써 준다. `useRadioGroupGuard`로 지금 실제 값에 맞춰 되돌려 둔다 - 취소하면
 * 그대로 남고, 확정되면 `manualTestChoice`가 `'holdout'`으로 바뀌어 다음 렌더링이
 * 알아서 맞춰 준다.
 */
function chooseHoldout(): void {
  openedTest.value = null
  if (settings.value?.split.method === 'provided') {
    testChoiceRadios.resync('provided')
    requestRemoveTest()
  } else {
    manualTestChoice.value = 'holdout'
  }
}

/** "②"를 고른다. **아직 아무 일도 하지 않는다** - 올리는 자리를 펼칠 뿐이다. */
function chooseProvided(): void {
  manualTestChoice.value = 'provided'
}

async function readTestFile(file: File): Promise<void> {
  testBusy.value = true
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = await openTable(bytes, file.name)
    openedTest.value = { document, fileName: file.name }
    testSheetName.value = document.sheetNames[0]
    testHasHeader.value = true
  } catch (error) {
    toasts.pushError(error)
  } finally {
    testBusy.value = false
  }
}

function onTestPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 같은 파일을 다시 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 안 뜬다.
  input.value = ''
  if (file) void readTestFile(file)
}

function onTestDrop(event: DragEvent): void {
  testDragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void readTestFile(file)
}

/** 붙이기 요청. 지울 실험이 있으면 먼저 물어본다 (mlpx-spec.md §1.1 "따라오는 것 넷"). */
function requestApplyTest(): void {
  if (experimentCount.value > 0) {
    testAttaching.value = true
    return
  }
  void applyTest()
}

async function applyTest(): Promise<void> {
  const source = openedTest.value
  const file = project.file
  if (!source || !file || testBusy.value) return

  testBusy.value = true
  try {
    const imported = importTable(source.document, testSheetName.value)
    const applied = applyTestDataset(file, imported, {
      fileName: source.fileName,
      hasHeader: testHasHeader.value,
      now: new Date().toISOString(),
    })
    await project.save(applied.project)

    testAttaching.value = false
    openedTest.value = null
    manualTestChoice.value = null
    toasts.push('success', 'preprocess.testDataApplied')
  } catch (error) {
    toasts.pushError(error)
  } finally {
    testBusy.value = false
  }
}

/** 떼기 요청. 지울 실험이 있으면 먼저 물어본다. */
function requestRemoveTest(): void {
  if (experimentCount.value > 0) {
    testRemoving.value = true
    return
  }
  void removeTest()
}

async function removeTest(): Promise<void> {
  const file = project.file
  if (!file || testBusy.value) return

  testBusy.value = true
  try {
    const removed = removeTestDataset(file, new Date().toISOString())
    await project.save(removed.project)
    testRemoving.value = false
    manualTestChoice.value = 'holdout'
  } catch (error) {
    toasts.pushError(error)
  } finally {
    testBusy.value = false
  }
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
        <!-- 빠진 행이 0이면 아무 말도 안 한다 (trainRowUsage가 그때 null이다). -->
        <p v-if="trainRowUsage" class="mt-1 text-ink-faint">
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

        <section class="rounded-panel border border-line bg-surface p-4">
          <h2 class="font-bold">{{ t('preprocess.testDataTitle') }}</h2>
          <p class="mt-1 text-ink-soft">{{ t('preprocess.testDataLead') }}</p>

          <!-- 양자택일이다 - 세 번째 상태가 없어야 학습 데이터로 채점하는 길이 막힌다
               (open-decisions.md "`분할 안 함`을 없앱니다 - 그 자리가 양자택일이 된다"). -->
          <div class="mt-3 flex flex-col gap-4">
            <div>
              <label class="flex cursor-pointer items-start gap-2">
                <input
                  :ref="testChoiceRadios.register('holdout')"
                  type="radio"
                  name="test-data-choice"
                  class="mt-1 size-4 accent-brand"
                  :checked="testChoice === 'holdout'"
                  @change="chooseHoldout"
                />
                <span class="flex flex-col">
                  <span class="font-bold">{{ t('preprocess.testDataHoldout') }}</span>
                  <span class="text-ink-faint">{{ t('preprocess.testDataHoldoutNote') }}</span>
                </span>
              </label>

              <div v-if="testChoice === 'holdout'" class="mt-3 ml-6 flex flex-col gap-4">
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
            </div>

            <div>
              <label class="flex cursor-pointer items-start gap-2">
                <input
                  :ref="testChoiceRadios.register('provided')"
                  type="radio"
                  name="test-data-choice"
                  class="mt-1 size-4 accent-brand"
                  :disabled="!targetChosen"
                  :checked="testChoice === 'provided'"
                  @change="chooseProvided"
                />
                <span class="flex flex-col">
                  <span class="font-bold">{{ t('preprocess.testDataProvided') }}</span>
                  <span class="text-ink-faint">{{ t('preprocess.testDataProvidedNote') }}</span>
                </span>
              </label>
              <p v-if="!targetChosen" class="mt-1 ml-6 text-caution">
                {{ t('preprocess.testDataNeedsTarget') }}
              </p>

              <div
                v-if="testChoice === 'provided'"
                class="mt-3 ml-6 flex flex-col gap-3"
                @dragover.prevent="testDragging = true"
                @dragleave="testDragging = false"
                @drop.prevent="onTestDrop"
              >
                <!-- 이미 붙어 있고, 새로 고르는 중이 아니다. -->
                <div
                  v-if="settings.testDataset && !openedTest"
                  class="flex flex-wrap items-center gap-x-4 gap-y-2"
                >
                  <span class="max-w-56 truncate font-bold text-ink">
                    {{ settings.testDataset.originalFileName }}
                  </span>
                  <span class="flex items-center gap-1.5 text-ink-soft">
                    <span>{{ t('data.rows') }}</span>
                    <span class="font-bold tabular-nums text-ink">
                      {{ testDataset?.rows.length ?? 0 }}
                    </span>
                  </span>
                  <AppButton
                    variant="secondary"
                    :disabled="testBusy"
                    @click="testFileInput?.click()"
                  >
                    {{ t('data.change') }}
                  </AppButton>
                  <AppButton variant="secondary" :disabled="testBusy" @click="requestRemoveTest">
                    {{ t('preprocess.testDataRemove') }}
                  </AppButton>
                </div>

                <!-- 아직 안 붙었거나, 다른 파일로 바꾸는 중이다. -->
                <template v-if="!settings.testDataset || openedTest">
                  <div
                    v-if="!openedTest"
                    class="rounded-panel border-2 border-dashed p-4 text-center transition-colors"
                    :class="testDragging ? 'border-brand bg-brand-soft' : 'border-line-strong'"
                  >
                    <AppButton
                      variant="secondary"
                      :disabled="testBusy"
                      @click="testFileInput?.click()"
                    >
                      {{ testBusy ? t('data.reading') : t('data.choose') }}
                    </AppButton>
                    <p class="mt-1.5 text-ink-faint">{{ t('data.dropHint') }}</p>
                  </div>

                  <div v-else class="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span class="max-w-56 truncate font-bold">{{ openedTest.fileName }}</span>

                    <label
                      v-if="openedTest.document.sheetNames.length > 1"
                      class="flex items-center gap-2"
                    >
                      <span class="font-bold text-ink-soft">{{ t('data.sheet') }}</span>
                      <select
                        v-model="testSheetName"
                        class="rounded-field border border-line-strong bg-surface px-2 py-1"
                      >
                        <option
                          v-for="name in openedTest.document.sheetNames"
                          :key="name"
                          :value="name"
                        >
                          {{ name }}
                        </option>
                      </select>
                    </label>

                    <label class="flex cursor-pointer items-center gap-2">
                      <input v-model="testHasHeader" type="checkbox" class="size-4 accent-brand" />
                      <span class="font-bold">{{ t('data.hasHeader') }}</span>
                    </label>

                    <div class="ml-auto flex gap-2">
                      <AppButton variant="secondary" @click="openedTest = null">
                        {{ t('common.cancel') }}
                      </AppButton>
                      <AppButton :disabled="testBusy" @click="requestApplyTest">
                        {{ t('data.use') }}
                      </AppButton>
                    </div>
                  </div>
                </template>

                <!-- 빠진 행이 0이면 아무 말도 안 한다 (testRowUsage가 그때 null이다). -->
                <p v-if="testRowUsage" class="text-ink-faint">
                  {{ t('preprocess.rowsUsable', testRowUsage) }}
                </p>
              </div>
            </div>

            <input
              ref="testFileInput"
              type="file"
              :accept="TEST_DATA_ACCEPT"
              class="hidden"
              @change="onTestPick"
            />
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

    <!--
      **붙이거나 떼면 지금까지의 실험이 지워진다** - 평가셋이 바뀌면 그 위의 점수가
      전부 다른 것을 잰 값이 된다 (open-decisions.md "학습용과 평가용 파일이 따로일
      수 있다"). data.replaceTitle과 같은 사유·같은 경고다.
    -->
    <AppDialog
      :open="testAttaching"
      :title="t('preprocess.testDataAttachTitle')"
      :description="t('preprocess.testDataAttachDescription', experimentCount)"
      @close="testAttaching = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="testAttaching = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="danger" :disabled="testBusy" :action="applyTest">
          {{ t('preprocess.testDataAttachConfirm') }}
        </AppButton>
      </template>
    </AppDialog>

    <AppDialog
      :open="testRemoving"
      :title="t('preprocess.testDataRemoveTitle')"
      :description="t('preprocess.testDataRemoveDescription', experimentCount)"
      @close="testRemoving = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="testRemoving = false">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="danger" :disabled="testBusy" :action="removeTest">
          {{ t('preprocess.testDataRemoveConfirm') }}
        </AppButton>
      </template>
    </AppDialog>
  </div>

  <AppEmpty v-else :reason="t('preprocess.emptyReason')" :next="t('preprocess.emptyNext')" />
</template>
