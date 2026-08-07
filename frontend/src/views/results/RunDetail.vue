<script setup lang="ts">
/**
 * run 하나의 속 — 등록부가 고른 상세 패널들.
 *
 * **표 줄 안에서 펼치지 않고 표 아래에 둔다** (architecture.md §8.13). 표 안에 표를
 * 넣으면 열 폭이 무너진다.
 *
 * **무엇을 그릴지 여기서 정하지 않는다** (§9.1). 혼동 행렬이 분류 전용이라는 사실은
 * `ml/metric-panels.ts`에 있고, 이 화면은 등록부가 준 목록을 순서대로 그리기만 한다.
 * 이미지가 들어와도 여기는 안 고친다.
 *
 * **패널이 0개면 아무 말도 안 한다** (§9.2 "없는 것을 이름으로 말하지 않는다",
 * 2026-08-07). 회귀에서 `회귀에는 혼동 행렬이 없습니다`라고 적고 있었는데, 그렇게 적으려면
 * **이 화면이 혼동 행렬이라는 것을 알아야 하고** 아는 순간 여기 `if (분류) … else …`가
 * 생긴다. 이미지가 들어오면 그 문장이 한 줄 더 느는 것이 그 증거다. 회귀 결과는 지표와
 * 설정으로 이미 완결되어 있고, 설정은 언제나 있으므로 카드가 통째로 비지도 않는다.
 *
 * **맨 위는 이 run에 먹인 손잡이들이다** (§8.13, 2026-08-07). 등록부가 고르는 패널들과
 * 달리 **축을 안 보므로 등록부에 안 들어간다** — 어느 데이터 종류, 어느 과제 유형이든
 * 모든 run에 있다. 무엇을 어떤 순서로 보일지는 `hyperparametersOf`가 정한다 (§9.1).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { metricPanelsFor } from '@/ml/metric-panels'
import { hyperparametersOf, whereTrainedKeyOf } from '@/ml/results'
import type { DataType, Run, TaskType } from '@/project/schema'

const props = defineProps<{ run: Run; dataType: DataType; taskType: TaskType }>()

const { t } = useI18n()

/**
 * 성공했지만 학생이 알아야 하는 사실 (mlpx-spec.md §5.9).
 *
 * **점수 위에 둔다.** 이 문장이 걸리는 대상이 아래의 모든 숫자이고, 숫자를 다 읽은 뒤에
 * 알게 되면 이미 늦다. 실패한 run의 사유와 같은 방식으로 키를 만든다 — 코드가 어느
 * 네임스페이스인지 아는 것은 `errorMessageKey` 하나다.
 */
const warningText = computed(() => {
  const warning = props.run.warning
  return warning ? t(errorMessageKey(warning.code as ClientErrorCode), { ...warning.params }) : null
})

const panels = computed(() => metricPanelsFor(props.dataType, props.taskType, props.run))

/** 이 run에 먹인 손잡이들. 판정은 전부 `ml/results.ts`에 있다. */
const hyperparameters = computed(() => hyperparametersOf(props.run))
</script>

<template>
  <!--
    **카드 하나가 이 run 하나의 것임을 테두리로 말한다.** 표에서 줄을 눌러 내려오지만,
    스크롤하고 나면 방금 누른 줄이 화면 밖이라 무엇을 보고 있는지 잊기 쉽다. 문장 한 줄로
    "어느 모델"인지 밝히는 것보다, 그 속(혼동 행렬 등)을 통째로 카드 테두리 안에 담아
    "이 안이 전부 그 모델의 것"이라고 형태로 보여주는 편이 더 즉각적이다. 강조색은
    `ExperimentDetail`이 고른 줄에 쓰는 `bg-brand-soft`와 같다 — 표의 그 줄이 이 카드로
    펼쳐졌다는 것이 색으로 이어진다.
  -->
  <div class="overflow-hidden rounded-panel border border-brand-line">
    <div class="flex flex-wrap items-baseline gap-x-2 bg-brand-soft px-4 py-3">
      <h3 class="font-bold text-ink">
        {{ t('results.detailFor', { model: t(`algorithms.${props.run.algorithm}`) }) }}
      </h3>
      <span class="text-ink-soft">{{ t(whereTrainedKeyOf(props.run)) }}</span>
    </div>

    <div class="flex flex-col gap-5 bg-surface p-4">
      <p v-if="warningText" class="rounded-panel border border-caution/30 bg-caution-soft p-3">
        {{ warningText }}
      </p>

      <!--
        **이 run에 먹인 손잡이들.** 지표보다 위다 (§8.13) — 아래의 모든 숫자가 이 설정에서
        나온 값이고, 다 읽은 뒤에 무슨 설정이었는지 알게 되면 이미 늦다. `직전 학습에서
        바뀐 것`은 이 자리를 대신하지 못한다: 그것은 두 실험의 차이라 안 바꾼 값은 안 뜨고
        첫 실험에는 아무것도 안 뜬다.
      -->
      <section class="flex flex-col gap-1.5">
        <h4 class="font-bold">{{ t('results.paramTitle') }}</h4>

        <!--
          **손잡이가 없는 모델도 그 사실을 적는다** (나이브 베이즈·선형 회귀). 학습 화면이
          같은 상황에서 쓰는 문장을 그대로 쓴다 — 같은 사실을 두 화면이 다른 낱말로 말할
          이유가 없다.
        -->
        <p v-if="hyperparameters.length === 0" class="text-ink-soft">{{ t('train.noTuning') }}</p>

        <dl v-else class="flex flex-wrap gap-x-6 gap-y-1.5">
          <div v-for="param in hyperparameters" :key="param.name" class="flex items-baseline gap-2">
            <!--
              **등록부가 모르는 키는 엔진이 받는 키 그대로 보인다.** 번역된 이름이 없다고
              값을 감추면 화면이 파일보다 적게 말한다 (`ChangeList`의 모르는 경로와 같다).
            -->
            <dt v-if="param.labelKey === null" class="text-ink-soft">{{ param.name }}</dt>
            <dt v-else class="text-ink-soft">{{ t(param.labelKey) }}</dt>
            <dd class="font-bold tabular-nums">{{ param.text }}</dd>
          </div>
        </dl>
      </section>

      <!--
        **등록부가 준 순서 그대로다.** 여기에 조건을 더하지 마라 — 무엇이 언제 뜨는지는
        `ml/metric-panels.ts`의 항목이 자기 옆에 갖는다 (§9.1). **0개일 때의 가지도 두지
        마라** — 그 가지에 쓸 문장은 반드시 등록부가 아는 것의 이름을 부르게 된다 (§9.2).
      -->
      <component :is="panel.panel" v-for="panel in panels" :key="panel.id" :run="props.run" />
    </div>
  </div>
</template>
