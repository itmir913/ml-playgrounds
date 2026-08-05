<script setup lang="ts">
/**
 * 담은 모델들. **(모델, 실행 방법) 쌍으로 쌓인다** (mlpx-spec.md §3).
 *
 * 체크박스 목록이 아닌 이유는 **같은 모델을 실행 방법만 바꿔 여러 번 담을 수 있어야
 * 하기 때문이다.** "순수 JS 결정 트리 + scikit-learn 결정 트리"를 한 실험에 나란히 놓고
 * 숫자가 왜 다른지 보는 것이 이 도구가 줄 수 있는 가장 좋은 수업 장면인데, 체크박스로는
 * 그 줄이 하나밖에 안 생긴다.
 *
 * **손잡이 서술은 `ml/hyperparams.ts`에서 온다.** 엔진 본체를 거치지 않는다 — 그러면
 * ml.js가 통째로 첫 화면 번들에 딸려 온다(`engines/mljs-params.ts`). 그리고 서술은
 * **줄마다의 실행 방법**으로 찾는다. ml.js는 `maxDepth`, sklearn은 `max_depth`라
 * 어휘가 다르므로 줄이 다르면 손잡이도 다르다.
 */

import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import { outOfRange, parametersFor, type HyperparameterSpec } from '@/ml/hyperparams'
import type { ChosenModel } from '@/ml/selection'
import type { Settings } from '@/project/schema'

const props = defineProps<{
  chosen: readonly ChosenModel[]
  values: Settings['hyperparameters']
}>()

const emit = defineEmits<{
  remove: [index: number]
  setParam: [algorithm: string, runtime: string, name: string, value: number | undefined]
}>()

const { t } = useI18n()

function specsOf(row: ChosenModel): readonly HyperparameterSpec[] {
  return parametersFor(row.runtime, row.algorithm)
}

/**
 * 칸에 보일 값. **저장된 값이 없으면 기본값을 보여준다.**
 *
 * 빈 칸으로 두면 학생은 자기 모델이 무엇으로 도는지 알 수 없다. 파일에는 여전히
 * 아무것도 안 적힌다 — 손대야 적힌다.
 */
function valueOf(row: ChosenModel, spec: HyperparameterSpec): number {
  const stored = props.values[row.algorithm]?.[row.runtime]?.[spec.name]
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : spec.default
}

/** 지금 눈금 밖인 손잡이들. 학습이 거부하는 것과 같은 함수로 판정한다. */
function violated(row: ChosenModel): ReadonlySet<string> {
  const specs = specsOf(row)
  const values = Object.fromEntries(specs.map((spec) => [spec.name, valueOf(row, spec)]))
  return new Set(outOfRange(specs, values).map((violation) => violation.name))
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
function onParam(row: ChosenModel, spec: HyperparameterSpec, event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  if (raw === '') {
    emit('setParam', row.algorithm, row.runtime, spec.name, undefined)
    return
  }
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  emit('setParam', row.algorithm, row.runtime, spec.name, spec.integer ? Math.round(value) : value)
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <h3 class="font-bold text-ink-soft">{{ t('train.chosenTitle') }}</h3>

    <ul v-if="props.chosen.length > 0" class="flex flex-col rounded-panel border border-line">
      <li
        v-for="(row, index) in props.chosen"
        :key="`${row.algorithm}:${row.runtime}:${index}`"
        class="min-w-0 p-3"
        :class="index > 0 ? 'border-t border-line' : ''"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span class="font-bold">{{ t(`algorithms.${row.algorithm}`) }}</span>
          <span class="text-ink-soft">{{ t(`runtimes.${row.runtime}`) }}</span>
          <AppButton variant="ghost" class="ml-auto" @click="emit('remove', index)">
            {{ t('train.removeModel') }}
          </AppButton>
        </div>

        <details v-if="specsOf(row).length > 0" class="mt-2 rounded-panel border border-line">
          <summary class="cursor-pointer px-3 py-2 font-bold text-ink-soft">
            {{ t('train.tuning') }}
          </summary>

          <div class="flex flex-wrap gap-x-6 gap-y-4 border-t border-line p-3">
            <AppField
              v-for="spec in specsOf(row)"
              :key="spec.name"
              :label="t(`hyperparams.${spec.name}`)"
              :hint="t('train.range', { min: spec.min, max: spec.max })"
              :error="violated(row).has(spec.name) ? t('train.outOfRange') : undefined"
            >
              <template #default="field">
                <input
                  v-bind="field"
                  type="number"
                  class="w-40 rounded-field border border-line-strong bg-surface px-2 py-1"
                  :value="valueOf(row, spec)"
                  :min="spec.min"
                  :max="spec.max"
                  :step="spec.step"
                  @change="onParam(row, spec, $event)"
                />
              </template>
            </AppField>
          </div>
        </details>
      </li>
    </ul>

    <p class="text-ink-soft">
      {{
        props.chosen.length === 0
          ? t('train.noModelChosen')
          : t('train.modelSummary', props.chosen.length)
      }}
    </p>
  </div>
</template>
