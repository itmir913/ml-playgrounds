<script setup lang="ts">
/**
 * 위 도구 막대 (architecture.md §8.6).
 *
 * **단계 이동은 여기 없다.** 왼쪽 레일이 쥔다 — 둘 다 두면 같은 것이 두 군데 있고,
 * 학생은 둘이 다른 것인 줄 안다. 여기 남는 것은 프로젝트 이름, 전역 동작, 상태 버튼이다.
 *
 * 얇게 유지한다. 큰 배너나 히어로가 들어오면 그만큼 작업 공간이 줄어든다.
 */

import { useI18n } from 'vue-i18n'

import ExportButton from '@/components/ExportButton.vue'
import ProjectName from '@/components/ProjectName.vue'
import ProjectStatus from '@/components/ProjectStatus.vue'
import { BRAND_ICON } from '@/icons'
import { ROUTE_PROJECTS } from '@/router'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()
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
      <ProjectName />
    </template>

    <div class="ml-auto flex shrink-0 items-center gap-1">
      <ProjectStatus v-if="project.projectId !== null" />
      <ExportButton v-if="project.projectId !== null" />
    </div>
  </header>
</template>
