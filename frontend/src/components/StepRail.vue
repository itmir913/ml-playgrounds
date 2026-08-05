<script setup lang="ts">
/**
 * 왼쪽 단계 레일. **단계 이동은 여기만 쥔다** (architecture.md §8.6).
 *
 * 아이콘만 남기는 이유는 표와 그래프가 이 앱의 본체이고, 그것들이 쓸 수 있는 가로 폭이
 * 넓을수록 좋기 때문이다. VS Code의 Activity Bar와 같은 역할이다.
 *
 * 못 가는 단계도 **지우지 않고** 왜 못 가는지와 함께 흐리게 둔다 — 목록에서 사라지면
 * 학생은 그런 단계가 있다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다.
 *
 * **휴대폰에서는 가로로 눕는다.** 좁은 화면에서 세로 레일은 이미 부족한 가로 폭을
 * 더 깎는다.
 */

import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { isStepUnlocked, STEP_IDS, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const route = useRoute()
const project = useProjectStore()

/**
 * 단계 아이콘. **글자가 아니라 그림이라 번역하지 않는다.**
 *
 * 이모지를 쓰는 이유는 아이콘 폰트나 SVG 세트를 CDN에서 받을 수 없고(§8.5와 같은 이유),
 * 직접 그린 SVG를 여섯 개 들고 다니는 것보다 지금 단계에서 싸기 때문이다.
 * 디자인이 자리를 잡으면 SVG로 바꾼다.
 */
const ICONS: Readonly<Record<StepId, string>> = {
  data: '📂',
  preprocess: '⚙️',
  train: '🧪',
  results: '📈',
  predict: '🤖',
  portfolio: '📝',
}

function unlocked(step: StepId): boolean {
  return project.projectId !== null && isStepUnlocked(step, project.facts)
}

function label(step: StepId): string {
  return t(`steps.${step}.label`)
}

/** 못 가는 이유. 프로젝트가 없으면 그것이 이유다. */
function reason(step: StepId): string {
  if (project.projectId === null) return t('shell.noProject')
  return t(`steps.${step}.locked`)
}

const CELL =
  'flex w-full flex-col items-center justify-center gap-0.5 py-2.5 text-[0.625rem] leading-tight font-bold'
</script>

<template>
  <nav
    :aria-label="t('shell.steps')"
    class="flex shrink-0 gap-1 overflow-x-auto border-line bg-surface px-1 py-1 max-sm:order-last max-sm:border-t sm:w-rail sm:flex-col sm:overflow-visible sm:border-r sm:px-0"
  >
    <template v-for="step in STEP_IDS" :key="step">
      <RouterLink
        v-if="unlocked(step)"
        :to="{ name: step, params: route.params }"
        :title="label(step)"
        :aria-current="route.name === step ? 'page' : undefined"
        :class="[
          CELL,
          'rounded-control transition-colors',
          route.name === step
            ? 'bg-brand-soft text-brand'
            : 'text-ink-faint hover:bg-surface-sunken hover:text-ink-soft',
        ]"
      >
        <span class="text-lg" aria-hidden="true">{{ ICONS[step] }}</span>
        <span class="max-sm:hidden">{{ label(step) }}</span>
      </RouterLink>

      <span
        v-else
        :title="reason(step)"
        :aria-disabled="true"
        :class="[CELL, 'cursor-not-allowed rounded-control text-ink-faint opacity-40']"
      >
        <span class="text-lg" aria-hidden="true">{{ ICONS[step] }}</span>
        <span class="max-sm:hidden">{{ label(step) }}</span>
      </span>
    </template>
  </nav>
</template>
