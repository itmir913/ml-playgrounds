<script setup lang="ts">
/**
 * 아래 상태 표시줄. **이 프로젝트에서는 장식이 아니라 핵심 기능이다**
 * (architecture.md §8.8).
 *
 * **"저장됨"이라고 쓰지 않는다.** 학교 컴퓨터실 PC는 전원을 끄면 디스크가 되돌아가므로
 * 브라우저에 쓴 것은 안전하지 않다. 그런데 "저장됨"은 안전하다고 읽힌다 — 이 저장소가
 * 무결성 문구에 "verified"를 금지한 것과 **같은 종류의 잘못**이다(mlpx-spec.md §7.3).
 * 그래서 브라우저 쪽은 "이 브라우저에만 있음"이라고만 말하고, **안전 여부는 내보내기
 * 상태 하나가 쥔다.**
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

/** 브라우저 쪽 상태와 곁가지들. 가운뎃점으로 이어 붙일 것이라 배열로 만든다. */
const facts = computed(() => {
  const parts: string[] = []
  if (project.saving) parts.push(t('save.saving'))
  else if (project.dirty) parts.push(t('save.unsaved'))
  else parts.push(t('save.browserOnly'))

  if (project.savedAt !== null && !project.dirty && !project.saving) {
    parts.push(format.dateTime(project.savedAt))
  }
  // 아직 아무것도 없는 프로젝트에 "0 byte"는 알려 주는 것이 없다.
  if (sizeBytes.value > 0) parts.push(format.bytes(sizeBytes.value))
  return parts
})

function onLocale(event: Event): void {
  void setLocale((event.target as HTMLSelectElement).value as Locale)
}
</script>

<template>
  <footer
    class="scrollbar-none flex h-statusbar shrink-0 items-center gap-2 overflow-x-auto border-t border-line bg-surface px-3 text-ink-soft"
  >
    <template v-if="project.projectId !== null">
      <!--
        내보내기 상태가 먼저다. 학생이 알아야 하는 것은 "내 작업이 이 컴퓨터를 나갈 수
        있는가" 하나이고, 브라우저 저장 상태는 그 뒤의 곁가지다.
      -->
      <span
        class="flex shrink-0 items-center gap-2 whitespace-nowrap"
        :class="exportState === 'exported' ? 'text-positive' : 'font-bold text-caution'"
        :title="exportState === 'exported' ? undefined : t('save.exportWarning')"
      >
        <span class="size-2 shrink-0 rounded-pill bg-current" aria-hidden="true" />
        {{ t(`save.${exportState}`) }}
      </span>

      <template v-for="fact in facts" :key="fact">
        <span class="shrink-0 text-line-strong" aria-hidden="true">·</span>
        <span class="shrink-0 whitespace-nowrap">{{ fact }}</span>
      </template>
    </template>

    <span v-else class="whitespace-nowrap">{{ t('shell.noProject') }}</span>

    <select
      class="ml-auto shrink-0 rounded-field bg-transparent px-1 py-0.5"
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
