<script setup lang="ts">
/**
 * 학습한 회귀 모델의 그림 (`open-decisions.md` "97. 학습한 회귀 모델을 그림으로 보일 것인가").
 *
 * 테스트 데이터의 **실제 vs 예측**과 **잔차 vs 예측**을 나란히 그리고, 입력 열이 수치 하나면
 * **회귀선**을 더한다. 축과 이름은 sklearn `PredictionErrorDisplay`를 따른다. 하나만 기본으로 고르지
 * 않는다 — 결정문의 까닭.
 *
 * **저장된 모델로 다시 예측한다** (`ml/regression-fit.ts`). 다시 잰 결정계수가 파일과 다르면 그림
 * 대신 그 사실을 한 줄로 말한다. 재료가 없으면 자리 자체가 없다(§9.2) — 사유는 다른 자리가 말한다.
 */

import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

import RegressionPlot from '@/components/RegressionPlot.vue'
import type { PanelInput } from '@/ml/metric-panels'
import { regressionFitFor, regressionPlot, type RegressionView } from '@/ml/regression-fit'
import { readTestDataset } from '@/project/dataset'
import { dataSnapshot } from '@/project/schema'

const props = defineProps<{ input: PanelInput }>()

const { t } = useI18n()

const result = computed(() =>
  regressionFitFor({
    run: props.input.run,
    experiment: props.input.experiment,
    dataset: props.input.dataset,
    testDataset: readTestDataset(props.input.file),
    preprocessor: props.input.preprocessor,
    modelBytes: props.input.modelBytes,
  }),
)

const fit = computed(() => (result.value?.kind === 'fit' ? result.value.fit : null))
const target = computed(() => dataSnapshot('tabular', props.input.experiment.settings).target ?? '')

/** 그릴 그림들. 회귀선은 입력 열이 수치 하나일 때만 있다(`regressionPlot`이 `null`). */
const plots = computed(() => {
  const found = fit.value
  if (!found) return []
  const axes: Record<RegressionView, { title: string; x: string; y: string; reference: string }> = {
    actual_vs_predicted: {
      title: t('results.regression.actualVsPredicted'),
      x: t('results.regression.axisPredicted'),
      y: t('results.regression.axisActual'),
      reference: t('results.regression.diagonal'),
    },
    residual_vs_predicted: {
      title: t('results.regression.residualVsPredicted'),
      x: t('results.regression.axisPredicted'),
      y: t('results.regression.axisResidual'),
      reference: t('results.regression.zero'),
    },
    line: {
      title: t('results.regression.line', { feature: found.line?.feature ?? '' }),
      x: found.line?.feature ?? '',
      y: target.value,
      reference: t('results.regression.curve'),
    },
  }
  return (Object.keys(axes) as RegressionView[]).flatMap((view) => {
    const plot = regressionPlot(found, view)
    return plot ? [{ view, plot, ...axes[view] }] : []
  })
})

/** 그림마다 붐빈 칸을 묶었는가. 하나라도 그러면 아래 한 줄이 말한다. */
const merged = reactive<Partial<Record<RegressionView, boolean>>>({})
const anyMerged = computed(() => Object.values(merged).some(Boolean))
</script>

<template>
  <section v-if="result" class="flex min-w-0 flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.regression.title') }}</h4>

    <p v-if="result.kind === 'mismatch'" class="text-ink-soft">
      {{ t('results.regression.mismatch') }}
    </p>

    <template v-else-if="fit">
      <p class="text-ink-soft">{{ t('results.regression.lead') }}</p>
      <!-- 넓은 화면에서 앞의 둘은 나란히, 회귀선은 아래 전체 폭이다. 좁으면 위아래로 쌓인다. -->
      <div class="grid min-w-0 gap-4 md:grid-cols-2">
        <RegressionPlot
          v-for="one in plots"
          :key="one.view"
          :class="one.view === 'line' ? 'md:col-span-2' : ''"
          :plot="one.plot"
          :title="one.title"
          :axis-x="one.x"
          :axis-y="one.y"
          :reference="one.reference"
          @merged="(value) => (merged[one.view] = value)"
        />
      </div>
      <p class="text-ink-faint">
        {{ t('results.regression.rows', { count: fit.rows.length }) }}
        <template v-if="anyMerged"> · {{ t('data.charts.scatter.merged') }}</template>
      </p>
    </template>
  </section>
</template>
