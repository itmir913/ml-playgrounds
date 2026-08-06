<script setup lang="ts">
/**
 * 프로젝트 홈. **프로젝트를 열면 여기다.**
 *
 * 예전에는 데이터 단계로 곧장 튕겼는데, 그건 홈이 없어서 쓴 우회였다. 학생이 파일을
 * 열었을 때 보고 싶은 것은 "어디까지 했더라"이지 파일 업로드 칸이 아니다 —
 * 특히 **다음 차시에 파일을 열고 들어오는 경우**가 그렇다.
 *
 * **[이어서 하기]가 맨 위 오른쪽이고, 그 아래에서 두 열이 같은 높이에서 시작한다**
 * (architecture.md §8.9). 이어서 하기가 왼쪽 열 안에 있으면 오른쪽 요약이 그만큼 위로
 * 떠서 두 열의 머리가 어긋나고, 눈이 훑을 기준선이 없어진다.
 *
 * **두 열이다** (§8.10.1). 왼쪽은 지금 하는 일, 오른쪽은 그 일을 판단하는 데 필요한
 * 맥락이다. 전에는 카드 여섯 장을 격자로 깔았는데, 넓은 화면에서 카드가 위에 몰리고
 * 아래 3분의 2가 비었다. 그건 웹사이트 문법이지 작업실 문법이 아니다.
 *
 * `md` 미만에서는 한 열이다. 좁은 화면에서 두 열은 둘 다 못 읽게 만든다.
 *
 * **단계는 카드가 아니라 줄이다.** 카드는 저마다 테두리와 여백을 갖느라 여섯 개가
 * 화면을 다 먹는다. 여기서 학생이 하는 일은 훑는 것이므로 줄이 맞다.
 *
 * 여기 있는 것은 §8.7의 사실들을 단계별로 펼친 것뿐이다. 새 판단을 만들지 않는다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import ProjectSummary from '@/components/ProjectSummary.vue'
import StepHeader from '@/components/StepHeader.vue'
import { STEP_ICONS } from '@/icons'
import { currentTask, isStepUnlocked, stepTasks, STEP_IDS, type StepId } from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const router = useRouter()
const project = useProjectStore()

const now = computed(() => currentTask(project.facts, project.taskType))

const steps = computed(() =>
  STEP_IDS.map((step) => {
    const tasks = stepTasks(step, project.facts, project.taskType)
    return {
      step,
      unlocked: isStepUnlocked(step, project.facts, project.taskType),
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
    <!--
      머리와 [이어서 하기]가 한 줄이다. 이어서 하기를 왼쪽 열 안에 두면 오른쪽 요약이
      그만큼 위로 떠서 두 열의 머리가 어긋난다.

      한 문장은 한 키다 (docs/i18n.md 규칙 3) - 조각으로 이으면 어순이 다른 언어에서 무너진다.
    -->
    <StepHeader :title="t('project.homeTitle')" :purpose="t('project.homeLead')">
      <template #actions>
        <AppButton v-if="now !== null" size="lg" @click="go(now.step)">
          {{ t('project.resume', { task: t(`tasks.${now.key}`) }) }}
        </AppButton>
      </template>
    </StepHeader>

    <!--
      2 대 1이다. 왼쪽이 본체이고 오른쪽은 곁들이는 맥락이라, 반씩 나누면 오른쪽이
      과하게 커지고 왼쪽 줄이 일찍 접힌다. 임의 값 대신 기본 눈금 셋을 쓴다.
    -->
    <div class="grid gap-5 md:grid-cols-3">
      <!-- 왼쪽: 지금 하는 일 -->
      <div class="flex min-w-0 flex-col gap-4 md:col-span-2">
        <ul class="flex flex-col rounded-panel border border-line bg-surface">
          <!--
            **줄마다 칸이 같은 자리에서 시작한다.** flex로 두면 단계 이름의 글자 수만큼
            할 일이 밀려서 여섯 줄의 시작점이 제각각이 되고, 눈이 훑을 기준선이 없어진다
            (§8.9의 "두 열의 머리가 어긋난다"와 같은 문제다).

            **고정 너비가 아니라 격자다.** 칸을 px로 박으면 영어에서 30% 긴 이름이
            넘친다(docs/i18n.md 규칙 7). 비율로 나누면 언어가 바뀌어도 줄이 서로 맞는다.
            좁은 화면에서는 한 열로 쌓인다 - 거기서 2열은 둘 다 못 읽게 만든다.
          -->
          <li
            v-for="(entry, index) in steps"
            :key="entry.step"
            class="grid grid-cols-1 items-center gap-x-4 gap-y-2 p-4 sm:grid-cols-6"
            :class="[
              index > 0 ? 'border-t border-line' : '',
              entry.here ? 'bg-brand-soft' : '',
              entry.unlocked ? '' : 'text-ink-faint',
            ]"
          >
            <div class="flex min-w-0 items-center gap-2 font-bold sm:col-span-1">
              <component :is="STEP_ICONS[entry.step]" :size="20" aria-hidden="true" />
              {{ t(`steps.${entry.step}.label`) }}
            </div>

            <!--
              할 일은 줄바꿈되며 늘어선다. **한 항목은 한 덩어리다** - 항목 가운데서
              줄이 갈리면 "타깃(Target)" 과 "정하기"가 두 줄에 걸쳐 두 개처럼 읽힌다.
              칸이 모자라면 항목째로 다음 줄에 내려간다.

              **설명문은 지금 있는 칸에만 붙인다** - 여섯 줄이 모두 설명을 달면 훑을 수가
              없고, 각 단계의 설명은 그 단계 화면의 머리가 이미 갖고 있다 (§8.9).
            -->
            <ul class="flex min-w-0 flex-wrap gap-x-4 gap-y-1 sm:col-span-3">
              <li
                v-for="task in entry.tasks"
                :key="task.key"
                class="whitespace-nowrap"
                :class="task.done ? 'text-ink-faint line-through' : 'text-ink-soft'"
              >
                <span aria-hidden="true">{{ task.done ? '☑' : '☐' }}</span>
                {{ t(`tasks.${task.key}`) }}
              </li>
            </ul>

            <!--
              **못 가는 이유가 [들어가기]와 같은 칸을 쓴다.** 한 줄에 둘 다 있는 일이
              없으므로 자리를 나눌 이유가 없고, 문장이라 버튼보다 넓은 칸이 필요하다.

              설명문이 붙는 줄에서는 **두 줄에 걸쳐 가운데 선다** - 버튼이 첫 줄에만
              매달리면 줄의 무게 중심에서 벗어나 혼자 위로 올라가 보인다.
            -->
            <div
              class="min-w-0 sm:col-span-2 sm:justify-self-end"
              :class="entry.here ? 'sm:row-span-2' : ''"
            >
              <AppButton v-if="entry.unlocked" variant="secondary" @click="go(entry.step)">
                {{ t('project.openStep') }}
              </AppButton>
              <span v-else class="block text-ink-soft">{{ t(`steps.${entry.step}.locked`) }}</span>
            </div>

            <!--
              버튼 칸을 침범하지 않는다. 여기까지가 왼쪽 네 칸이고, 그래서 위의
              row-span이 성립한다.
            -->
            <p v-if="entry.here" class="text-ink-soft sm:col-span-4">
              {{ t(`steps.${entry.step}.purpose`) }}
            </p>
          </li>
        </ul>
      </div>

      <!-- 오른쪽: 이게 무슨 프로젝트인지 -->
      <aside class="min-w-0 rounded-panel border border-line bg-surface p-4">
        <h2 class="mb-3 font-bold">{{ t('meta.title') }}</h2>
        <ProjectSummary />
      </aside>
    </div>
  </div>
</template>
