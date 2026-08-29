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
  /**
   * 비었을 때 무엇을 말할지. **판이 정한다** — 왜 비었는지는 계획이 알고 화면은 모른다.
   * 요약 카드가 세 상태를 갖는 것과 같은 사정이다 (R11 감사 B-1).
   */
  emptyKey: string
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

/**
 * 이 칸을 어떤 글자로 그릴까. **무엇인가는 `ml/preview.ts`가 정하고 여기는 고르기만 한다.**
 *
 * @param before 같은 행의 원본 칸. 비어 있으면 지나간 값이 아니라 **채운 값**이다.
 */
function cellText(
  feature: PreprocessPreview['columns'][number]['features'][number],
  before: string,
  value: number,
): string {
  if (feature.kind === 'code') return String(value)
  if (feature.kind === 'scaled' || before.trim() === '') return format.stat(value)
  return format.rawCell(value)
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

    <p v-if="!props.preview" class="mt-3 text-ink-soft">{{ t(props.emptyKey) }}</p>

    <AppTable v-else class="mt-3">
      <thead>
        <!--
          **원본 열 하나가 한 덩어리다.** 학생이 물을 질문이 "이 열이 어떻게 됐나"이지
          "표가 어떻게 생겼나"가 아니다.
        -->
        <tr>
          <!--
            **행 번호는 옆으로 굴려도 남는다** (2026-08-29 화면 실측 B-3). 열이 서른
            개인 데이터에서 표가 9,205px가 되는데, 그때 지금 보는 칸이 몇 번째 줄인지가
            사라졌다. 하위 열 머리는 `지역=서울`처럼 원본 열 이름을 이미 달고 있어서
            **잃는 것이 행 앵커 하나였다.**

            바탕이 불투명해야 한다 — 조금이라도 비치면 그 틈으로 옆 칸이 지나간다
            (§8.9가 머리글 고정에서 밟은 것과 같다). 줄무늬가 `tr`에 걸려 있어
            `bg-inherit`이면 홀짝이 그대로 따라온다.
          -->
          <th rowspan="2" class="sticky left-0 z-10 min-w-16 bg-surface-sunken">
            {{ t('preprocess.previewRowNumber') }}
          </th>
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
          <td class="sticky left-0 z-10 bg-inherit text-ink-faint tabular-nums">{{ number }}</td>
          <template v-for="column in props.preview.columns" :key="column.name">
            <td class="border-l border-line" :class="column.excluded ? 'text-ink-faint' : ''">
              {{ column.before[row] }}
            </td>
            <!--
              **칸의 종류마다 다르게 그린다** (`ml/preview.ts`의 `kind`).

              한때 여기가 전부 `prediction`이었다. "스케일링을 안 건 원값이 그대로
              지나가므로 12345를 12,350으로 만들면 안 된다"가 그 근거였는데 **맞는 말이고,
              그런데 그 전제가 이미 깨져 있었다** — 안 건 칸도 `Intl`을 지나 `2001`이
              `2,001`로 그려졌다 (2026-08-29 화면 실측 B-2). 그래서 자르느냐 마느냐가
              아니라 칸을 갈랐다.

              - 지나가는 값은 **옆 칸의 원문과 같은 글자로** (`rawCell`).
              - 스케일된 값은 계산해 낸 통계라 유효숫자 넷 (`stat`) — 요약 카드가
                `스케일링 기준`에 이미 쓰는 눈금이다. 특성 다섯 개짜리 표가 1,502px에서
                1,204px로 내려와 1366 화면에 들어간다.
              - 원-핫·순서 인코딩은 정수다.

              **빈 칸이었으면 지나간 값이 아니라 채운 값이다** — 그건 훈련 데이터에서
              구한 통계라 `stat`으로 간다.
            -->
            <td v-for="feature in column.features" :key="feature.name" class="tabular-nums">
              {{ cellText(feature, column.before[row] ?? '', feature.values[row] ?? 0) }}
            </td>
          </template>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
