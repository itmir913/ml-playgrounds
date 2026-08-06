<script setup lang="ts">
/**
 * 일괄 예측 — 파일로 여러 줄을 한 번에 예측한다
 * (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다", architecture.md §8.13.1).
 *
 * **왼쪽 입력이 한 줄이냐 파일이냐로 갈리는 자리의 "파일" 쪽이다.** 답을 보여주는 오른쪽
 * 대신 여기는 **결과가 표 자체다** — 1열이 행 번호, 2열부터 모델이다.
 *
 * **판정과 계산은 전부 화면 밖에 있다** (`ml/predict.ts`의 `predictPage` 등). 여기가
 * 하는 일은 파일에서 모델 바이트를 꺼내 그 함수들에 넘기고, 페이지를 캐시하고,
 * 결과를 그리는 것까지다 - "조용히 틀린 결과"를 막으려고 계산 자체는 순수 함수에
 * 맡긴다.
 */

import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useFormat } from '@/composables/useFormat'
import { importTable, openTable, type TableDocument } from '@/data/table'
import { toCanonicalCsv } from '@/data/serialize'
import { PREDICT_PAGE_SIZE } from '@/limits'
import { interpreterFor, loadModel, type LoadContext, type Predict } from '@/ml/models'
import {
  predictDownloadGrid,
  predictPage,
  predictPageSignature,
  trainingRowsFor,
  type Answer,
  type PredictableModel,
  type PredictionField,
} from '@/ml/predict'
import type { Dataset, Preprocessor } from '@/ml/preprocess'
import { whereTrainedKeyOf } from '@/ml/results'
import { applyPredictDataset, readPredictDataset, removePredictDataset } from '@/project/dataset'
import { downloadBytes } from '@/project/download'
import { projectFileName } from '@/project/format'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

/** 예측용 파일이 받아들이는 형식. 데이터 화면·평가 데이터와 같다 (data/kinds.ts). */
const PREDICT_FILE_ACCEPT = '.csv,.xlsx'

const props = defineProps<{
  /** 지금 보이는(필터를 지난) 쓸 수 있는 모델들. */
  models: readonly PredictableModel[]
  preprocessors: ReadonlyMap<string, Preprocessor>
  /** 참조형 모델의 학습 행을 만드는 데 필요한 학습 정본. 없으면 참조형만 못 쓴다. */
  dataset: Dataset | null
  /** 채워야 하는 칸 - 여러 실험의 합집합이다 (§8.13.1 "칸은 실험들의 합집합이다"). */
  fields: readonly PredictionField[]
  /** 실험 id -> 화면에 쓰는 이름. 결과 화면의 세로줄과 같은 이름이어야 한다. */
  experimentNames: ReadonlyMap<string, string>
}>()

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()
const toasts = useToastStore()

const predictDataset = computed(() => readPredictDataset(project.file))

const fileInput = shallowRef<HTMLInputElement | null>(null)
const dragging = shallowRef(false)
const busy = shallowRef(false)
/** 아직 확정하지 않은 파일. 확정하면 비운다 - 데이터 화면·평가 데이터와 같은 모양이다. */
const opened = shallowRef<{ document: TableDocument; fileName: string } | null>(null)
const sheetName = shallowRef<string | undefined>(undefined)
const hasHeader = shallowRef(true)

async function readFile(file: File): Promise<void> {
  busy.value = true
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = await openTable(bytes, file.name)
    opened.value = { document, fileName: file.name }
    sheetName.value = document.sheetNames[0]
    hasHeader.value = true
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 같은 파일을 다시 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 안 뜬다.
  input.value = ''
  if (file) void readFile(file)
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void readFile(file)
}

/**
 * 붙인다. **`applyTestDataset`과 결정적으로 다르다 - 실험을 지우지 않는다.** 예측
 * 데이터는 점수에 영향을 주지 않으므로 확인 대화상자도 없다 - 되돌릴 수 없는 조작이
 * 아니다.
 */
async function apply(): Promise<void> {
  const source = opened.value
  const file = project.file
  if (!source || !file || busy.value) return

  busy.value = true
  try {
    const imported = importTable(source.document, sheetName.value)
    const applied = applyPredictDataset(file, imported, {
      fileName: source.fileName,
      hasHeader: hasHeader.value,
      now: new Date().toISOString(),
      requiredColumns: props.fields.map((field) => field.name),
    })
    await project.save(applied.project)

    opened.value = null
    toasts.push('success', 'predict.fileApplied')
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  const file = project.file
  if (!file || busy.value) return

  busy.value = true
  try {
    const removed = removePredictDataset(file, new Date().toISOString())
    await project.save(removed.project)
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

/** 파일의 모든 행. 칸 이름 -> 값이라 `inputVector`에 그대로 넣을 수 있는 모양이다. */
const rows = computed<Record<string, string>[]>(() => {
  const table = predictDataset.value
  if (!table) return []
  return table.rows.map((row) => {
    const values: Record<string, string> = {}
    table.columns.forEach((name, index) => {
      values[name] = row[index] ?? ''
    })
    return values
  })
})

const totalPages = computed(() => Math.max(1, Math.ceil(rows.value.length / PREDICT_PAGE_SIZE)))
const page = shallowRef(0)

const pageRows = computed(() => {
  const start = page.value * PREDICT_PAGE_SIZE
  return rows.value.slice(start, start + PREDICT_PAGE_SIZE)
})

const showFeatures = shallowRef(false)

/**
 * 같은 알고리즘이 실행 방법만 다르게 둘 이상 있으면 뒤에 실행 방법을 괄호로 붙인다
 * (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다"). `predict.modelName`이
 * 이미 "{algorithm} · {runtime}" 모양이므로 그 값을 그대로 괄호 안에 쓴다.
 */
const modelNames = computed(() => {
  const algorithmOf = (model: PredictableModel) => t(`algorithms.${model.run.algorithm}`)
  const counts = new Map<string, number>()
  for (const model of props.models) {
    const name = algorithmOf(model)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return props.models.map((model) => {
    const algorithm = algorithmOf(model)
    if ((counts.get(algorithm) ?? 0) <= 1) return algorithm
    const runtime = t(whereTrainedKeyOf(model.run))
    return `${algorithm} (${runtime})`
  })
})

/**
 * 페이지 캐시. **서명이 바뀌면 통째로 버린다** (architecture.md §8.13.1) - 파일·모델
 * 선택·전처리 설정 중 하나라도 바뀌면 이전 페이지의 답은 다른 것을 잰 값이다.
 */
const pageCache = shallowRef<{ signature: string; pages: Map<number, Answer[][]> }>({
  signature: '',
  pages: new Map(),
})

const signature = computed(() =>
  predictPageSignature(project.file?.predictDataset?.hash ?? '', props.models),
)

/**
 * 참조형 모델의 학습 행. **실험당 한 번만 만든다** - 페이지를 넘길 때마다 학습셋
 * 전체를 다시 전처리하면 저사양 학교 PC에서 느껴질 정도로 비싸다. 서명이 바뀌면
 * (모델 선택이 바뀌면) 함께 버린다 - 유효하지 않은 실험을 계속 들고 있을 이유가 없다.
 */
let trainingRowContexts = new Map<string, LoadContext>()

function contextFor(model: PredictableModel, preprocessor: Preprocessor): LoadContext {
  const seen = trainingRowContexts.get(model.experiment.id)
  if (seen) return seen
  const context: LoadContext = props.dataset
    ? { trainingRows: trainingRowsFor(model.experiment, preprocessor, props.dataset) }
    : {}
  trainingRowContexts.set(model.experiment.id, context)
  return context
}

/**
 * 로드해 둔 predict 함수들. **서명이 같으면 다시 안 만든다.**
 *
 * 없으면 페이지를 넘길 때마다(그리고 내려받을 때는 페이지 수만큼) 모델 JSON을 전부
 * 다시 파싱하고 `loadModel`을 다시 부른다 - 50페이지 × 모델 5개면 250번이다. 페이지를
 * 끊은 이유가 애초에 연산 억제인데(limits.ts의 `PREDICT_PAGE_SIZE`) 그 자리에서 도로
 * 까먹는 셈이다.
 */
let predictorCache: { signature: string; predictors: Map<string, Predict> } | null = null

function predictorsFor(): Map<string, Predict> {
  if (predictorCache?.signature === signature.value) return predictorCache.predictors
  const predictors = loadPredictors()
  predictorCache = { signature: signature.value, predictors }
  return predictors
}

/** predict 함수들을 로드한다. 모델 바이트를 zip에서 꺼내는 것은 이 화면의 일이다. */
function loadPredictors(): Map<string, Predict> {
  const file = project.file
  const predictors = new Map<string, Predict>()
  if (!file) return predictors

  for (const model of props.models) {
    const preprocessor = props.preprocessors.get(model.experiment.id)
    const path = model.run.model?.path
    const bytes = path === undefined ? undefined : file.models.get(path)
    if (!preprocessor || bytes === undefined) continue
    try {
      const interpreter = interpreterFor(model.run.model?.format ?? '')
      const context = interpreter?.needsTrainingRows ? contextFor(model, preprocessor) : {}
      predictors.set(model.run.id, loadModel(JSON.parse(new TextDecoder().decode(bytes)), context))
    } catch {
      // predictPage가 이 run을 predictors에서 못 찾으면 MODEL_FILE_INVALID 칸을 준다.
    }
  }
  return predictors
}

const computing = shallowRef(false)

/**
 * 쪽 넘김 버튼의 잠금. **조합은 여기서 한다** (architecture.md §10.1) — 템플릿에서
 * 조립하면 조건이 늘 때마다 마크업이 길어지고 그 조건을 아무도 테스트하지 않는다.
 */
const atFirstPage = computed(() => computing.value || page.value === 0)
const atLastPage = computed(() => computing.value || page.value >= totalPages.value - 1)

/** 이 페이지가 캐시에 없으면 계산해 채운다. */
async function ensurePage(index: number): Promise<Answer[][]> {
  if (pageCache.value.signature !== signature.value) {
    pageCache.value = { signature: signature.value, pages: new Map() }
  }
  const cached = pageCache.value.pages.get(index)
  if (cached) return cached

  const start = index * PREDICT_PAGE_SIZE
  const slice = rows.value.slice(start, start + PREDICT_PAGE_SIZE)
  if (slice.length === 0) return []

  const result = predictPage(props.models, slice, props.preprocessors, predictorsFor())

  const pages = new Map(pageCache.value.pages)
  pages.set(index, result)
  pageCache.value = { signature: signature.value, pages }
  return result
}

async function goToPage(index: number): Promise<void> {
  if (index < 0 || index >= totalPages.value) return
  computing.value = true
  try {
    page.value = index
    await ensurePage(index)
  } finally {
    computing.value = false
  }
}

/**
 * 서명이 바뀌면(파일이 바뀌거나 보이는 모델이 바뀌면) 캐시와 학습 행 캐시를 버리고
 * 첫 페이지를 다시 계산한다. **처음 보일 때도 돈다** (`immediate`) - 그래야 파일이
 * 이미 붙어 있는 프로젝트를 열었을 때도 표가 비어 있지 않다.
 */
watch(
  signature,
  () => {
    pageCache.value = { signature: signature.value, pages: new Map() }
    trainingRowContexts = new Map()
    predictorCache = null
    void goToPage(0)
  },
  { immediate: true },
)

const currentAnswers = computed(() => pageCache.value.pages.get(page.value) ?? [])

/** 답 하나를 표에 쓸 문자열로. 수치는 언어에 맞게, 아직 없으면 빈 칸이다. */
function cellText(answer: Answer | undefined): string {
  const value = answer?.value
  if (value === undefined) return ''
  return typeof value === 'number' ? format.prediction(value) : value
}

/**
 * 내려받는다. **전체 행이다 - 지금 보이는 페이지가 아니다** (open-decisions.md
 * "일괄 예측은 `행 × 모델` 매트릭스다"). 아직 계산 안 한 페이지는 여기서 마저 계산한다.
 */
async function downloadAction(): Promise<void> {
  computing.value = true
  try {
    const answers: Answer[][] = []
    for (let index = 0; index < totalPages.value; index += 1) {
      answers.push(...(await ensurePage(index)))
    }

    const grid = predictDownloadGrid(
      props.models,
      modelNames.value,
      t('predict.rowNumber'),
      rows.value,
      props.fields.map((field) => field.name),
      answers,
      showFeatures.value,
      (value) => (typeof value === 'number' ? format.prediction(value) : value),
    )
    const name = project.file
      ? projectFileName(project.file.document.manifest).replace(/\.mlpx$/, '.csv')
      : 'predict.csv'
    downloadBytes(toCanonicalCsv(grid), name)
  } finally {
    computing.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.tableTitle') }}</h3>
      <p class="text-ink-soft">{{ t('predict.fileLead') }}</p>
    </div>

    <!-- 이미 붙어 있고, 새로 고르는 중이 아니다. -->
    <div
      v-if="project.file?.document.settings.predictDataset && !opened"
      class="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <span class="max-w-56 truncate font-bold text-ink">
        {{ project.file.document.settings.predictDataset.originalFileName }}
      </span>
      <span class="text-line-strong" aria-hidden="true"> · </span>
      <span class="flex items-center gap-1.5 text-ink-soft">
        <span>{{ t('data.rows') }}</span>
        <span class="font-bold tabular-nums text-ink">{{ predictDataset?.rows.length ?? 0 }}</span>
      </span>
      <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
        {{ t('data.change') }}
      </AppButton>
      <AppButton variant="secondary" :disabled="busy" :action="remove">
        {{ t('predict.fileRemove') }}
      </AppButton>
    </div>

    <!-- 아직 안 붙었거나, 다른 파일로 바꾸는 중이다. -->
    <template v-if="!project.file?.document.settings.predictDataset || opened">
      <div
        v-if="!opened"
        class="rounded-panel border-2 border-dashed p-4 text-center transition-colors"
        :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong'"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
          {{ busy ? t('data.reading') : t('data.choose') }}
        </AppButton>
        <p class="mt-1.5 text-ink-faint">{{ t('data.dropHint') }}</p>
      </div>

      <div v-else class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="max-w-56 truncate font-bold">{{ opened.fileName }}</span>

        <label v-if="opened.document.sheetNames.length > 1" class="flex items-center gap-2">
          <span class="font-bold text-ink-soft">{{ t('data.sheet') }}</span>
          <select
            v-model="sheetName"
            class="rounded-field border border-line-strong bg-surface px-2 py-1"
          >
            <option v-for="name in opened.document.sheetNames" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>

        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="hasHeader" type="checkbox" class="size-4 accent-brand" />
          <span class="font-bold">{{ t('data.hasHeader') }}</span>
        </label>

        <div class="ml-auto flex gap-2">
          <AppButton variant="secondary" @click="opened = null">{{ t('common.cancel') }}</AppButton>
          <AppButton :disabled="busy" :action="apply">{{ t('data.use') }}</AppButton>
        </div>
      </div>
    </template>

    <input
      ref="fileInput"
      type="file"
      :accept="PREDICT_FILE_ACCEPT"
      class="hidden"
      @change="onPick"
    />

    <!-- 아직 파일이 없다. -->
    <div v-if="!predictDataset" class="rounded-panel border border-line bg-surface-sunken p-4">
      <p class="font-bold text-ink-soft">{{ t('predict.fileEmptyReason') }}</p>
      <p class="mt-1 text-ink-faint">{{ t('predict.fileEmptyNext') }}</p>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="showFeatures" type="checkbox" class="size-4 accent-brand" />
          <span class="font-bold">{{ t('predict.showFeatures') }}</span>
        </label>

        <AppButton variant="secondary" :disabled="computing" :action="downloadAction">
          {{ t('predict.download') }}
        </AppButton>
      </div>

      <p v-if="computing" class="text-ink-soft">{{ t('predict.computing') }}</p>

      <div class="overflow-x-auto rounded-panel border border-line">
        <table class="w-full text-left">
          <thead class="bg-surface-sunken">
            <tr>
              <th class="px-3 py-2 font-bold text-ink-soft">{{ t('predict.rowNumber') }}</th>
              <template v-if="showFeatures">
                <th
                  v-for="field in props.fields"
                  :key="field.name"
                  class="px-3 py-2 font-bold text-ink-soft"
                >
                  {{ field.name }}
                </th>
              </template>
              <th
                v-for="(model, index) in props.models"
                :key="model.run.id"
                class="px-3 py-2 font-bold text-ink-soft"
              >
                <span class="flex flex-col">
                  <span>{{
                    props.experimentNames.get(model.experiment.id) ?? model.experiment.id
                  }}</span>
                  <span class="font-normal text-ink-faint">{{ modelNames[index] }}</span>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in pageRows"
              :key="page * PREDICT_PAGE_SIZE + rowIndex"
              class="border-t border-line odd:bg-surface even:bg-surface-sunken"
            >
              <td class="px-3 py-2 tabular-nums text-ink-faint">
                {{ page * PREDICT_PAGE_SIZE + rowIndex + 1 }}
              </td>
              <template v-if="showFeatures">
                <td v-for="field in props.fields" :key="field.name" class="px-3 py-2 tabular-nums">
                  {{ row[field.name] ?? '' }}
                </td>
              </template>
              <td
                v-for="(model, modelIndex) in props.models"
                :key="model.run.id"
                class="px-3 py-2 tabular-nums font-bold"
              >
                {{ cellText(currentAnswers[rowIndex]?.[modelIndex]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between gap-4">
        <AppButton variant="secondary" :disabled="atFirstPage" :action="() => goToPage(page - 1)">
          {{ t('predict.prevPage') }}
        </AppButton>
        <p class="tabular-nums text-ink-soft">{{ page + 1 }} / {{ totalPages }}</p>
        <AppButton variant="secondary" :disabled="atLastPage" :action="() => goToPage(page + 1)">
          {{ t('predict.nextPage') }}
        </AppButton>
      </div>
    </template>
  </div>
</template>
