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
 * **[학습]이 끝나도 결과 화면으로 옮기지 않는다.** 설정을 바꿔가며 반복 학습하는 것이
 * 이 도구의 핵심 활동이라(CLAUDE.md §1.1) 매번 화면이 튀면 돌아오는 클릭이 계속 붙는다.
 * 끝났다는 것과 [결과 보기]가 버튼 자리에 남는다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { onBeforeRouteLeave, useRouter, type RouteLocationNormalized } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useTraining } from '@/composables/useTraining'
import { summarizeColumns } from '@/data/columns'
import { algorithmOptions, supportedTaskTypes } from '@/ml/algorithms'
import type { RuntimeContext } from '@/ml/backend'
import {
  algorithmsLosingMeaning,
  columnPlan,
  requiredTargetKind,
  type ChosenModel,
} from '@/ml/selection'
import { spawnTrainingWorker } from '@/ml/worker/spawn'
import { applyExperiment } from '@/project/attach'
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
const router = useRouter()
const project = useProjectStore()
const toasts = useToastStore()
const training = useTraining(spawnTrainingWorker)

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

/**
 * 고를 수 있는 유형. **데이터 종류가 좁힌다** - 이미지에 회귀는 성립하지 않는다.
 * 표를 안 올렸으면 종류를 모르므로 좁히지 않는다 (ml/algorithms.ts).
 */
const taskTypes = computed(() => supportedTaskTypes(project.file?.document.manifest.dataType))

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

/** 지난 실험이 하나라도 있으면 결과 화면에 볼 것이 있다. */
const hasResults = computed(() => (project.file?.document.runs.experiments.length ?? 0) > 0)

/** 담은 모델이 없으면 돌릴 것이 없다. 나머지 실패는 학습이 사유와 함께 돌려준다. */
const nothingToTrain = computed(() => chosen.value.length === 0)

/**
 * 학습을 한 번 돌린다. **`AppButton`의 `action`으로 준다** — 도는 동안 버튼이 스스로
 * 꺼진다. 학생은 느리다고 생각하면 한 번 더 누르고, 그러면 실험이 둘 생긴다.
 *
 * 결과는 그 자리에서 파일에 앉히고 자동 저장이 받는다. 취소면 아무 일도 없었던 것이라
 * 알릴 것이 없다 — 학생이 스스로 누른 것이다.
 */
async function startTraining(): Promise<void> {
  const file = project.file
  const table = dataset.value
  const taskType = project.taskType
  if (!file || !table || taskType === undefined) return

  try {
    const result = await training.run({
      type: 'train',
      input: {
        dataset: table,
        taskType,
        dataType: file.document.manifest.dataType,
        settings: file.document.settings,
        context: context.value,
      },
      history: file.document.runs,
    })
    if (result === null) return

    // 학습하는 동안 학생이 다른 것을 고쳤을 수 있다. 그때의 파일이 아니라 지금 것에 앉힌다.
    project.update(applyExperiment(project.file ?? file, result, now()))
    toasts.push('success', 'train.finished')
  } catch (error) {
    toasts.pushError(error)
  }
}

function goResults(): void {
  void router.push({ name: 'results', params: { projectId: project.projectId } })
}

/** 게이지 너비. 아직 아무것도 안 끝났으면 0%다 — 도는 척하는 막대를 만들지 않는다. */
const donePercent = computed(() => {
  const at = training.progress.value
  if (!at || at.total === 0) return '0%'
  return `${Math.round((at.completed / at.total) * 100)}%`
})

/**
 * 학습 중에 나가려 한 곳. 확인을 기다리는 동안만 값이 있다.
 *
 * **화면 생명주기가 아니라 라우터 가드가 쥔다.** 컴포넌트가 사라진 뒤에 정리하려 들면
 * 이미 늦고, 워커는 아무도 안 듣는 채로 계속 돈다.
 */
const leavingTo = ref<RouteLocationNormalized | null>(null)

/** 확인을 받고 나가는 중인가. **불리언 하나로 가드를 통과시킨다** — 취소가 상태에 반영되는
 * 것은 마이크로태스크 뒤라, `running`이 내려가길 기다렸다 밀면 가드가 한 번 더 걸린다. */
let leaving = false

onBeforeRouteLeave((to) => {
  if (leaving || !training.running.value) return true
  leavingTo.value = to
  return false
})

function stay(): void {
  leavingTo.value = null
}

function leave(): void {
  const to = leavingTo.value
  leavingTo.value = null
  leaving = true
  training.cancel()
  if (to) {
    void router.push(to.fullPath).catch(() => {
      leaving = false
    })
  }
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
          <dd class="font-bold tabular-nums text-ink">{{ t('meta.countUnit', usableFeatures) }}</dd>
        </div>
      </template>
    </StepHeader>

    <StepChecklist step="train" />

    <!--
      **세 축과 담긴 목록이 한 카드 안에 있다** (§8.12). 넓은 화면에서는 왼쪽이 고르는
      자리, 오른쪽이 그 판단의 맥락인 담긴 목록이다 (§8.10.1).
    -->
    <!--
      **학습이 도는 동안에는 못 건드린다.** 실험은 [학습]을 누른 순간의 스냅샷으로 돌므로
      지금 모델을 빼도 도는 것은 안 바뀐다 — 고칠 수 있게 두면 화면이 지금 무엇이 도는지에
      대해 거짓말을 하게 된다. `inert`는 하위 전체를 못 누르게 하고 접근성 트리에서도 뺀다.
    -->
    <section
      class="min-w-0 rounded-panel border border-line bg-surface p-4 transition-opacity"
      :class="training.running.value ? 'opacity-60' : ''"
      :inert="training.running.value"
    >
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

        <!--
          **두 열 사이도 점선으로 가른다** (§8.12). 축 사이를 가른 것과 같은 선이라
          같은 문법으로 읽힌다. 한 열로 접히면 세로선이 뜻을 잃으므로 가로선이 된다.
        -->
        <div
          class="min-w-0 border-t border-dashed border-line pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-6"
        >
          <ChosenModels
            :chosen="chosen"
            :values="settings.hyperparameters"
            @remove="removeModel"
            @set-param="setParam"
          />
        </div>
      </div>
    </section>

    <!--
      **이 단계의 본 동작이라 카드 밖에 선다.** 도는 동안 같은 자리가 진행 표시와
      [멈추기]로 바뀐다 — 누른 자리에서 답이 나와야 눈을 옮기지 않는다.
    -->
    <section class="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
      <!--
        **말이 왼쪽, 누를 것이 오른쪽이다.** 왜 못 누르는지가 버튼 바로 옆에 오고,
        버튼은 카드의 오른쪽 끝에 고정되어 학생이 매번 같은 자리를 찾는다.
      -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p v-if="training.running.value" class="min-w-0 font-bold" role="status">
          {{ t('train.progress', training.progress.value ?? { completed: 0, total: 0 }) }}
        </p>
        <!-- 이유 없이 꺼진 버튼은 학생에게 고장으로 보인다. -->
        <p v-else-if="nothingToTrain" class="min-w-0 text-ink-soft">
          {{ t('train.nothingToTrain') }}
        </p>

        <div class="ml-auto flex flex-wrap items-center gap-3">
          <AppButton
            v-if="hasResults && !training.running.value"
            variant="secondary"
            size="lg"
            @click="goResults"
          >
            {{ t('train.seeResults') }}
          </AppButton>

          <AppButton
            v-if="training.running.value"
            variant="secondary"
            size="lg"
            @click="training.cancel"
          >
            {{ t('train.stop') }}
          </AppButton>
          <AppButton v-else size="lg" :disabled="nothingToTrain" :action="startTraining">
            {{ t('train.start') }}
          </AppButton>
        </div>
      </div>

      <!--
        **게이지는 모델 단위다** (mlpx-spec.md §0.3). 모델 하나가 안에서 몇 퍼센트인지는
        엔진이 알려주지 않으므로 만들어 낼 수 없다 — 지어내면 멈춘 막대가 도는 척한다.
        너비는 값이라 class가 아니라 style이다.
      -->
      <div
        v-if="training.running.value"
        class="h-2 w-full overflow-hidden rounded-pill bg-surface-sunken"
        role="progressbar"
        :aria-valuenow="training.progress.value?.completed ?? 0"
        aria-valuemin="0"
        :aria-valuemax="training.progress.value?.total ?? 0"
      >
        <div class="h-full rounded-pill bg-brand transition-all" :style="{ width: donePercent }" />
      </div>
    </section>
  </div>

  <AppEmpty v-else :reason="t('train.emptyReason')" :next="t('train.emptyNext')" />

  <!--
    **학습 중에 나가면 결과가 없다.** 워커는 terminate되고 남는 것이 없으므로, 조용히
    보내면 학생은 돌아와서 "결과가 왜 없지"를 만난다.
  -->
  <AppDialog
    :open="leavingTo !== null"
    :title="t('train.leaveTitle')"
    :description="t('train.leaveBody')"
    @close="stay"
  >
    <template #actions>
      <AppButton variant="secondary" @click="stay">{{ t('train.leaveStay') }}</AppButton>
      <AppButton variant="danger" @click="leave">{{ t('train.leaveGo') }}</AppButton>
    </template>
  </AppDialog>
</template>
