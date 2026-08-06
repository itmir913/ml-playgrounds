<script setup lang="ts">
/**
 * run 하나의 속 — 혼동 행렬과 값 종류별 점수.
 *
 * **표 줄 안에서 펼치지 않고 표 아래에 둔다** (architecture.md §8.13). 표 안에 표를
 * 넣으면 열 폭이 무너진다.
 *
 * **회귀에는 아무것도 없다.** 맞고 틀림이 아니라 얼마나 벗어났느냐이고, 그건 위의
 * 점수가 이미 전부 말했다. 빈 칸으로 두지 않고 그 사실을 적는다 — 이유 없는 빈 자리는
 * 고장으로 보인다 (§8.9).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { whereTrainedKeyOf } from '@/ml/results'
import type { Run } from '@/project/schema'

const props = defineProps<{ run: Run }>()

const { t } = useI18n()
const format = useFormat()

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

      <section v-if="props.run.confusionMatrix" class="flex flex-col gap-1.5">
        <h4 class="font-bold">{{ t('results.confusion') }}</h4>
        <p class="text-ink-soft">{{ t('results.confusionLead') }}</p>

        <AppTable>
          <thead>
            <tr>
              <!-- 모서리 칸. 세로축이 실제이고 가로축이 예측이라는 것을 여기서 말한다. -->
              <th>{{ t('results.actual') }}</th>
              <th v-for="label in props.run.confusionMatrix.labels" :key="label">{{ label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in props.run.confusionMatrix.matrix" :key="index">
              <th class="text-left">{{ props.run.confusionMatrix.labels[index] }}</th>
              <!--
                **맞힌 칸(대각선)은 굵기와 배경을 함께 준다.** 굵기만으로는 표를 눈으로
                훑을 때 잘 안 걸린다 — 배경색이 먼저 눈에 들어와야 어디를 봐야 하는지가
                읽기 전에 이미 보인다.
              -->
              <td
                v-for="(count, column) in row"
                :key="column"
                :class="index === column ? 'bg-positive-soft font-bold' : ''"
              >
                {{ count }}
              </td>
            </tr>
          </tbody>
        </AppTable>
      </section>

      <section v-if="props.run.perClass" class="flex flex-col gap-1.5">
        <h4 class="font-bold">{{ t('results.perClass') }}</h4>

        <AppTable>
          <thead>
            <tr>
              <th>{{ t('results.label') }}</th>
              <th>{{ t('results.precision') }}</th>
              <th>{{ t('results.recall') }}</th>
              <th>{{ t('results.f1') }}</th>
              <th>{{ t('results.support') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in props.run.perClass" :key="entry.label">
              <th class="text-left">{{ entry.label }}</th>
              <td>{{ format.percent(entry.precision) }}</td>
              <td>{{ format.percent(entry.recall) }}</td>
              <td>{{ format.percent(entry.f1) }}</td>
              <td>{{ entry.support }}</td>
            </tr>
          </tbody>
        </AppTable>
      </section>

      <p v-if="!props.run.confusionMatrix && !props.run.perClass" class="text-ink-soft">
        {{ t('results.noDetail') }}
      </p>
    </div>
  </div>
</template>
