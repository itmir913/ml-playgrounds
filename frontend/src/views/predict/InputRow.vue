<script setup lang="ts">
/**
 * 입력 한 줄 — **표에 새 줄을 하나 넣는 일이다** (architecture.md §8.13.1).
 *
 * **칸의 모양은 데이터가 정한다.** 수치 열은 숫자 칸, 범주 열은 **학습 때 본 값 중에서
 * 고르는 칸**이다. 자유 입력으로 두면 학생이 오타를 내고 그 값은 전처리에서 조용히 미지의
 * 범주가 된다 — 화면이 답을 내주는데 그 답이 무의미해진다.
 *
 * **빈 칸으로 시작한다.** 처음부터 채워 두면 학생이 그대로 [예측]을 눌러 자기가 학습에
 * 쓴 행을 다시 맞히는 것을 본다. 대신 [데이터에서 한 줄 가져오기]로 **한두 칸만 바꿔
 * 보는 길**을 연다 — 이 도구가 주려는 장면이 그것이다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import { useFormat } from '@/composables/useFormat'
import type { PredictionField } from '@/ml/predict'

const props = defineProps<{
  fields: readonly PredictionField[]
  values: Readonly<Record<string, string>>
  /** 수치 칸마다 표에 있는 값의 범위. 없는 칸도 있다 (숫자가 하나도 없는 열). */
  ranges: ReadonlyMap<string, { min: number; max: number }>
  /** 가져온 줄의 번호. 화면이 무엇을 가져왔는지 말한다. 없으면 아직 안 가져왔다. */
  sampled: number | null
  /**
   * 계산이 도는 동안 켜진다. **칸도 함께 잠근다.** 도중에 값이 바뀌면 이미 도는
   * 계산이 어느 입력에 대한 답인지 흐려진다 — 필터를 못 바꾸게 하는 것과 같은
   * 이유다(architecture.md §8.13.1).
   */
  disabled: boolean
  /** [예측]을 누르면 할 일. `AppButton`의 `action`으로 준다 - 두 번 눌리는 것을 막는다. */
  runAction: () => Promise<void>
}>()

const emit = defineEmits<{
  set: [name: string, value: string]
  sample: []
  clear: []
}>()

const { t } = useI18n()
const format = useFormat()

/**
 * 이 칸의 도움말. **수치 칸에만 있다** — 범주 칸은 고를 것이 이미 목록에 있다.
 *
 * 힌트일 뿐 막지 않는다. 범위 밖 값을 넣어 보는 것은 여기서 해 볼 만한 일이다.
 */
function hintOf(field: PredictionField): string | undefined {
  const range = props.ranges.get(field.name)
  if (!range) return undefined
  return t('predict.range', {
    min: format.prediction(range.min),
    max: format.prediction(range.max),
  })
}

/** 아직 안 채운 칸. **하나라도 있으면 [예측]이 멈춘다** — 비워 두고 누르면 학습셋의
 * 대체값으로 예측되는데, 학생은 자기가 넣은 값으로 예측했다고 믿는다. */
const blank = computed(() =>
  props.fields.filter((field) => (props.values[field.name] ?? '').trim() === ''),
)

/** 빈 칸이 하나라도 있으면 못 돌린다. **조합은 템플릿이 아니라 여기서 한다** (§10.1). */
const cannotRun = computed(() => props.disabled || blank.value.length > 0)
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.inputTitle') }}</h3>
      <p class="text-ink-soft">{{ t('predict.inputLead') }}</p>
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <AppButton variant="secondary" :disabled="props.disabled" @click="emit('sample')">
        {{ t('predict.fromData') }}
      </AppButton>
      <AppButton variant="secondary" :disabled="props.disabled" @click="emit('clear')">
        {{ t('predict.clear') }}
      </AppButton>
      <p
          :class="{ invisible: props.sampled === null }"
          class="min-w-0 text-ink-soft"
      >
        {{ t('predict.fromDataDone', { index: (props.sampled ?? 0) + 1 }) }}
      </p>
    </div>

    <!--
      칸이 스무 개인 데이터가 있다. 좁은 화면에서는 한 줄, 넓어지면 두 줄로 접는다 —
      한 칸씩 세로로만 쌓으면 [예측] 버튼이 화면 밖으로 밀린다.
    -->
    <div class="grid gap-4 sm:grid-cols-2">
      <AppField
        v-for="field in props.fields"
        :key="field.name"
        :label="field.name"
        :hint="hintOf(field)"
      >
        <template #default="control">
          <select
            v-if="field.options"
            v-bind="control"
            class="rounded-field border border-line-strong bg-surface px-3 py-2"
            :value="props.values[field.name] ?? ''"
            :disabled="props.disabled"
            @change="emit('set', field.name, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">{{ t('predict.pickOption') }}</option>
            <option v-for="option in field.options" :key="option" :value="option">
              {{ option }}
            </option>
          </select>

          <input
            v-else
            v-bind="control"
            type="number"
            step="any"
            class="rounded-field border border-line-strong bg-surface px-3 py-2 tabular-nums"
            :value="props.values[field.name] ?? ''"
            :disabled="props.disabled"
            @input="emit('set', field.name, ($event.target as HTMLInputElement).value)"
          />
        </template>
      </AppField>
    </div>

    <!-- [예측]은 오른쪽에 붙인다 - 입력 칸들과 같은 오른쪽 끝에 맞춰야 한 덩어리로 읽힌다. -->
    <div class="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
      <!-- 왜 꺼져 있는지 말한다. 이유 없이 회색인 버튼은 학생에게 고장으로 보인다. -->
      <p v-if="blank.length > 0" class="min-w-0 text-ink-soft">
        {{ t('client.PREDICTION_INPUT_INCOMPLETE', { feature: blank[0]?.name ?? '' }) }}
      </p>
      <AppButton size="lg" :disabled="cannotRun" :action="props.runAction">
        {{ t('predict.run') }}
      </AppButton>
    </div>
  </div>
</template>
