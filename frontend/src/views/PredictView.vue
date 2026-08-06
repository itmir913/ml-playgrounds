<script setup lang="ts">
/**
 * predict 단계 — **표의 한 줄을 채우는 것이다** (architecture.md §8.13.1).
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

import AppEmpty from '@/components/AppEmpty.vue'
import StepHeader from '@/components/StepHeader.vue'
import { isClientError, type ClientErrorCode } from '@/errors'
import { interpreterFor, loadModel, type LoadContext } from '@/ml/models'
import {
  applyPredictFilter,
  defaultFilter,
  inputFields,
  inputVector,
  mergeFields,
  numericRanges,
  sampleRow,
  predictableModels,
  trainingRowsFor,
  type Answer,
  type PredictableModel,
  type PredictFilter,
} from '@/ml/predict'
import { parsePreprocessor, type Preprocessor } from '@/ml/preprocess'
import { readDataset, readTestDataset } from '@/project/dataset'
import type { Experiment } from '@/project/schema'
import { useProjectStore } from '@/stores/project'
import AnswerList from './predict/AnswerList.vue'
import BatchPredict from './predict/BatchPredict.vue'
import InputRow from './predict/InputRow.vue'
import PredictFilters, { type FilterOption } from './predict/PredictFilters.vue'

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
const preprocessors = computed(() => {
  const parsed = new Map<string, Preprocessor>()
  const file = project.file
  if (!file) return parsed

  for (const experiment of file.document.runs.experiments) {
    const path = experiment.preprocessor?.path
    const bytes = path === undefined ? undefined : file.models.get(path)
    if (bytes === undefined) continue
    try {
      parsed.set(experiment.id, parsePreprocessor(JSON.parse(new TextDecoder().decode(bytes))))
    } catch {
      // 못 읽은 전처리기다. 남의 파일에서 올 수 있고, 그 실험의 모델은 좌표계를 못 세운다.
    }
  }
  return parsed
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

  return predictableModels(file.document, dataset.value !== null).map((entry) => {
    if (entry.reason) return entry
    const standalone = interpreterFor(entry.run.model?.format ?? '')?.includesPreprocessing === true
    const ready = standalone || preprocessors.value.has(entry.experiment.id)
    return ready ? entry : { ...entry, reason: 'MODEL_FILE_INVALID' as ClientErrorCode }
  })
})

/** 실험 이름. **결과 화면의 세로줄과 같은 이름이어야** 학생이 같은 것을 같은 것으로 읽는다. */
const experimentNames = computed(() => {
  const names = new Map<string, string>()
  const experiments = project.file?.document.runs.experiments ?? []
  experiments.forEach((experiment, index) => {
    names.set(experiment.id, t('results.experimentName', { index: index + 1 }))
  })
  return names
})

/**
 * 필터 — 실험 × 알고리즘의 다중 선택이다 (architecture.md §8.13.1 "답을 거르고
 * 세어 본다"). **기본값은 전부 켠 상태**이고, 지금 있는 실험·알고리즘 집합이
 * 바뀌면(새로 학습, 프로젝트 전환) 다시 전부 켠 상태로 돌아간다 — 없어진 것을
 * 계속 선택한 채로 두면 아무것도 안 보이는 필터가 조용히 생긴다.
 */
const filter = ref<PredictFilter>({ experimentIds: new Set(), algorithms: new Set() })

/** 지금 있는 실험·알고리즘의 집합. 이게 바뀔 때만 필터를 다시 연다. */
const availableIds = computed(() => {
  const experiments = [...new Set(models.value.map((entry) => entry.experiment.id))].sort()
  const algorithms = [...new Set(models.value.map((entry) => entry.run.algorithm))].sort()
  return `${experiments.join(',')}|${algorithms.join(',')}`
})

watch(
  availableIds,
  () => {
    filter.value = defaultFilter(models.value)
  },
  { immediate: true },
)

/** 필터 칸에 쓸 이름표. 실험은 결과 화면과 같은 이름, 알고리즘은 등록부 문구다. */
const experimentOptions = computed<FilterOption[]>(() => {
  const seen = new Set<string>()
  const list: FilterOption[] = []
  for (const entry of models.value) {
    if (seen.has(entry.experiment.id)) continue
    seen.add(entry.experiment.id)
    list.push({
      id: entry.experiment.id,
      label: experimentNames.value.get(entry.experiment.id) ?? entry.experiment.id,
    })
  }
  return list
})

const algorithmOptions = computed<FilterOption[]>(() => {
  const seen = new Set<string>()
  const list: FilterOption[] = []
  for (const entry of models.value) {
    if (seen.has(entry.run.algorithm)) continue
    seen.add(entry.run.algorithm)
    list.push({ id: entry.run.algorithm, label: t(`algorithms.${entry.run.algorithm}`) })
  }
  return list
})

/**
 * 필터를 바꾸면 지금까지의 답을 지운다 (architecture.md §8.13.1). 안 지우고 새로
 * 보이는 것만 채우면 답이 있는 카드와 없는 카드가 섞여 집계표의 합계가 화면의
 * 카드 수와 안 맞는다.
 */
function toggleExperiment(id: string): void {
  const next = new Set(filter.value.experimentIds)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  filter.value = { ...filter.value, experimentIds: next }
  answers.value = new Map()
}

function toggleAlgorithm(id: string): void {
  const next = new Set(filter.value.algorithms)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  filter.value = { ...filter.value, algorithms: next }
  answers.value = new Map()
}

/** 필터를 지난 것만. 안 쓰는 모델의 카드도 포함한다 - 사유는 필터와 별개다. */
const visible = computed(() => applyPredictFilter(models.value, filter.value))
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
const ranges = computed(() => {
  const table = dataset.value
  return table
    ? numericRanges(table, fields.value)
    : new Map<string, { min: number; max: number }>()
})

const values = ref<Record<string, string>>({})
const sampled = ref<number | null>(null)
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
const answerListEl = ref<HTMLElement | null>(null)

/** 화면에 한 프레임 양보한다. `setTimeout(0)`이 `requestAnimationFrame`보다 테스트 환경을 덜 가린다. */
function yieldToScreen(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

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
  if (!file) return

  predicting.value = true
  void nextTick(() => {
    answerListEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  try {
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

        const predict = loadModel(JSON.parse(new TextDecoder().decode(bytes)), context)
        const vector = inputVector(entry.experiment, preprocessor, values.value)
        const answer = predict([vector])[0]
        // **수치를 여기서 문자열로 만들지 않는다.** 회귀의 답은 숫자이고 그것을 어떻게
        // 쓸지는 언어가 정한다 (`useFormat`) - `String()`으로 굳히면 3.4000000000000004가
        // 그대로 화면에 뜬다.
        if (answer !== undefined) next.set(entry.run.id, { value: answer })
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
  <!-- `min-h-full`인 이유는 `views/data/TabularPanel.vue`에 적어 두었다. -->
  <div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.predict.label')" :purpose="t('steps.predict.purpose')" />

    <!--
      레일이 이미 잠그지만 빈 상태는 여전히 필요하다 — 모델이 예산에서 밀린 파일이나
      남의 파일을 열면 여기 도달할 수 있다.
    -->
    <div v-if="models.length === 0" class="grid min-h-0 flex-1 place-items-center">
      <AppEmpty :reason="t('predict.emptyReason')" :next="t('predict.emptyNext')" />
    </div>

    <template v-else>
      <!--
        필터 칸은 각 축이 둘 이상일 때만 그 축을 보인다(`PredictFilters` 안에서
        판정한다) - 실험이 하나뿐인데 거를 것을 보이면 아무것도 안 하는 버튼이 된다.
      -->
      <PredictFilters
        :experiments="experimentOptions"
        :algorithms="algorithmOptions"
        :selected-experiments="filter.experimentIds"
        :selected-algorithms="filter.algorithms"
        :experiments-label="t('predict.filterExperiments')"
        :algorithms-label="t('predict.filterAlgorithms')"
        :disabled="predicting"
        @toggle-experiment="toggleExperiment"
        @toggle-algorithm="toggleAlgorithm"
      />

      <!--
        **필터가 전부 걸러 냈을 때다** (architecture.md §8.13.1). 모델이 없는 것과는
        다른 사유다 - 이유 없이 꺼진 것처럼 보이면 안 되므로 따로 문구를 준다.
      -->
      <div v-if="visible.length === 0" class="grid min-h-0 flex-1 place-items-center">
        <AppEmpty :reason="t('predict.filterEmptyReason')" :next="t('predict.filterEmptyNext')" />
      </div>

      <template v-else>
        <!--
          **입력은 양자택일이다 - 한 줄이거나 파일이거나**
          (architecture.md §8.13.1 "입력은 양자택일이다"). `PreprocessView.vue`의
          평가 데이터 라디오와 같은 모양이다 - 묻는 것이 하나("이 모델들에 무엇을
          넣을까")인데 답하는 길이 둘이다.
        -->
        <div
          class="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 md:flex-row md:flex-wrap md:gap-x-8"
        >
          <label class="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="predict-input-mode"
              class="mt-1 size-4 accent-brand"
              :checked="inputMode === 'value'"
              @change="inputMode = 'value'"
            />
            <span class="flex flex-col">
              <span class="font-bold">{{ t('predict.inputChoiceValue') }}</span>
              <span class="text-ink-faint">{{ t('predict.inputChoiceValueNote') }}</span>
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
              <span class="font-bold">{{ t('predict.inputChoiceFile') }}</span>
              <span class="text-ink-faint">{{ t('predict.inputChoiceFileNote') }}</span>
            </span>
          </label>
        </div>

        <div v-if="inputMode === 'value'" class="flex min-h-96 flex-1 flex-col gap-5 md:flex-row">
          <!--
            **붙박이다** (architecture.md §8.13.1 "왼쪽은 붙박이다"). 오른쪽 답 목록은
            실험이 쌓일수록 길어지는데 왼쪽 입력은 짧다 — 붙박이가 아니면 답을 보려고
            내려 스크롤하는 순간 값을 바꿀 입력이 화면 밖으로 사라진다.

            `self-start`가 필요하다 - 안 주면 flex 기본값(`stretch`)이 이 칸을 오른쪽
            칸만큼 늘려서, sticky가 붙을 상단 여백이 칸 안쪽에 생기는 대신 칸 자체가
            아래로 늘어난다. `sticky`는 `md`부터라 그 폭에서는 이미 `sm` 패딩(`p-5`,
            1.25rem)이 적용 중이다 - `top-5`로 맞춰서 붙었을 때도 화면 끝에 딱 붙지
            않고 그 여백을 유지한다.
          -->
          <div class="min-w-0 flex-1 self-start md:sticky md:top-5 md:max-w-lg">
            <InputRow
              :fields="fields"
              :values="values"
              :ranges="ranges"
              :sampled="sampled"
              :disabled="predicting"
              :run-action="run"
              @set="set"
              @sample="sample"
              @clear="clear"
            />
          </div>

          <div ref="answerListEl" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <AnswerList :models="visible" :answers="answers" :experiment-names="experimentNames" />
          </div>
        </div>

        <!--
          **파일 쪽의 결과는 `행 × 모델` 표다** (architecture.md §8.13.1). 표가 열을
          모델 수만큼 가지므로 두 칸으로 쪼개지 않고 전체 폭을 준다.
        -->
        <div v-else class="min-h-0 flex-1">
          <BatchPredict
            :models="visibleUsable"
            :preprocessors="preprocessors"
            :dataset="dataset"
            :fields="fields"
            :experiment-names="experimentNames"
          />
        </div>
      </template>
    </template>

    <!--
      **파일에 안 남는다는 사실을 말한다** (mlpx-spec.md §0). 학생이 여기서 마음껏
      눌러 보려면 무엇이 남고 무엇이 안 남는지 알아야 한다.
    -->
    <p class="text-ink-faint">{{ t('predict.notSaved') }}</p>
  </div>
</template>
