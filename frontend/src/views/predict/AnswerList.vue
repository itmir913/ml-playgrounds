<script setup lang="ts">
/**
 * 모델들의 답 (architecture.md §8.13.1).
 *
 * **같은 값을 모든 모델에 동시에 넣는다.** 예측은 밀리초라 나눌 이유가 없고, "같은
 * 값인데 모델마다 답이 다르다"가 결과 화면의 비교와 짝을 이룬다.
 *
 * **쓸 수 없는 모델은 지우지 않고 사유와 함께 끈다** (§8.2). 목록에서 사라지면 학생은
 * 그 모델이 있었다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다.
 */

import { useI18n } from 'vue-i18n'

import { useFormat } from '@/composables/useFormat'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import type { Prediction } from '@/ml/metrics'
import { whereTrainedKeyOf } from '@/ml/results'
import type { PredictableModel } from '@/ml/predict'

export interface Answer {
  /**
   * 모델이 낸 값. 실패했으면 없다.
   *
   * **분류는 라벨(문자열), 회귀는 수치다.** 수치를 미리 문자열로 굳히지 않는 이유는
   * 어떻게 쓸지가 언어에 달렸기 때문이다 (docs/i18n.md 규칙 6).
   */
  readonly value?: Prediction
  /** 이 모델에서만 난 실패. 코드는 `client.*`이거나 `errors.*`다. */
  readonly failure?: { code: ClientErrorCode; params: Record<string, unknown> }
}

const props = defineProps<{
  models: readonly PredictableModel[]
  /** run id -> 답. 아직 안 눌렀으면 비어 있다. */
  answers: ReadonlyMap<string, Answer>
  /** 실험 id -> 화면에 쓰는 이름. 결과 화면의 세로줄과 같은 이름이어야 한다. */
  experimentNames: ReadonlyMap<string, string>
}>()

const { t } = useI18n()
const format = useFormat()

function reasonText(code: ClientErrorCode, params: Record<string, unknown> = {}): string {
  return t(errorMessageKey(code), { ...params })
}

/** 회귀의 답은 수치다. 부동소수의 잡음을 걷어내고 언어에 맞게 쓴다. */
function answerText(value: Prediction | undefined): string | null {
  if (value === undefined) return null
  return typeof value === 'number' ? format.prediction(value) : value
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.answerTitle') }}</h3>
      <p class="text-ink-soft">{{ t('predict.answerLead') }}</p>
    </div>

    <ul class="flex flex-col gap-3">
      <li
        v-for="model in props.models"
        :key="model.run.id"
        class="rounded-panel border border-line bg-surface-sunken p-4"
        :class="model.reason ? 'opacity-60' : ''"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p class="font-bold">
            {{
              t('predict.modelName', {
                algorithm: t(`algorithms.${model.run.algorithm}`),
                runtime: t(whereTrainedKeyOf(model.run)),
                experiment: props.experimentNames.get(model.experiment.id) ?? model.experiment.id,
              })
            }}
          </p>

          <!--
            **답은 크게 쓴다.** 이 화면에서 학생이 보러 온 것이 이 한 낱말이고,
            줄마다 그것을 찾아 눈이 헤매면 비교가 안 된다.
          -->
          <p
            v-if="answerText(props.answers.get(model.run.id)?.value) !== null"
            class="text-xl font-bold tabular-nums text-brand-strong"
          >
            {{ answerText(props.answers.get(model.run.id)?.value) }}
          </p>
        </div>

        <!-- 쓸 수 없는 사유. 셋이 전부 다른 말이고 학생이 할 수 있는 일이 다르다. -->
        <p v-if="model.reason" class="mt-1 text-ink-soft">{{ reasonText(model.reason) }}</p>

        <!-- 이 모델에서만 난 실패. 나머지 모델의 답은 그대로 나온다. -->
        <p
          v-else-if="props.answers.get(model.run.id)?.failure"
          class="mt-1 font-medium text-danger"
        >
          {{
            reasonText(
              props.answers.get(model.run.id)?.failure?.code ?? 'UNEXPECTED_ERROR',
              props.answers.get(model.run.id)?.failure?.params,
            )
          }}
        </p>

        <p v-else-if="props.answers.size === 0" class="mt-1 text-ink-faint">
          {{ t('predict.waiting') }}
        </p>
      </li>
    </ul>
  </div>
</template>
