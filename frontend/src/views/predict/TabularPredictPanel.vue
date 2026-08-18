<script setup lang="ts">
/**
 * **표 데이터**의 예측 작업 공간. 표의 한 줄을 채우거나 파일을 올려 답을 본다.
 *
 * 데이터 종류마다 이런 판이 하나씩 있고 `data/kinds.ts`가 고른다. **이미지는 옆에 새
 * 판이 있다** (`ImagePredictPanel.vue`) — 거기는 입력이 양자택일이 아니다
 * (open-decisions.md "이미지 예측 화면").
 *
 * **표의 한 줄을 채우는 것이다** (architecture.md §8.13.1).
 *
 * 왼쪽이 입력 한 줄, 오른쪽이 모델들의 답이다 (§8.10.1). 입력이 지금 하는 일이고
 * 답이 그 판단의 결과다.
 *
 * **이 화면은 프로젝트를 고치지 않는다.** 예측 결과는 파일에 기록하지 않으므로
 * (mlpx-spec.md §0) 자동 저장도 건드리지 않는다 — 여기는 플레이그라운드이지 보고서가
 * 아니다.
 *
 * **예측은 언제나 브라우저다** (mlpx-spec.md §0.2). 서버에서 학습한 모델이라도 실행은
 * 여기서 한다 — 그래서 파일만 있으면 서버 없이 시연이 된다.
 *
 * **판정은 전부 화면 밖에 있다** (`ml/predict.ts`). 여기가 하는 일은 파일에서 바이트를
 * 꺼내 그 함수들에 넘기고 결과를 그리는 것까지다.
 */

import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepActionBar from '@/components/StepActionBar.vue'
import { isClientError } from '@/errors'
import { interpreterFor, loadModel, loadModelProba, type LoadContext } from '@/ml/models'
import {
  algorithmFilterOptions,
  applyPredictFilter,
  defaultFilter,
  experimentFilterOptions,
  filterAxisSignature,
  readPreprocessors,
  withPreprocessorReason,
  toggleAllFilter,
  toggleFilter,
  type FilterAxisId,
  inputFields,
  inputVector,
  mergeFields,
  numericRanges,
  sampleRow,
  showsClusterNames,
  rankAnswersAcross,
  predictableModels,
  trainingRowsFor,
  type Answer,
  type PredictableModel,
  type PredictFilter,
} from '@/ml/predict'
import type { Preprocessor } from '@/ml/preprocess'
import { readDataset, readTestDataset } from '@/project/dataset'
import { yieldToScreen } from '@/screen'
import type { Experiment } from '@/project/schema'
import { experimentNames as experimentNamesOf } from '@/ml/results'
import { useProjectStore } from '@/stores/project'
import AnswerList from './AnswerList.vue'
import ClusterNeighbors from './ClusterNeighbors.vue'
import BatchPredict from './BatchPredict.vue'
import InputRow from './InputRow.vue'
import PredictFilters, { type FilterAxis } from './PredictFilters.vue'

const { t } = useI18n()
const project = useProjectStore()

/**
 * 왼쪽 입력이 양자택일이다 - 한 줄이거나 파일이거나 (architecture.md §8.13.1 "입력은
 * 양자택일이다", `PreprocessView.vue`의 평가 데이터 라디오와 같은 모양이다).
 */
const inputMode = ref<'value' | 'file'>('value')

const dataset = computed(() => readDataset(project.file))

/** 평가 정본. `split.method`가 `provided`인 프로젝트에만 있다 (mlpx-spec.md §1.1). */
const testDataset = computed(() => readTestDataset(project.file))

/**
 * 실험 id -> 그 실험의 전처리기.
 *
 * **파일에서 읽어 검증한다** (`parsePreprocessor`). 캐스팅으로 넘기면 잘못된 `categories`
 * 하나가 예외 없이 한 칸 밀린 원-핫을 만든다. 못 읽은 실험은 여기 없고, 그 실험의 모델은
 * 아래에서 사유와 함께 꺼진다.
 */
/** 모델 경로 → 바이트. 군집 답의 이웃이 중심점을 읽는 데 쓴다 (`ClusterNeighbors`). */
const modelFiles = computed<ReadonlyMap<string, Uint8Array>>(
  () => project.file?.models ?? new Map<string, Uint8Array>(),
)

const preprocessors = computed(() => {
  const file = project.file
  return file ? readPreprocessors(file.document, file.models) : new Map<string, Preprocessor>()
})

/**
 * 목록의 줄들. **모델이 아니라 (실험, run) 쌍이다.**
 *
 * `predictableModels`가 형식·데이터·담김 여부를 보고, 여기서 전처리기까지 본다 —
 * 그것은 파일에서 실제로 읽어 봐야 아는 것이라 순수 함수가 판정할 수 없다.
 */
const models = computed<PredictableModel[]>(() => {
  const file = project.file
  if (!file) return []

  return withPreprocessorReason(
    predictableModels(file.document, dataset.value !== null),
    preprocessors.value,
  )
})

/** 실험 이름. **결과 화면의 세로줄과 같은 이름이어야** 학생이 같은 것을 같은 것으로 읽는다. */
const experimentNames = computed(() =>
  experimentNamesOf(project.file?.document.runs.experiments ?? [], (index) =>
    t('results.experimentName', { index }),
  ),
)

/**
 * 필터 — 실험 × 알고리즘의 다중 선택이다 (architecture.md §8.13.1 "답을 거르고
 * 세어 본다"). **기본값은 전부 켠 상태**이고, 지금 있는 실험·알고리즘 집합이
 * 바뀌면(새로 학습, 프로젝트 전환) 다시 전부 켠 상태로 돌아간다 — 없어진 것을
 * 계속 선택한 채로 두면 아무것도 안 보이는 필터가 조용히 생긴다.
 */
const filter = ref<PredictFilter>({ experimentIds: new Set(), algorithms: new Set() })

/** 지금 있는 실험·알고리즘의 집합. 이게 바뀔 때만 필터를 다시 연다. */
const availableIds = computed(() => filterAxisSignature(models.value))

watch(
  availableIds,
  () => {
    filter.value = defaultFilter(models.value)
  },
  { immediate: true },
)

/** 필터 칸에 쓸 이름표. 실험은 결과 화면과 같은 이름, 알고리즘은 등록부 문구다. */
const experimentOptions = computed(() =>
  experimentFilterOptions(models.value, experimentNames.value),
)

const algorithmOptions = computed(() =>
  algorithmFilterOptions(models.value, (algorithm) => t(`algorithms.${algorithm}`)),
)

/** 필터에 그릴 축. **배열이라 셋째 축이 생겨도 화면 코드가 안 바뀐다.** */
const axes = computed<FilterAxis[]>(() => [
  { id: 'experiment', label: t('predict.filterExperiments'), options: experimentOptions.value },
  { id: 'algorithm', label: t('predict.filterAlgorithms'), options: algorithmOptions.value },
])

/**
 * 필터를 바꾸면 지금까지의 답을 지운다 (architecture.md §8.13.1). 안 지우고 새로
 * 보이는 것만 채우면 답이 있는 카드와 없는 카드가 섞여 집계표의 합계가 화면의
 * 카드 수와 안 맞는다.
 */
function toggle(axis: FilterAxisId, id: string): void {
  filter.value = toggleFilter(filter.value, axis, id)
  answers.value = new Map()
}

function toggleAll(axis: FilterAxisId): void {
  const found = axes.value.find((one) => one.id === axis)
  filter.value = toggleAllFilter(
    filter.value,
    axis,
    (found?.options ?? []).map((option) => option.id),
  )
  answers.value = new Map()
}

/** 필터를 지난 것만. 안 쓰는 모델의 카드도 포함한다 - 사유는 필터와 별개다. */
const visible = computed(() => applyPredictFilter(models.value, filter.value))

/**
 * `값 -> 등수`. **색의 순서만 정한다** (architecture.md §8.13.1). 여기는 답이 한 벌이라
 * 화면 단위와 목록 단위가 같은 말이지만, **판정이 사는 자리는 사진 예측과 같아야 한다** —
 * 갈리면 두 화면이 다른 규칙으로 색을 칠한다.
 */
const ranks = computed(() => rankAnswersAcross(visible.value, [answers.value]))

/** **셈은 스크립트에서 만든다** — `t()` 옆에 계산이 붙으면 문장을 조각내는 것과
 * 구별되지 않아 `tests/i18n-usage.spec.ts`가 잡는다 (`InputRow`와 같은 이유). */
const filterCount = computed(() =>
  // **복수는 total이 정한다.** `{count}`가 없는 문장이라 vue-i18n이 스스로 못 고른다.
  t(
    'predict.filterCount',
    { shown: visible.value.length, total: models.value.length },
    models.value.length,
  ),
)
const visibleUsable = computed(() => visible.value.filter((entry) => entry.reason === undefined))

/**
 * 채워야 하는 칸. **지금 보이는(필터를 지난) 쓸 수 있는 모델들의 합집합이다.**
 *
 * 실험마다 특성이 다를 수 있는데 입력은 한 줄이다. 교집합으로 하면 열을 하나 더 쓴
 * 실험의 모델이 통째로 못 쓰게 되고, 그러면 이 화면이 하려던 비교가 사라진다.
 *
 * **필터를 따라가는 이유도 같다** — 필터로 좁힌 실험이 안 쓰는 열까지 채워야
 * [예측]이 켜지면, 아무 모델도 안 보는 값을 요구하는 셈이다.
 */
const fields = computed(() =>
  mergeFields(
    visibleUsable.value.map((entry) => {
      const preprocessor = preprocessors.value.get(entry.experiment.id)
      return preprocessor ? inputFields(preprocessor) : []
    }),
  ),
)

/** 수치 칸의 값 범위. 표 전체를 훑으므로 칸 목록이 바뀔 때만 다시 센다. */
/** 가진 표를 전부 넘긴다 — 왜 하나로는 안 되는지는 `numericRanges`에 적혀 있다. */
const ranges = computed(() =>
  numericRanges(
    [dataset.value, testDataset.value].filter((one) => one !== null),
    fields.value,
  ),
)

const values = ref<Record<string, string>>({})
const sampled = ref<number | null>(null)
/**
 * 아직 안 채운 칸. **하나라도 있으면 [예측]이 멈춘다** — 비워 두고 누르면 학습셋의
 * 대체값으로 예측되는데, 학생은 자기가 넣은 값으로 예측했다고 믿는다.
 */
const blank = computed(() =>
  fields.value.filter((field) => (values.value[field.name] ?? '').trim() === ''),
)

/** run id -> 답. **비어 있으면 아직 안 눌렀다는 뜻이다.** */
const answers = shallowRef<Map<string, Answer>>(new Map())

/** 값이 바뀌면 지난 답을 지운다. 남겨 두면 지금 화면의 값과 다른 답이 나란히 선다. */
function set(name: string, value: string): void {
  values.value = { ...values.value, [name]: value }
  if (answers.value.size > 0) answers.value = new Map()
}

function clear(): void {
  values.value = {}
  sampled.value = null
  answers.value = new Map()
}

// 프로젝트를 바꿔 들어오면 남은 값이 뜻을 잃는다. 열 이름이 아예 다를 수 있다.
watch(() => project.projectId, clear)

/**
 * [데이터에서 한 줄 가져오기]. 평가에 쓴 행 중에서 무작위로 하나 준다.
 *
 * **보이는 것 중 첫 모델의 실험을 쓴다** (architecture.md §8.13.1). `usable`을 쓰면
 * 그 실험이 필터에 걸려 안 보일 때 화면에 없는 실험의 분할을 따라 행을 주게 된다.
 *
 * 직전에 준 줄은 빼고 뽑는다 — 눌렀는데 화면이 그대로면 고장으로 읽힌다.
 */
function sample(): void {
  const table = dataset.value
  const experiment = visibleUsable.value[0]?.experiment
  if (!table || !experiment) return

  // **두 표를 다 넘긴다.** 평가 행이 어느 표의 번호인지는 그 실험의 split.method가
  // 정하므로(mlpx-spec.md §1.1) 여기서 고르면 조용히 다른 줄이 채워진다.
  const row = sampleRow(
    experiment,
    fields.value,
    { dataset: table, testDataset: testDataset.value },
    sampled.value ?? undefined,
  )
  if (!row) return

  values.value = { ...values.value, ...row.values }
  sampled.value = row.index
  answers.value = new Map()

  // **가져온 줄을 보여 준다.** 버튼이 화면 맨 위 바에 있어서, 답을 보다가 누르면 채워진
  // 칸이 화면 밖에 있다 — 학생은 아무 일도 안 일어난 줄 안다.
  void nextTick(() => {
    inputRowEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

/**
 * 이 모델의 해석기가 요구하는 것을 갖춰 준다.
 *
 * **학습 행은 필요할 때만 만든다** — 참조형만 쓰는데(mlpx-spec.md §5.0) 그 계산이
 * 학습셋 전체의 전처리라 값싸지 않다. 실험마다 한 번만 만들고 나눠 쓴다.
 */
function contextFor(
  experiment: Experiment,
  preprocessor: Preprocessor,
  cache: Map<string, LoadContext>,
): LoadContext {
  const seen = cache.get(experiment.id)
  if (seen) return seen

  const table = dataset.value
  const context: LoadContext = table
    ? { trainingRows: trainingRowsFor(experiment, preprocessor, table) }
    : {}
  cache.set(experiment.id, context)
  return context
}

/** 계산이 도는 동안 켜진다. 필터·입력 칸이 이걸 보고 잠긴다 (architecture.md §8.13.1). */
const predicting = ref(false)

/**
 * 답 목록의 DOM. **[예측]을 누르면 여기로 스스로 스크롤한다** - 왼쪽은 붙박이지만
 * (architecture.md §8.13.1 "왼쪽은 붙박이다") 넓은 화면에서는 오른쪽 답 목록이 화면
 * 위쪽에 있어, 표를 내려 보다가 눌렀으면 다시 올려다봐야 한다. `ExperimentDetail.vue`가
 * 줄을 고르면 속으로 스크롤하는 것과 같은 이유·같은 모양이다.
 */
/**
 * 입력 칸 위에 뜨는 한 줄. **자리는 하나이고 사슬이 나눠 쓴다**
 * (architecture.md §8.13.1 "동작 바는 세 경로가 함께 쓴다").
 *
 * **못 누르는 이유가 방금 한 일보다 앞이다.** 값을 가져온 뒤 한 칸을 지우면 둘 다
 * 참이 되는데, 그때 학생이 알아야 하는 것은 왜 [예측]이 꺼져 있는가다.
 *
 * **문장을 스크립트에서 만든다** — `t()` 옆에 계산이 붙으면 문장을 조각내는 것과
 * 구별되지 않아 `tests/i18n-usage.spec.ts`가 잡는다.
 */
const inputStatus = computed<{ text: string; caution: boolean } | null>(() => {
  if (predicting.value) return { text: t('predict.tabular.computing'), caution: false }
  const missing = blank.value[0]
  if (missing) {
    return {
      text: t('client.PREDICTION_INPUT_INCOMPLETE', { feature: missing.name }),
      caution: true,
    }
  }
  if (sampled.value !== null) {
    return { text: t('predict.tabular.fromDataDone', { index: sampled.value + 1 }), caution: false }
  }
  return null
})

/** 빈 칸이 하나라도 있으면 못 돌린다. **조합은 템플릿이 아니라 여기서 한다** (§10.1). */
const cannotRun = computed(() => predicting.value || blank.value.length > 0)

const answerListEl = ref<HTMLElement | null>(null)
const inputRowEl = ref<HTMLElement | null>(null)

/**
 * 파일 모드의 손잡이. **바는 판이 그리는데 파일 상태는 `BatchPredict`가 든다** — 고르는
 * 중인 시트나 머리글 여부까지 여기로 올리면 판이 두 모드의 상태를 다 지게 된다.
 *
 * **필터가 전부 걸러 내면 `BatchPredict`가 안 그려진다.** 그때 바의 버튼은 부를 곳이
 * 없으므로 꺼진다 — 학생이 할 일은 필터를 켜는 것이다.
 */
const batch = ref<InstanceType<typeof BatchPredict> | null>(null)
const fileBusy = computed(() => !batch.value || batch.value.busy || batch.value.computing)
const hasPredictFile = computed(() => batch.value?.hasFile === true)

/** 고르는 중인 파일. **그동안 바가 드는 것은 [파일 선택]이 아니라 [이 데이터 사용]이다.** */
const picking = computed(() => batch.value?.opened ?? null)

/**
 * 지금 보이는(필터를 지난) 쓸 수 있는 모델에 같은 값을 넣는다.
 *
 * **한 모델의 실패가 나머지를 막지 않는다.** 학습에서 run 하나의 실패가 실험을 죽이지
 * 않는 것과 같은 규칙이다 (mlpx-spec.md §4.1) — 여기서 통째로 멈추면 학생은 멀쩡한
 * 모델의 답까지 못 본다.
 *
 * **필터를 못 바꾸게 계산 중에는 `predicting`을 켠다** (architecture.md §8.13.1). 도는
 * 동안 대상이 바뀌면 어느 집합에 대한 답인지 흐려진다. 그러려면 이 함수가 메인
 * 스레드를 계속 붙잡고 있으면 안 되므로, 모델 하나를 마칠 때마다 화면에 양보한다 —
 * 참조형이 낀 파일에서는 이게 실제로 뜻이 있다(학습셋 전체를 매번 전처리한다).
 *
 * **이미 답이 있는 모델은 다시 안 돈다.** 필터·입력값이 바뀌면 `answers`가 통째로
 * 지워지므로(아래 `toggleExperiment` 등) 실제로는 매번 전부 다시 도는 것과 같지만,
 * 규칙은 "보이면서 답이 없는 것만"이다 - 같은 값을 두 번 계산하지 않는다는 뜻을
 * 코드로 남겨 둔다.
 */
async function run(): Promise<void> {
  const file = project.file
  if (!file || predicting.value) return

  predicting.value = true
  void nextTick(() => {
    answerListEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  try {
    // **첫 모델을 돌리기 전에 한 번 양보한다** (`screen.ts`). 여기서 안 비켜 주면 첫
    // 모델이 도는 동안 단추가 꺼진 적이 없는 상태라, 그 사이의 클릭이 그대로 들어온다.
    await yieldToScreen()

    const next = new Map(answers.value)
    const contexts = new Map<string, LoadContext>()

    for (const entry of visibleUsable.value) {
      if (next.has(entry.run.id)) continue

      const preprocessor = preprocessors.value.get(entry.experiment.id)
      const path = entry.run.model?.path
      const bytes = path === undefined ? undefined : file.models.get(path)

      try {
        // 여기까지 왔는데 없으면 파일이 자기 자신에 대해 거짓말을 하고 있는 것이다.
        if (!preprocessor || bytes === undefined) throw new Error('model entry missing')

        const interpreter = interpreterFor(entry.run.model?.format ?? '')
        // **형식 이름을 보지 않는다** — 등록부의 불리언 하나가 무엇이 필요한지 안다.
        const context = interpreter?.needsTrainingRows
          ? contextFor(entry.experiment, preprocessor, contexts)
          : {}

        const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
        const predict = loadModel(payload, context)
        const vector = inputVector(entry.experiment, preprocessor, values.value)
        const answer = predict([vector])[0]

        // **확률을 내는 모델만 확률이 있다** (mlpx-spec.md §5.4). 여기서도 형식 이름을
        // 보지 않는다 - 등록부에 `loadProba`가 없으면 null이고, 포화한 행도 null이다.
        // 라벨은 위에서 이미 나왔다. **확률로 다시 구하지 않는다.**
        const proba = loadModelProba(payload, context)
        const row = proba?.predict([vector])[0]

        // **수치를 여기서 문자열로 만들지 않는다.** 회귀의 답은 숫자이고 그것을 어떻게
        // 쓸지는 언어가 정한다 (`useFormat`) - `String()`으로 굳히면 3.4000000000000004가
        // 그대로 화면에 뜬다.
        if (answer !== undefined) {
          next.set(entry.run.id, {
            value: answer,
            ...(proba && row ? { probabilities: { classes: proba.classes, values: row } } : {}),
          })
        }
      } catch (error) {
        next.set(entry.run.id, {
          failure: isClientError(error)
            ? { code: error.code, params: error.params }
            : { code: 'MODEL_FILE_INVALID', params: { field: 'payload' } },
        })
      }

      // 답이 나올 때마다 바로 보여준다 - 화면이 멎지 않았다는 것을 눈으로 알 수 있다.
      answers.value = new Map(next)
      await yieldToScreen()
    }
  } finally {
    predicting.value = false
  }
}
</script>

<template>
  <!-- 바깥 여백과 머리는 화면이 준다 (`views/PredictView.vue`). 판은 속만 채운다. -->
  <div class="flex min-h-0 flex-1 flex-col gap-5">
    <!--
      레일이 이미 잠그지만 빈 상태는 여전히 필요하다 — 모델이 예산에서 밀린 파일이나
      남의 파일을 열면 여기 도달할 수 있다.
    -->
    <div v-if="models.length === 0" class="grid min-h-0 flex-1 place-items-center">
      <AppEmpty :reason="t('predict.tabular.emptyReason')" :next="t('predict.tabular.emptyNext')" />
    </div>

    <template v-else>
      <!--
        **누르는 것은 전부 바에 모인다** (architecture.md §8.13.1 "동작 바는 세 경로가
        함께 쓴다"). 이미지 경로와 같은 컴포넌트이고 같은 자리다.
      -->
      <StepActionBar v-if="inputMode === 'value'">
        <AppButton variant="secondary" :disabled="predicting" @click="sample">
          {{ t('predict.tabular.fromData') }}
        </AppButton>
        <AppButton variant="secondary" :disabled="predicting" @click="clear">
          {{ t('predict.tabular.clear') }}
        </AppButton>

        <template #end>
          <AppButton :disabled="cannotRun" :action="run">
            {{ t('predict.run') }}
            <template #pending>{{ t('predict.running') }}</template>
          </AppButton>
        </template>
      </StepActionBar>

      <!--
        **같은 바에 다른 버튼이 선다.** 파일 모드에는 누를 [예측]이 없다 — 쪽마다 저절로
        계산한다. 그래서 오른쪽 끝에 서는 것은 "예측"이 아니라 **이 모드의 결론**이고,
        여기서는 내려받기다.
      -->
      <StepActionBar v-else>
        <!--
          **고르는 중에는 바가 그 파일을 든다.** 이때 [파일 선택]을 그대로 두면 바가
          엉뚱한 버튼을 들고 있게 된다 — 눌러야 하는 것은 [이 데이터 사용]이다.
          머리글 여부를 여기 함께 두는 이유는, 정하는 것과 확정하는 것이 갈리면 학생이
          체크를 바꾸고 다른 자리로 눈을 옮겨야 하기 때문이다.
        -->
        <template v-if="picking">
          <span class="max-w-56 truncate font-bold">{{ picking.fileName }}</span>

          <label v-if="picking.document.sheetNames.length > 1" class="flex items-center gap-2">
            <span class="font-bold text-ink-soft">{{ t('data.tabular.sheet') }}</span>
            <select
              class="rounded-field border border-line-strong bg-surface px-2 py-1"
              :value="batch?.sheetName"
              @change="batch?.setSheet(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="name in picking.document.sheetNames" :key="name" :value="name">
                {{ name }}
              </option>
            </select>
          </label>

          <label class="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              class="size-4 accent-brand"
              :checked="batch?.hasHeader"
              @change="batch?.setHasHeader(($event.target as HTMLInputElement).checked)"
            />
            <span class="font-bold">{{ t('data.tabular.hasHeader') }}</span>
          </label>
        </template>

        <template v-else>
          <AppButton variant="secondary" :disabled="fileBusy" @click="batch?.pickFile()">
            {{ hasPredictFile ? t('predict.tabular.fileChange') : t('data.tabular.choose') }}
          </AppButton>
          <AppButton
            v-if="hasPredictFile"
            variant="secondary"
            :disabled="fileBusy"
            :action="() => batch?.remove()"
          >
            {{ t('predict.tabular.fileRemove') }}
          </AppButton>
        </template>

        <template #end>
          <template v-if="picking">
            <AppButton variant="secondary" @click="batch?.cancelPick()">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton :disabled="fileBusy" :action="() => batch?.apply()">
              {{ t('data.tabular.use') }}
            </AppButton>
          </template>

          <AppButton
            v-else-if="hasPredictFile"
            :disabled="fileBusy"
            :action="() => batch?.download()"
          >
            {{ t('predict.tabular.download') }}
          </AppButton>
        </template>
      </StepActionBar>

      <!--
        **입력은 양자택일이다 - 한 줄이거나 파일이거나**
        (architecture.md §8.13.1 "입력은 양자택일이다"). `PreprocessView.vue`의 평가
        데이터 라디오와 같은 모양이다 - 묻는 것이 하나("이 모델들에 무엇을 넣을까")인데
        답하는 길이 둘이다.

        **정확히 반씩 가른다.** 폭에 따라 나란히 섰다 접혔다 하면 "둘 중 하나"라는 것이
        모양으로 안 보인다.

        **바 아래, 필터 위다.** 무엇을 넣을지가 먼저이고 어느 모델이 답할지가 그 다음이다.
      -->
      <div class="grid gap-3 rounded-panel border border-line bg-surface p-4 md:grid-cols-2">
        <label class="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="predict-input-mode"
            class="mt-1 size-4 accent-brand"
            :checked="inputMode === 'value'"
            @change="inputMode = 'value'"
          />
          <span class="flex flex-col">
            <span class="font-bold">{{ t('predict.tabular.inputChoiceValue') }}</span>
            <span class="text-ink-faint">{{ t('predict.tabular.inputChoiceValueNote') }}</span>
          </span>
        </label>
        <label class="flex cursor-pointer items-start gap-2">
          <input
            type="radio"
            name="predict-input-mode"
            class="mt-1 size-4 accent-brand"
            :checked="inputMode === 'file'"
            @change="inputMode = 'file'"
          />
          <span class="flex flex-col">
            <span class="font-bold">{{ t('predict.tabular.inputChoiceFile') }}</span>
            <span class="text-ink-faint">{{ t('predict.tabular.inputChoiceFileNote') }}</span>
          </span>
        </label>
      </div>

      <!--
        필터 칸은 각 축이 둘 이상일 때만 그 축을 보인다(`PredictFilters` 안에서
        판정한다) - 실험이 하나뿐인데 거를 것을 보이면 아무것도 안 하는 버튼이 된다.

        **두 모드가 같은 자리에서 같은 말을 한다.** 파일 모드에서는 표의 열이 곧 모델이라
        좁힐 수 없어 전체 폭인데, 값 모드만 오른쪽 칸 안으로 넣으면 모드를 바꿀 때마다
        거르개가 화면을 옮겨 다닌다.
      -->
      <PredictFilters
        :axes="axes"
        :filter="filter"
        :count="filterCount"
        :disabled="predicting"
        @toggle="toggle"
        @toggle-all="toggleAll"
      />

      <!--
        **군집 번호의 뜻은 답을 읽기 전에 말한다** (open-decisions.md "머리글은 목록 밖에
        선다"). 서로 다른 학습의 `2번 군집`은 같은 군집이 아닌데, 그걸 모르고 보면
        **화면의 모든 비교가 틀린 비교가 된다** — 조용한 오독이라 스스로 못 알아챈다.

        **필터 바로 아래인 이유는 이 문장이 "지금 보이는 모델들"에 대한 주석이기
        때문이다.** 군집 모델을 걸러 낸 학생에게는 할 말이 없다.
      -->
      <!-- 값 입력 줄은 언제나 있다. 이 화면에는 "답이 설 자리가 없는" 상태가 없다. -->
      <p v-if="showsClusterNames(visible, true)" class="font-bold text-caution">
        {{ t('predict.clusterAnswerNote') }}
      </p>

      <!--
        **필터가 전부 걸러 냈을 때다** (architecture.md §8.13.1). 모델이 없는 것과는
        다른 사유다 - 이유 없이 꺼진 것처럼 보이면 안 되므로 따로 문구를 준다.
      -->
      <div v-if="visible.length === 0" class="grid min-h-0 flex-1 place-items-center">
        <AppEmpty :reason="t('predict.filterEmptyReason')" :next="t('predict.filterEmptyNext')" />
      </div>

      <template v-else>
        <div v-if="inputMode === 'value'" class="flex min-h-96 flex-1 flex-col gap-5 md:flex-row">
          <!--
            **붙박이다** (architecture.md §8.13.1 "왼쪽은 붙박이다"). 오른쪽 답 목록은
            실험이 쌓일수록 길어지는데 왼쪽 입력은 짧다 — 붙박이가 아니면 답을 보려고
            내려 스크롤하는 순간 값을 바꿀 입력이 화면 밖으로 사라진다.

            `self-start`가 필요하다 - 안 주면 flex 기본값(`stretch`)이 이 칸을 오른쪽
            칸만큼 늘려서, sticky가 붙을 상단 여백이 칸 안쪽에 생기는 대신 칸 자체가
            아래로 늘어난다.

            **붙는 자리는 동작 바가 정한다** (`styles/utilities.css`의
            `stick-under-step-bar`). 여기 숫자를 적어 두면 좁은 화면에서 바가 두 줄이
            되는 순간 그만큼 어긋나 바가 이 칸의 머리를 덮는다.
          -->
          <div
            ref="inputRowEl"
            class="min-w-0 flex-1 self-start under-step-bar md:sticky md:max-w-lg md:stick-under-step-bar"
          >
            <InputRow
              :fields="fields"
              :values="values"
              :ranges="ranges"
              :status="inputStatus"
              :disabled="predicting"
              @set="set"
            />
          </div>

          <!--
            **도착 지점이 바 아래에서 멈춘다.** 여백이 없으면 `scrollIntoView`가 목표를
            화면 맨 위에 붙여 놓는데, 그 자리는 이제 붙박이 바가 덮고 있어
            `모델들의 답`이 가려진다.

            **붙박이 열과 같은 이름을 쓴다** — 둘 다 "바 아래 첫 자리"를 가리키므로
            같은 값에서 나온다(§8.13.1 "왼쪽은 붙박이다").
          -->
          <div ref="answerListEl" class="min-h-0 min-w-0 flex-1 overflow-y-auto under-step-bar">
            <!--
              **머리글은 목록 밖이다** (open-decisions.md "머리글은 목록 밖에 선다").
              여기서는 목록이 정확히 하나라 한 번씩만 뜨지만, 사진 예측에서는 같은 셋이
              사진 수만큼 찍혔다. 무엇을 모델에 넣는지는 화면마다 다르므로 호출부가 말한다.
            -->
            <div class="mb-5 flex flex-col gap-1.5">
              <h3 class="text-lg font-bold">{{ t('predict.answerTitle') }}</h3>
              <p class="text-ink-soft">{{ t('predict.tabular.answerLead') }}</p>
            </div>

            <AnswerList
              data-type="tabular"
              :models="visible"
              :answers="answers"
              :experiment-names="experimentNames"
              :ranks="ranks"
              :waiting="t('predict.tabular.waiting')"
            >
              <!--
                **답 목록 안에 든다** (architecture.md §8.13.1). `2번 군집`이라는 답만으로는
                학생에게 정수 하나이고, 그 뜻을 만드는 것이 이 자리다 — 답과 떨어진 별도
                섹션으로 두면 분류를 보다 온 학생에게 **화면이 통째로 달라 보인다.**
                갈림표가 카드 위에 붙는 것과 같은 문법이고 방향만 다르다.
              -->
              <template #detail>
                <ClusterNeighbors
                  :models="visible"
                  :answers="answers"
                  :dataset="dataset"
                  :preprocessors="preprocessors"
                  :model-files="modelFiles"
                  :values="values"
                  :experiment-names="experimentNames"
                />
              </template>
            </AnswerList>
          </div>
        </div>

        <!--
          **파일 쪽의 결과는 `행 × 모델` 표다** (architecture.md §8.13.1). 표가 열을
          모델 수만큼 가지므로 두 칸으로 쪼개지 않고 전체 폭을 준다.
        -->
        <div v-else class="min-h-0 flex-1">
          <BatchPredict
            ref="batch"
            :models="visibleUsable"
            :preprocessors="preprocessors"
            :dataset="dataset"
            :fields="fields"
            :experiment-names="experimentNames"
          />
        </div>
      </template>
    </template>
  </div>
</template>
