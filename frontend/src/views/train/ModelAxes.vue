<script setup lang="ts">
/**
 * 학습할 것을 고르는 **세 축** — 기계학습 유형 · 모델 · 실행 방법 (architecture.md §8.12).
 *
 * **축들은 서로를 좁힌다.** 회귀를 고르면 분류 모델이 꺼지고, 그 실행 방법에 구현이 없는
 * 모델은 그 축에서 꺼진다. 판정은 `ml/selection.ts`의 `modelAxes` 하나가 하고 여기서는
 * 문장을 붙여 그리기만 한다 — 축마다 따로 판정하면 세 벌이 되고 반드시 어긋난다.
 *
 * **고른 것을 되돌리지 않는다** (mlpx-spec.md §0.1). 유형을 바꿔서 걸어 둔 모델이 뜻을
 * 잃으면 그 카드가 꺼지고 [담기]가 사유와 함께 멈출 뿐, 다른 모델로 슬쩍 옮기지 않는다.
 * 학생이 아직 아무것도 안 고른 자리에만 첫 번째로 쓸 수 있는 것을 채워 둔다.
 *
 * **담는 것은 [담기]다.** 마지막 축을 누르는 것이 곧 담기가 되면 "지금 고른 것"과 "담은
 * 것"이 한 물건에 겹친다. 파일은 (모델, 실행 방법) 쌍을 여러 줄 담고, 같은 모델이 엔진만
 * 다르게 두 줄 들어가는 것이 이 도구의 핵심 수업 장면이다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppChoices, { type Choice } from '@/components/AppChoices.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import type { AlgorithmOption } from '@/ml/algorithms'
import { reasonParams } from '@/ml/backend'
import { modelAxes, type AxisChoice, type ChosenModel } from '@/ml/selection'
import type { TaskType } from '@/project/schema'

const props = defineProps<{
  taskTypes: readonly TaskType[]
  /** 아직 아무도 안 골랐으면 undefined다. 기본값이 없다. */
  taskType?: TaskType | undefined
  /** 유형을 안 골랐으면 빈 목록이다 — 그때는 아래 두 축이 뜻이 없다. */
  options: readonly AlgorithmOption[]
  chosen: readonly ChosenModel[]
  /** 실험 기본 실행 방법. 다시 들어왔을 때 축이 여기서 시작한다. */
  preferredRuntime: string
}>()

const emit = defineEmits<{
  pickTaskType: [taskType: TaskType]
  add: [algorithm: string, runtime: string]
}>()

const { t } = useI18n()

/** 학생이 콕 집은 것. null은 "아직 안 골랐다"이고, 그때만 우리가 채운다. */
const pickedAlgorithm = ref<string | null>(null)
const pickedRuntime = ref<string | null>(null)

const algorithm = computed(
  () =>
    pickedAlgorithm.value ??
    props.options.find((option) => option.enabled)?.algorithm.id ??
    props.options[0]?.algorithm.id ??
    '',
)

/**
 * 안 골랐을 때 걸릴 실행 방법.
 *
 * 실험 기본을 먼저 본다 — 지난번에 이 프로젝트가 쓰던 것이고, 다시 들어온 학생이 같은
 * 자리에서 시작해야 한다. 그것이 이 모델에서 안 되면 되는 것 중 첫째로 넘어간다.
 */
const runtime = computed(() => {
  if (pickedRuntime.value !== null) return pickedRuntime.value

  const list = props.options.find((option) => option.algorithm.id === algorithm.value)?.runtimes
  const wanted = list?.find((one) => one.runtime.id === props.preferredRuntime)
  const fallback = wanted?.enabled ? wanted : list?.find((one) => one.enabled)
  return fallback?.runtime.id ?? props.preferredRuntime
})

const axes = computed(() =>
  modelAxes({
    options: props.options,
    algorithm: algorithm.value,
    runtime: runtime.value,
    chosen: props.chosen,
  }),
)

/**
 * 사유 문장은 `client.*`에 이미 있다. 화면이 새로 짓지 않는다.
 *
 * **숫자를 화면이 고르지 않는다.** 상한은 (알고리즘 × 구현)마다 다르므로 알고리즘 id로
 * 되짚어 고를 수 있는 값이 아니고, 판정이 이미 그 칸의 값을 함께 들려 보냈다
 * (`AxisChoice.maxRows`). 여기서 다시 고르면 화면이 5000이라고 말하고 3000에서 꺼진다.
 */
function withReason(choice: AxisChoice, label: string): Choice {
  return {
    id: choice.id,
    label,
    enabled: choice.enabled,
    ...(choice.reason
      ? { reason: t(`client.${choice.reason}`, reasonParams(choice.reason, choice.maxRows)) }
      : {}),
  }
}

/**
 * 유형 축. **아무것도 꺼지지 않는다** (architecture.md §10.5).
 *
 * 알고리즘이 하나도 없는 유형은 등록부가 애초에 목록에서 빼므로(`supportedTaskTypes`),
 * 여기 있는 것은 전부 고를 수 있다.
 *
 * **지금 데이터로 못 하는 유형도 꺼지지 않는다.** 잠금이 여기 있었던 적이 있고
 * (2026-09-02~09-03), 그때 사진만 올리고 군집을 고른 학생의 화면이 반대말을 했다 —
 * 데이터 화면의 체크리스트에서는 `범주 지정하기`가 **면제되어 사라지는데**(고른 유형이
 * 군집이므로) 분류 카드는 바로 그 범주를 요구하며 잠겼다. **잠금을 풀 방법이 화면에서
 * 사라진 채로 잠긴다.**
 *
 * **고르는 것은 묻는 일이지 저지르는 일이 아니다.** 못 하는 조합은 [학습하기]가 사유와
 * 함께 세운다(`ml/training-source.ts`) — 그래야 되돌릴 손잡이가 손에 남는다.
 * `task-type-trap.spec.ts`가 이 축이 다시 잠기지 않는지 지킨다.
 */
const taskChoices = computed<Choice[]>(() =>
  props.taskTypes.map((taskType) => ({
    id: taskType,
    label: t(`taskTypes.${taskType}`),
    enabled: true,
  })),
)

// 줄마다 자기 사유와 자기 숫자를 들고 있다 (modelAxes).
const modelChoices = computed<Choice[]>(() =>
  axes.value.algorithms.map((choice) => withReason(choice, t(`algorithms.${choice.id}`))),
)

const runtimeChoices = computed<Choice[]>(() =>
  axes.value.runtimes.map((choice) => withReason(choice, t(`runtimes.${choice.id}`))),
)

/** 왜 못 담는지. 이유 없이 꺼진 버튼은 학생에게 고장으로 보인다. */
const blocked = computed(() => {
  const reason = axes.value.blocked
  if (reason === null) return null
  // 사유가 모델 축의 칸에서 온다(modelAxes의 불변식). 숫자도 같은 칸에서 온다.
  const choice = axes.value.algorithms.find((one) => one.id === algorithm.value)
  return reason === 'alreadyAdded'
    ? t('train.alreadyAdded')
    : t(`client.${reason}`, reasonParams(reason, choice?.maxRows))
})

/** 문자열로 온 것을 유형으로 되돌린다. 목록에 있는 것만 통과하므로 단언이 필요 없다. */
function onTaskType(id: string): void {
  const taskType = props.taskTypes.find((one) => one === id)
  if (taskType) emit('pickTaskType', taskType)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <AppChoices
      :label="t('train.taskTitle')"
      :items="taskChoices"
      :selected="props.taskType"
      @pick="onTaskType"
    />

    <hr class="border-t border-dashed border-line-strong" />

    <!-- 유형을 안 골랐으면 아래 두 축이 통째로 뜻이 없다. 회색 줄만 늘어놓지 않는다. -->
    <AppEmpty
      v-if="props.taskType === undefined"
      :reason="t('train.noTaskTypeReason')"
      :next="t('train.noTaskTypeNext')"
    />

    <template v-else>
      <AppChoices
        :label="t('train.pickModel')"
        :items="modelChoices"
        :selected="algorithm"
        @pick="pickedAlgorithm = $event"
      />

      <hr class="border-t border-dashed border-line-strong" />

      <!--
        **이 축만 힌트를 갖는다.** 라벨은 오른쪽(어디서)을 말하는데 목록의 왼쪽에는
        라이브러리 이름이 서 있고, 그래서 `scikit-learn`이 두 줄인 이유가 라벨만으로는
        안 읽힌다. 한 낱말로 둘을 덮으려다 `학습 엔진`으로 갔던 안을 접고, 라벨은
        그대로 두고 문장이 나머지 절반을 말하게 했다 (2026-08-13).
      -->
      <AppChoices
        :label="t('train.pickRuntime')"
        :hint="t('train.pickRuntimeHint')"
        :items="runtimeChoices"
        :selected="runtime"
        @pick="pickedRuntime = $event"
      />

      <!-- [담기]도 같은 선으로 가른다. 고르는 일이 아니라 담는 일이다. -->
      <hr class="border-t border-dashed border-line-strong" />

      <div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        <p v-if="blocked" class="min-w-0 text-ink-soft">{{ blocked }}</p>
        <AppButton :disabled="blocked !== null" @click="emit('add', algorithm, runtime)">
          {{ t('train.addModel') }}
        </AppButton>
      </div>
    </template>
  </div>
</template>
