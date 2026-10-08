<script lang="ts">
/**
 * **재수출은 이 블록에 있어야 한다.** `<script setup>` 안의 `export`는 컴파일러가
 * 못 받는다. 팔레트 차례를 모듈에서 한 번 뽑던 자리는 `answer-tones.ts`로 옮겼다 —
 * 판정을 순수 함수로 두어 vitest가 덮게 하려고서다.
 */
import type { Answer } from '@/ml/predict'

export type { Answer }
</script>

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
 * **머리글은 여기 없다** (open-decisions.md "머리글은 목록 밖에 선다"). 표에서는 한
 * 번씩 뜨던 제목·설명·군집 안내가 이미지에서는 사진 수만큼 찍혔다. 무엇을 넣는지는
 * 호출부가 말하고, 이 목록은 **답만 그린다** — 대신 자기 이름은 `aria-label`로 계속
 * 단다. 화면에서 제목을 뺀다고 영역의 이름까지 없애면 스크린리더에게 무명이 된다.
 *
 * **집계와 강조는 이 목록이 받은 `models`를 그대로 본다.** 필터를 지난 것만 여기
 * 오르므로 (`architecture.md` 8.13.1 "답을 거르고 세어 본다"), 따로 필터를 다시 걸
 * 필요가 없다 — 표의 숫자가 화면의 카드와 저절로 맞아떨어진다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppPopover from '@/components/AppPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { nameList } from '@/data/columns'
import { ACTION_ICONS } from '@/icons'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import type { Prediction } from '@/ml/metrics'
import {
  answerRank,
  answersInClusters,
  clusterNumberOf,
  tallyClassificationAnswers,
  type PredictableModel,
} from '@/ml/predict'
import { hyperparametersOf, whereTrainedKeyOf } from '@/ml/results'
import { answerEvidenceFor } from '@/ml/answer-evidence'
import type { DataType } from '@/project/schema'
import { cardTone, rankTally, tallyTone } from './answer-tones'

/**
 * **`withDefaults`가 있어야 한다.** Vue는 빠진 불리언 prop을 `undefined`가 아니라 `false`로
 * 바꿔 넣으므로, 기본값이 없으면 표 예측의 카드가 통째로 숨는다.
 */
const props = withDefaults(
  defineProps<{
    /**
     * 무엇을 예측하는가. **여기서 비교하지 않는다** — 답에 붙일 증거를 등록부에 물을 때만
     * 쓴다 (`ml/answer-evidence.ts`). 목록이 종류를 알고 갈라지기 시작하면, 음성이 오는
     * 날 고쳐야 할 파일이 등록부 하나가 아니라 이 화면이 된다 (architecture.md §9.1).
     */
    dataType: DataType
    models: readonly PredictableModel[]
    /** run id -> 답. 아직 안 눌렀으면 비어 있다. */
    answers: ReadonlyMap<string, Answer>
    /** 실험 id -> 화면에 쓰는 이름. 결과 화면의 세로줄과 같은 이름이어야 한다. */
    experimentNames: ReadonlyMap<string, string>
    /**
     * 아직 안 눌렀을 때 카드가 하는 말. **이미 번역된 채로 온다** (`PredictFilters`와 같은
     * 규칙) — 여기서 키를 고르면 이 목록이 데이터 종류를 알게 되고, 실제로 그래서
     * **사진 예측 화면에 "값을 채우고 [예측]을 누르면"이 떴다.**
     */
    waiting: string
    /**
     * `값 -> 등수`. **화면 전체에서 매겨 내려온다** (`rankAnswersAcross`).
     *
     * 여기서 매기면 사진마다 따로 매겨져, 동점일 때 정렬이 뒤집혀 **같은 답이 사진마다
     * 다른 색**을 받는다. 갈림표의 **개수**는 여전히 이 목록이 받은 답으로 센다 —
     * 그건 그 사진에 대한 사실이다.
     */
    ranks: ReadonlyMap<Prediction, number> | null
    /**
     * 카드가 보이는가. **없으면 보인다** — 표 예측은 입력이 한 줄이라 숨길 일이 없다.
     * 숨기는 단추는 `#fold` 칸으로 호출부가 넣는다 (§8.13.4).
     */
    cardsShown?: boolean
  }>(),
  { cardsShown: true },
)

const { t } = useI18n()
const format = useFormat()

/** 그 모델에 먹인 손잡이들. **판정은 `ml/results.ts`가 한다** — 결과 화면과 같은 함수다. */
function paramsOf(model: PredictableModel) {
  return hyperparametersOf(model.run)
}

function reasonText(code: ClientErrorCode, params: Record<string, unknown> = {}): string {
  return t(errorMessageKey(code), { ...params })
}

/**
 * 이 카드가 왜 못 쓰는지. **사유마다 학생이 할 일이 다르다.**
 *
 * 모델이 파일에 안 담긴 run에는 `MODEL_FILE_INVALID`("다시 학습하면 쓸 수 있습니다")가
 * 붙는데, **`tooLarge`에는 정반대다** — 앱 자신이 `modelOmission.tooLarge`에서 "다시
 * 학습해도 같으니 모델을 키우는 설정을 줄여 보세요"라고 적었다 (V11 R5 B-7).
 * 왜 안 담겼는지를 아는 run에서는 그 말을 고른다.
 */
function unusableText(model: PredictableModel): string {
  if (model.omitted !== undefined) return t(`modelOmission.${model.omitted}`)
  return reasonText(model.reason ?? 'MODEL_FILE_INVALID', { ...model.reasonParams })
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
 * 이 답에 붙일 증거. **등록부가 고른다** (`ml/answer-evidence.ts`) — 이 목록은 무엇이
 * 붙는지 모르고, 붙을 것이 없는 조합이 정상이다(분류·표 군집).
 *
 * 답이 없으면 붙일 것도 없다. 아직 안 누른 카드에 여는 단추만 서 있으면 학생은 그것부터
 * 눌러 보고 빈 상자를 본다.
 */
function evidenceOf(model: PredictableModel) {
  // **답은 문자열로 온다** (`clusterNumberOf`). 여기서 다시 묻지 않는다.
  const cluster = clusterNumberOf(model, props.answers.get(model.run.id)?.value)
  if (cluster === null) return null
  const found = answerEvidenceFor(props.dataType, model.experiment.settings.taskType, model.run)
  return found ? { panel: found.panel, value: cluster } : null
}

/**
 * 카드마다 증거를 **한 번만** 센다. 템플릿에서 부르면 카드 하나에 네 번 돌고, 사진이
 * 스물인 화면에서 곱해진다 (V11 R5 C-3).
 */
const cards = computed(() => props.models.map((model) => ({ model, evidence: evidenceOf(model) })))

const tally = computed(() => tallyClassificationAnswers(props.models, props.answers))

/** 갈림표의 차례와 색은 `answer-tones.ts`가 정한다. */
const rankedTally = computed(() => rankTally(tally.value, props.ranks))

function cardClass(model: PredictableModel): string {
  return cardTone(answerRank(model, props.answers, props.ranks))
}

function tallyChipClass(value: Prediction): string {
  return tallyTone(value, props.ranks)
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
  <section class="@container flex flex-col gap-5" :aria-label="t('predict.answerTitle')">
    <!--
      **분류 답만 집계한다** (`architecture.md` 8.13.1). 회귀는 연속값이라 정확히
      겹칠 일이 실질적으로 없다. **판정 도구가 아니라 관찰 도구다** — "얼마나
      갈렸나"를 보여줄 뿐 어느 쪽이 옳은지는 말하지 않는다.
    -->
    <!--
      **카드를 펴고 닫는 단추는 칩 왼쪽에 선다** (architecture.md §8.13.4, 사용자). 갈림표는
      펴든 닫든 같은 자리에 있고 그 아래 카드만 숨는다 — 단추가 다른 줄에 있으면 누를
      때마다 칩이 자리를 옮겨 화면이 흔들린다. 갈림표가 없는 답(회귀·군집·예측 전)에는
      단추만 선다.
    -->
    <section v-if="tally.length > 0 || $slots.fold" class="flex flex-col gap-1.5">
      <template v-if="tally.length > 0">
        <h4 class="font-bold">{{ t('predict.tallyTitle') }}</h4>
        <p class="text-ink-soft">{{ t('predict.tallyLead') }}</p>
      </template>

      <div class="flex flex-wrap items-start gap-2">
        <slot name="fold" />

        <ul v-if="tally.length > 0" class="flex flex-wrap gap-2">
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
      </div>
    </section>

    <!--
      **기준은 카드 하나가 280px 아래로 안 내려가는 것이다.** 카드가 담는 것은 두 줄로
      접히는 모델 이름과 답, 그리고 범주별 확률 막대다. 문턱은 그 값에서 나온다 —
      간격 16px을 빼고 나누면 36rem에서 280px, 56rem에서 288px, 72rem에서 276px이다.

      **한 줄의 카드는 높이를 맞춘다** (그리드 기본값 `stretch`, 사용자). 확률 막대가 없는 카드가 옆 카드보다
      짧게 끊기면 줄이 들쭉날쭉하다. 내용은 위에서부터 놓인다 — 가운데로 모으지 않는다.
    -->
    <!--
      **숨겨도 그린다** (`v-show`, architecture.md §8.13.4). 전체 스위치 한 번에 사진 수 ×
      모델 수만큼 카드를 만들었다 부수는 것이 남겨 두는 것보다 무겁다.
    -->
    <ul
      v-show="props.cardsShown"
      class="grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4"
    >
      <li
        v-for="{ model, evidence } in cards"
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
          <p class="font-bold">{{ t(`algorithms.${model.run.algorithm}`) }}</p>
          <p class="text-ink-soft">{{ t(whereTrainedKeyOf(model.run)) }}</p>

          <!--
            **실험 이름을 누르면 그 모델의 손잡이가 열린다.** 이 화면의 일이 "같은 값인데
            모델마다 답이 다르다"를 보는 것인데, 왜 다른지의 절반이 하이퍼파라미터다 —
            그걸 보려고 결과 화면으로 갔다 오면 답들이 눈앞에서 사라진다.

            **표 머리글의 설명과 같은 문법이다** (§8.13) — 평문에 아이콘이 붙고, 눌러야
            열린다. 다만 여는 것이 설명이 아니라 값이라 `TermPopover`가 아니다.
          -->
          <!--
            **위로 연다.** 이 트리거 바로 아래가 그 모델의 답이라, 아래로 열면 **왜 그
            답이 나왔는지를 보려고 연 패널이 그 답을 가린다.** 표 머리글의 설명이 위로
            열리는 것과 같은 이유다(`TermPopover`) — 트리거 아래가 전부 값인 자리다.
            위쪽에 자리가 모자라면 `AppPopover`가 알아서 아래로 뒤집는다.
          -->
          <AppPopover side="top">
            <template #trigger="{ open }">
              <button
                type="button"
                :aria-expanded="open"
                class="flex items-center gap-1 rounded-control text-ink-soft transition-colors hover:text-ink"
              >
                {{ props.experimentNames.get(model.experiment.id) ?? model.experiment.id }}
                <component :is="ACTION_ICONS.explainTerm" :size="16" aria-hidden="true" />
              </button>
            </template>

            <h5 class="font-bold text-ink">{{ t('results.paramTitle') }}</h5>

            <!-- 손잡이가 없는 모델도 그 사실을 적는다 (`RunDetail`과 같은 문장이다). -->
            <p v-if="paramsOf(model).length === 0" class="mt-2 text-ink-soft">
              {{ t('train.noTuning') }}
            </p>

            <dl v-else class="mt-2 flex flex-col gap-1.5">
              <div
                v-for="param in paramsOf(model)"
                :key="param.name"
                class="flex items-baseline justify-between gap-4"
              >
                <!-- 등록부가 모르는 키는 엔진이 받는 키 그대로 보인다 (`RunDetail`과 같다). -->
                <dt class="text-ink-soft">
                  {{ param.labelKey === null ? param.name : t(param.labelKey) }}
                </dt>
                <dd class="font-bold tabular-nums">{{ param.text }}</dd>
              </div>
            </dl>
          </AppPopover>

          <!--
            **답은 크게 쓴다.** 이 화면에서 학생이 보러 온 것이 이 한 낱말이다.
          -->
          <div v-if="cardAnswer(model) !== null" class="flex items-center gap-1.5">
            <!--
              **답이 곧 트리거다.** 증거가 붙는 답(군집 번호)은 그 글자를 눌러 연다 —
              옆에 아이콘을 하나 더 두면 한 카드에 여는 표시가 둘이 된다. 증거가 없는
              답은 지금까지처럼 그냥 글자다.
            -->
            <p v-if="!evidence" class="text-xl font-bold tabular-nums text-brand-strong">
              {{ cardAnswer(model) }}
            </p>

            <!--
              **답의 증거.** 군집 번호처럼 그 자체로는 아무 말도 안 하는 답에 붙는다
              (open-decisions.md "군집 답의 증거는 팝오버가 갖는다").

              **목록 위나 카드 안에 늘 그리지 않는다** — 위에 그리면 답이 나올 때 아래가
              밀리고, 카드마다 그리면 `사진 수 × 모델 수 × 아홉 장`이 한 쪽에 뜬다.
              팝오버는 흐름 밖에 뜨고 **연 것만** 그린다.

              위로 여는 이유는 손잡이 팝오버와 같다 — 아래가 전부 답이다.
            -->
            <AppPopover v-if="evidence" side="top" size="photos">
              <template #trigger="{ open }">
                <!--
                  **아이콘을 안 단다** (2026-08-14, 사용자). 이 카드에는 실험 이름의 설명
                  팝오버가 이미 (i) 아이콘을 달고 있어서, 둘이 서면 무엇이 무엇의 설명인지
                  자리와 문맥으로만 갈린다.

                  **점선 밑줄은 이 앱에서 이미 "눌러도 아무 일이 안 일어나고 설명만
                  펼쳐진다"는 뜻이다** (`AppButton` 주석의 표기 규칙). 실선은 실제로
                  무언가를 하는 것(ghost 버튼)이라 둘이 안 헷갈린다.

                  **이름에 답을 넣는다** (2026-09-01 감사 B-4). `aria-label`은 안의 글자를
                  **덮어쓴다** — 그래서 보조기술 사용자에게는 이 카드에서 학생이 보러 온
                  그 한 낱말이 **아예 안 들렸다.** 바로 위 주석이 *"답은 크게 쓴다. 이
                  화면에서 학생이 보러 온 것이 이 한 낱말이다"*라고 적어 둔 자리다.
                -->
                <button
                  type="button"
                  :aria-expanded="open"
                  :aria-label="t('predict.clusterEvidenceOpen', { answer: cardAnswer(model) })"
                  class="rounded-control text-xl font-bold tabular-nums text-brand-strong underline decoration-dotted decoration-1 underline-offset-4 transition-colors hover:text-brand"
                >
                  {{ cardAnswer(model) }}
                </button>
              </template>

              <component
                :is="evidence?.panel"
                :input="{
                  experiment: model.experiment,
                  run: model.run,
                  value: evidence?.value ?? 0,
                }"
              />
            </AppPopover>
          </div>
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

        <!--
          **학습 때 못 본 값이 들어간 답** (open-decisions.md 72). 답은 그대로 두고 표시만 한다 —
          판정은 부르는 쪽이 `unseenCategories`로 답에 붙인다(표 예측만 붙인다).
        -->
        <p v-if="props.answers.get(model.run.id)?.unseen" class="mt-1 font-medium text-caution">
          {{
            t('predict.tabular.unseenNote', {
              columns: nameList(props.answers.get(model.run.id)?.unseen ?? []),
            })
          }}
        </p>

        <!-- 쓸 수 없는 사유. 전부 다른 말이고 학생이 할 수 있는 일이 다르다. -->
        <p v-if="model.reason" class="mt-1 text-ink-soft">{{ unusableText(model) }}</p>

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
  </section>
</template>
