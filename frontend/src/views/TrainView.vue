<script setup lang="ts">
/**
 * train 단계 — **모델 얘기만 한다.**
 *
 * 세 축(기계학습 유형 → 모델 → 실행 방법)이 **한 카드 안에** 있다. 서로를 좁히는 것들을
 * 카드로 갈라 놓으면 이어져 있다는 것이 안 보인다 (architecture.md §8.12).
 * **기본값이 없으므로 아무것도 안 골라진 채로 시작한다** — 학생이 고른 분류와 아무도 안
 * 고른 분류는 다르다 (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
 *
 * 타깃과 특성은 여기 없다. 그건 데이터의 성질이라 전처리에서 이미 정해졌다.
 *
 * **[학습] 버튼은 아직 없다.** 실행·진행 표시·취소는 다음 작업이고, 워커 껍데기는
 * 이미 서 있다 (`ml/worker/`, roadmap.md 구현 순서 6).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppEmpty from '@/components/AppEmpty.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { summarizeColumns } from '@/data/columns'
import { algorithmOptions, supportedTaskTypes } from '@/ml/algorithms'
import type { RuntimeContext } from '@/ml/backend'
import {
  algorithmsLosingMeaning,
  columnPlan,
  requiredTargetKind,
  type ChosenModel,
} from '@/ml/selection'
import { readDataset } from '@/project/dataset'
import type { ProjectDocument, TaskType } from '@/project/schema'
import {
  withHyperparameter,
  withRuntime,
  withSelectedAlgorithms,
  withTaskType,
} from '@/project/settings'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import ChosenModels from './train/ChosenModels.vue'
import ModelAxes from './train/ModelAxes.vue'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const settings = computed(() => project.file?.document.settings ?? null)
const dataset = computed(() => readDataset(project.file))
const columns = computed(() => (dataset.value ? summarizeColumns(dataset.value) : []))

/**
 * 실행 방법 판정에 필요한 것들.
 *
 * **서버 상태를 아는 곳이 아직 없다.** 같은 오리진 헬스 엔드포인트를 찌르는 상태 점검
 * 패널이 생기면 거기서 온다(architecture.md §7.3). 그때까지 `unknown`이고, 서버 항목은
 * 이유와 함께 꺼진 채로 보인다 — 지금 그것이 사실이다.
 */
const context = computed<RuntimeContext>(() => ({
  serverStatus: 'unknown',
  engineStates: {},
  rowCount: dataset.value?.rows.length ?? 0,
}))

const taskTypes = computed(() => supportedTaskTypes())

/**
 * 지금 고를 수 있는 모델들. **유형을 안 골랐으면 빈 목록이다.**
 *
 * `algorithmOptions`에 유형을 선택 인자로 열지 않는다 - 유형 없이 판정하면 모든 모델이
 * 고를 수 있는 것처럼 보이고, 그건 이 등록부가 하는 말이 아니다. 화면은 그때 목록 대신
 * "먼저 유형을 고르세요"를 보여준다.
 */
const options = computed(() => {
  const taskType = project.taskType
  if (taskType === undefined) return []
  return algorithmOptions(
    { dataType: project.file?.document.manifest.dataType ?? 'tabular', taskType },
    context.value,
  )
})

/**
 * 쌓인 줄들. **실행 방법을 여기서 채운다.**
 *
 * 파일에서는 선택 항목이라(`{algorithm}`만 있는 줄이 정상이다) 옛 파일이나 남의 파일에
 * 그런 줄이 있다. 화면은 쌍으로 다루므로 실험 기본을 끌어와 채운다 - 실제 학습도 같은
 * 규칙으로 정한다(`ml/experiment.ts`).
 */
const chosen = computed<ChosenModel[]>(() => {
  const current = settings.value
  if (!current) return []
  return current.selectedAlgorithms.map((one) => ({
    algorithm: one.algorithm,
    runtime: one.runtime ?? current.runtime,
  }))
})

/**
 * 지금 고른 유형에서 타깃이 성립하지 않으면 그 사유.
 *
 * **전처리에서 고른 타깃을 여기서 되돌리지 않는다** (mlpx-spec.md §0.1). 유형이 나중에
 * 정해지므로 학생이 방금 한 선택의 옆이 여기이고, 할 말은 "이 조합으로는 답이 나오지
 * 않는다"뿐이다. 고칠 방법은 둘 다 열려 있다 — 유형을 바꾸거나 타깃을 바꾸거나.
 */
const targetIssue = computed(() => {
  const target = settings.value?.target
  const required = requiredTargetKind(project.taskType)
  if (!required || target === undefined) return null

  const summary = columns.value.find((column) => column.name === target)
  if (!summary || summary.kind === required.kind) return null
  return t(`errors.${required.code}`, { target })
})

/** 지금 설정으로 학습에 들어갈 특성 수. 0이면 전처리로 돌아가야 한다. */
const usableFeatures = computed(() => {
  const current = settings.value
  const table = dataset.value
  if (!current || !table) return 0
  return columnPlan({
    columns: columns.value,
    rowCount: table.rows.length,
    taskType: project.taskType,
    target: current.target,
    features: current.features,
    preprocessing: current.preprocessing,
  }).usableFeatures
})

function apply(next: ProjectDocument): void {
  const file = project.file
  if (file) project.update({ ...file, document: next })
}

function now(): string {
  return new Date().toISOString()
}

/**
 * 기계학습 유형을 바꾼다.
 *
 * **뜻을 잃은 모델 선택은 지우고 알린다.** 데이터를 바꿀 때 없어진 열을 선택에서 빼는
 * 것과 같은 처리다(`project/dataset.ts`). 조용히 지우면 학생은 자기가 골라 둔 것이
 * 사라진 줄 모르고, 남겨 두면 [학습]에서 실패한 run으로 만난다.
 */
function pickTaskType(taskType: TaskType): void {
  const file = project.file
  if (!file || file.document.manifest.taskType === taskType) return

  const dropped = algorithmsLosingMeaning(file.document.settings.selectedAlgorithms, taskType)
  apply(withTaskType(file.document, taskType, dropped, now()))

  if (dropped.length > 0) {
    toasts.push('caution', 'train.taskChanged', {
      names: dropped.map((id) => t(`algorithms.${id}`)).join(', '),
    })
  }
}

/**
 * 줄을 하나 담는다. **실행 방법을 줄에 박아 둔다.**
 *
 * 학생이 콕 집어 고른 것이므로 학습이 자동으로 옮기지 않는다 - 못 돌면 사유를 준다
 * (open-decisions.md "실행 방법은 하나의 목록이다"). 화면이 못 담는 조합을 애초에
 * 막으므로 그 경로로 실패할 일은 없다.
 *
 * **마지막에 고른 실행 방법을 실험 기본으로도 적어 둔다.** 스냅샷의 `runtime`이 늘
 * 뜻 있는 값이어야 하고, 다음에 이 화면에 들어왔을 때 드롭다운이 거기서 시작한다.
 */
function addModel(algorithm: string, runtime: string): void {
  const file = project.file
  if (!file) return
  const next = withSelectedAlgorithms(
    file.document,
    [...file.document.settings.selectedAlgorithms, { algorithm, runtime }],
    now(),
  )
  apply(withRuntime(next, runtime, now()))
}

/** 번호로 뺀다 - 같은 모델이 실행 방법만 다르게 여러 줄 있을 수 있다. */
function removeModel(index: number): void {
  const file = project.file
  if (!file) return
  apply(
    withSelectedAlgorithms(
      file.document,
      file.document.settings.selectedAlgorithms.filter((_, at) => at !== index),
      now(),
    ),
  )
}

function setParam(
  algorithm: string,
  runtime: string,
  name: string,
  value: number | undefined,
): void {
  const file = project.file
  if (!file) return
  apply(withHyperparameter(file.document, { algorithm, runtime, name }, value, now()))
}
</script>

<template>
  <div v-if="settings" class="flex flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.train.label')" :purpose="t('steps.train.purpose')">
      <template #context>
        <div class="flex gap-1.5">
          <dt>{{ t('meta.target') }}</dt>
          <dd class="max-w-48 truncate font-bold text-ink">
            {{ settings.target ?? t('meta.none') }}
          </dd>
        </div>
        <div class="flex gap-1.5">
          <dt>{{ t('meta.features') }}</dt>
          <dd class="tabular-nums">{{ t('meta.countUnit', usableFeatures) }}</dd>
        </div>
      </template>
    </StepHeader>

    <StepChecklist step="train" />

    <!--
      **세 축과 담긴 목록이 한 카드 안에 있다** (§8.12). 넓은 화면에서는 왼쪽이 고르는
      자리, 오른쪽이 그 판단의 맥락인 담긴 목록이다 (§8.10.1).
    -->
    <section class="min-w-0 rounded-panel border border-line bg-surface p-4">
      <h2 class="font-bold">{{ t('train.modelsTitle') }}</h2>
      <p class="mt-1 text-ink-soft">{{ t('train.modelsLead') }}</p>

      <!-- 유형과 타깃이 안 맞는다. 둘 다 고칠 수 있으므로 어느 쪽도 되돌리지 않는다. -->
      <p v-if="targetIssue" class="mt-3 font-bold text-danger">{{ targetIssue }}</p>

      <div class="mt-4 grid gap-x-6 gap-y-5 md:grid-cols-3">
        <div class="min-w-0 md:col-span-2">
          <ModelAxes
            :task-types="taskTypes"
            :task-type="project.taskType"
            :options="options"
            :chosen="chosen"
            :preferred-runtime="settings.runtime"
            @pick-task-type="pickTaskType"
            @add="addModel"
          />
        </div>

        <ChosenModels
          :chosen="chosen"
          :values="settings.hyperparameters"
          @remove="removeModel"
          @set-param="setParam"
        />
      </div>
    </section>
  </div>

  <AppEmpty v-else :reason="t('train.emptyReason')" :next="t('train.emptyNext')" />
</template>
