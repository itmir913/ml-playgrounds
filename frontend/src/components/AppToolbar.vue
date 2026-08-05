<script setup lang="ts">
/**
 * 위 도구 막대 (architecture.md §8.6).
 *
 * **단계 이동은 여기 없다.** 왼쪽 레일이 쥔다 — 둘 다 두면 같은 것이 두 군데 있고,
 * 학생은 둘이 다른 것인 줄 안다. 여기 남는 것은 프로젝트 이름, 전역 동작, 상태 버튼이다.
 *
 * 얇게 유지한다. 큰 배너나 히어로가 들어오면 그만큼 작업 공간이 줄어든다.
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import ProjectStatus from '@/components/ProjectStatus.vue'
import { ACTION_ICONS, BRAND_ICON } from '@/icons'
import { renderPortfolioMarkdown } from '@/project/portfolio'
import { ROUTE_PROJECTS } from '@/router'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const busy = ref(false)

async function exportFile(): Promise<void> {
  const file = project.file
  if (!file || busy.value) return
  busy.value = true
  try {
    // portfolio.md는 파생물이지만 파일에 담는다 - 교사가 압축을 풀어 메모장으로 열어도
    // 학생이 무엇을 썼는지 보여야 한다 (CLAUDE.md §1.3).
    const markdown = renderPortfolioMarkdown(
      file.document.manifest.name,
      file.document.portfolio,
      (key) => t(key),
    )
    const dropped = await project.exportFile(markdown)

    toasts.push('success', 'project.exportDone')
    if (dropped.length > 0) {
      // 조용히 빠지면 학생은 예측이 왜 안 되는지 모른다.
      toasts.push('caution', 'project.exportDropped', { count: dropped.length })
    }
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <header class="flex h-toolbar shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
    <RouterLink
      :to="{ name: ROUTE_PROJECTS }"
      class="flex shrink-0 items-center gap-2 rounded-control px-1.5 py-1 font-black tracking-tight transition-colors hover:bg-surface-sunken"
    >
      <component :is="BRAND_ICON" :size="24" class="text-brand" aria-hidden="true" />
      <span class="max-lg:hidden">{{ t('app.name') }}</span>
    </RouterLink>

    <template v-if="project.projectId !== null">
      <span class="shrink-0 text-line-strong" aria-hidden="true">/</span>
      <h1 class="min-w-0 truncate font-bold">{{ project.name }}</h1>
    </template>

    <div class="ml-auto flex shrink-0 items-center gap-1">
      <ProjectStatus v-if="project.projectId !== null" />
      <AppButton
        v-if="project.projectId !== null"
        variant="secondary"
        :disabled="busy"
        @click="exportFile"
      >
        <component :is="ACTION_ICONS.exportFile" :size="18" aria-hidden="true" />
        <span class="max-sm:hidden">{{ t('project.export') }}</span>
      </AppButton>
    </div>
  </header>
</template>
