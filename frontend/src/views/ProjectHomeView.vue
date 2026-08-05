<script setup lang="ts">
/**
 * 프로젝트 홈. **프로젝트를 열면 여기다.**
 *
 * 예전에는 데이터 단계로 곧장 튕겼는데, 그건 홈이 없어서 쓴 우회였다. 학생이 파일을
 * 열었을 때 보고 싶은 것은 "어디까지 했더라"이지 파일 업로드 칸이 아니다 —
 * 특히 **다음 차시에 파일을 열고 들어오는 경우**가 그렇다.
 *
 * 여기 있는 것은 §8.7의 사실들을 단계별로 펼친 것뿐이다. 새 판단을 만들지 않는다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import StepHeader from '@/components/StepHeader.vue'
import { STEP_ICONS } from '@/icons'
import { currentTask, isStepUnlocked, stepTasks, STEP_IDS, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const router = useRouter()
const project = useProjectStore()

const now = computed(() => currentTask(project.facts))

const steps = computed(() =>
  STEP_IDS.map((step) => {
    const tasks = stepTasks(step, project.facts)
    return {
      step,
      unlocked: isStepUnlocked(step, project.facts),
      tasks,
      done: tasks.length > 0 && tasks.every((task) => task.done),
      here: now.value?.step === step,
    }
  }),
)

function go(step: StepId): void {
  void router.push({ name: step, params: { projectId: project.projectId } })
}
</script>

<template>
  <div class="flex flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('project.homeTitle')" :purpose="t('project.homeLead')" />

    <!-- 한 문장은 한 키다 (CLAUDE.md §3 규칙 3). 조각으로 이으면 어순이 다른 언어에서 무너진다. -->
    <AppButton v-if="now !== null" size="lg" class="self-start" @click="go(now.step)">
      {{ t('project.resume', { task: t(`tasks.${now.key}`) }) }}
    </AppButton>

    <ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <li
        v-for="entry in steps"
        :key="entry.step"
        class="flex flex-col gap-2 rounded-panel border bg-surface p-4"
        :class="entry.here ? 'border-brand' : 'border-line'"
      >
        <div
          class="flex items-center gap-2 font-bold"
          :class="entry.unlocked ? '' : 'text-ink-faint'"
        >
          <component :is="STEP_ICONS[entry.step]" :size="20" aria-hidden="true" />
          {{ t(`steps.${entry.step}.label`) }}
        </div>

        <p class="text-ink-soft">{{ t(`steps.${entry.step}.purpose`) }}</p>

        <ul v-if="entry.tasks.length > 0" class="flex flex-col gap-1 text-ink-soft">
          <li
            v-for="task in entry.tasks"
            :key="task.key"
            :class="task.done ? 'text-ink-faint line-through' : ''"
          >
            <span aria-hidden="true">{{ task.done ? '☑' : '☐' }}</span>
            {{ t(`tasks.${task.key}`) }}
          </li>
        </ul>

        <div class="mt-auto pt-1">
          <AppButton v-if="entry.unlocked" variant="subtle" @click="go(entry.step)">
            {{ t('project.openStep') }}
          </AppButton>
          <span v-else class="text-ink-faint">{{ t(`steps.${entry.step}.locked`) }}</span>
        </div>
      </li>
    </ul>
  </div>
</template>
