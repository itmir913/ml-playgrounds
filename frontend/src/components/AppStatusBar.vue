<script setup lang="ts">
/**
 * 아래 상태 표시줄. **이 프로젝트에서는 장식이 아니라 핵심 기능이다**
 * (architecture.md §8.8).
 *
 * 학교 컴퓨터실 PC는 전원을 끄면 디스크가 되돌아간다. 그래서 **"아직 안 내보냈습니다"가
 * 늘 보이는 것**이 그 문제에 주는 답이다 — 차시가 끝날 때 뜨는 배너보다 낫다.
 * 배너는 닫히고 이건 늘 거기 있다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useFormat } from '@/composables/useFormat'
import { setLocale, SUPPORTED_LOCALES, type Locale } from '@/i18n'
import { useProjectStore } from '@/stores/project'

const { t, locale } = useI18n()
const format = useFormat()
const project = useProjectStore()

const sizeBytes = computed(() => {
  const file = project.file
  if (!file) return 0
  let total = file.dataset?.bytes.length ?? 0
  for (const bytes of file.models.values()) total += bytes.length
  return total
})

/**
 * 내보내기 상태. 셋으로 갈린다 — 안 내보냄 / 내보낸 뒤 고침 / 그대로.
 *
 * **가운데가 중요하다.** "내보냈다"만 보여주면 그 뒤에 한 시간을 더 작업한 학생이
 * 안심한 채로 컴퓨터를 끈다.
 */
const exportState = computed(() => {
  if (project.exportedAt === null) return 'notExported'
  if (project.savedAt !== null && project.savedAt > project.exportedAt) return 'stale'
  return 'exported'
})

function onLocale(event: Event): void {
  void setLocale((event.target as HTMLSelectElement).value as Locale)
}
</script>

<template>
  <footer
    class="flex h-statusbar shrink-0 items-center gap-4 overflow-x-auto border-t border-line bg-surface px-3 text-xs text-ink-soft"
  >
    <template v-if="project.projectId !== null">
      <span class="flex items-center gap-1.5 whitespace-nowrap">
        <span
          class="size-1.5 rounded-pill"
          :class="project.saving ? 'bg-caution' : 'bg-positive'"
          aria-hidden="true"
        />
        {{ project.saving ? t('save.saving') : t('save.saved') }}
      </span>

      <span v-if="project.savedAt !== null" class="whitespace-nowrap text-ink-faint">
        {{ format.dateTime(project.savedAt) }}
      </span>

      <span
        class="whitespace-nowrap"
        :class="exportState === 'exported' ? '' : 'font-bold text-caution'"
        :title="exportState === 'exported' ? undefined : t('save.exportWarning')"
      >
        {{ exportState === 'notExported' ? t('save.notExported') : t('save.exported') }}
      </span>

      <span class="whitespace-nowrap max-sm:hidden">{{ format.bytes(sizeBytes) }}</span>
    </template>

    <span v-else class="whitespace-nowrap">{{ t('shell.noProject') }}</span>

    <select
      class="ml-auto rounded-field bg-transparent px-1 py-0.5 text-xs"
      :aria-label="t('shell.language')"
      :value="locale"
      @change="onLocale"
    >
      <option v-for="tag in SUPPORTED_LOCALES" :key="tag" :value="tag">
        {{ t(`language.${tag}`) }}
      </option>
    </select>
  </footer>
</template>
