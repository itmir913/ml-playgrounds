<script setup lang="ts">
/**
 * 혼동 행렬. **분류 전용이라는 사실은 여기가 아니라 등록부에 있다** (`ml/metric-panels.ts`).
 *
 * 이 파일은 "어떻게 그리는가"만 안다. 언제 뜨는지는 등록부가 정하므로 결과 화면에
 * `taskType === 'classification'`이 생기지 않는다 (architecture.md §9.1).
 */

import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import type { Run } from '@/project/schema'

const props = defineProps<{ run: Run }>()

const { t } = useI18n()
</script>

<template>
  <!--
    등록부의 hasData가 이미 걸렀지만 타입은 여전히 선택 필드다. **이 v-if는 축 판정이
    아니라 필드가 있는지다** — 어느 필드에 담기는지를 아는 것이 이 패널의 몫이다 (§9.5).
  -->
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
</template>
