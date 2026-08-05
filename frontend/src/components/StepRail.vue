<script setup lang="ts">
/**
 * 왼쪽 단계 사이드바. **단계 이동은 여기만 쥔다** (architecture.md §8.6).
 *
 * **슬림하다.** 표와 그래프가 이 앱의 본체이고 그것들이 쓸 가로 폭이 넓을수록 좋다.
 * 그렇다고 아이콘만 두지는 않는다 — VS Code의 Activity Bar가 아이콘만으로 되는 것은
 * 쓰는 사람이 이미 그 그림을 아는 프로그래머라서이고, 우리 학생은 배운 적이 없다.
 *
 * **글자는 레일 폭 안에서 줄을 바꿔 담긴다.** 영어 낱말이 한국어보다 길어서
 * (CLAUDE.md §3 규칙 7) `Preprocessing`이 두세 줄이 되는데, 그게 영역 밖으로
 * 삐져나오는 것보다 낫다. `break-words`가 그것을 보장한다.
 *
 * 못 가는 단계도 **지우지 않고** 왜 못 가는지와 함께 남긴다 — 목록에서 사라지면
 * 학생은 그런 단계가 있다는 것조차 모른다. 다만 **흐리게만 하고 지우듯 하지 않는다.**
 * 너무 흐리면 안 보이고, 안 보이면 없는 것과 같다.
 *
 * 휴대폰에서는 가로로 눕는다. 좁은 화면에서 세로 사이드바는 이미 부족한 가로 폭을
 * 더 깎는다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { type RouteLocationRaw, useRoute } from 'vue-router'

import { HOME_ICON, STEP_ICONS } from '@/icons'
import { ROUTE_PROJECT_HOME } from '@/router'
import { isStepUnlocked, STEP_IDS, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const route = useRoute()
const project = useProjectStore()

/**
 * 링크가 가리킬 곳. **`route.params`가 아니라 스토어를 본다.**
 *
 * 라우터 가드가 프로젝트를 여는 시점에는 **아직 주소가 옛것이다.** 목록에서 프로젝트로
 * 넘어가는 그 순간, 스토어에는 프로젝트가 있어 칸이 열리는데 `route.params`는 비어
 * 있고, 그러면 RouterLink가 setup에서 `Missing required param`으로 던진다. 한 칸이
 * 던지면 레일 전체의 렌더가 깨지고 그 뒤로 화면이 아무것도 갱신하지 못한다.
 *
 * 지금 어떤 프로젝트가 열려 있는지의 유일한 출처는 스토어다.
 */
function linkTo(step: StepId): RouteLocationRaw {
  return { name: step, params: { projectId: openId.value } }
}

const openId = computed(() => project.projectId ?? '')

function unlocked(step: StepId): boolean {
  return project.projectId !== null && isStepUnlocked(step, project.facts)
}

function label(step: StepId): string {
  return t(`steps.${step}.label`)
}

/** 못 가는 이유. 프로젝트가 없으면 그것이 이유다. */
function reason(step: StepId): string {
  return project.projectId === null ? t('shell.noProject') : t(`steps.${step}.locked`)
}

/** 칸 하나의 공통 모양. 아이콘 위, 글자 아래. */
const CELL =
  'flex w-full min-w-0 flex-col items-center gap-1 rounded-control px-1 py-2 leading-tight'

/**
 * 글자 상자.
 *
 * **`w-full`이 핵심이다.** `items-center` 아래에서는 자식의 가로 크기가 내용을 따라가서,
 * `break-words`만 있으면 상자가 레일보다 넓어지고 글자는 그냥 넘친다. 폭을 부모에
 * 매어 놓아야 비로소 줄바꿈이 일한다 — 영어에서 레일에 가로 스크롤이 생기던 이유가
 * 이 한 클래스였다.
 */
const LABEL = 'w-full text-center break-words hyphens-auto'
</script>

<template>
  <nav
    :aria-label="t('shell.steps')"
    class="scrollbar-none flex shrink-0 gap-1 overflow-x-auto border-line bg-surface-sunken p-1 max-md:order-last max-md:justify-center max-md:border-t md:w-rail md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r"
  >
    <!--
      프로젝트 홈. **단계가 아니라 그 위에 있는 자리**라 STEP_IDS에 없고 여기 손으로
      둔다. 학생이 "어디까지 했더라"로 돌아올 곳이 레일에 없으면 주소를 지워야 한다.
    -->
    <RouterLink
      v-if="project.projectId !== null"
      :to="{ name: ROUTE_PROJECT_HOME, params: { projectId: openId } }"
      :title="t('project.dashboard')"
      :aria-current="route.name === ROUTE_PROJECT_HOME ? 'page' : undefined"
      :class="[
        CELL,
        'shrink-0 transition-colors',
        route.name === ROUTE_PROJECT_HOME
          ? 'z-10 bg-surface font-bold text-brand md:-mr-px md:rounded-r-none md:border-r md:border-surface'
          : 'font-medium text-ink-soft hover:bg-surface/60 hover:text-ink',
      ]"
    >
      <component :is="HOME_ICON" :size="20" aria-hidden="true" />
      <span :class="[LABEL, 'max-md:hidden']">{{ t('project.dashboard') }}</span>
    </RouterLink>

    <span
      v-if="project.projectId !== null"
      class="my-1 shrink-0 self-stretch border-line max-md:border-l md:border-t"
      aria-hidden="true"
    />

    <template v-for="step in STEP_IDS" :key="step">
      <RouterLink
        v-if="unlocked(step)"
        :to="linkTo(step)"
        :title="label(step)"
        :aria-current="route.name === step ? 'page' : undefined"
        :class="[
          CELL,
          'shrink-0 transition-colors',
          // 지금 있는 칸은 작업 공간과 같은 흰 면이고 경계선을 1px 덮어 둘이
          // 이어져 보인다 - 레일에서 그 탭이 열린 것처럼.
          route.name === step
            ? 'z-10 bg-surface font-bold text-brand md:-mr-px md:rounded-r-none md:border-r md:border-surface'
            : 'font-medium text-ink-soft hover:bg-surface/60 hover:text-ink',
        ]"
      >
        <component :is="STEP_ICONS[step]" :size="20" aria-hidden="true" />
        <span :class="[LABEL, 'max-md:hidden']">{{ label(step) }}</span>
      </RouterLink>

      <span
        v-else
        :title="reason(step)"
        :aria-disabled="true"
        :class="[CELL, 'shrink-0 cursor-not-allowed font-medium text-ink-faint']"
      >
        <component :is="STEP_ICONS[step]" :size="20" aria-hidden="true" />
        <span :class="[LABEL, 'max-md:hidden']">{{ label(step) }}</span>
      </span>
    </template>
  </nav>
</template>
