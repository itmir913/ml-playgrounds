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

import { useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import type { ProjectSummary } from '@/project/storage'

defineProps<{ summaries: readonly ProjectSummary[] }>()

const emit = defineEmits<{
  open: [projectId: string]
  remove: [summary: ProjectSummary]
}>()

const { t } = useI18n()
const format = useFormat()

const popoverId = useId()
</script>

<template>
  <div class="w-full">
    <AppButton variant="subtle" size="lg" class="w-full" :popovertarget="popoverId">
      <component :is="ACTION_ICONS.savedProjects" :size="20" aria-hidden="true" />
      {{ t('projects.saved') }}
      <span class="rounded-pill bg-surface px-2 py-0.5 text-ink-soft">
        {{ summaries.length }}
      </span>
    </AppButton>

    <div
      :id="popoverId"
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
            :disabled="!summary.readable"
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
