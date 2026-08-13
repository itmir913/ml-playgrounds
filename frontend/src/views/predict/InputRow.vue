<script setup lang="ts">
/**
 * 입력 한 줄 — **표에 새 줄을 하나 넣는 일이다** (architecture.md §8.13.1).
 *
 * **칸의 모양은 데이터가 정한다.** 수치 열은 숫자 칸, 범주 열은 **학습 때 본 값 중에서
 * 고르는 칸**이다. 자유 입력으로 두면 학생이 오타를 내고 그 값은 전처리에서 조용히 미지의
 * 범주가 된다 — 화면이 답을 내주는데 그 답이 무의미해진다.
 *
 * **빈 칸으로 시작한다.** 처음부터 채워 두면 학생이 그대로 [예측]을 눌러 자기가 학습에
 * 쓴 행을 다시 맞히는 것을 본다. 대신 [랜덤으로 하나 가져오기]로 **한두 칸만 바꿔
 * 보는 길**을 연다 — 이 도구가 주려는 장면이 그것이다.
 *
 * **누르는 것은 여기 없다.** 가져오기·비우기·예측은 전부 화면 위에 붙은 동작 바에 있다
 * (architecture.md §8.13.1 "동작 바는 세 경로가 함께 쓴다"). 이 카드는 값을 채우는
 * 곳이고, 바는 누르는 곳이다.
 */

import { useI18n } from 'vue-i18n'

import AppField from '@/components/AppField.vue'
import { useFormat } from '@/composables/useFormat'
import type { PredictionField } from '@/ml/predict'

const props = defineProps<{
  fields: readonly PredictionField[]
  values: Readonly<Record<string, string>>
  /** 수치 칸마다 표에 있는 값의 범위. 없는 칸도 있다 (숫자가 하나도 없는 열). */
  ranges: ReadonlyMap<string, { min: number; max: number }>
  /**
   * 제목 아래 한 줄. **자리는 하나이고 판이 사슬로 나눠 쓴다** — 못 누르는 이유와 방금
   * 가져온 행이 각자 자리를 가지면 문구가 두 군데로 흩어지고, 아무 말도 안 할 때는 빈
   * 자리가 남는다. 이미 번역돼서 온다.
   *
   * **경고인지 아닌지는 판이 안다.** 빈 칸이 있다는 말은 [예측]을 막고 있는 사유이고,
   * 방금 가져온 행은 그냥 알림이다 — 둘을 같은 색으로 쓰면 막힌 것을 못 알아챈다.
   */
  status: { text: string; caution: boolean } | null
  /**
   * 계산이 도는 동안 켜진다. **칸도 함께 잠근다.** 도중에 값이 바뀌면 이미 도는
   * 계산이 어느 입력에 대한 답인지 흐려진다 — 필터를 못 바꾸게 하는 것과 같은
   * 이유다(architecture.md §8.13.1).
   */
  disabled: boolean
}>()

const emit = defineEmits<{
  set: [name: string, value: string]
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
  return t('predict.tabular.range', {
    min: format.prediction(range.min),
    max: format.prediction(range.max),
  })
}
</script>

<template>
  <!--
    **카드로 선다.** 붙박이로 화면을 따라올 때 테두리가 없으면 무엇이 따라오는 건지
    경계가 안 보인다.
  -->
  <section class="flex flex-col gap-5 rounded-panel border border-line bg-surface p-4">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.tabular.inputTitle') }}</h3>
      <p class="text-ink-soft">{{ t('predict.tabular.inputLead') }}</p>
      <!--
        **바꿀 칸 바로 위다.** "한두 칸만 바꿔서 다시 예측해 보세요"가 칸을 다 지나
        아래에 있으면 무엇을 가리키는지 멀다.
      -->
      <p
        v-if="props.status"
        role="status"
        :class="props.status.caution ? 'font-bold text-caution' : 'text-ink-soft'"
      >
        {{ props.status.text }}
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
            <option value="">{{ t('predict.tabular.pickOption') }}</option>
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
  </section>
</template>
