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
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import type { ProjectSummary } from '@/project/storage'

const props = defineProps<{
  summaries: readonly ProjectSummary[]
  /**
   * 화면이 무언가 하는 중인가. **켜지면 이 목록 전체가 잠긴다.**
   *
   * 파일을 여는 동안 여기가 살아 있으면, 학생이 목록에서 다른 프로젝트를 눌러 먼저
   * 이동하고 **뒤늦게 끝난 파일 열기가 또 한 번 화면을 민다** — 방금 연 파일이 아닌
   * 프로젝트를 보고 있게 된다. 지우기도 같은 이유로 함께 잠근다.
   */
  disabled?: boolean | undefined
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

defineExpose({ open })

/**
 * 이 줄을 누를 수 있는가. **템플릿에서 조건을 조립하지 않는다** (architecture.md §10) —
 * 못 읽는 프로젝트와 지금 바쁜 것은 다른 사유이고, 둘을 `||`로 이어 붙이면 그 구분이
 * 화면 코드 속으로 사라진다.
 */
function locked(summary: ProjectSummary): boolean {
  if (props.disabled === true) return true
  return !summary.readable
}
</script>

<template>
  <div class="w-full">
    <AppButton
      variant="subtle"
      size="lg"
      class="w-full"
      :disabled="props.disabled"
      :popovertarget="popoverId"
    >
      <component :is="ACTION_ICONS.savedProjects" :size="20" aria-hidden="true" />
      {{ t('projects.saved') }}
      <span class="rounded-pill bg-surface px-2 py-0.5 text-base text-ink-soft">
        {{ summaries.length }}
      </span>
    </AppButton>

    <div
      :id="popoverId"
      ref="panel"
      popover="auto"
      class="m-auto w-full max-w-lg rounded-card border border-line bg-surface p-4 text-ink shadow-pop"
    >
      <h3 class="mb-1 font-bold">{{ t('projects.saved') }}</h3>
      <p class="mb-4 text-ink-faint">{{ t('projects.savedCount', summaries.length) }}</p>

      <ul class="flex max-h-96 flex-col gap-2 overflow-y-auto">
        <li
          v-for="summary in summaries"
          :key="summary.projectId"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-line px-3 py-2 transition-colors hover:border-brand-line hover:bg-surface-sunken"
        >
          <!--
            **못 읽는 것도 목록에 남는다** (architecture.md §8.10.2). 빼면 학생 눈에는
            프로젝트가 사라진 것으로 보인다. 열기만 막고 지우기는 아래에 그대로 둔다 —
            학생이 스스로 정리할 수 있어야 한다.
          -->
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            :disabled="locked(summary)"
            :class="summary.readable ? '' : 'cursor-not-allowed text-ink-faint'"
            @click="emit('open', summary.projectId)"
          >
            <span class="block truncate font-bold">
              {{ summary.readable ? summary.name : t('projects.unreadable') }}
            </span>
            <span class="mt-1 block text-ink-faint">
              {{ format.dateTime(summary.updatedAt) }}
            </span>
          </button>

          <span class="whitespace-nowrap text-ink-faint">
            {{ format.bytes(summary.sizeBytes) }}
          </span>

          <AppButton
            variant="ghost"
            :disabled="props.disabled"
            :label="t('projects.delete')"
            :action="() => emit('remove', summary)"
          >
            <component :is="ACTION_ICONS.remove" :size="18" aria-hidden="true" />
          </AppButton>
        </li>
      </ul>
    </div>
  </div>
</template>
