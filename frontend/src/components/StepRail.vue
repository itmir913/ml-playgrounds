<script setup lang="ts">
/**
 * 왼쪽 단계 사이드바. **단계 이동은 여기만 쥔다** (architecture.md §8.6).
 *
 * **슬림하다.** 표와 그래프가 이 앱의 본체이고 그것들이 쓸 가로 폭이 넓을수록 좋다.
 * 그렇다고 아이콘만 두지는 않는다 — VS Code의 Activity Bar가 아이콘만으로 되는 것은
 * 쓰는 사람이 이미 그 그림을 아는 프로그래머라서이고, 우리 학생은 배운 적이 없다.
 *
 * **글자는 레일 폭 안에서 줄을 바꿔 담긴다.** 영어 낱말이 한국어보다 길어서
 * (docs/i18n.md 규칙 7) `Preprocessing`이 두세 줄이 되는데, 그게 영역 밖으로
 * 삐져나오는 것보다 낫다.
 *
 * **끊는 자리는 언어마다 다르게 정해진다.** 한국어는 글자마다 줄바꿈 기회가 있어
 * 브라우저에 맡기면 "대시보/드"가 된다. 그래서 로케일 문자열이 `​`(폭 없는
 * 공백)로 자리를 지정하고 `break-keep`이 그 밖의 자리를 막는다. 영어에는 낱말
 * 중간을 끊을 때 하이픈을 넣는 관행이 있으므로 `hyphens-auto`에 맡긴다 —
 * 하이픈 없이 끊으면 두 낱말로 읽힌다. 자리 지정이 없는 긴 낱말이 들어왔을
 * 때만 `break-words`가 마지막 수단으로 일한다.
 *
 * **칸의 안쪽 폭이 상태에 따라 달라지면 안 된다.** 글자가 한 줄이냐 두 줄이냐가
 * 1px에 걸려 있어서, 폭이 조금만 달라져도 칸 높이가 20px씩 뛰고 레일 전체가 흔들린다.
 * 그래서 둘을 지킨다.
 *
 * 1. **활성 칸을 굵게 하지 않는다.** 활성 표시는 흰 면과 브랜드 색과 경계선이 이미 한다.
 * 2. **오른쪽 테두리를 모든 칸이 늘 갖고 색만 바꾼다.** 활성일 때만 `border-r`을 주면
 *    그 칸의 안쪽만 1px 좁아진다. "대시보드"가 정확히 그 1px 안쪽에 걸쳐 있어서
 *    누르는 순간 두 줄이 됐다. 잠긴 칸에는 테두리가 아예 없어 폭이 셋이었다.
 *
 * **이건 한국어만의 문제가 아니다.** 어느 언어든 한 줄에 아슬아슬하게 들어가는 낱말이
 * 하나는 있고(영어는 `Training`이 그렇다), 그것이 상태에 따라 갈린다.
 *
 * 못 가는 단계도 **지우지 않고** 왜 못 가는지와 함께 남긴다 — 목록에서 사라지면
 * 학생은 그런 단계가 있다는 것조차 모른다. 다만 **흐리게만 하고 지우듯 하지 않는다.**
 * 너무 흐리면 안 보이고, 안 보이면 없는 것과 같다.
 *
 * 휴대폰에서는 가로로 눕는다. 좁은 화면에서 세로 사이드바는 이미 부족한 가로 폭을
 * 더 깎는다. **그 폭에서는 문서가 스크롤하므로 화면 아래에 `fixed`로 붙는다**
 * (architecture.md §8.6) — 흐름에 두면 페이지 맨 끝까지 내려야 단계를 옮길 수 있다.
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { type RouteLocationRaw, useRoute } from 'vue-router'

import { HOME_ICON, STEP_ICONS } from '@/icons'
import { ROUTE_PROJECT_HOME } from '@/router'
import { dataKindFor, lockedSentence, lockedTextFor } from '@/data/kinds'
import { isStepUnlocked, STEP_IDS, stepBlockers, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const route = useRoute()
const project = useProjectStore()

/**
 * **가로로 누웠을 때의 높이를 내놓는다.** 그 폭에서 이 레일은 `fixed`라 흐름에서
 * 빠져 있고, 작업 공간은 가려지는 만큼을 아래 여백으로 비워 둬야 한다
 * (`base.css`의 `--shell-bottom`).
 *
 * 도구 막대와 상태 표시줄은 높이가 토큰으로 고정인데 **여기는 아이콘 줄이라 그렇지
 * 않다.** 값을 손으로 적어 두면 아이콘 크기나 여백이 바뀌는 날 조용히 어긋난다.
 *
 * 세로로 선 폭(`md` 이상)에서도 계속 내놓지만 그때는 아무도 안 쓴다 —
 * `--shell-bottom`이 그 폭에서 0이다.
 *
 * `ResizeObserver`가 없으면(jsdom) 첫 값만 쓴다.
 */
const HEIGHT_VAR = '--rail-bar-height'

const railEl = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

function publish(el: HTMLElement): void {
  document.documentElement.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`)
}

onMounted(() => {
  const el = railEl.value
  if (!el) return

  publish(el)
  if (typeof ResizeObserver === 'undefined') return

  observer = new ResizeObserver(() => publish(el))
  observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  document.documentElement.style.removeProperty(HEIGHT_VAR)
})

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
  return (
    project.projectId !== null &&
    isStepUnlocked(step, project.facts, project.taskType, project.dataType)
  )
}

function label(step: StepId): string {
  return t(`steps.${step}.label`)
}

/** 못 가는 이유. 프로젝트가 없으면 그것이 이유다. */
function reason(step: StepId): string {
  if (project.projectId === null) return t('shell.noProject')
  // **잠금 이유도 종류가 준다** (architecture.md §8.10) — 표의 "타깃과 특성을 먼저
  // 정해 주세요"는 이미지에서 학생이 할 수 없는 일을 하라는 말이 된다.
  // **막는 사실을 가리킨다.** 단계마다 문장 하나로는 못 말하는 자리가 있었다 —
  // 학습이 "전처리 단계에서 할 일을…"이라고 하는데 전처리도 잠겨 있었다 (V11 R5 B-10).
  const text = lockedTextFor(
    dataKindFor(project.dataType ?? ''),
    step,
    stepBlockers(step, project.facts, project.taskType, project.dataType),
    project.dataType,
  )
  // **판정은 여기서 하지 않는다** (`data/kinds.ts`의 `lockedSentence`). 화면 둘이
  // 이 두 줄을 똑같이 복사해 갖고 있었고 아무도 안 태웠다 (2026-08-31 검증 감사 C-3).
  return lockedSentence(text, t)
}

/**
 * 칸 하나의 공통 모양. 아이콘 위, 글자 아래.
 *
 * **좌우 여백도 세로일 때만이다.** 레일 4.5rem에서 글자에 돌아가는 자리는 여백을 뺀
 * 나머지인데, 칸의 `px-1`과 레일의 `p-1`이 양쪽에서 0.5rem씩 먹어 3.5rem만 남았다 —
 * `대시보드`는 4rem이라 **반 글자가 모자라 접혔다.** 그래서 세로에서는 칸의 좌우
 * 여백을 없애고 레일 쪽도 반으로 줄인다. 가로로 누우면 이름이 숨고 아이콘만 남아서,
 * 거기서는 이 여백이 칸과 칸 사이의 유일한 숨통이다.
 *
 * **`w-full`은 세로일 때만이다.** 가로로 누우면 칸마다 nav 전체 너비를 요구해서
 * 여덟 칸이 통째로 넘치고, `justify-center`와 겹치면 넘친 쪽이 양옆으로 잘려
 * **스크롤로도 닿지 않는다.** 태블릿에서 가운데 한 칸만 보이고 나머지를 누를 수
 * 없던 이유가 이것이다. 가로에서는 내용만큼만 차지한다.
 */
const CELL =
  'flex min-w-0 flex-col items-center gap-1 rounded-control border-transparent px-1 py-2 leading-tight md:w-full md:border-r md:px-0'

/**
 * 글자 상자.
 *
 * **`w-full`이 핵심이다.** `items-center` 아래에서는 자식의 가로 크기가 내용을 따라가서,
 * `break-words`만 있으면 상자가 레일보다 넓어지고 글자는 그냥 넘친다. 폭을 부모에
 * 매어 놓아야 비로소 줄바꿈이 일한다 — 영어에서 레일에 가로 스크롤이 생기던 이유가
 * 이 한 클래스였다.
 */
const LABEL = 'w-full text-center break-keep break-words hyphens-auto'
</script>

<template>
  <nav
    ref="railEl"
    :aria-label="t('shell.steps')"
    class="scrollbar-none z-30 flex shrink-0 gap-1 overflow-x-auto border-line bg-surface-sunken p-1 max-md:fixed max-md:inset-x-0 max-md:above-statusbar max-md:justify-center max-md:border-t md:w-rail md:px-0.5 md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-r"
  >
    <!--
      프로젝트 홈. **단계가 아니라 그 위에 있는 자리**라 STEP_IDS에 없고 여기 손으로
      둔다. 학생이 "어디까지 했더라"로 돌아올 곳이 레일에 없으면 주소를 지워야 한다.

      **없앴다 나타나게 하지 않는다.** 단계 여섯은 못 가도 이유와 함께 흐리게 남는데
      (§8.6) 이 칸만 통째로 사라지면 규칙이 둘이 되고, 프로젝트를 열기 전과 연 뒤에
      레일의 칸 수가 달라져 다른 화면처럼 보인다. 아래 단계들과 같은 모양으로 흐려진다.

      다만 **잠겼을 때는 RouterLink가 아니어야 한다.** projectId가 없으면
      `Missing required param`으로 던지고, 레일 한 칸이 던지면 앱 전체가 갱신을 멈춘다.
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
          ? 'z-10 bg-surface font-medium text-brand md:-mr-px md:rounded-r-none md:border-surface'
          : 'font-medium text-ink-soft hover:bg-surface/60 hover:text-ink',
      ]"
    >
      <component :is="HOME_ICON" :size="20" aria-hidden="true" />
      <span :class="[LABEL, 'max-md:hidden']">{{ t('project.dashboard') }}</span>
    </RouterLink>

    <span
      v-else
      :title="t('shell.noProject')"
      :aria-disabled="true"
      :class="[CELL, 'shrink-0 cursor-not-allowed font-medium text-ink-faint']"
    >
      <component :is="HOME_ICON" :size="20" aria-hidden="true" />
      <span :class="[LABEL, 'max-md:hidden']">{{ t('project.dashboard') }}</span>
    </span>

    <span
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
            ? 'z-10 bg-surface font-medium text-brand md:-mr-px md:rounded-r-none md:border-surface'
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
