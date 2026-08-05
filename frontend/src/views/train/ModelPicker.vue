<script setup lang="ts">
/**
 * 학습할 모델을 **(모델, 실행 방법) 쌍으로 쌓는다.**
 *
 * 체크박스 목록이 아닌 이유는 **같은 모델을 실행 방법만 바꿔 여러 번 담을 수 있어야
 * 하기 때문이다** (mlpx-spec.md §3). "순수 JS 결정트리 + scikit-learn 결정트리"를
 * 한 실험에 나란히 놓고 숫자가 왜 다른지 보는 것이 이 도구가 줄 수 있는 가장 좋은
 * 수업 장면인데, 체크박스로는 그 줄이 하나밖에 안 생긴다.
 *
 * **못 쓰는 조합도 목록에서 지우지 않는다** (mlpx-spec.md §0.1). 고를 수는 있게 두되
 * [추가]가 꺼지고 **왜 못 쓰는지**가 그 자리에 뜬다 — 사라지면 학생은 그런 모델이
 * 있다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다.
 *
 * **손잡이 서술은 `ml/hyperparams.ts`에서 온다.** 엔진 본체를 거치지 않는다 — 그러면
 * ml.js가 통째로 첫 화면 번들에 딸려 온다(`engines/mljs-params.ts`). 그리고 서술은
 * **줄마다의 실행 방법**으로 찾는다. ml.js는 `maxDepth`, sklearn은 `max_depth`라
 * 어휘가 다르므로 줄이 다르면 손잡이도 다르다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import type { AlgorithmOption } from '@/ml/algorithms'
import { reasonParams, type RuntimeOption } from '@/ml/backend'
import { outOfRange, parametersFor, type HyperparameterSpec } from '@/ml/hyperparams'
import type { Settings } from '@/project/schema'

/** 쌓인 줄 하나. 실행 방법이 **언제나 채워져 있다** — 화면이 쌍으로 담기 때문이다. */
export interface ChosenModel {
  readonly algorithm: string
  readonly runtime: string
}

const props = defineProps<{
  options: readonly AlgorithmOption[]
  runtimes: readonly RuntimeOption[]
  chosen: readonly ChosenModel[]
  values: Settings['hyperparameters']
}>()

const emit = defineEmits<{
  add: [algorithm: string, runtime: string]
  remove: [index: number]
  setParam: [algorithm: string, runtime: string, name: string, value: number | undefined]
}>()

const { t } = useI18n()

/** 지금 드롭다운에 걸린 쌍. 첫 값은 고를 수 있는 것으로 맞춰 둔다. */
const draftAlgorithm = ref(
  props.options.find((option) => option.enabled)?.algorithm.id ??
    props.options[0]?.algorithm.id ??
    '',
)
const draftRuntime = ref(
  props.runtimes.find((option) => option.enabled)?.runtime.id ??
    props.runtimes[0]?.runtime.id ??
    '',
)

const algorithmName = (id: string): string => t(`algorithms.${id}`)

/**
 * 지금 걸린 쌍을 담을 수 없는 이유. 없으면 담을 수 있다.
 *
 * **순서가 곧 우선순위다** (mlpx-spec.md §0.1). 알고리즘 자체가 이 과제 유형에 안
 * 맞는 것이 먼저고, 그다음이 실행 위치이고, 마지막이 "이미 담았다"이다. 이미 담은 것을
 * 먼저 말하면 애초에 못 쓰는 조합을 두 번 고르게 만든다.
 */
const blocked = computed(() => {
  const option = props.options.find((one) => one.algorithm.id === draftAlgorithm.value)
  if (option && !option.enabled && option.reason) {
    return t(`client.${option.reason}`, reasonParams(option.reason))
  }

  const runtime = props.runtimes.find((one) => one.runtime.id === draftRuntime.value)
  if (runtime && !runtime.enabled && runtime.reason) {
    return t(`client.${runtime.reason}`, reasonParams(runtime.reason))
  }

  // 이 알고리즘이 그 실행 방법을 아예 지원하지 않는 경우 (순수 JS의 SVM).
  const pair = option?.runtimes.find((one) => one.runtime.id === draftRuntime.value)
  if (pair && !pair.enabled && pair.reason) {
    return t(`client.${pair.reason}`, reasonParams(pair.reason))
  }

  // 같은 쌍을 두 줄 담으면 하이퍼파라미터가 공유되어 똑같은 줄이 둘 생긴다.
  const already = props.chosen.some(
    (one) => one.algorithm === draftAlgorithm.value && one.runtime === draftRuntime.value,
  )
  return already ? t('train.alreadyAdded') : null
})

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
  <div class="flex flex-col gap-4">
    <!-- 쌍을 고르고 담는 줄. -->
    <div class="flex flex-col gap-2 rounded-panel border border-line bg-surface-sunken p-3">
      <div class="flex flex-wrap items-end gap-3">
        <AppField :label="t('train.pickModel')">
          <template #default="field">
            <select
              v-bind="field"
              v-model="draftAlgorithm"
              class="w-56 rounded-field border border-line-strong bg-surface px-3 py-2"
            >
              <option
                v-for="option in props.options"
                :key="option.algorithm.id"
                :value="option.algorithm.id"
              >
                {{ algorithmName(option.algorithm.id) }}
              </option>
            </select>
          </template>
        </AppField>

        <AppField :label="t('train.pickRuntime')">
          <template #default="field">
            <select
              v-bind="field"
              v-model="draftRuntime"
              class="w-56 rounded-field border border-line-strong bg-surface px-3 py-2"
            >
              <option
                v-for="option in props.runtimes"
                :key="option.runtime.id"
                :value="option.runtime.id"
              >
                {{ t(`runtimes.${option.runtime.id}`) }}
              </option>
            </select>
          </template>
        </AppField>

        <AppButton :disabled="blocked !== null" @click="emit('add', draftAlgorithm, draftRuntime)">
          {{ t('train.addModel') }}
        </AppButton>
      </div>

      <!-- 왜 못 담는지. 이유 없이 꺼진 버튼은 학생에게 고장으로 보인다. -->
      <p v-if="blocked" class="text-ink-soft">{{ blocked }}</p>
    </div>

    <!-- 쌓인 줄들. -->
    <ul v-if="props.chosen.length > 0" class="flex flex-col rounded-panel border border-line">
      <li
        v-for="(row, index) in props.chosen"
        :key="`${row.algorithm}:${row.runtime}:${index}`"
        class="p-4"
        :class="index > 0 ? 'border-t border-line' : ''"
      >
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span class="font-bold">{{ algorithmName(row.algorithm) }}</span>
          <span class="text-ink-soft">{{ t(`runtimes.${row.runtime}`) }}</span>
          <AppButton variant="ghost" class="ml-auto" @click="emit('remove', index)">
            {{ t('train.removeModel') }}
          </AppButton>
        </div>

        <details v-if="specsOf(row).length > 0" class="mt-3 rounded-panel border border-line">
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
  </div>
</template>
