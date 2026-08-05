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

const tasks = computed(() => stepTasks(props.step, project.facts, project.taskType))
const done = computed(() => tasks.value.every((task) => task.done))
</script>

<template>
  <section
    v-if="tasks.length > 0"
    class="rounded-panel border border-line bg-surface px-4 py-3"
    :aria-label="t('tasks.title')"
  >
    <!--
      **한 줄이다.** 완료 문구를 아래에 붙이면 다 끝낸 순간 이 칸의 높이가 늘어 아래
      내용이 통째로 밀린다. 학생이 마지막 체크를 누르는 순간 화면이 움직이는 것이라
      제일 나쁜 자리다. 넓은 화면에서는 오른쪽 끝으로 밀어 두고, 좁은 화면에서는
      감싸여 아래로 내려간다 - 그때는 어차피 자리가 없다.
    -->
    <div class="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-base">
      <p class="font-bold text-ink-soft">{{ t('tasks.title') }}</p>

      <ul class="flex min-w-0 flex-wrap gap-x-5 gap-y-1.5">
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

      <p v-if="done" class="text-positive md:ml-auto">{{ t('tasks.allDone') }}</p>
    </div>
  </section>
</template>
