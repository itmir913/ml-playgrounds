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
import { MIN_SPLIT_ROWS } from '@/limits'
import { columnPlan, requiredTargetKind, rowUsage, trainableRowCount } from '@/ml/selection'
import { readDataset } from '@/project/dataset'
import {
  CATEGORICAL_ENCODINGS,
  MISSING_STRATEGIES,
  SCALING_METHODS,
  type Preprocessing,
  type ProjectDocument,
} from '@/project/schema'
import { withFeatures, withPreprocessing, withSampling, withTarget } from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import ColumnPicker from './ColumnPicker.vue'

const { t } = useI18n()
const project = useProjectStore()

const settings = computed(() => project.file?.document.settings ?? null)
/** 이 판이 다루는 것은 표의 설정이다 (`settings.data`, mlpx-spec.md §3). */
const data = computed(() => settings.value?.data ?? null)
const dataset = computed(() => readDataset(project.file))
const columns = computed(() => (dataset.value ? summarizeColumns(dataset.value) : []))

const trainRowUsage = computed(() => {
  const current = data.value
  if (!current) return null
  return rowUsage(dataset.value, current.features, current.target, current.preprocessing.missing)
})

const plan = computed(() => {
  const current = data.value
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
  if ((data.value?.features.length ?? 0) === 0) {
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
  const features = file.document.settings.data.features
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

/**
 * 뽑기 전에 쓸 수 있는 행 수. **이 손잡이의 천장이다.**
 *
 * `trainableRowCount`에 `undefined`를 넘기는 것이 핵심이다 — 지금 뽑은 값을 반영하면
 * 학생이 3,000을 넣는 순간 천장도 3,000이 되어 다시는 못 올린다.
 */
const usableRowCount = computed(() =>
  trainableRowCount(
    dataset.value,
    data.value?.features ?? [],
    data.value?.target,
    data.value?.preprocessing.missing ?? 'drop',
    undefined,
  ),
)

/** 지금 뽑기로 한 수. 안 뽑으면 `undefined`다. */
const nSamples = computed(() => settings.value?.nSamples)

/**
 * **타깃을 고르기 전에는 잠근다** (`open-decisions.md` #22).
 *
 * 타깃이 없으면 위 천장이 **파일의 행 수**다(`trainableRowCount`가 무엇이 빠질지 아직
 * 모르므로 보수적으로 센다). 그 상태에서 켜면 `nSamples`에 파일 행 수가 박히고, 나중에
 * 타깃을 골라 쓸 수 있는 행이 줄어도 그 숫자는 안 따라간다 — **파일과 실험 스냅샷에
 * 데이터보다 큰 표본 수가 남는다.** 학습은 안 틀리지만(`sampleRows`가 그대로 돌려준다)
 * 파일만 보고 답해야 하는 교사 쪽에서 걸린다.
 */
const samplingLocked = computed(() => data.value?.target === undefined)

/** 뽑은 뒤 남는 행. **모델이 한 번도 보지 않는 줄이다** (open-decisions.md #30). */
const sampleSummary = computed(() => {
  const chosen = nSamples.value
  if (chosen === undefined) return null
  const usable = usableRowCount.value
  // **`trainableRowCount`를 다시 구현하지 않는다.** 같은 규칙이 두 벌이면 어긋난다
  // (2026-08-12 감사 C-1).
  const used = trainableRowCount(
    dataset.value,
    data.value?.features ?? [],
    data.value?.target,
    data.value?.preprocessing.missing ?? 'drop',
    chosen,
  )
  return { usable, used, rest: Math.max(usable - used, 0) }
})

function setSampling(chosen: number | undefined): void {
  const file = project.file
  if (file) apply(withSampling(file.document, chosen, now()))
}

/**
 * 켤 때의 기본값. **천장의 절반이 아니라 천장 그대로다** — 켜자마자 데이터가 줄어들면
 * 학생이 고르지도 않은 표본으로 학습하게 된다. 줄이는 것은 학생이 한다.
 */
function startSampling(input: HTMLInputElement): void {
  setSampling(Math.max(usableRowCount.value, MIN_SPLIT_ROWS))
  // **DOM을 스키마로 되돌린다** (architecture.md §8.15.1). `setSampling`은 열린 프로젝트가
  // 없으면 아무것도 안 하는데, 그때 라디오만 켜진 채로 남으면 화면이 거짓말한다.
  input.checked = nSamples.value !== undefined
}

/**
 * 입력값을 천장과 바닥 사이로 되돌린다. **입력 중에는 부르지 않는다**(change에 건다) —
 * keyup마다 고치면 "3000"을 치는 도중의 "3"이 바닥으로 튀어 올라 뒷자리를 못 친다.
 *
 * **끝에서 칸을 스키마 값으로 다시 쓴다** (`architecture.md` §8.15.1). 안 쓰면 화면이
 * 조용히 거짓말한다 — 클램프한 결과가 지금 값과 **같으면** computed가 안 바뀌고,
 * 그러면 Vue가 DOM 프로퍼티를 다시 안 쓴다. 칸을 비우고 나가거나(파싱 실패) 천장에서
 * 더 큰 수를 치면 학생이 친 것이 칸에 남고 바로 아래 요약 줄은 파일 값을 말한다.
 * **라디오와 달리 숫자 칸에는 "한 번 더 누르면 맞아진다"가 없다.**
 */
function setSampleRows(input: HTMLInputElement): void {
  const parsed = Number.parseInt(input.value, 10)
  const next = Number.isNaN(parsed)
    ? (nSamples.value ?? usableRowCount.value)
    : Math.min(Math.max(parsed, MIN_SPLIT_ROWS), usableRowCount.value)
  setSampling(next)
  input.value = String(next)
}
</script>

<template>
  <!--
    **표가 넓은 쪽을 갖는다** (architecture.md §8.9). 열이 수십 개인 표를 반쪽 칸에
    가두면 그 안에서만 옆으로 스크롤하게 된다. 다만 2 대 1은 표에 과했다 - 오른쪽
    설정들이 라디오 줄이라 좁으면 글자마다 접힌다. **6 대 4**로 다섯 칸을 나눈다.
  -->
  <div v-if="data && plan" class="grid gap-5 md:grid-cols-5">
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
                  :checked="data.preprocessing.missing === strategy"
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
                  :checked="data.preprocessing.scaling === method"
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
                  :checked="data.preprocessing.categoricalEncoding === encoding"
                  @change="setCleaning({ categoricalEncoding: encoding })"
                />
                {{ t(`categoricalEncoding.${encoding}`) }}
              </label>
            </div>
            <p class="mt-1 text-ink-faint">{{ t('preprocess.encodingNote') }}</p>
          </div>
        </div>
      </section>
      <!--
          **뽑기는 나누기 앞에 선다** (architecture.md §8.9). 실행 순서가 그렇고,
          화면을 위에서 아래로 읽으면 그 순서가 그대로 보여야 한다.

          **표에만 있는 개념이라 이 판이 갖는다.** 아래 나누기는 모든 종류에 공통이라
          슬롯으로 온다 - 둘이 붙어 있지만 소유자가 다르다 (open-decisions.md #22).
        -->
      <section class="rounded-panel border border-line bg-surface p-4">
        <h2 class="font-bold">{{ t('preprocess.sampleTitle') }}</h2>
        <p class="mt-1 text-ink-soft">{{ t('preprocess.sampleLead') }}</p>

        <!-- 양자택일이다. 세 번째 상태가 없어야 "일부만 뽑는데 몇 행인지 모르는" 칸이
               생기지 않는다 (아래 나누기 카드와 같은 규칙). -->
        <div class="mt-3 flex flex-col gap-4">
          <label class="flex cursor-pointer items-start gap-2">
            <input
              type="radio"
              name="sampling"
              class="mt-1 size-4 accent-brand"
              :checked="nSamples === undefined"
              @change="setSampling(undefined)"
            />
            <span class="flex flex-col">
              <span class="font-bold">{{ t('preprocess.sampleAll') }}</span>
              <span class="text-ink-faint">{{ t('preprocess.sampleAllNote') }}</span>
            </span>
          </label>

          <div>
            <label class="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="sampling"
                class="mt-1 size-4 accent-brand"
                :checked="nSamples !== undefined"
                :disabled="samplingLocked"
                @change="startSampling($event.target as HTMLInputElement)"
              />
              <span class="flex flex-col">
                <span class="font-bold">{{ t('preprocess.samplePart') }}</span>
                <span class="text-ink-faint">{{ t('preprocess.samplePartNote') }}</span>
              </span>
            </label>

            <!-- **이유 없이 회색이면 고장으로 본다** (architecture.md §8.2). -->
            <p v-if="samplingLocked" class="mt-1 ml-6 text-caution">
              {{ t('preprocess.sampleNeedsTarget') }}
            </p>

            <div v-if="sampleSummary" class="mt-3 ml-6">
              <label class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="font-bold text-ink-soft">{{ t('preprocess.sampleRows') }}</span>
                <input
                  type="number"
                  class="w-28 rounded border border-line bg-surface px-2 py-1 text-right tabular-nums"
                  :min="MIN_SPLIT_ROWS"
                  :max="usableRowCount"
                  :value="sampleSummary.used"
                  @change="setSampleRows($event.target as HTMLInputElement)"
                />
              </label>
              <!-- **조용히 일부만 쓰지 않는다** - 안 쓰는 행이 몇 행인지 말한다
                     (architecture.md §8.9, §8.13.2의 산점도 상한과 같은 규칙). -->
              <p class="mt-1.5 text-caution">
                {{ t('preprocess.sampleSummary', sampleSummary) }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- 모든 데이터 종류에 공통이다. 내용은 PreprocessView가 넣는다. -->
      <slot />
    </div>
  </div>
</template>
