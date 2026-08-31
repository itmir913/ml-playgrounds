<script setup lang="ts">
/**
 * 모델이 배운 값 — 계수·절편, 그리고 범주별 평균·분산.
 *
 * **어느 모델이 무엇을 보여주는지는 여기가 아니라 `ml/parameters.ts`와 등록부에 있다**
 * (`ml/metric-panels.ts`, architecture.md §9.1). 이 파일은 "어떻게 그리는가"만 안다.
 *
 * **표는 특성이 세로다.** 원핫이면 열 하나가 여럿으로 늘어나 특성이 수십 줄이 되는데,
 * 가로로 두면 그만큼 옆으로 흐르고 좁은 화면에서 읽을 수 없다. 범주는 보통 둘셋이라
 * 가로가 맞다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import type { PanelInput } from '@/ml/metric-panels'
import { PARAMETER_TITLE_KEYS, parameterTableFor } from '@/ml/parameters'

const props = defineProps<{ input: PanelInput }>()

const { t } = useI18n()
const format = useFormat()

/**
 * 그릴 것 전부. **못 세우면 `null`이고 그때 이 패널은 아무것도 안 그린다**
 * (§9.2 "없는 것을 이름으로 말하지 않는다"). 전처리기가 안 담긴 파일이 그렇다 —
 * 이름 없이 숫자만 늘어놓으면 몇 번째 계수가 어느 열인지 알 수 없다.
 */
const table = computed(() => {
  const { run, modelBytes, preprocessor, experiment } = props.input
  return parameterTableFor(run.model?.format, modelBytes, preprocessor, experiment.settings)
})
</script>

<template>
  <section v-if="table" class="flex flex-col gap-1.5">
    <h4 class="font-bold">{{ t('results.parametersTitle') }}</h4>
    <p class="text-muted">{{ t('results.parametersLead') }}</p>
    <!--
      **스케일링을 켰으면 안 뜬다.** 계수의 크기를 견줄 수 있는지가 거기서 갈리고,
      켠 학생에게까지 띄우면 맞는 말을 못 믿게 만든다.
    -->
    <p v-if="!table.scaled" class="text-caution">{{ t('results.parametersScaleCaution') }}</p>

    <div v-for="section in table.sections" :key="section.kind" class="flex flex-col gap-1.5">
      <h5 class="font-bold">{{ t(PARAMETER_TITLE_KEYS[section.kind]) }}</h5>

      <AppTable>
        <thead>
          <tr>
            <th>{{ t('results.parametersFeature') }}</th>
            <!--
              **범주 이름이 곧 열 이름이다.** 회귀는 범주가 없어 `label`이 비고,
              그때는 열이 하나뿐이라 `값`이라고만 적는다.
            -->
            <th v-for="(row, index) in section.rows" :key="index">
              {{ row.label ?? t('results.parametersValue') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(name, column) in table.featureNames" :key="name">
            <th class="text-left">{{ name }}</th>
            <td v-for="(row, index) in section.rows" :key="index">
              {{ format.stat(row.values[column] ?? 0) }}
            </td>
          </tr>
          <!--
            **절편은 특성이 아니라서 표 안에 섞지 않는다.** 평균·분산 표에는 없다.
          -->
          <tr v-if="section.rows.some((row) => row.intercept !== null)">
            <th class="text-left">{{ t('results.parametersIntercept') }}</th>
            <td v-for="(row, index) in section.rows" :key="index">
              {{ row.intercept === null ? '' : format.stat(row.intercept) }}
            </td>
          </tr>
        </tbody>
      </AppTable>
    </div>
  </section>
</template>
