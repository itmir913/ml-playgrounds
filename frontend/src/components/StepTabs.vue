<script setup lang="ts">
/**
 * 단계 탭바. **이게 곧 네비게이션이다** — 단계 하나가 라우트 하나이므로
 * 별도의 단계 상태가 없다 (architecture.md §8.2).
 *
 * 아직 못 가는 단계도 **지우지 않고 보여준다.** 학생이 앞으로 무엇을 하게 되는지
 * 보는 것이 이 도구의 절반이다. 대신 왜 못 가는지를 함께 준다 — 이유 없이 회색으로
 * 죽어 있는 것은 학생에게 고장으로 보인다 (§7.3과 같은 이유).
 */

import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import { isStepUnlocked, STEP_IDS, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const route = useRoute()
const project = useProjectStore()

function unlocked(step: StepId): boolean {
  return isStepUnlocked(step, project.progress)
}

function labelKey(step: StepId): string {
  return `steps.${step}.label`
}

function lockedKey(step: StepId): string {
  return `steps.${step}.locked`
}

const TAB = 'block border-b-2 px-4 py-4 text-base font-bold whitespace-nowrap sm:px-6 sm:text-lg'
</script>

<template>
  <nav class="sticky top-0 z-40 border-b border-line bg-surface/80 shadow-float backdrop-blur-md">
    <ul class="mx-auto flex max-w-shell overflow-x-auto px-2 sm:px-6">
      <li v-for="step in STEP_IDS" :key="step" class="shrink-0">
        <RouterLink
          v-if="unlocked(step)"
          :to="{ name: step, params: route.params }"
          :aria-current="route.name === step ? 'page' : undefined"
          :class="[
            TAB,
            route.name === step
              ? 'border-brand text-brand'
              : 'border-transparent text-ink-soft transition-colors hover:text-ink',
          ]"
        >
          {{ t(labelKey(step)) }}
        </RouterLink>

        <span
          v-else
          :title="t(lockedKey(step))"
          :class="[TAB, 'cursor-not-allowed border-transparent text-ink-faint']"
        >
          {{ t(labelKey(step)) }}
        </span>
      </li>
    </ul>
  </nav>
</template>
