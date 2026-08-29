<script setup lang="ts">
/**
 * **전처리 요약** — 지금 설정으로 학습하면 무엇이 되는가 (open-decisions.md "전처리
 * 요약 카드").
 *
 * **아무것도 계산하지 않는다.** 숫자는 전부 `planRun`에서 오고, 그것은 학습이 부르는
 * 그 함수다 (architecture.md §9.1.3). 화면이 따로 세기 시작하면 반올림·뽑기 순서·
 * 훈련 데이터 기준 셋 중 하나에서 반드시 어긋난다.
 *
 * **여기 모으는 것은 흩어져 있던 결과 문장들이다.** 다만 **입력 옆의 즉시 피드백은
 * 남긴다** — 특성 줄은 열 고르기 표 아래에, 뽑기 요약은 행 수 입력 옆에 있어야 학생이
 * 손을 움직이는 자리에서 반응을 본다. 카드로 오는 것은 **입력 옆이 아닌데 파이프라인
 * 전체를 말하던 것**이다.
 *
 * **거부 사유도 결과다.** 지금까지는 [학습하기]를 눌러야 알 수 있었다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { errorMessageKey } from '@/errors'
import type { RunPlan } from '@/ml/plan'
import { usesTarget } from '@/ml/selection'
import { readDataset } from '@/project/dataset'
import { tabularDataOf } from '@/project/schema'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{
  /**
   * 지금 설정의 계획. **판이 한 번만 계산해서 내려준다** — 카드와 열 표가 같은 값을
   * 쓰는데 각자 부르면 `fitPreprocessor`가 설정 하나 바꿀 때마다 두 번 돈다.
   *
   * **유형을 안 골랐어도 온다.** 그때는 `pending`이고, 화면은 "고르면 정해집니다"라고
   * 말한다.
   */
  plan: RunPlan | null
}>()

const { t } = useI18n()
const project = useProjectStore()

const data = computed(() => tabularDataOf(project.file?.document))

const dataset = computed(() => readDataset(project.file))

const plan = computed(() => props.plan)

/**
 * 타깃 줄을 그리는가. **판정은 `usesTarget` 하나다** — 열 표가 타깃 칸을 그리는
 * 기준과 같아야 한다 (`architecture.md` §8.9). 여기서 유형을 직접 비교하면 두 자리가
 * 갈린다.
 */
const showsTarget = computed(() => usesTarget(project.taskType))

/** 계획이 섰을 때의 사실들. 막혔거나 아직이면 `null`이다. */
const facts = computed(() => {
  const current = plan.value
  return current?.ok === true ? current : null
})

/** 학습이 거부하는 사유. 있으면 나머지 숫자는 아직 뜻이 없다. */
const blocked = computed(() => {
  const current = plan.value
  if (current === null || current.ok || current.reason.kind !== 'error') return null
  return t(errorMessageKey(current.reason.code), current.reason.params)
})

/** 아직 유형을 안 골랐는가. 실패가 아니라 정해지지 않은 상태다. */
const pending = computed(() => plan.value?.ok === false && plan.value.reason.kind === 'pending')

const rows = (count: number): string => t('preprocess.tabular.summaryRowUnit', count)
const features = (count: number): string => t('preprocess.tabular.summaryFeatureUnit', count)

/**
 * 인코딩 뒤 특성 수. **원-핫이면 열 하나가 범주 수만큼 늘어난다** — 학생이 다음에
 * 만날 개념이고 지금은 아무 데서도 안 보인다. 안 늘어났으면 이 줄이 없다.
 */
const expanded = computed(() => {
  const current = facts.value
  if (!current) return null
  const { columns, featureNames } = current.preprocessor
  return featureNames.length === columns.length ? null : featureNames.length
})

/** 안 뽑힌 행. 뽑기를 안 켰으면 없다. */
const unused = computed(() => {
  const current = facts.value
  if (!current) return null
  const rest = current.usable.length - current.sampled.length
  return rest > 0 ? rest : null
})
</script>

<template>
  <section v-if="data" class="rounded-panel border border-line bg-surface p-4">
    <h2 class="font-bold">{{ t('preprocess.summaryTitle') }}</h2>

    <!-- 거부 사유는 두 열 위에 전체 폭으로. 막혀 있으면 아래 숫자는 아직 뜻이 없다. -->
    <p v-if="blocked" class="mt-2 font-bold text-danger">{{ blocked }}</p>

    <!--
      **위 두 카드와 세로로 짝을 맞춘다** — 왼쪽에서 고른 것의 결과가 왼쪽 아래,
      오른쪽 설정의 결과가 오른쪽 아래다.

      **`items-start`를 두지 않는다.** 칸을 내용 높이에 맞추면 **가르는 선도 그 높이에서
      끊긴다** — 오른쪽이 짧은 상태에서 선이 중간에 멎어 무엇을 가르는지 안 보였다
      (2026-08-13). 늘어나는 것은 칸이지 글이 아니라, 줄 수가 달라도 글은 위에서 시작한다.

      **여기는 `md`에서 갈린다.** 위 두 판은 `lg`에서 갈리는데(표가 좁아지면 열 이름이
      글자마다 접힌다), 이 카드가 담는 것은 이름과 숫자 한 쌍이라 좁아도 안 접힌다.
      태블릿 폭에서 한 줄에 하나씩 늘어놓으면 오른쪽이 통째로 빈다.
    -->
    <div class="mt-3 grid gap-x-4 gap-y-5 md:grid-cols-2">
      <dl class="flex flex-col gap-1.5">
        <!--
          **타깃을 안 쓰는 유형에서는 이 줄이 없다** (§8.9). 저장된 값은 남아 있지만
          군집화에서는 아무 일도 안 하므로, 적으면 안 쓰는 값을 설정으로 읽게 된다.
        -->
        <div v-if="showsTarget" class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.roleTarget') }}</dt>
          <dd class="truncate">{{ data.target ?? t('meta.none') }}</dd>
        </div>

        <div v-if="facts" class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryFeatures') }}</dt>
          <dd class="tabular-nums">{{ features(facts.preprocessor.columns.length) }}</dd>
        </div>

        <div v-if="expanded !== null" class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryEncoded') }}</dt>
          <dd class="tabular-nums">{{ features(expanded) }}</dd>
        </div>

        <div
          v-if="facts && facts.preprocessor.excludedColumns.length > 0"
          class="flex justify-between gap-4"
        >
          <dt class="shrink-0 font-bold text-ink-soft">
            {{ t('preprocess.tabular.summaryExcluded') }}
          </dt>
          <dd class="truncate">
            {{ facts.preprocessor.excludedColumns.map((column) => column.name).join(', ') }}
          </dd>
        </div>

        <!--
          **설정 셋은 언제나 말한다.** 계획이 막혀도 학생이 고른 것은 그대로이고,
          무엇이 켜져 있는지 모르는 채로 사유만 보는 것이 더 나쁘다.
        -->
        <div class="mt-2 flex justify-between gap-4 border-t border-line pt-2">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.missing') }}</dt>
          <dd>{{ t(`missingStrategy.${data.preprocessing.missing}`) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.scaling') }}</dt>
          <dd>{{ t(`scalingMethod.${data.preprocessing.scaling}`) }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.encoding') }}</dt>
          <dd>{{ t(`categoricalEncoding.${data.preprocessing.categoricalEncoding}`) }}</dd>
        </div>

        <!-- 데이터 누수를 말하는 자리다. 지금까지는 코드 주석에만 있었다. -->
        <p v-if="facts" class="mt-1 text-ink-faint">
          {{ t('preprocess.tabular.summaryFitNote') }}
        </p>
      </dl>

      <!--
        **두 열 사이를 점선으로 가른다** (§8.12). 학습 화면의 두 열이 같은 선으로 갈려
        있어서 같은 문법으로 읽힌다 - 왼쪽에서 정한 것과 오른쪽에서 정한 것이 다른
        이야기라는 표시다. 한 열로 접히면 세로선이 뜻을 잃으므로 가로선이 된다.
      -->
      <dl
        class="flex flex-col gap-1.5 border-t border-dashed border-line-strong pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-4"
      >
        <div class="flex justify-between gap-4">
          <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryTotal') }}</dt>
          <!-- **계획이 못 서도 전체 행 수는 안다.** 정본을 읽은 것이 곧 그 숫자다. -->
          <dd class="tabular-nums">{{ rows(dataset?.rows.length ?? 0) }}</dd>
        </div>

        <template v-if="facts">
          <div class="flex justify-between gap-4">
            <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryUsable') }}</dt>
            <dd class="tabular-nums">{{ rows(facts.usable.length) }}</dd>
          </div>

          <div v-if="unused !== null" class="flex justify-between gap-4">
            <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summarySampled') }}</dt>
            <dd class="tabular-nums">{{ rows(facts.sampled.length) }}</dd>
          </div>

          <!--
            **군집이어도 이 자리를 비우지 않는다.** 학생이 정한 설정이 어디 갔는지
            모르게 되기 때문이다 (open-decisions.md).
          -->
          <p v-if="facts.isClustering" class="mt-2 border-t border-line pt-2 text-ink-soft">
            {{ t('preprocess.tabular.summaryClustering') }}
          </p>

          <template v-else>
            <div class="mt-2 flex justify-between gap-4 border-t border-line pt-2">
              <dt class="font-bold text-ink-soft">{{ t('preprocess.tabular.summaryTrain') }}</dt>
              <dd class="tabular-nums">{{ rows(facts.split.trainIndices.length) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="font-bold text-ink-soft">
                {{
                  facts.testFromProvided
                    ? t('preprocess.tabular.summaryTestFile')
                    : t('preprocess.tabular.summaryTest')
                }}
              </dt>
              <dd class="tabular-nums">{{ rows(facts.split.testIndices.length) }}</dd>
            </div>
          </template>
        </template>

        <p v-if="pending" class="text-ink-soft">{{ t('preprocess.tabular.summaryPending') }}</p>
      </dl>
    </div>
  </section>
</template>
