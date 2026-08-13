<script setup lang="ts">
/**
 * 예측 화면의 필터 — 축마다 여럿을 켜고 끈다 (architecture.md §8.13.1
 * "답을 거르고 세어 본다").
 *
 * **`AppChoices`가 아니다.** 그건 축 하나에서 하나만 고르는 라디오형이고, 여기는 각
 * 축에서 여럿을 켜고 끄는 체크박스형이다. **생김새가 같으면 학생이 라디오로 읽는다** —
 * 학습 화면에서 칩을 배운 학생이 여기서 하나를 누르면 나머지가 꺼질 것이라 기대한다.
 * 그래서 축 이름 옆에 **[전체 선택]/[전체 해제]를 붙여 둔다**: 전체를 켜고 끄는 버튼이
 * 옆에 있으면 그 칩들이 여럿 켜지는 것임이 드러난다.
 *
 * **축을 배열로 받는다.** 축마다 props와 emit을 따로 두면 줄 하나를 축 수만큼 베껴
 * 적게 되고, 셋째 축이 생기는 날 두 경로가 갈린다.
 *
 * **여기는 무엇을 거르는 축인지 모른다.** 이름표도 설명문도 이미 번역된 채로 온다 —
 * `AppChoices`와 같은 이유다. [전체 선택]만 여기서 `t()`를 부르는데, 그건 화면의
 * 어휘가 아니라 어느 축에나 같은 말이기 때문이다.
 *
 * **그릴 축이 없으면 통째로 안 그린다.** 축은 저마다 둘 이상일 때만 서는데, 바깥 칸은
 * 남아서 **아무것도 안 든 빈 카드**가 화면에 떴다 — 학생에게는 무언가 안 뜬 고장이다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { isAllSelected, type FilterAxisId, type PredictFilter } from '@/ml/predict'

export interface FilterOption {
  readonly id: string
  readonly label: string
}

export interface FilterAxis {
  readonly id: FilterAxisId
  /** 이미 번역된 축 이름. */
  readonly label: string
  readonly options: readonly FilterOption[]
}

const props = defineProps<{
  axes: readonly FilterAxis[]
  filter: PredictFilter
  /**
   * 지금 몇 개가 답하는지. 답이 셋뿐일 때 그 이유를 여기서 읽는다.
   *
   * **줄을 따로 안 쓴다.** 첫 축의 이름 옆에 끼워 넣는다 — 셈 하나가 한 줄을 차지하면
   * 카드가 그만큼 길어지는데, 그 줄에서 읽을 것은 숫자 두 개뿐이다. 설명 한 줄을 안 두는
   * 것도 같은 이유다("켜 둔 것만 답을 냅니다"는 칩을 한 번 눌러 보면 안다).
   *
   * **첫 축에 붙이는 이유**는 축 하나가 안 그려질 수 있기 때문이다. 특정 축에 매달면
   * 그 축이 빠지는 프로젝트에서 셈이 통째로 사라진다.
   */
  count: string
  /** 계산이 도는 동안 켜진다. 도중에 대상이 바뀌면 어느 집합에 대한 답인지 흐려진다. */
  disabled: boolean
}>()

const emit = defineEmits<{
  toggle: [axis: FilterAxisId, id: string]
  toggleAll: [axis: FilterAxisId]
}>()

const { t } = useI18n()

/**
 * 그릴 축. **하나뿐이면 안 그린다** — 끌 수 있는 것이 하나뿐인 필터는 누르면 화면이
 * 비는 버튼이고, 학생이 그것으로 알 수 있는 것이 없다.
 *
 * **템플릿에서 조건을 조립하지 않는다** (architecture.md §10).
 */
const shown = computed(() => props.axes.filter((axis) => axis.options.length > 1))

/** 그 축이 전부 켜졌는가. **판정은 `ml/predict.ts`가 한다** — 이름과 동작이 각자 판정하면
 * [전체 해제]라고 적힌 버튼이 전부 켜는 일이 생긴다. */
function allOn(axis: FilterAxis): boolean {
  return isAllSelected(
    props.filter,
    axis.id,
    axis.options.map((option) => option.id),
  )
}

function on(axis: FilterAxis, id: string): boolean {
  return axis.id === 'experiment'
    ? props.filter.experimentIds.has(id)
    : props.filter.algorithms.has(id)
}

/** 테두리는 늘 있고 색만 바뀐다 - `AppChoices`와 같은 이유(칸 안쪽 폭이 상태에 따라 흔들리면 안 된다). */
function chipClass(state: boolean): string {
  return state
    ? 'border-brand bg-brand text-ink-invert'
    : 'border-line-strong bg-surface text-ink hover:bg-surface-sunken'
}
</script>

<template>
  <section
    v-if="shown.length > 0"
    class="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4"
  >
    <!--
      **축마다 한 줄이다.** 이름·전체 버튼·칩이 한 줄에 서면 축 둘이 넉 줄에서 두 줄로
      준다. 줄 사이는 **점선**이다 — 두 열을 가르던 것과 같은 문법이고, 여기서도 가르는
      것은 서로 다른 이야기다(§8.12).
    -->
    <div
      v-for="(axis, index) in shown"
      :key="axis.id"
      class="flex flex-wrap items-center gap-x-3 gap-y-2"
      :class="index > 0 ? 'border-t border-dashed border-line-strong pt-3' : ''"
    >
      <h3 class="font-bold text-ink-soft">{{ axis.label }}</h3>
      <p v-if="index === 0" class="tabular-nums text-ink-soft">{{ props.count }}</p>

      <!-- 글자 버튼이라 `ghost`다. 상하 여백을 도로 빼서 줄 높이를 안 키운다. -->
      <AppButton
        variant="ghost"
        class="-mx-2 -my-2.5"
        :disabled="props.disabled"
        @click="emit('toggleAll', axis.id)"
      >
        {{ allOn(axis) ? t('common.clearAll') : t('common.selectAll') }}
      </AppButton>

      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="option in axis.options"
          :key="option.id"
          type="button"
          :disabled="props.disabled"
          :aria-pressed="on(axis, option.id)"
          class="rounded-field border px-3 py-1.5 font-medium transition-colors disabled:pointer-events-none disabled:opacity-45"
          :class="chipClass(on(axis, option.id))"
          @click="emit('toggle', axis.id, option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </section>
</template>
