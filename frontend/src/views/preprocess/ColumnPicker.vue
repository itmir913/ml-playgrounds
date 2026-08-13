<script setup lang="ts">
/**
 * 타깃과 특성을 고르는 표 (architecture.md §8.9).
 *
 * **드롭다운 하나와 체크박스 목록을 따로 두지 않는다.** 고르는 대상이 같은 열들이고,
 * 판단 재료(자료형·결측 수·값 종류)가 그 자리에 있어야 한다 — "값이 한 종류뿐인 열을
 * 타깃으로 골랐다"가 [학습하기]를 눌러야 드러나면 안 된다.
 *
 * **판정은 여기서 하지 않는다.** `ml/selection.ts`가 만든 `ColumnPlan`을 그리기만 한다.
 * 화면이 따로 판정하면 [학습하기]가 거부하는 것과 갈린다.
 *
 * 못 고르는 것은 **이유와 함께** 꺼 둔다. 이유 없이 회색이면 학생에게 고장으로 보인다.
 */

import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import type { FittedColumn } from '@/ml/preprocess'
import type { ColumnPlan } from '@/ml/selection'
import type { Preprocessing } from '@/project/schema'

const props = defineProps<{
  plan: ColumnPlan
  /**
   * 지금 과제 유형이 타깃에 요구하는 것. 없으면 요구가 없다.
   *
   * **문구가 코드에서 나온다** — `requiredTargetKind`가 주는 코드로 키를 만든다.
   * 요구를 하나 더 만드는 사람은 로케일에 문장을 함께 넣어야 화면이 말을 한다.
   */
  targetRule?: 'TARGET_NOT_NUMERIC' | undefined
  /**
   * 학습셋에서 구한 열별 전처리 값 — 무엇으로 채우고 무엇을 기준으로 스케일링하는가.
   *
   * **여기서 계산하지 않는다.** `planRun`이 학습과 같은 함수로 구한 것을 받아 적기만
   * 한다 (architecture.md §9.1.3). 계획이 아직 못 섰으면 비어 있고, 그때는 이 칸이
   * 빈다 — 아직 정해지지 않은 것을 지어내지 않는다.
   */
  fitted?: ReadonlyMap<string, FittedColumn> | undefined
  /** 기준을 읽는 말이 방식마다 다르다 — 평균·표준편차인지 최솟값·범위인지. */
  scaling: Preprocessing['scaling']
}>()

const emit = defineEmits<{
  pickTarget: [name: string]
  toggleFeature: [name: string, on: boolean]
  setAllFeatures: [on: boolean]
}>()

const { t } = useI18n()
const format = useFormat()

/**
 * 이 열에 실제로 무슨 일이 일어나는가. **결측이 없으면 채움값을 말하지 않는다** —
 * 채울 것이 없는데 값을 보여주면 그 열에도 빈 칸이 있는 것처럼 읽힌다.
 */
function effectOf(column: ColumnPlan['columns'][number]): string[] {
  const fitted = props.fitted?.get(column.summary.name)
  if (!fitted) return []
  const parts: string[] = []
  if (fitted.fill !== undefined && column.summary.missing > 0) {
    parts.push(
      t('preprocess.tabular.fillWith', {
        value: typeof fitted.fill === 'number' ? format.prediction(fitted.fill) : fitted.fill,
      }),
    )
  }
  if (fitted.scale) {
    parts.push(
      t(`scalingBasis.${props.scaling}`, {
        center: format.prediction(fitted.scale.center),
        spread: format.prediction(fitted.scale.spread),
      }),
    )
  }
  return parts
}

/**
 * 이 줄에 붙일 한 줄. **하나만 붙인다** — 세 줄이 겹치면 아무것도 안 읽힌다.
 *
 * 순서가 곧 우선순위다. 학습이 거부하는 것이 먼저고, 그다음이 이 설정에서 빠지는 것,
 * 마지막이 골라도 되지만 알아야 하는 것이다.
 */
function noteOf(column: ColumnPlan['columns'][number]): string | null {
  if (column.featureIssue !== undefined) {
    return t(`errors.${column.featureIssue}`, { feature: column.summary.name })
  }
  if (column.role === 'target' && column.targetIssue !== undefined) {
    return t(`errors.${column.targetIssue}`, { target: column.summary.name })
  }
  if (column.role === 'feature' && column.featureNote !== undefined) {
    return t(`preprocess.tabular.${column.featureNote}`)
  }
  if (column.role === 'target' && column.targetCaution !== undefined) {
    return t('preprocess.tabular.targetSingleValue')
  }
  return null
}

function toneOf(column: ColumnPlan['columns'][number]): string {
  const bad = column.featureIssue !== undefined || column.targetIssue !== undefined
  return bad && column.role !== 'unused' ? 'text-danger' : 'text-ink-soft'
}

/** 특성으로 고를 수 없는 열. 값이 통째로 비어 있으면 전처리가 던진다. */
function featureBlocked(column: ColumnPlan['columns'][number]): boolean {
  return column.role === 'target' || column.featureIssue !== undefined
}

function onFeature(name: string, event: Event): void {
  emit('toggleFeature', name, (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <AppButton variant="secondary" @click="emit('setAllFeatures', true)">
        {{ t('preprocess.tabular.selectAll') }}
      </AppButton>
      <AppButton variant="secondary" @click="emit('setAllFeatures', false)">
        {{ t('preprocess.tabular.clearAll') }}
      </AppButton>
    </div>

    <AppTable>
      <thead>
        <tr>
          <th>{{ t('preprocess.tabular.roleTarget') }}</th>
          <th>{{ t('preprocess.tabular.roleFeature') }}</th>
          <!--
            **이름 칸이 남는 폭을 전부 가진다.** 안 그러면 숫자 세 칸이 자리를 나눠 갖고
            열 이름이 글자마다 줄바꿈된다 — 사유가 붙은 줄에서 특히 그렇다.
          -->
          <th class="w-full">{{ t('data.tabular.columnName') }}</th>
          <th>{{ t('data.tabular.kind') }}</th>
          <th>{{ t('data.tabular.missing') }}</th>
          <th>{{ t('data.tabular.unique') }}</th>
          <!-- 학습셋에서 구한 값이라 계획이 서야 채워진다. 그전에는 빈 칸이다. -->
          <th class="whitespace-nowrap">{{ t('preprocess.tabular.effect') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="column in props.plan.columns" :key="column.summary.name">
          <td>
            <input
              type="radio"
              class="size-4 accent-brand"
              :checked="column.role === 'target'"
              :disabled="column.targetIssue !== undefined"
              :aria-label="column.summary.name"
              @change="emit('pickTarget', column.summary.name)"
            />
          </td>
          <td>
            <input
              type="checkbox"
              class="size-4 accent-brand"
              :checked="column.role === 'feature'"
              :disabled="featureBlocked(column)"
              :aria-label="column.summary.name"
              @change="onFeature(column.summary.name, $event)"
            />
          </td>
          <td class="w-full">
            <span class="block font-bold text-ink">{{ column.summary.name }}</span>
            <span v-if="noteOf(column)" class="block" :class="toneOf(column)">
              {{ noteOf(column) }}
            </span>
          </td>
          <td class="whitespace-nowrap">{{ t(`columnKind.${column.summary.kind}`) }}</td>
          <td class="whitespace-nowrap">{{ column.summary.missing }}</td>
          <td class="whitespace-nowrap">{{ column.summary.unique }}</td>
          <td class="whitespace-nowrap text-ink-soft">
            <span v-for="part in effectOf(column)" :key="part" class="block">{{ part }}</span>
          </td>
        </tr>
      </tbody>
    </AppTable>

    <!-- 왜 어떤 줄의 타깃 칸이 꺼져 있는지. 줄마다 붙이면 표가 사유로 뒤덮인다. -->
    <p v-if="props.targetRule" class="text-base text-ink-soft">
      {{ t(`preprocess.tabular.targetRule.${props.targetRule}`) }}
    </p>
  </div>
</template>
