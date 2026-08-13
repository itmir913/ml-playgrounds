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
  answerRank,
  answersInClusters,
  rankAnswers,
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
  /**
   * 무엇을 모델에 넣는지, 그리고 아직 안 눌렀을 때 무엇을 하면 되는지.
   *
   * **이미 번역된 채로 온다** (`PredictFilters`와 같은 규칙). 여기서 키를 고르면 이
   * 목록이 데이터 종류를 알게 되고, 실제로 그래서 **사진 예측 화면에 "값을 채우고
   * [예측]을 누르면"이 떴다** — 사진에는 채울 값이 없다.
   */
  lead: string
  waiting: string
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

/**
 * 카드에 쓰는 답. **군집은 번호가 아니라 이름으로 쓴다** (§8.13.1).
 *
 * `0`이라고만 쓰면 분류의 라벨 `0`이나 회귀의 값 `0`과 글자가 같다. **어느 모델의 답이
 * 군집 번호인지는 화면이 아니라 `ml/predict.ts`가 안다** (§9.1).
 */
function cardAnswer(model: PredictableModel): string | null {
  const value = props.answers.get(model.run.id)?.value
  if (value === undefined) return null
  if (!answersInClusters(model)) return answerText(value)
  return t('results.clusterName', { index: Number(value) })
}

/**
 * 군집으로 답한 모델이 하나라도 있는가. **있으면 번호의 뜻을 한 줄로 말한다.**
 *
 * 서로 다른 학습의 `0번 군집`은 같은 군집이 아닌데, 카드 둘이 나란히 같은 글자를 달고
 * 있으면 학생은 "둘 다 같은 답"으로 읽는다.
 */
const hasClusterAnswer = computed(() =>
  props.models.some((model) => answersInClusters(model) && props.answers.has(model.run.id)),
)

const tally = computed(() => tallyClassificationAnswers(props.models, props.answers))
const ranks = computed(() => rankAnswers(tally.value))

/** 갈림표는 많이 나온 답부터 늘어놓는다 - 카드 색의 1등이 표에서도 맨 앞이다. */
const rankedTally = computed(() => {
  const map = ranks.value
  if (map === null) return tally.value
  return [...tally.value].sort((a, b) => (map.get(a.value) ?? 0) - (map.get(b.value) ?? 0))
})

/** 한 번 섞은 새 배열. 제자리에서 안 바꾼다 - 원본을 공유하는 곳이 있으면 그쪽이 놀란다. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = copy[i]!
    copy[i] = copy[j]!
    copy[j] = temp
  }
  return copy
}

/**
 * 값마다 다른 색. **7개까지만 있다.** 값 종류가 이보다 늘면 8등부터는 전부 같은
 * 회색이다 - 갈림표는 "값별로 다른 색"이 필요하지 "무한히 다른 색"이 필요하지 않고,
 * 색이 여덟아홉 개를 넘으면 어차피 눈으로 못 가른다 (architecture.md 8.13.1).
 *
 * **문자열을 통째로 적는다.** `` `border-chart-${n}` `` 처럼 이어 붙이면 Tailwind가
 * 소스에서 클래스 이름을 못 찾아 그 색이 빌드에서 통째로 빠진다 - CLAUDE.md §4가 임의
 * 값을 막는 것과 같은 이유로, 만들어 붙인 이름도 안 된다.
 *
 * **등수와 색의 대응은 뜬다(mount) 때마다 한 번 섞는다.** 색은 순위표가 아니라
 * "같은 값이면 같은 색"만 보장하면 되므로, 1등이 매번 chart-1로 고정될 이유가 없다.
 * 고정하면 분류가 대개 두세 갈래라 chart-1·2만 늘 쓰이고 나머지 다섯은 안 쓰인
 * 채로 남는다. **답이 갱신되는 동안에는 다시 안 섞는다** - [예측]을 다시 누를 때마다
 * 색이 바뀌면 방금 보던 카드를 못 찾는다. 그래서 반응형 값이 아니라 이 컴포넌트가
 * 뜰 때 한 번만 계산해 상수처럼 쓴다.
 */
const CHART_CLASSES = shuffled([
  'border-chart-1 bg-chart-1-soft',
  'border-chart-2 bg-chart-2-soft',
  'border-chart-3 bg-chart-3-soft',
  'border-chart-4 bg-chart-4-soft',
  'border-chart-5 bg-chart-5-soft',
  'border-chart-6 bg-chart-6-soft',
  'border-chart-7 bg-chart-7-soft',
])

/**
 * 카드 테두리·배경. `null`은 갈리지 않았거나(값이 하나뿐) 회귀 모델이다 - 이때는
 * 강조할 갈림이 없으므로 무채색이다.
 */
function toneClass(rank: number | null): string {
  return (rank !== null && CHART_CLASSES[rank]) || 'border-line bg-surface-sunken'
}

function cardClass(model: PredictableModel): string {
  return toneClass(answerRank(model, props.answers, ranks.value))
}

/**
 * 집계 칩의 색. **카드와 같은 값이면 같은 색이어야 갈림표와 카드를 눈으로 맞춰
 * 볼 수 있다** - 전에는 최다 답만 강조하고 나머지는 전부 무채색이라, "이 색이 어느
 * 카드였더라"를 표에서 못 찾았다.
 */
function tallyChipClass(value: Prediction): string {
  const rank = ranks.value?.get(value) ?? null
  return (rank !== null && CHART_CLASSES[rank]) || 'border-line-strong bg-surface'
}

/** 막대 한 줄. 화면이 그리는 데 필요한 것만 담는다. */
interface ProbabilityBar {
  readonly name: string
  readonly percent: string
  readonly width: string
  /** 이 범주가 이 모델의 답인가. **확률의 최댓값이 아니라 답과 대조한다** (아래 주석). */
  readonly chosen: boolean
}

/**
 * 범주별 확률 막대 (architecture.md §8.13.1, mlpx-spec.md §5.4).
 *
 * **확률을 내는 모델에만 있다.** 지금은 로지스틱 회귀뿐이고, 포화해서 못 낸 답에도 없다 —
 * 그때 균등분포를 그리면 없는 확신을 지어낸다.
 *
 * **어느 막대를 굵게 쓸지는 `value`와 이름을 대조해 정한다.** 확률의 argmax로 정하면
 * 포화 구간에서 큰 답과 굵은 막대가 갈릴 수 있고(mlpx-spec.md §5.4), 그러면 화면이
 * 자기 자신과 어긋난 말을 한다. **답은 언제나 모델이 낸 그 값이다.**
 */
function bars(model: PredictableModel): ProbabilityBar[] {
  const answer = props.answers.get(model.run.id)
  const proba = answer?.probabilities
  if (!proba) return []

  return proba.classes.map((name, index) => {
    const ratio = proba.values[index] ?? 0
    return {
      name,
      percent: format.percent(ratio),
      // 소수점을 남긴다 - 반올림하면 1%가 안 되는 막대가 통째로 사라진다.
      width: `${(ratio * 100).toFixed(2)}%`,
      chosen: name === answer?.value,
    }
  })
}
</script>

<template>
  <!--
    **`@container`가 붙는 자리다.** 아래 그리드가 창이 아니라 **자기가 받은 폭**을 보게
    한다 — `lg:`로 쓰면 창이 1024px일 때 열이 셋으로 갈리는데, 그때 이 목록이 사는
    오른쪽 칸은 아직 482px이라 카드 하나가 147px이 된다. 사진 예측에서는 더 나쁘다(사진
    128px과 [빼기]를 뺀 나머지가 이 폭이다).
  -->
  <div class="@container flex flex-col gap-5">
    <div class="flex flex-col gap-1.5">
      <h3 class="text-lg font-bold">{{ t('predict.answerTitle') }}</h3>
      <p class="text-ink-soft">{{ props.lead }}</p>
      <!-- **번호는 그 모델 안에서만 뜻이 있다** (§8.13.1). 갈림표가 군집을 안 세는 이유도 이것이다. -->
      <p v-if="hasClusterAnswer" class="text-ink-soft">{{ t('predict.clusterAnswerNote') }}</p>
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
          v-for="entry in rankedTally"
          :key="String(entry.value)"
          class="flex items-baseline gap-2 rounded-field border px-3 py-1.5"
          :class="tallyChipClass(entry.value)"
        >
          <span class="font-bold tabular-nums">{{ answerText(entry.value) }}</span>
          <span class="text-ink-soft">{{ t('meta.countUnit', { count: entry.count }) }}</span>
        </li>
      </ul>
    </section>

    <!--
      **기준은 카드 하나가 280px 아래로 안 내려가는 것이다.** 카드가 담는 것은 두 줄로
      접히는 모델 이름과 답, 그리고 범주별 확률 막대다. 문턱은 그 값에서 나온다 —
      간격 16px을 빼고 나누면 36rem에서 280px, 56rem에서 288px, 72rem에서 276px이다.
    -->
    <ul class="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
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
            v-if="cardAnswer(model) !== null"
            class="text-xl font-bold tabular-nums text-brand-strong"
          >
            {{ cardAnswer(model) }}
          </p>
        </div>

        <!--
          **범주별 확률** (mlpx-spec.md §5.4). 확률을 내는 모델에만 붙고, 포화해서 못 낸
          답에는 안 붙는다 — 없는 확신을 지어내지 않는다.

          **이름과 값을 한 줄에, 막대를 그 아래에 둔다.** 이름을 막대와 나란히 두면 범주
          이름이 길 때 잘리는데, 그 이름은 학생의 데이터에서 온 것이라 길이를 우리가 정할
          수 없다.
        -->
        <section v-if="bars(model).length > 0" class="mt-3 flex flex-col gap-2">
          <h5 class="text-ink-soft">{{ t('predict.probability') }}</h5>

          <ul class="flex flex-col gap-2">
            <li v-for="bar in bars(model)" :key="bar.name" class="flex flex-col gap-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="truncate" :class="bar.chosen ? 'font-bold' : 'text-ink-soft'">
                  {{ bar.name }}
                </span>
                <span
                  class="shrink-0 tabular-nums"
                  :class="bar.chosen ? 'font-bold' : 'text-ink-soft'"
                >
                  {{ bar.percent }}
                </span>
              </div>

              <!--
                학습 진행률 막대와 같은 모양이되 **테두리가 있다.** 저기서는 트랙이
                흰 배경 위에 있지만 여기 카드가 `bg-surface-sunken`이라 트랙과 색이
                정확히 같고, 그러면 0%인 범주는 막대가 통째로 사라져 후보에 없었던 것처럼
                보인다. 카드 톤이 여덟 가지라(무채색 + 갈림 색 일곱) 어느 배경에서도
                안전한 트랙 색이 없어서, 색이 아니라 선으로 자리를 잡는다.
              -->
              <div
                class="h-2 w-full overflow-hidden rounded-pill border border-line-strong bg-surface-sunken"
              >
                <div
                  class="h-full rounded-pill"
                  :class="bar.chosen ? 'bg-brand' : 'bg-brand-line'"
                  :style="{ width: bar.width }"
                />
              </div>
            </li>
          </ul>
        </section>

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
          {{ props.waiting }}
        </p>
      </li>
    </ul>

    <!--
      **유형이 더 말할 수 있으면 여기서 말한다** (§8.13.1). 위의 갈림표가 분류에만 붙는
      것과 **같은 문법이고 방향만 다르다** — 갈림표는 답들을 요약하니 카드 위이고, 이
      자리는 답 하나를 풀어 설명하니 카드 아래다.

      **이 화면은 무엇이 들어오는지 모른다.** 지금 들어오는 것은 군집의 이웃인데
      (`ClusterNeighbors`), 그것을 여기서 이름으로 알면 §9.1이 막으려던 분기가 생긴다.
    -->
    <slot name="detail" />
  </div>
</template>
