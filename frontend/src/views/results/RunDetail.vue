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
 * **회귀에는 아무것도 없다.** 맞고 틀림이 아니라 얼마나 벗어났느냐이고, 그건 위의
 * 점수가 이미 전부 말했다. 빈 칸으로 두지 않고 그 사실을 적는다 — 이유 없는 빈 자리는
 * 고장으로 보인다 (§8.9). **패널이 0개인 것은 고장이 아니라 정상인 조합이 있다** (§9.3).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { metricPanelsFor } from '@/ml/metric-panels'
import { whereTrainedKeyOf } from '@/ml/results'
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
        **등록부가 준 순서 그대로다.** 여기에 조건을 더하지 마라 — 무엇이 언제 뜨는지는
        `ml/metric-panels.ts`의 항목이 자기 옆에 갖는다 (§9.1).
      -->
      <component :is="panel.panel" v-for="panel in panels" :key="panel.id" :run="props.run" />

      <p v-if="panels.length === 0" class="text-ink-soft">
        {{ t('results.noDetail') }}
      </p>
    </div>
  </div>
</template>
