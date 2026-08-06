<script setup lang="ts">
/**
 * 예측 화면의 필터 — 실험 × 알고리즘의 다중 선택이다 (architecture.md §8.13.1
 * "답을 거르고 세어 본다").
 *
 * **`AppChoices`가 아니다.** 그건 축 하나에서 하나만 고르는 라디오형이고, 여기는
 * 각 축에서 여럿을 켜고 끄는 체크박스형이다 — 겹치는 축 좁히기·꺼진 이유 문구도
 * 필요 없어서 새로 만든다.
 *
 * **여기는 무엇을 거르는 축인지 모른다.** 이름표는 이미 번역된 채로 온다 —
 * `AppChoices`와 같은 이유다.
 */

export interface FilterOption {
  readonly id: string
  readonly label: string
}

const props = defineProps<{
  experiments: readonly FilterOption[]
  algorithms: readonly FilterOption[]
  selectedExperiments: ReadonlySet<string>
  selectedAlgorithms: ReadonlySet<string>
  experimentsLabel: string
  algorithmsLabel: string
  /** 계산이 도는 동안 켜진다. 도중에 대상이 바뀌면 어느 집합에 대한 답인지 흐려진다. */
  disabled: boolean
}>()

const emit = defineEmits<{
  toggleExperiment: [id: string]
  toggleAlgorithm: [id: string]
}>()

/** 테두리는 늘 있고 색만 바뀐다 - `AppChoices`와 같은 이유(칸 안쪽 폭이 상태에 따라 흔들리면 안 된다). */
function chipClass(on: boolean): string {
  return on
    ? 'border-brand bg-brand text-ink-invert'
    : 'border-line-strong bg-surface text-ink hover:bg-surface-sunken'
}
</script>

<template>
  <div class="flex flex-wrap gap-x-6 gap-y-3 rounded-panel border border-line bg-surface p-4">
    <div v-if="props.experiments.length > 1" class="min-w-0">
      <h3 class="font-bold text-ink-soft">{{ props.experimentsLabel }}</h3>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <button
          v-for="option in props.experiments"
          :key="option.id"
          type="button"
          :disabled="props.disabled"
          :aria-pressed="props.selectedExperiments.has(option.id)"
          class="rounded-field border px-3 py-1.5 font-medium transition-colors disabled:pointer-events-none disabled:opacity-45"
          :class="chipClass(props.selectedExperiments.has(option.id))"
          @click="emit('toggleExperiment', option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div v-if="props.algorithms.length > 1" class="min-w-0">
      <h3 class="font-bold text-ink-soft">{{ props.algorithmsLabel }}</h3>
      <div class="mt-1.5 flex flex-wrap gap-1.5">
        <button
          v-for="option in props.algorithms"
          :key="option.id"
          type="button"
          :disabled="props.disabled"
          :aria-pressed="props.selectedAlgorithms.has(option.id)"
          class="rounded-field border px-3 py-1.5 font-medium transition-colors disabled:pointer-events-none disabled:opacity-45"
          :class="chipClass(props.selectedAlgorithms.has(option.id))"
          @click="emit('toggleAlgorithm', option.id)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>
