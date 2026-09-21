<script setup lang="ts">
/**
 * 열 검사기. 열마다 자료형·결측 수·값 종류·예시를 늘어놓는다.
 *
 * **넓은 화면에서는 표 옆에 서고 좁은 화면에서는 표 아래에 접힌다** (architecture.md §8.9).
 * 그래서 자리를 스스로 정하지 않는다 — 바깥이 준 만큼 채우고, 넘치면 **자기 안에서**
 * 스크롤한다. 여기서 높이를 박으면 두 자리 중 한쪽에서 반드시 틀린다.
 *
 * **`h-full`이 아니라 `min-h-0 flex-1`로 받는다** (§8.14). `h-full`은 부모가 얼마나
 * 작든 그만큼 따라 줄어들어 머리만 남는다.
 *
 * **시각화를 여는 손잡이가 이 표의 줄에 있다** (§8.9.1). 표 머리글이 아닌 이유는 그것이
 * 가로 스크롤 안에 있어서 열이 수십 개면 학생이 못 찾기 때문이고, 이 줄에는 이미
 * **무엇을 볼지 정하는 재료**(자료형·결측·값 종류)가 적혀 있다.
 *
 * 판단은 하나도 안 한다. `data/columns.ts`가 요약한 것을 그리기만 한다.
 */

import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import type { ColumnSummary } from '@/data/columns'
import { ACTION_ICONS } from '@/icons'

const props = defineProps<{
  columns: readonly ColumnSummary[]
  /**
   * 그림으로 볼 수 있는가. **확정된 정본에서만 참이다** (§8.9.1).
   *
   * 파일을 고르는 중에 보이는 표는 앞부분만 파싱한 것이라, 그것으로 그린 분포는
   * 전체의 분포가 아니다 — 숫자는 옆에 안내를 달아 구할 수 있어도 **그림은 그게 안 된다.**
   */
  visualizable?: boolean
}>()

const emit = defineEmits<{ visualize: [column: string] }>()

const { t } = useI18n()
</script>

<template>
  <AppTable class="min-h-0 flex-1">
    <thead class="sticky top-0 z-10">
      <tr>
        <th>{{ t('data.tabular.columnName') }}</th>
        <th>{{ t('data.tabular.kind') }}</th>
        <th>{{ t('data.tabular.missing') }}</th>
        <th>{{ t('data.tabular.unique') }}</th>
        <th>{{ t('data.tabular.samples') }}</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="column in props.columns" :key="column.name">
        <td class="font-bold">
          <!--
            **손잡이는 이름 자체다.** 줄 끝에 작은 아이콘만 두면 열이 수십 개인 표에서
            과녁이 오른쪽 끝으로 흩어지고, 이름을 누르는 것이 학생이 먼저 해 보는 일이다.

            **`relative`가 있어야 한다. 꾸밈이 아니다** (2026-09-22, 사용자가 실물에서
            봤다). 아래 `sr-only`는 Tailwind에서 **`position: absolute`**인데, 위치 지정된
            조상이 없으면 담는 상자가 **화면**이 된다 — 그러면 표의 스크롤 상자도
            `overflow`도 그것을 못 자르고, **화면 아래에 선 것이 문서의 스크롤 영역을
            늘린다.** 상태 표시줄 밑으로 빈 칸이 생기고 거기까지 스크롤됐다.

            **`body`는 안 늘고 `html`만 늘어서** 원인을 찾는 데 오래 걸렸다 — 그 둘이
            갈리는 것이 곧 "담는 상자가 화면인 절대 위치"의 서명이다.
          -->
          <button
            v-if="props.visualizable"
            type="button"
            class="relative inline-flex items-center gap-1.5 rounded-field text-left font-bold text-brand underline decoration-transparent underline-offset-2 hover:decoration-inherit"
            @click="emit('visualize', column.name)"
          >
            {{ column.name }}
            <component :is="ACTION_ICONS.visualize" class="size-4 shrink-0" aria-hidden="true" />
            <span class="sr-only">{{ t('data.charts.open') }}</span>
          </button>
          <template v-else>{{ column.name }}</template>
        </td>
        <td>{{ t(`columnKind.${column.kind}`) }}</td>
        <td>{{ column.missing }}</td>
        <td>{{ column.unique }}</td>
        <td class="text-ink-soft">{{ column.samples.join(', ') }}</td>
      </tr>
    </tbody>
  </AppTable>
</template>
