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
  <div class="flex flex-col gap-5">
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
              **맞힌 칸(대각선)만 굵다.** 행렬을 처음 보는 학생이 어디를 봐야 하는지가
              그 굵기 하나로 정해진다.
            -->
            <td
              v-for="(count, column) in row"
              :key="column"
              :class="index === column ? 'font-bold' : ''"
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
</template>
