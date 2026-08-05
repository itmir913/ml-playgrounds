<script setup lang="ts">
/**
 * 학습할 모델을 고르고 손잡이를 만지는 곳.
 *
 * **못 쓰는 것도 목록에 남긴다** (mlpx-spec.md §0.1). 사라지면 학생은 그런 모델이
 * 있다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다. 판정은 `algorithmOptions`가
 * 이미 했고 여기서는 그리기만 한다.
 *
 * **손잡이 서술은 `ml/hyperparams.ts`에서 온다.** 엔진 본체를 거치지 않는다 — 그러면
 * ml.js가 통째로 첫 화면 번들에 딸려 온다(`engines/mljs-params.ts`).
 *
 * **범위는 눈금이지 상한이 아니다.** 밖의 값도 그대로 저장되고, 대신 그 자리에서 말한 뒤
 * 학습하면 그 모델의 run 하나가 실패한다
 * (open-decisions.md "하이퍼파라미터는 눈금을 주되 막지 않는다").
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppField from '@/components/AppField.vue'
import type { AlgorithmOption } from '@/ml/algorithms'
import { reasonParams } from '@/ml/backend'
import { outOfRange, parametersFor, type HyperparameterSpec } from '@/ml/hyperparams'
import type { Settings } from '@/project/schema'

const props = defineProps<{
  options: readonly AlgorithmOption[]
  /** 지금 체크된 알고리즘 id들. */
  chosen: readonly string[]
  /** 실험 기본 실행 방법. 손잡이 어휘가 여기서 갈린다 (mlpx-spec.md §3). */
  runtimeId: string
  values: Settings['hyperparameters']
}>()

const emit = defineEmits<{
  toggle: [algorithm: string, on: boolean]
  setParam: [algorithm: string, name: string, value: number | undefined]
}>()

const { t } = useI18n()

const picked = computed(() => new Set(props.chosen))

/** 이 실행 방법에서 이 모델이 받는 손잡이들. 없으면 접을 것도 없다. */
function specsOf(algorithm: string): readonly HyperparameterSpec[] {
  return parametersFor(props.runtimeId, algorithm)
}

/**
 * 칸에 보일 값. **저장된 값이 없으면 기본값을 보여준다.**
 *
 * 빈 칸으로 두면 학생은 자기 모델이 무엇으로 도는지 알 수 없다. 파일에는 여전히
 * 아무것도 안 적힌다 — 손대야 적힌다.
 */
function valueOf(algorithm: string, spec: HyperparameterSpec): number {
  const stored = props.values[algorithm]?.[props.runtimeId]?.[spec.name]
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : spec.default
}

/** 지금 눈금 밖인 손잡이들. 학습이 거부하는 것과 같은 함수로 판정한다. */
function violated(algorithm: string): ReadonlySet<string> {
  const specs = specsOf(algorithm)
  const values = Object.fromEntries(specs.map((spec) => [spec.name, valueOf(algorithm, spec)]))
  return new Set(outOfRange(specs, values).map((violation) => violation.name))
}

function onToggle(algorithm: string, event: Event): void {
  emit('toggle', algorithm, (event.target as HTMLInputElement).checked)
}

/**
 * 칸을 고친 결과를 올려보낸다.
 *
 * 비우면 `undefined`다 — "기본값으로 돌려 달라"는 뜻이고, 빈 값을 적어 두면 파일에는
 * 값이 있는데 엔진은 기본값으로 도는 상태가 된다.
 *
 * **정수 자리는 여기서 반올림한다.** 학습 직전에 확정하면 화면에 2.5가 떠 있는 채로
 * 3으로 돌게 되고, 학생이 보는 값과 도는 값이 갈린다.
 */
function onParam(algorithm: string, spec: HyperparameterSpec, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') {
    emit('setParam', algorithm, spec.name, undefined)
    return
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  emit('setParam', algorithm, spec.name, spec.integer ? Math.round(value) : value)
}
</script>

<template>
  <ul class="flex flex-col rounded-panel border border-line bg-surface">
    <li
      v-for="(option, index) in props.options"
      :key="option.algorithm.id"
      class="p-4"
      :class="index > 0 ? 'border-t border-line' : ''"
    >
      <label class="flex items-start gap-3" :class="option.enabled ? 'cursor-pointer' : ''">
        <input
          type="checkbox"
          class="mt-1 size-4 shrink-0 accent-brand"
          :checked="picked.has(option.algorithm.id)"
          :disabled="!option.enabled"
          @change="onToggle(option.algorithm.id, $event)"
        />
        <span class="min-w-0">
          <span class="block font-bold" :class="option.enabled ? 'text-ink' : 'text-ink-faint'">
            {{ t(`algorithms.${option.algorithm.id}`) }}
          </span>
          <span v-if="option.reason" class="block text-ink-soft">
            {{ t(`client.${option.reason}`, reasonParams(option.reason)) }}
          </span>
        </span>
      </label>

      <!-- 고른 모델만 손잡이를 연다. 안 고른 것까지 펼치면 목록을 훑을 수가 없다. -->
      <details
        v-if="option.enabled && picked.has(option.algorithm.id)"
        class="mt-3 rounded-panel border border-line bg-surface-sunken"
      >
        <summary class="cursor-pointer px-3 py-2 font-bold text-ink-soft">
          {{ t('train.tuning') }}
        </summary>

        <div class="border-t border-line p-3">
          <p v-if="specsOf(option.algorithm.id).length === 0" class="text-ink-soft">
            {{ t('train.noTuning') }}
          </p>

          <div v-else class="flex flex-wrap gap-x-6 gap-y-4">
            <AppField
              v-for="spec in specsOf(option.algorithm.id)"
              :key="spec.name"
              :label="t(`hyperparams.${spec.name}`)"
              :hint="t('train.range', { min: spec.min, max: spec.max })"
              :error="
                violated(option.algorithm.id).has(spec.name) ? t('train.outOfRange') : undefined
              "
            >
              <template #default="field">
                <input
                  v-bind="field"
                  type="number"
                  class="w-40 rounded-field border border-line-strong bg-surface px-2 py-1"
                  :value="valueOf(option.algorithm.id, spec)"
                  :min="spec.min"
                  :max="spec.max"
                  :step="spec.step"
                  @change="onParam(option.algorithm.id, spec, $event)"
                />
              </template>
            </AppField>
          </div>
        </div>
      </details>
    </li>
  </ul>
</template>
