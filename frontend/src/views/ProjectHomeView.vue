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
import { dataKindFor, lockedSentenceFor, stepTextKey } from '@/data/kinds'
import { STEP_ICONS } from '@/icons'
import {
  currentTask,
  isStepUnlocked,
  stepBlockers,
  stepTasks,
  STEP_IDS,
  type StepId,
} from '@/router/steps'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const router = useRouter()
const project = useProjectStore()

const now = computed(() => currentTask(project.facts, project.taskType, project.dataType))

/**
 * 이 프로젝트의 데이터 종류. **단계 설명문과 잠금 사유가 여기서 나온다** (§8.10).
 *
 * **`steps.${step}.purpose`를 직접 조립하면 안 된다.** 그 자리 셋(`data.purpose`·
 * `predict.purpose`·`train.locked`)은 종류가 갖고 `steps.*`에는 없다 — 손으로 조립한
 * 키는 로케일에 없는 것을 가리키고, **화면에는 키 문자열이 그대로 뜬다.** 실제로
 * 그렇게 떴다. 정적 키 검사는 따옴표 안의 키만 보므로 이 자리를 못 본다.
 */
const kind = computed(() => dataKindFor(project.dataType ?? ''))

const steps = computed(() =>
  STEP_IDS.map((step) => {
    const tasks = stepTasks(step, project.facts, project.taskType, project.dataType)
    const unlocked = isStepUnlocked(step, project.facts, project.taskType, project.dataType)
    const here = now.value?.step === step
    return {
      step,
      unlocked,
      tasks,
      done: tasks.length > 0 && tasks.every((task) => task.done),
      here,
      /**
       * 이 줄이 설명문을 다는가. **템플릿에서 조건을 조립하지 않는다** (§10).
       *
       * **여섯 줄이 모두 설명을 달면 훑을 수가 없다.** 그래서 지금 있는 줄에만 달았는데,
       * 그러면 **할 일이 없는 단계는 영영 아무 말도 안 한다** — 결과와 예측은 체크리스트가
       * 비어 있고(파생 사실뿐이라 학생이 체크할 것이 없다), 그래서 `currentTask`가 그 줄을
       * 고르는 일도 없다. 열리고 나면 이름과 버튼만 남은 빈 줄이 된다.
       *
       * **잠겨 있을 때는 사유가 그 자리를 채우므로** 설명까지 겹치지 않는다.
       */
      // **`dataKindFor`는 `undefined`를 돌려준다** (`data/kinds.ts`). `!== null`은 그것을
      // 통과시켜 가드가 아니었고, 종류를 모르는 순간(닫히는 중) 화면이 없는 대체 키
      // `steps.data.purpose`를 찾았다 (R21 C-1).
      explains: (here || (unlocked && tasks.length === 0)) && kind.value !== undefined,
    }
  }),
)

function go(step: StepId): void {
  void router.push({ name: step, params: { projectId: project.projectId } })
}
/** 잠긴 줄에 할 말. 막는 사실을 가리킨다 (V11 R5 B-10). */
function lockedText(step: StepId): string {
  // **판정도 번역도 여기서 하지 않는다** (`data/kinds.ts`의 `lockedSentenceFor`). 화면 둘이
  // 두 줄을 똑같이 복사해 갖고 있었고(2026-08-31 검증 감사 C-3), 셋째 화면은 번역을
  // 빠뜨려 키를 그대로 보였다(2026-09-03 R24 재검토 B-N1). 입구를 하나로 좁혔다.
  return lockedSentenceFor(
    kind.value,
    step,
    stepBlockers(step, project.facts, project.taskType, project.dataType),
    project.dataType,
    t,
  )
}
</script>

<template>
  <div class="flex flex-col gap-5 p-4 sm:p-5">
    <!--
      머리와 [이어서 하기]가 한 줄이다. 이어서 하기를 왼쪽 열 안에 두면 오른쪽 요약이
      그만큼 위로 떠서 두 열의 머리가 어긋난다.

      한 문장은 한 키다 (docs/i18n.md 규칙 3) - 조각으로 이으면 어순이 다른 언어에서 무너진다.
    -->
    <StepHeader :title="t('project.dashboard')" :purpose="t('project.homeLead')">
      <template #actions>
        <AppButton v-if="now !== null" size="lg" @click="go(now.step)">
          {{ t('project.resume', { task: t(now.labelKey) }) }}
        </AppButton>
      </template>
    </StepHeader>

    <!--
      3 대 2다. 왼쪽이 본체이고 오른쪽은 곁들이는 맥락이라 반씩 나누지는 않지만,
      2 대 1에서는 오른쪽 요약의 이름-값이 자주 잘렸다 - 거기 있는 파일 이름과 타깃
      열 이름은 **잘리면 쓸모가 없는 값**이다. 임의 값 대신 기본 눈금 다섯을 쓴다.
    -->
    <div class="grid gap-5 md:grid-cols-5">
      <!-- 왼쪽: 지금 하는 일 -->
      <div class="flex min-w-0 flex-col gap-4 md:col-span-3">
        <!--
          **`overflow-hidden`이 있어야 모서리가 둥근 채로 남는다.** 줄마다 배경을
          칠하는데(`bg-brand-soft`) 그 배경은 네모라, 지금 하는 일이 첫 줄이나 마지막
          줄이면 네 귀퉁이가 테두리 밖으로 삐져나온다. 밝은 화면에서는 배경 차이가
          작아 잘 안 보이고 어두운 화면에서만 드러난다.
        -->
        <ul class="flex flex-col overflow-hidden rounded-panel border border-line bg-surface">
          <!--
            **줄마다 칸이 같은 자리에서 시작한다.** flex로 두면 단계 이름의 글자 수만큼
            할 일이 밀려서 여섯 줄의 시작점이 제각각이 되고, 눈이 훑을 기준선이 없어진다
            (§8.9의 "두 열의 머리가 어긋난다"와 같은 문제다).

            **고정 너비가 아니라 격자다.** 칸을 px로 박으면 영어에서 30% 긴 이름이
            넘친다(docs/i18n.md 규칙 7). 비율로 나누면 언어가 바뀌어도 줄이 서로 맞는다.
            좁은 화면에서는 한 열로 쌓인다 - 거기서 2열은 둘 다 못 읽게 만든다.

            **다만 첫 칸은 내용보다 좁아지지 않는다** (`step-row-grid`). 비율만으로
            나누면 `전처리`가 `전처` / `리`로 갈리는데, 단계 이름이 갈리면 그것이 한
            낱말이라는 것부터 다시 읽어야 한다. 비율(1 : 3 : 2)은 그대로다.
          -->
          <li
            v-for="(entry, index) in steps"
            :key="entry.step"
            class="grid grid-cols-1 items-center gap-x-4 gap-y-2 p-4 sm:step-row-grid"
            :class="[
              index > 0 ? 'border-t border-line' : '',
              entry.here ? 'bg-brand-soft' : '',
              entry.unlocked ? '' : 'text-ink-faint',
            ]"
          >
            <!--
              **`break-keep`이 있어야 앞의 `min-content`가 뜻을 갖는다.** 한국어는 글자마다
              줄바꿈 기회가 있어서(docs/i18n.md 규칙 9) 기본값에서는 `전처리`의 min-content가
              **한 글자**다 - 칸을 아무리 내용 기준으로 잡아도 `전처` / `리`로 갈린다.
              끊을 자리를 띄어쓰기로 제한하면 그제서야 min-content가 낱말 전체가 된다.

              **`min-w-0`을 빼는 것도 같은 이유다.** 0으로 열어 두면 이 칸이 얼마든지
              좁아져도 된다고 말하는 셈이라, 칸의 아래쪽 끝을 올려 둔 것이 무의미해진다.

              단계 이름은 짧고 띄어쓰기가 없어 넘칠 걱정이 없다 - 규칙 9가 경고하는
              "띄어쓰기 없는 긴 낱말"은 레일의 긴 문구 쪽 이야기다.
            -->
            <div class="flex items-center gap-2 font-bold break-keep">
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
            <ul v-if="entry.tasks.length > 0" class="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
              <li
                v-for="task in entry.tasks"
                :key="task.key"
                class="whitespace-nowrap"
                :class="task.done ? 'text-ink-faint line-through' : 'text-ink-soft'"
              >
                <span aria-hidden="true">{{ task.done ? '☑' : '☐' }}</span>
                <!--
                  **등록부가 준 키를 그대로 쓴다.** `tasks.{key}`를 조립하면 종류마다
                  갈리는 문구(`tasks.image.*`)를 지나쳐, 이미지 프로젝트의 전처리 줄에
                  `타깃(Target) 선택하기`가 떴다. 정적 키 검사는 조립한 키를 못 본다.
                -->
                {{ t(task.labelKey) }}
              </li>
            </ul>

            <!--
              **버튼보다 앞에 둔다.** 좁은 화면에서는 격자가 한 열로 쌓여 DOM 순서가 곧
              읽는 순서가 되는데, `할 일 → 들어가기 → 설명`은 **들어가고 나서 거기가
              어디였는지 알려주는 순서**다. 넓은 화면의 자리는 위·아래에서 못 박아
              두었으므로 여기서 순서를 바꿔도 격자는 안 움직인다.
            -->
            <!--
              **종류를 모르면 설명문이 없다.** `stepTextKey`가 `steps.{단계}.purpose`로
              떨어지는데 그 열쇠는 로케일에 없다 - 줄마다 키 문자열이 뜬다.

              **자리를 못 박는다.** 할 일이 없는 줄에서는 줄 전체(`col-span-3`)를 쓰게
              두었는데, 버튼이 두 줄에 걸치면서 **셋째 칸이 늘 차 있게 됐다** — 세 칸이
              연속으로 빈 줄을 찾다가 설명문이 **셋째 줄로 밀려나고 둘째 줄이 통째로
              비었다** (2026-08-31). 버튼 칸을 안 침범하면 그 일이 없고, 그 칸은 이제
              비어 있지도 않다.
            -->
            <p
              v-if="entry.explains"
              class="text-ink-soft sm:col-span-2 sm:col-start-1 sm:row-start-2"
            >
              {{ t(stepTextKey(kind, entry.step, 'purpose')) }}
            </p>

            <!--
              **못 가는 이유가 [들어가기]와 같은 칸을 쓴다.** 한 줄에 둘 다 있는 일이
              없으므로 자리를 나눌 이유가 없고, 문장이라 버튼보다 넓은 칸이 필요하다.

              설명문이 붙는 줄에서는 **두 줄에 걸쳐 가운데 선다** - 버튼이 첫 줄에만
              매달리면 줄의 무게 중심에서 벗어나 혼자 위로 올라가 보인다.

              **칸과 줄을 둘 다 못 박는다.** 할 일이 없는 줄은 가운데 칸을 안 그리고,
              설명문은 DOM에서 이 칸보다 앞에 있다 — 자동 배치에 맡기면 버튼이 빈 가운데
              칸이나 둘째 줄로 흘러간다.

              **걸치는 조건은 "설명문이 있는가"다. "지금 여기인가"가 아니다.**
              버튼(46px)이 단계 이름(24px)보다 높아서, 첫 줄에만 매달리면 그 줄이
              버튼만큼 부풀고 `items-center`가 이름을 가운데로 내린다 — **줄의 위
              여백만 11px 더 두꺼워 보인다.** 조건을 `here`로 두었더니 현재 단계만
              멀쩡하고 나머지가 전부 그 모양이었다 (2026-08-31).
            -->
            <div
              class="min-w-0 sm:col-start-3 sm:row-start-1 sm:justify-self-end"
              :class="entry.explains ? 'sm:row-span-2' : ''"
            >
              <AppButton v-if="entry.unlocked" variant="secondary" @click="go(entry.step)">
                {{ t('project.openStep') }}
              </AppButton>
              <!--
                **넓을 때만 오른쪽에 붙인다.** 칸 자체는 이미 오른쪽 끝에 서 있지만
                (`sm:justify-self-end`), 두 줄로 접히면 안쪽 글줄이 왼쪽에 맞아 오른쪽
                가장자리가 들쭉날쭉해진다 — 버튼과 같은 세로선에 서야 한 칸으로 읽힌다.
                좁은 화면에서는 칸이 왼쪽부터 시작하므로 그대로 왼쪽 정렬이 맞다.
              -->
              <span v-else class="block text-ink-soft sm:text-right">{{
                lockedText(entry.step)
              }}</span>
            </div>
          </li>
        </ul>
      </div>

      <!-- 오른쪽: 이게 무슨 프로젝트인지 -->
      <aside class="min-w-0 rounded-panel border border-line bg-surface p-4 md:col-span-2">
        <h2 class="mb-3 font-bold">{{ t('meta.title') }}</h2>
        <ProjectSummary />
      </aside>
    </div>
  </div>
</template>
