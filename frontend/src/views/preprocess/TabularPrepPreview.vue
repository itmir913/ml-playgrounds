<script setup lang="ts">
/**
 * **다듬기가 표를 어떻게 바꾸는지** 다섯 줄로 보이는 카드
 * (open-decisions.md "전처리 미리보기 — 바뀐 표를 다섯 줄로 보인다").
 *
 * **아무것도 계산하지 않는다.** 묶는 것도 값도 `ml/preview.ts`가 지어서 내려준다 —
 * 어느 특성이 어느 원본 열에서 나왔는가를 여기서 세면, 원-핫이 한 칸 밀려도 아무 검사가
 * 안 본다. 요약 카드가 같은 규칙을 쓴다.
 *
 * **요약 카드와 겹치지 않는다** (architecture.md §9.1). 저쪽은 숫자 요약이고 여기는
 * 표 자체다.
 */

import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppTable from '@/components/AppTable.vue'
import TermPopover from '@/components/TermPopover.vue'
import { useFormat } from '@/composables/useFormat'
import type { PreprocessPreview } from '@/ml/preview'

const props = defineProps<{
  /** 판이 한 번만 지어서 내려준다. 계획이 못 섰으면 `null`이다. */
  preview: PreprocessPreview | null
}>()

const { t } = useI18n()
const format = useFormat()

/**
 * 이 열이 표에서 차지하는 칸 수. **원래 값 한 칸에 특성만큼 더한다.**
 *
 * 빠진 열도 원래 값 한 칸은 갖는다 — 자리를 지우면 학생이 방금 무엇을 잃었는지 안 보인다.
 */
function spanOf(column: PreprocessPreview['columns'][number]): number {
  return 1 + column.features.length
}
</script>

<template>
  <section class="rounded-panel border border-line bg-surface p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 class="font-bold">{{ t('preprocess.previewTitle') }}</h2>
      <!--
        **문장이 아니라 라벨이다.** "훈련 데이터에서만 구한다"는 이 도구가 가르칠 수 있는
        것 중 값진 축인데, 문장으로 얹으면 화면이 무거워진다. 눌러서 여는 설명은 결과
        화면의 지표 용어와 같은 장치다 (architecture.md §8.13).
      -->
      <TermPopover :title="t('preprocess.previewBasis')" :body="t('preprocess.previewBasisNote')" />
    </div>
    <p class="mt-1 text-ink-soft">{{ t('preprocess.previewLead') }}</p>

    <p v-if="!props.preview" class="mt-3 text-ink-soft">{{ t('preprocess.previewEmpty') }}</p>

    <AppTable v-else class="mt-3">
      <thead>
        <!--
          **원본 열 하나가 한 덩어리다.** 학생이 물을 질문이 "이 열이 어떻게 됐나"이지
          "표가 어떻게 생겼나"가 아니다.
        -->
        <tr>
          <th rowspan="2" class="min-w-16">{{ t('preprocess.previewRowNumber') }}</th>
          <th
            v-for="column in props.preview.columns"
            :key="column.name"
            :colspan="spanOf(column)"
            class="border-l border-line text-left"
          >
            <span class="flex flex-wrap items-baseline gap-x-2">
              {{ column.name }}
              <AppBadge v-if="column.excluded">{{ t('preprocess.previewExcluded') }}</AppBadge>
            </span>
          </th>
        </tr>
        <tr>
          <template v-for="column in props.preview.columns" :key="column.name">
            <th class="border-l border-line text-left font-normal text-ink-soft">
              {{ t('preprocess.previewOriginal') }}
            </th>
            <!-- 이름은 전처리기가 붙인 그대로다. 모델 파일과 특성 중요도가 같은 글자를 쓴다. -->
            <th
              v-for="feature in column.features"
              :key="feature.name"
              class="text-left font-normal text-ink-soft"
            >
              {{ feature.name }}
            </th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(number, row) in props.preview.rowNumbers"
          :key="number"
          class="odd:bg-surface even:bg-surface-sunken"
        >
          <td class="text-ink-faint tabular-nums">{{ number }}</td>
          <template v-for="column in props.preview.columns" :key="column.name">
            <td class="border-l border-line" :class="column.excluded ? 'text-ink-faint' : ''">
              {{ column.before[row] }}
            </td>
            <td v-for="feature in column.features" :key="feature.name" class="tabular-nums">
              {{ format.prediction(feature.values[row] ?? 0) }}
            </td>
          </template>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
