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

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import { useFormat } from '@/composables/useFormat'
import { importTable, openTable, type TableDocument } from '@/data/table'
import { toCanonicalCsv } from '@/data/serialize'
import { PREDICT_PAGE_SIZE } from '@/limits'
import type { Prediction } from '@/ml/metrics'
import {
  interpreterFor,
  loadModel,
  loadModelProba,
  type LoadContext,
  type Predict,
  type ProbaModel,
} from '@/ml/models'
import {
  assignAnswerColors,
  cellColorIndex,
  chosenProbability,
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

/** 예측할 파일이 붙어 있는가. */
const hasFile = computed(() => predictDataset.value !== null)

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

/**
 * 파일 고르기 창을 연다. **바가 부른다** — 누르는 것은 전부 화면 위 동작 바에 모이는데
 * (architecture.md §8.13.1 "동작 바는 세 경로가 함께 쓴다"), 바는 판이 그리므로 여기
 * 상태에 손이 닿지 않는다. 파일에 얽힌 것(고르는 중인 시트, 머리글 여부, 읽는 중인지)이
 * 전부 이 컴포넌트에 있어서 **상태를 위로 올리는 대신 손잡이를 내준다.**
 */
function pickFile(): void {
  fileInput.value?.click()
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
    toasts.push('success', 'predict.tabular.fileApplied')
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
 * 파일에 없는데 어느 모델이 보는 열들. **비어 있지 않으면 그 모델의 칸이 전부 빈다** -
 * `predictPage`가 같은 판정을 (모델마다) 하고 `PREDICT_DATASET_COLUMN_MISSING`을 준다.
 *
 * **화면이 조용히 빈 표를 보여주면 안 되므로 여기서 한 번 더 센다.** 답이 없는 칸은
 * 원래 빈 칸이라(사유로 꺼진 모델, 빈 값이 있는 행) 표만 봐서는 무슨 일이 났는지 알
 * 수 없는데, 이 경우는 **파일 하나를 다시 올리면 전부 풀리는 상태**라 말해 줄 값어치가
 * 있다. 파일을 붙인 뒤에 특성을 바꿔 재학습하면 여기로 온다
 * (open-decisions.md "붙일 때 본 것을 예측 직전에 다시 본다").
 */
const missingColumns = computed(() => {
  const available = new Set(predictDataset.value?.columns ?? [])
  const missing = new Set<string>()
  for (const model of props.models) {
    if (model.reason) continue
    const preprocessor = props.preprocessors.get(model.experiment.id)
    if (!preprocessor) continue
    for (const column of preprocessor.columns) {
      if (!available.has(column.name)) missing.add(column.name)
    }
  }
  return [...missing]
})

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
interface LoadedModels {
  readonly predictors: Map<string, Predict>
  /** 확률을 내는 모델만 들어 있다 (mlpx-spec.md §5.4). */
  readonly probaModels: Map<string, ProbaModel>
}

let predictorCache: { signature: string; loaded: LoadedModels } | null = null

function predictorsFor(): LoadedModels {
  if (predictorCache?.signature === signature.value) return predictorCache.loaded
  const loaded = loadPredictors()
  predictorCache = { signature: signature.value, loaded }
  return loaded
}

/** predict 함수들을 로드한다. 모델 바이트를 zip에서 꺼내는 것은 이 화면의 일이다. */
function loadPredictors(): LoadedModels {
  const file = project.file
  const predictors = new Map<string, Predict>()
  const probaModels = new Map<string, ProbaModel>()
  if (!file) return { predictors, probaModels }

  for (const model of props.models) {
    const preprocessor = props.preprocessors.get(model.experiment.id)
    const path = model.run.model?.path
    const bytes = path === undefined ? undefined : file.models.get(path)
    if (!preprocessor || bytes === undefined) continue
    try {
      const interpreter = interpreterFor(model.run.model?.format ?? '')
      const context = interpreter?.needsTrainingRows ? contextFor(model, preprocessor) : {}
      const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
      predictors.set(model.run.id, loadModel(payload, context))
      // 확률을 못 내는 형식이면 null이다. **여기서도 형식 이름을 보지 않는다.**
      const proba = loadModelProba(payload, context)
      if (proba) probaModels.set(model.run.id, proba)
    } catch {
      // predictPage가 이 run을 predictors에서 못 찾으면 MODEL_FILE_INVALID 칸을 준다.
    }
  }
  return { predictors, probaModels }
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

  // 열 목록을 함께 넘긴다 - 행의 키로는 "열이 없다"와 "값이 다 비었다"가 안 갈린다.
  const { predictors, probaModels } = predictorsFor()
  const result = predictPage(
    props.models,
    slice,
    props.preprocessors,
    predictors,
    probaModels,
    predictDataset.value?.columns ?? [],
  )

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

/** 한 번 섞은 새 배열. 제자리에서 안 바꾼다 - 원본을 공유하는 곳이 있으면 그쪽이 놀란다. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = temp
  }
  return copy
}

/**
 * 값마다 다른 글자색. `AnswerList.vue`와 같은 팔레트(architecture.md §8.13.1)이지만
 * **팔레트를 공유하진 않는다** - `PredictView.vue`에서 이 화면과 `AnswerList`는
 * `v-if`/`v-else`로 갈려 동시에 안 보이므로, 같은 값이 두 화면에서 같은 색일 이유가
 * 없다. 그래서 여기서 따로, 뜰 때 한 번만 섞는다.
 */
const CHART_CLASSES = shuffled([
  'text-chart-1',
  'text-chart-2',
  'text-chart-3',
  'text-chart-4',
  'text-chart-5',
  'text-chart-6',
  'text-chart-7',
])

/**
 * 값 -> 색 인덱스. **등수(개수 순)가 아니라 처음 본 순서다** - 왜인지, 일곱 개를
 * 넘으면 어떻게 되는지는 `assignAnswerColors`(`ml/predict.ts`)에 있다.
 */
const colorAssignments = shallowRef<ReadonlyMap<Prediction, number>>(new Map())

/**
 * 서명이 바뀌면(파일이 바뀌거나 보이는 모델이 바뀌면) 캐시와 학습 행 캐시를 버리고
 * 첫 페이지를 다시 계산한다. **처음 보일 때도 돈다** (`immediate`) - 그래야 파일이
 * 이미 붙어 있는 프로젝트를 열었을 때도 표가 비어 있지 않다.
 *
 * **색 배정도 여기서 같이 비운다.** 다른 파일·다른 모델이면 값의 세계 자체가
 * 바뀐 것이라 이전 배정을 들고 있을 이유가 없다.
 */
watch(
  signature,
  () => {
    pageCache.value = { signature: signature.value, pages: new Map() }
    trainingRowContexts = new Map()
    predictorCache = null
    colorAssignments.value = new Map()
    void goToPage(0)
  },
  { immediate: true },
)

const currentAnswers = computed(() => pageCache.value.pages.get(page.value) ?? [])

/**
 * 페이지가 새로 계산될 때마다 그 안에서 처음 보는 값에만 색을 배정한다. **이미
 * 배정된 값은 안 건드린다** - 그래야 페이지를 앞뒤로 오가도 같은 값이 같은 색이다.
 */
watch(currentAnswers, (rows) => {
  colorAssignments.value = assignAnswerColors(
    props.models,
    rows,
    colorAssignments.value,
    CHART_CLASSES.length,
  )
})

/**
 * 셀 글자색. 판정(분류인지, 색이 배정된 값인지)은 `cellColorIndex`가 한다
 * (`ml/predict.ts`) - 화면은 그 등수를 팔레트 배열의 자리로 바꾸기만 한다.
 */
function cellColorClass(model: PredictableModel, value: Prediction | undefined): string {
  const index = cellColorIndex(model, value, colorAssignments.value)
  return index === null ? '' : (CHART_CLASSES[index] ?? '')
}

/**
 * 답 하나를 표에 쓸 문자열로. 수치는 언어에 맞게, 아직 없으면 빈 칸이다.
 *
 * **확률을 내는 모델은 그 답의 확신을 괄호로 붙인다** (mlpx-spec.md §5.4) —
 * `FALSE (100%)`. 열을 따로 세우지 않는 이유는 모델이 여럿이면 정작 비교할 열이 화면
 * 밖으로 밀리기 때문이다. **내려받는 파일에서는 반대로 열을 나눈다**
 * (`predictDownloadGrid`) — 저기는 데이터이고 여기는 눈이다.
 *
 * 붙는 숫자는 **답으로 나온 범주의 확률**이지 최댓값이 아니다 (`chosenProbability`).
 */
function cellText(answer: Answer | undefined): string {
  const value = answer?.value
  if (value === undefined) return ''
  const text = typeof value === 'number' ? format.prediction(value) : value

  const ratio = chosenProbability(answer)
  return ratio === null
    ? text
    : t('predict.tabular.cellWithProbability', { value: text, percent: format.percent(ratio) })
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

    // **확률 열은 실제로 확률을 낸 모델에만 선다.** 캐시는 위 ensurePage가 이미 채웠다.
    const { probaModels } = predictorsFor()
    const probabilityNames = props.models.map((model, index) =>
      probaModels.has(model.run.id)
        ? t('predict.tabular.probabilityColumn', { model: modelNames.value[index] ?? '' })
        : null,
    )

    const grid = predictDownloadGrid(
      props.models,
      modelNames.value,
      probabilityNames,
      t('predict.tabular.rowNumber'),
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

/** 고르던 파일을 물린다. */
function cancelPick(): void {
  opened.value = null
}

function setSheet(name: string): void {
  sheetName.value = name
}

function setHasHeader(value: boolean): void {
  hasHeader.value = value
}

/**
 * 바에 내주는 손잡이. **`hasFile`도 함께 준다** — 판이 프로젝트에서 직접 읽을 수도
 * 있지만, 그러면 "파일이 붙었는가"를 두 곳이 각자 판정하게 된다.
 *
 * **v-model 대신 설정 함수를 준다.** 노출된 ref는 읽을 때만 벗겨지고 쓰는 쪽은
 * 보장되지 않는다.
 *
 * **이 목록이 더 길어지면 경계가 잘못된 것이다** — 그때는 파일 고르기 상태를 컴포저블로
 * 빼서 판이 들고 이 컴포넌트가 props로 받아야 한다.
 */
defineExpose({
  pickFile,
  remove,
  download: downloadAction,
  apply,
  cancelPick,
  setSheet,
  setHasHeader,
  busy,
  computing,
  hasFile,
  opened,
  sheetName,
  hasHeader,
})
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.tabular.tableTitle') }}</h3>
      <p class="text-ink-soft">{{ t('predict.tabular.fileLead') }}</p>
    </div>

    <!-- 이미 붙어 있고, 새로 고르는 중이 아니다. -->
    <div
      v-if="project.file?.document.settings.data.predictDataset && !opened"
      class="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <span class="max-w-56 truncate font-bold text-ink">
        {{ project.file.document.settings.data.predictDataset.originalFileName }}
      </span>
      <!-- 이름은 배지, 값은 plaintext (§8.16). 파일 이름은 그 자체가 값이라 배지가 없다. -->
      <span class="flex items-baseline gap-1.5">
        <AppBadge>{{ t('data.tabular.rows') }}</AppBadge>
        <span class="font-bold tabular-nums text-ink">{{ predictDataset?.rows.length ?? 0 }}</span>
      </span>
    </div>

    <!-- 아직 안 붙었거나, 다른 파일로 바꾸는 중이다. -->
    <template v-if="!project.file?.document.settings.data.predictDataset || opened">
      <!-- 고르는 중일 때는 안 그린다. 그때 눌러야 하는 것은 바의 [이 데이터 사용]이다. -->
      <div
        v-if="!opened"
        class="rounded-panel border-2 border-dashed p-4 text-center transition-colors"
        :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong'"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
          {{ busy ? t('data.tabular.reading') : t('data.tabular.choose') }}
        </AppButton>
        <p class="mt-1.5 text-ink-faint">{{ t('data.tabular.dropHint') }}</p>
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
      <p class="font-bold text-ink-soft">{{ t('predict.tabular.fileEmptyReason') }}</p>
      <p class="mt-1 text-ink-faint">{{ t('predict.tabular.fileEmptyNext') }}</p>
    </div>

    <template v-else>
      <label class="flex cursor-pointer items-center gap-2">
        <input v-model="showFeatures" type="checkbox" class="size-4 accent-brand" />
        <span class="font-bold">{{ t('predict.tabular.showFeatures') }}</span>
      </label>

      <p v-if="computing" class="text-ink-soft">{{ t('predict.tabular.computing') }}</p>

      <p
        v-if="missingColumns.length > 0"
        class="rounded-panel border border-danger/30 bg-danger-soft p-3 font-bold text-ink"
      >
        {{ t('client.PREDICT_DATASET_COLUMN_MISSING', { columns: missingColumns }) }}
      </p>

      <div class="overflow-x-auto rounded-panel border border-line">
        <table class="w-full text-left">
          <thead class="bg-surface-sunken">
            <tr>
              <th class="min-w-20 px-3 py-2 font-bold text-ink-soft">
                {{ t('predict.tabular.rowNumber') }}
              </th>
              <template v-if="showFeatures">
                <th
                  v-for="field in props.fields"
                  :key="field.name"
                  class="min-w-32 px-3 py-2 font-bold text-ink-soft"
                >
                  {{ field.name }}
                </th>
              </template>
              <th
                v-for="(model, index) in props.models"
                :key="model.run.id"
                class="min-w-40 px-3 py-2 font-bold text-ink-soft"
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
                :class="cellColorClass(model, currentAnswers[rowIndex]?.[modelIndex]?.value)"
              >
                {{ cellText(currentAnswers[rowIndex]?.[modelIndex]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between gap-4">
        <AppButton variant="secondary" :disabled="atFirstPage" :action="() => goToPage(page - 1)">
          {{ t('common.prevPage') }}
        </AppButton>
        <p class="tabular-nums text-ink-soft">{{ page + 1 }} / {{ totalPages }}</p>
        <AppButton variant="secondary" :disabled="atLastPage" :action="() => goToPage(page + 1)">
          {{ t('common.nextPage') }}
        </AppButton>
      </div>
    </template>
  </div>
</template>
