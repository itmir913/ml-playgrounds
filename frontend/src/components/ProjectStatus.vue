<script setup lang="ts">
/**
 * 상단 바의 진행 상황 버튼과 그 팝오버 (architecture.md §8.6).
 *
 * **모달이 아니다.** 작업을 가리지 않고 잠깐 떴다 사라지는 것이어야 한다. 그래서
 * 브라우저의 Popover API를 쓴다 — 바깥을 누르면 닫히고 Esc가 듣고 맨 위에 뜨는 것을
 * 우리가 짜지 않는다.
 *
 * "지금 할 일"은 `currentTask`가 정한다. 체크리스트와 같은 사실에서 나오므로
 * 팝오버가 말하는 것과 화면이 말하는 것이 어긋날 수 없다 (§8.7).
 */

import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { currentTask, isStepUnlocked, STEP_IDS } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const popoverId = useId()

const now = computed(() => currentTask(project.facts))

/** 단계마다 열렸는지·할 일이 남았는지. 팝오버의 작은 진행 목록이 쓴다. */
const workflow = computed(() =>
  STEP_IDS.map((step) => ({
    step,
    unlocked: isStepUnlocked(step, project.facts),
    active: now.value?.step === step,
  })),
)
</script>

<template>
  <div>
    <button
      type="button"
      class="flex items-center gap-2 rounded-control px-2.5 py-1.5 text-sm font-bold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
      :popovertarget="popoverId"
    >
      <span
        class="size-2 rounded-pill"
        :class="now === null ? 'bg-positive' : 'bg-caution'"
        aria-hidden="true"
      />
      {{ now === null ? t('shell.finished') : t(`tasks.${now.key}`) }}
    </button>

    <div
      :id="popoverId"
      popover="auto"
      class="m-0 w-72 rounded-panel border border-line bg-surface p-4 text-ink shadow-pop"
      style="position: fixed; inset: auto; top: var(--spacing-toolbar); right: 0.75rem"
    >
      <h2 class="text-sm font-bold text-ink-soft">{{ t('shell.statusTitle') }}</h2>
      <p class="mt-1 truncate font-bold">{{ project.name }}</p>

      <p class="mt-4 text-sm font-bold text-ink-soft">{{ t('shell.now') }}</p>
      <p class="mt-1">{{ now === null ? t('shell.finished') : t(`tasks.${now.key}`) }}</p>

      <p class="mt-4 text-sm font-bold text-ink-soft">{{ t('save.exported') }}</p>
      <p class="mt-1 text-sm" :class="project.exportedAt === null ? 'text-caution' : ''">
        {{ project.exportedAt === null ? t('save.notExported') : t('save.exported') }}
      </p>

      <p class="mt-4 text-sm font-bold text-ink-soft">{{ t('shell.workflow') }}</p>
      <ul class="mt-2 flex flex-col gap-1 text-sm">
        <li
          v-for="entry in workflow"
          :key="entry.step"
          class="flex items-center gap-2"
          :class="entry.unlocked ? 'text-ink' : 'text-ink-faint'"
        >
          <span aria-hidden="true">{{ entry.active ? '●' : entry.unlocked ? '○' : '·' }}</span>
          {{ t(`steps.${entry.step}.label`) }}
        </li>
      </ul>
    </div>
  </div>
</template>
