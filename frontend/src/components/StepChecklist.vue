<script setup lang="ts">
/**
 * 이 단계에서 할 일 (architecture.md §8.7).
 *
 * **잠금 조건과 같은 사실에서 나온다.** 두 벌로 만들면 "체크는 다 됐는데 다음 단계가
 * 잠겨 있다"가 생기고, 그건 학생이 고칠 방법이 없는 고장이다.
 *
 * 강제하지 않는다. 튜토리얼이 아니라 곁에 놓인 목록이다. 할 일이 없는 단계에서는
 * 아무것도 그리지 않는다 — 빈 목록은 무언가 빠진 것처럼 보인다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { stepTasks, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{ step: StepId }>()

const { t } = useI18n()
const project = useProjectStore()

const tasks = computed(() => stepTasks(props.step, project.facts))
const done = computed(() => tasks.value.every((task) => task.done))
</script>

<template>
  <section
    v-if="tasks.length > 0"
    class="rounded-panel border border-line bg-surface px-4 py-3"
    :aria-label="t('tasks.title')"
  >
    <p class="text-xs font-bold text-ink-soft">{{ t('tasks.title') }}</p>

    <ul class="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
      <li
        v-for="task in tasks"
        :key="task.key"
        class="flex items-center gap-1.5"
        :class="task.done ? 'text-ink-faint line-through' : 'font-bold text-ink'"
      >
        <span aria-hidden="true">{{ task.done ? '☑' : '☐' }}</span>
        {{ t(`tasks.${task.key}`) }}
      </li>
    </ul>

    <p v-if="done" class="mt-2 text-xs text-positive">{{ t('tasks.allDone') }}</p>
  </section>
</template>
