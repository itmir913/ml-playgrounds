<script setup lang="ts">
/**
 * 모델들의 답 (architecture.md §8.13.1).
 *
 * **같은 값을 모든 모델에 동시에 넣는다.** 예측은 밀리초라 나눌 이유가 없고, "같은
 * 값인데 모델마다 답이 다르다"가 결과 화면의 비교와 짝을 이룬다.
 *
 * **쓸 수 없는 모델은 지우지 않고 사유와 함께 끈다** (§8.2). 목록에서 사라지면 학생은
 * 그 모델이 있었다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다.
 *
 * **집계와 강조는 이 목록이 받은 `models`를 그대로 본다.** 필터를 지난 것만 여기
 * 오르므로 (`architecture.md` 8.13.1 "답을 거르고 세어 본다"), 따로 필터를 다시 걸
 * 필요가 없다 — 표의 숫자가 화면의 카드와 저절로 맞아떨어진다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormat } from '@/composables/useFormat'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import type { Prediction } from '@/ml/metrics'
import {
  answerTone,
  majorityAnswer,
  tallyClassificationAnswers,
  type Answer,
  type PredictableModel,
} from '@/ml/predict'
import { whereTrainedKeyOf } from '@/ml/results'

export type { Answer }

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

const tally = computed(() => tallyClassificationAnswers(props.models, props.answers))
const majority = computed(() => majorityAnswer(tally.value))

/**
 * 이 모델의 답이 가장 많이 나온 답과 같은지. **판정은 `ml/predict.ts`가 한다** —
 * "다수결은 분류에만 있다"는 집계가 아는 사실이고, 화면이 한 번 더 알면 갈라진다 (§9.1).
 */
function toneOf(model: PredictableModel): 'majority' | 'minority' | null {
  return answerTone(model, props.answers, majority.value)
}

/**
 * 카드 테두리·배경. **`info`/`caution`이지 `positive`/`danger`가 아니다** — 다른 답을
 * 낸 모델이 틀렸다는 뜻이 아니기 때문이다(`architecture.md` 8.13.1 "부르는 이름은
 * `가장 많이 나온 답`이다").
 */
function toneClass(tone: 'majority' | 'minority' | null): string {
  if (tone === 'majority') return 'border-info bg-info-soft'
  if (tone === 'minority') return 'border-caution bg-caution-soft'
  return 'border-line bg-surface-sunken'
}

function cardClass(model: PredictableModel): string {
  return toneClass(toneOf(model))
}

/**
 * 집계 칩의 색. **카드와 같은 값이면 같은 색이어야 갈림표와 카드를 눈으로 맞춰
 * 볼 수 있다** - 전에는 최다 답만 강조하고 나머지는 전부 무채색이라, "이 색이 어느
 * 카드였더라"를 표에서 못 찾았다.
 */
function tallyChipClass(value: Prediction): string {
  if (majority.value === null) return 'border-line-strong bg-surface'
  return toneClass(value === majority.value ? 'majority' : 'minority')
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.answerTitle') }}</h3>
      <p class="text-ink-soft">{{ t('predict.answerLead') }}</p>
    </div>

    <!--
      **분류 답만 집계한다** (`architecture.md` 8.13.1). 회귀는 연속값이라 정확히
      겹칠 일이 실질적으로 없다. **판정 도구가 아니라 관찰 도구다** — "얼마나
      갈렸나"를 보여줄 뿐 어느 쪽이 옳은지는 말하지 않는다.
    -->
    <section v-if="tally.length > 0" class="flex flex-col gap-1.5">
      <h4 class="font-bold">{{ t('predict.tallyTitle') }}</h4>
      <p class="text-ink-soft">{{ t('predict.tallyLead') }}</p>

      <ul class="flex flex-wrap gap-2">
        <li
          v-for="entry in tally"
          :key="String(entry.value)"
          class="flex items-baseline gap-2 rounded-field border px-3 py-1.5"
          :class="tallyChipClass(entry.value)"
        >
          <span class="font-bold tabular-nums">{{ answerText(entry.value) }}</span>
          <span class="text-ink-soft">{{ t('meta.countUnit', { count: entry.count }) }}</span>
        </li>
      </ul>
    </section>

    <ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <li
        v-for="model in props.models"
        :key="model.run.id"
        class="rounded-panel border p-4"
        :class="[cardClass(model), model.reason ? 'opacity-60' : '']"
      >
        <!--
          **셋을 위계로 나눈다.** 알고리즘·실행 위치가 "어떻게"(이 카드를 다른 카드와
          가르는 값), 실험 이름이 "무엇"(부가 식별자), 답이 "결과"다. 한 줄에
          욱여넣으면 좁은 카드에서 아무 데서나 끊기고, 학생이 찾는 답이 눈에 안 띈다.
        -->
        <div class="flex flex-col gap-1">
          <p class="font-bold">
            {{
              t('predict.modelName', {
                algorithm: t(`algorithms.${model.run.algorithm}`),
                runtime: t(whereTrainedKeyOf(model.run)),
              })
            }}
          </p>

          <p class="text-ink-soft">
            {{ props.experimentNames.get(model.experiment.id) ?? model.experiment.id }}
          </p>

          <!--
            **답은 크게 쓴다.** 이 화면에서 학생이 보러 온 것이 이 한 낱말이다.
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

        <!--
          **모델마다 따로 본다** — `answers.size === 0`이 아니라 이 run에 답이 없는지를
          본다. 필터를 넓히면 답이 있는 카드와 없는 카드가 같이 보일 수 있고, 전체가
          비었을 때만 문구가 뜨면 새로 보인 카드는 아무 말도 못 한다.
        -->
        <p v-else-if="!props.answers.has(model.run.id)" class="mt-1 text-ink-faint">
          {{ t('predict.waiting') }}
        </p>
      </li>
    </ul>
  </div>
</template>
