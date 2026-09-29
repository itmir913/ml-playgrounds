<script setup lang="ts">
/**
 * 이 브라우저에 저장된 프로젝트 고르기. **버튼 하나와 그 아래 팝오버다.**
 *
 * 첫 화면에 목록을 펼쳐 두지 않는 이유는 **대개 비어 있기 때문이다** — 컴퓨터실 PC는
 * 다음 차시에 리셋되므로 학생이 하는 첫 동작은 파일 열기다. 그 상황에서 목록은
 * 자리만 차지한다. 가정 PC에서는 남아 있고 그때만 이 버튼이 뜬다.
 *
 * `<dialog>`가 아니라 브라우저의 Popover API를 쓴다 — 바깥을 누르면 닫히고 Esc가 듣는
 * 것을 우리가 짜지 않는다. 그리고 **작업을 막지 않는다.**
 */

import { ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppPlainButton from '@/components/AppPlainButton.vue'
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import { isLocked, type Lock } from '@/locks'
import type { ProjectSummary } from '@/project/storage'

const props = defineProps<{
  summaries: readonly ProjectSummary[]
  /**
   * 화면이 무언가 하는 중인가. **켜지면 이 목록 전체가 잠긴다.**
   *
   * 파일을 여는 동안 여기가 살아 있으면, 학생이 목록에서 다른 프로젝트를 눌러 먼저
   * 이동하고 **뒤늦게 끝난 파일 열기가 또 한 번 화면을 민다** — 방금 연 파일이 아닌
   * 프로젝트를 보고 있게 된다. 지우기도 같은 이유로 함께 잠근다.
   *
   * **진행 중의 잠금만 온다** (화면의 `useWork`, 결정문 65 ③). 받은 값을 그대로 안쪽 버튼에 건넨다.
   */
  lock?: Lock | undefined
}>()

const emit = defineEmits<{
  open: [projectId: string]
  remove: [summary: ProjectSummary]
}>()

const { t } = useI18n()
const format = useFormat()

const popoverId = useId()
const panel = ref<HTMLElement | null>(null)

/**
 * 목록을 다시 연다. **확인창이 닫힌 뒤에 화면이 부른다.**
 *
 * 지우기를 누르면 이 목록은 브라우저가 닫는다 — `popover`는 다른 최상위 층(확인창)이
 * 열리면 스스로 물러난다. 그 자체는 맞지만, **돌아왔을 때 목록이 없으면** 학생은
 * 방금 지운 것이 사라졌는지 확인하러 버튼을 다시 눌러야 하고, 취소한 사람은 보던
 * 자리를 잃는다.
 *
 * 이미 열려 있으면 브라우저가 던지므로 삼킨다 — 여는 것이 목적이지 상태를 뒤집는
 * 것이 아니다.
 */
function open(): void {
  try {
    panel.value?.showPopover()
  } catch {
    // 이미 열려 있다. 할 일이 없다.
  }
}

/** 목록을 닫는다. 이미 닫혀 있으면 브라우저가 던지므로 `open()`과 같은 까닭으로 삼킨다. */
function close(): void {
  try {
    panel.value?.hidePopover()
  } catch {
    // 이미 닫혀 있다. 할 일이 없다.
  }
}

defineExpose({ open })

/**
 * 줄이 잠긴 **이유**. 잠기지 않았으면 `undefined`다.
 *
 * **잠그는 것은 "여는 중" 하나다** (`open-decisions.md` 65 ②). 못 읽는 줄은 잠그지 않는다 —
 * 누르면 `open()`이 실패를 알리고(`PROJECT_FILE_VERSION_UNSUPPORTED` 알림) 목록에 남는다.
 * 목록의 "못 읽음"은 `manifest.name`만 보는 가벼운 판정이라 `open()`의 전체 파싱과 갈릴 수
 * 있고, 갈리면 열 수 있는 프로젝트가 잠긴다(결정문 60). `welcome-fail.spec.ts`의
 * *"decision 65: pressing an unreadable saved project"*가 문다.
 *
 * **이유 없는 회색은 학생에게 고장이다** (`docs/copy.md` §4, V11 R5 C-1) — 여는 동안의
 * 잠금도 이 문장을 `title`로 든다.
 */
function lockReason(): string | undefined {
  return isLocked(props.lock) ? t('projects.opening') : undefined
}
</script>

<template>
  <div class="w-full">
    <AppButton
      variant="subtle"
      size="lg"
      class="w-full"
      :lock="props.lock"
      :popovertarget="popoverId"
    >
      <component :is="ACTION_ICONS.savedProjects" :size="20" aria-hidden="true" />
      {{ t('projects.saved') }}
      <span class="rounded-pill bg-surface px-2 py-0.5 text-base text-ink-soft">
        {{ summaries.length }}
      </span>
    </AppButton>

    <!--
      **화면의 95%까지 쓰고, 굴리는 것은 목록이다** (`open-decisions.md` 79, #35). 판 자신은 높이
      천장(`max-h-19/20`)만 갖고 내용만큼 자라며, 천장에 닿으면 목록 칸만 줄어들어(`min-h-0`, 나머지는
      `shrink-0`) 그 안에서 굴러간다 — 제목과 [닫기]는 굴리는 칸 밖이라 창이 낮아도 남는다. 목록에
      `flex-1`을 주지 않는 것은 높이가 내용만큼인 판에서 `flex-basis: 0%`를 0으로 읽는 브라우저가 있어서다
      — 줄어드는 것은 `shrink`로 충분하다(사람 확인). 단위가 `dvh`가 아니라
      `%`인 것은 최상위 층의 `%`가 화면을 가리키기 때문이다(`dialog-fill`과 같은 까닭). 실제 크기는
      jsdom이 못 재므로 사람 확인이고, 뼈대는 `project-picker.spec.ts`가 문다.

      **세로 flex는 열렸을 때만이다**(`open:`). 닫힌 `popover`를 숨기는 것은 브라우저의 `display: none`
      한 줄이라, 조건 없는 `flex`는 닫힌 판을 첫 화면에 눌러앉힌다(`ui-rules.spec.ts`
      *"닫힌 팝오버를 숨기는 규칙을 덮지 않는다"*).
    -->
    <div
      :id="popoverId"
      ref="panel"
      popover="auto"
      class="m-auto max-h-19/20 w-19/20 max-w-2xl flex-col rounded-card border border-line bg-surface p-4 text-ink shadow-pop open:flex"
    >
      <h3 class="mb-1 shrink-0 font-bold">{{ t('projects.saved') }}</h3>
      <p class="mb-4 shrink-0 text-ink-faint">{{ t('projects.savedCount', summaries.length) }}</p>

      <ul class="flex min-h-0 flex-col gap-2 overflow-y-auto">
        <li
          v-for="summary in summaries"
          :key="summary.projectId"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-line px-3 py-2 transition-colors hover:border-brand-line hover:bg-surface-sunken"
        >
          <!--
            **못 읽는 것도 목록에 남는다** (architecture.md §8.10.2). 빼면 학생 눈에는
            프로젝트가 사라진 것으로 보인다. 누르면 열기가 실패를 알리고, 지우기는 아래에
            그대로 둔다 — 학생이 스스로 정리할 수 있어야 한다.
          -->
          <AppPlainButton
            class="min-w-0 flex-1 text-left"
            :lock="props.lock"
            :class="summary.readable ? '' : 'text-ink-faint'"
            :title="lockReason()"
            @click="emit('open', summary.projectId)"
          >
            <span class="block truncate font-bold">
              {{ summary.readable ? summary.name : t('projects.unreadable') }}
            </span>
            <span class="mt-1 block text-ink-faint">
              {{ format.dateTime(summary.updatedAt) }}
            </span>
          </AppPlainButton>

          <span class="whitespace-nowrap text-ink-faint">
            {{ format.bytes(summary.sizeBytes) }}
          </span>

          <!--
            **`action`이 아니라 `@click`이다.** 여기서 하는 일은 확인창을 여는 것뿐이라
            기다릴 약속이 없다 — `action`으로 두면 즉시 끝나는 약속이라 잠금이 서지도
            않으면서 **잠기는 것처럼 읽힌다.** 실제로 지우는 것은 그 창의 단추다.
          -->
          <AppButton
            variant="ghost"
            :lock="props.lock"
            :label="t('projects.delete')"
            @click="emit('remove', summary)"
          >
            <component :is="ACTION_ICONS.remove" :size="18" aria-hidden="true" />
          </AppButton>
        </li>
      </ul>

      <!--
        **[닫기]가 있어야 나갈 수 있다.** 판이 화면의 95%면 휴대폰에서 바깥을 누를 자리가 가장자리
        몇 px뿐이고 Esc가 없다. 자리는 대화상자의 단추 줄과 같은 아래 오른쪽이다.
      -->
      <div class="mt-4 flex shrink-0 justify-end">
        <AppButton variant="secondary" @click="close">{{ t('common.dismiss') }}</AppButton>
      </div>
    </div>
  </div>
</template>
