<script setup lang="ts">
/**
 * 표 데이터의 전처리 작업 공간 — 열 고르기, 정리하기, 뽑기, 그리고 **평가 데이터 받기.**
 *
 * **이 화면이 표 전용이라는 사실은 `data/kinds.ts`에 있다** (architecture.md §9.1).
 * `PreprocessView`는 종류를 모른 채 판을 하나 그리고, 이미지가 들어오면 여기가 아니라
 * 등록부에 줄이 하나 는다.
 *
 * **레이아웃도 판의 몫이다.** 표는 열이 수십 개라 넓은 칸을 갖지만(§8.9) 이미지 판은
 * 전혀 다른 모양이 된다.
 *
 * **슬롯으로 받는 것은 "얼마나 나눌 것인가"뿐이다** (§9.1.1). 비율·층화·씨앗은
 * `settings.split`이라 모든 종류에 공통이고, **"평가 데이터를 무엇으로 어디서 받나"는
 * 종류마다 다르다** — 표는 CSV·엑셀 파일 하나이고 이미지는 폴더나 zip이 된다.
 * 그래서 파일 받기와 시트 고르기가 이 파일에 있다.
 *
 * 스토어를 직접 본다. `data/TabularPanel.vue`와 같은 방식이다 — 판마다 필요한 것이
 * 다르므로 프롭으로 받으면 등록부의 계약이 표 모양이 되어 버린다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import { useRadioGroupGuard } from '@/composables/useRadioGroupGuard'
import { summarizeColumns } from '@/data/columns'
import { importTable, openTable, TABULAR_ACCEPT, type TableDocument } from '@/data/table'
import { MIN_SPLIT_ROWS } from '@/limits'
import {
  columnPlan,
  requiredTargetKind,
  rowUsage,
  stratifyBlock,
  stratifyLocked,
  trainableRowCount,
} from '@/ml/selection'
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
  dataSettings,
  tabularDataOf,
  type Preprocessing,
  type ProjectDocument,
} from '@/project/schema'
import {
  withFeatures,
  withPreprocessing,
  withSampling,
  withSplit,
  withTarget,
} from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import ColumnPicker from './ColumnPicker.vue'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const settings = computed(() => project.file?.document.settings ?? null)
/**
 * 이 판이 다루는 것은 표의 설정이다 (`settings.data`, mlpx-spec.md §3).
 *
 * **판이 등록부에서 표에만 걸려 있으므로 여기 오는 것은 표뿐이다.** 그래도 좁히기를
 * 거치는 이유는 타입이 그걸 모르기 때문이고, 종류가 어긋난 문서가 오면 `null`이 되어
 * 화면이 조용히 빈다 — 이미지 설정을 표로 읽어 그리는 것보다 낫다.
 */
const data = computed(() => tabularDataOf(project.file?.document))
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
 * 특성 상태 한 줄. **네 가지 상태를 가른다** — 아직 안 골랐다 / 골랐는데 하나도 안
 * 들어간다 / 고른 것이 전부 들어간다 / 그중 일부만 들어간다. 둘째만 빨갛다.
 *
 * **고른 수와 들어가는 수는 다르다.** 문자 열을 특성으로 골라도 인코딩을 끄면 학습에서
 * 빠지므로, 체크박스는 다섯 개가 켜져 있는데 들어가는 것은 둘일 수 있다. 그 차이가
 * 있을 때만 둘을 말한다 — 늘 "5개 중 5개"라고 하면 아무 일도 없는 화면이 매번 뺄셈을
 * 시킨다.
 */
const featureSummary = computed(() => {
  const chosen = data.value?.features.length ?? 0
  const usable = plan.value?.usableFeatures ?? 0
  if (chosen === 0) {
    return { text: t('preprocess.tabular.noFeatureChosen'), tone: 'text-ink-soft' }
  }
  if (usable === 0) {
    return { text: t('preprocess.tabular.noUsableFeature'), tone: 'font-bold text-danger' }
  }
  return {
    text:
      chosen === usable
        ? t('preprocess.tabular.featureSummary', usable)
        : t('preprocess.tabular.featureSummaryPartial', chosen, { named: { chosen, usable } }),
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
  const features = dataSettings('tabular', file.document.settings).features
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

// ---------------------------------------------------------------------- 층화

/**
 * 층화를 켜고 끈다. **DOM과 파일이 갈리지 않게 끝에 되돌린다** (architecture.md §8.15.1).
 *
 * `:checked`는 `v-model`이 아니라, 계산값이 안 바뀌면 Vue가 DOM 프로퍼티를 다시 안 쓴다.
 * 그런데 브라우저는 클릭한 순간 이미 `checked`를 뒤집어 둔 뒤다. 그래서 여기서 파일을
 * 못 고치면(파일이 없다) **화면은 꺼진 것처럼 보이는데 파일은 켜져 있는** 상태로 남고,
 * 잠금 판정은 파일을 보므로 **입력이 회색이 된 뒤에는 학생이 고칠 문이 없다.**
 *
 * 그래서 둘을 지킨다 - **의도는 파일에서 뒤집고**(브라우저가 바꿔 둔 `checked`는 우리가
 * 만든 결과가 아니다), **끝에 DOM을 파일 값으로 다시 쓴다**(정상 경로에서는 이미 같아서
 * 아무 일도 아니다).
 */
function onStratify(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = project.file
  if (file) {
    apply(withSplit(file.document, { stratify: !file.document.settings.split.stratify }, now()))
  }
  input.checked = project.file?.document.settings.split.stratify ?? false
}

/**
 * 층화를 걸 수 없는 이유. **판정은 화면 밖에 있다** (`ml/selection.ts`의 `stratifyBlock`).
 *
 * 학습이 보는 것과 같은 함수라 "화면은 멀쩡한데 [학습]이 거부한다"가 생기지 않는다.
 */
const stratifyBlockNow = computed(() => {
  const current = data.value
  if (!current) return null
  return stratifyBlock({
    dataset: dataset.value,
    taskType: project.taskType,
    target: current.target,
    features: current.features,
    preprocessing: current.preprocessing,
    nSamples: nSamples.value,
  })
})

const stratifyReason = computed(() => {
  const block = stratifyBlockNow.value
  return block === null ? null : t(`client.${block.code}`, block.params ?? {})
})

/** 잠금 규칙은 화면 밖에 있다 (`ml/selection.ts`의 `stratifyLocked` - 왜 그런지도 거기 있다). */
const stratifyDisabled = computed(() =>
  stratifyLocked(stratifyBlockNow.value, settings.value?.split.stratify ?? false),
)

// ------------------------------------------------------------ 평가 데이터 받기

/** 평가 데이터를 파싱한 표. `split.method`가 `provided`가 아니면 없다. */
const testDataset = computed(() => readTestDataset(project.file))

/** 순수 함수는 ml/selection.ts에 있다 - 컴포넌트 밖에서 테스트한다. */
const testRowUsage = computed(() => {
  const current = data.value
  if (!current) return null
  return rowUsage(
    testDataset.value,
    current.features,
    current.target,
    current.preprocessing.missing,
  )
})

const experimentCount = computed(() => project.file?.document.runs.experiments.length ?? 0)

/** 타깃이 정해진 뒤에만 평가용 파일을 받을 수 있다 (mlpx-spec.md §1.1). */
const targetChosen = computed(() => data.value?.target !== undefined)

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
    toasts.push('success', 'preprocess.tabular.testDataApplied')
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
</script>

<template>
  <!--
    **표가 넓은 쪽을 갖는다** (architecture.md §8.9). 열이 수십 개인 표를 반쪽 칸에
    가두면 그 안에서만 옆으로 스크롤하게 된다. 다만 2 대 1은 표에 과했다 - 오른쪽
    설정들이 라디오 줄이라 좁으면 글자마다 접힌다. **6 대 4**로 다섯 칸을 나눈다.
  -->
  <div v-if="settings && data && plan" class="grid gap-5 md:grid-cols-5">
    <section class="min-w-0 rounded-panel border border-line bg-surface p-4 md:col-span-3">
      <h2 class="font-bold">{{ t('preprocess.tabular.columnsTitle') }}</h2>
      <p class="mt-1 text-ink-soft">{{ t('preprocess.tabular.columnsLead') }}</p>

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
        {{ t('preprocess.tabular.rowsUsable', trainRowUsage) }}
      </p>
    </section>

    <div class="flex min-w-0 flex-col gap-5 md:col-span-2">
      <section class="rounded-panel border border-line bg-surface p-4">
        <h2 class="font-bold">{{ t('preprocess.tabular.cleaningTitle') }}</h2>

        <div class="mt-3 flex flex-col gap-4">
          <div>
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.tabular.missing') }}</h3>
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
            <p class="mt-1 text-ink-faint">{{ t('preprocess.tabular.missingNote') }}</p>
          </div>

          <div>
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.tabular.scaling') }}</h3>
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
            <p class="mt-1 text-ink-faint">{{ t('preprocess.tabular.scalingNote') }}</p>
          </div>

          <div>
            <h3 class="font-bold text-ink-soft">{{ t('preprocess.tabular.encoding') }}</h3>
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
            <p class="mt-1 text-ink-faint">{{ t('preprocess.tabular.encodingNote') }}</p>
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
        <h2 class="font-bold">{{ t('preprocess.tabular.sampleTitle') }}</h2>
        <p class="mt-1 text-ink-soft">{{ t('preprocess.tabular.sampleLead') }}</p>

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
              <span class="font-bold">{{ t('preprocess.tabular.sampleAll') }}</span>
              <span class="text-ink-faint">{{ t('preprocess.tabular.sampleAllNote') }}</span>
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
                <span class="font-bold">{{ t('preprocess.tabular.samplePart') }}</span>
                <span class="text-ink-faint">{{ t('preprocess.tabular.samplePartNote') }}</span>
              </span>
            </label>

            <!-- **이유 없이 회색이면 고장으로 본다** (architecture.md §8.2). -->
            <p v-if="samplingLocked" class="mt-1 ml-6 text-caution">
              {{ t('preprocess.tabular.sampleNeedsTarget') }}
            </p>

            <div v-if="sampleSummary" class="mt-3 ml-6">
              <label class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span class="font-bold text-ink-soft">{{
                  t('preprocess.tabular.sampleRows')
                }}</span>
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
                {{ t('preprocess.tabular.sampleSummary', sampleSummary) }}
              </p>
            </div>
          </div>
        </div>
      </section>

      <!--
        **평가 데이터를 어디서 받나는 종류별이다** (architecture.md 9.1.1). 표는 파일
        하나이고 이미지는 폴더나 zip이 된다. 얼마나 나눌 것인가만 공통이라 슬롯으로 온다.
      -->
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
                <span class="font-bold">{{ t('preprocess.tabular.testDataHoldout') }}</span>
                <span class="text-ink-faint">{{
                  t('preprocess.tabular.testDataHoldoutNote')
                }}</span>
              </span>
            </label>

            <div v-if="testChoice === 'holdout'" class="mt-3 ml-6 flex flex-col gap-4">
              <!--
                **비율과 씨앗은 공통이라 슬롯으로 온다** (architecture.md 9.1.2).
                층화만 여기 있는 이유는 잠기는지와 왜 잠기는지가 이 종류의 라벨 분포에
                달려 있어서다 - 슬롯은 그것을 알 방법이 없다.
              -->
              <slot name="split-ratio" />

              <div>
                <label class="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    class="size-4 accent-brand"
                    :checked="settings.split.stratify"
                    :disabled="stratifyDisabled"
                    @change="onStratify"
                  />
                  <span class="font-bold">{{ t('preprocess.stratify') }}</span>
                </label>
                <!-- 이유 없이 회색이면 고장으로 보이고, 켜진 채 걸린 것은 학생이 꺼야 한다. -->
                <p v-if="stratifyReason" class="mt-1 ml-6 text-caution">{{ stratifyReason }}</p>
              </div>

              <slot />
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
                <span class="font-bold">{{ t('preprocess.tabular.testDataProvided') }}</span>
                <span class="text-ink-faint">{{
                  t('preprocess.tabular.testDataProvidedNote')
                }}</span>
              </span>
            </label>
            <p v-if="!targetChosen" class="mt-1 ml-6 text-caution">
              {{ t('preprocess.tabular.testDataNeedsTarget') }}
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
                v-if="data.testDataset && !openedTest"
                class="flex flex-wrap items-center gap-x-4 gap-y-2"
              >
                <span class="max-w-56 truncate font-bold text-ink">
                  {{ data.testDataset.originalFileName }}
                </span>
                <span class="flex items-center gap-1.5 text-ink-soft">
                  <span>{{ t('data.tabular.rows') }}</span>
                  <span class="font-bold tabular-nums text-ink">
                    {{ testDataset?.rows.length ?? 0 }}
                  </span>
                </span>
                <AppButton variant="secondary" :disabled="testBusy" @click="testFileInput?.click()">
                  {{ t('data.tabular.change') }}
                </AppButton>
                <AppButton variant="secondary" :disabled="testBusy" @click="requestRemoveTest">
                  {{ t('preprocess.tabular.testDataRemove') }}
                </AppButton>
              </div>

              <!-- 아직 안 붙었거나, 다른 파일로 바꾸는 중이다. -->
              <template v-if="!data.testDataset || openedTest">
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
                    {{ testBusy ? t('data.tabular.reading') : t('data.tabular.choose') }}
                  </AppButton>
                  <p class="mt-1.5 text-ink-faint">{{ t('data.tabular.dropHint') }}</p>
                </div>

                <div v-else class="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span class="max-w-56 truncate font-bold">{{ openedTest.fileName }}</span>

                  <label
                    v-if="openedTest.document.sheetNames.length > 1"
                    class="flex items-center gap-2"
                  >
                    <span class="font-bold text-ink-soft">{{ t('data.tabular.sheet') }}</span>
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
                    <span class="font-bold">{{ t('data.tabular.hasHeader') }}</span>
                  </label>

                  <div class="ml-auto flex gap-2">
                    <AppButton variant="secondary" @click="openedTest = null">
                      {{ t('common.cancel') }}
                    </AppButton>
                    <AppButton :disabled="testBusy" @click="requestApplyTest">
                      {{ t('data.tabular.use') }}
                    </AppButton>
                  </div>
                </div>
              </template>

              <!-- 빠진 행이 0이면 아무 말도 안 한다 (testRowUsage가 그때 null이다). -->
              <p v-if="testRowUsage" class="text-ink-faint">
                {{ t('preprocess.tabular.rowsUsable', testRowUsage) }}
              </p>
            </div>
          </div>

          <input
            ref="testFileInput"
            type="file"
            :accept="TABULAR_ACCEPT"
            class="hidden"
            @change="onTestPick"
          />
        </div>
      </section>
    </div>
  </div>

  <!--
    **붙이거나 떼면 지금까지의 실험이 지워진다** - 평가셋이 바뀌면 그 위의 점수가
    전부 다른 것을 잰 값이 된다 (open-decisions.md "학습용과 평가용 파일이 따로일
    수 있다"). data.replaceTitle과 같은 사유·같은 경고다.
  -->
  <AppDialog
    :open="testAttaching"
    :title="t('preprocess.tabular.testDataAttachTitle')"
    :description="t('preprocess.tabular.testDataAttachDescription', experimentCount)"
    @close="testAttaching = false"
  >
    <template #actions>
      <AppButton variant="secondary" @click="testAttaching = false">
        {{ t('common.cancel') }}
      </AppButton>
      <AppButton variant="danger" :disabled="testBusy" :action="applyTest">
        {{ t('preprocess.tabular.testDataAttachConfirm') }}
      </AppButton>
    </template>
  </AppDialog>

  <AppDialog
    :open="testRemoving"
    :title="t('preprocess.tabular.testDataRemoveTitle')"
    :description="t('preprocess.tabular.testDataRemoveDescription', experimentCount)"
    @close="testRemoving = false"
  >
    <template #actions>
      <AppButton variant="secondary" @click="testRemoving = false">
        {{ t('common.cancel') }}
      </AppButton>
      <AppButton variant="danger" :disabled="testBusy" :action="removeTest">
        {{ t('preprocess.tabular.testDataRemoveConfirm') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
