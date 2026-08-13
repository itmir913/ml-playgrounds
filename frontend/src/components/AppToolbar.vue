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
  <!--
    **`md` 미만에서 위에 붙는다** (architecture.md §8.6). 그 폭에서는 문서가
    스크롤하므로 붙여 두지 않으면 도구 막대가 위로 사라진다. `md` 이상에서는 바깥이
    스크롤하지 않아 `sticky`가 아무 일도 하지 않지만, 폭마다 다른 클래스를 두는 것보다
    한 줄로 두는 편이 낫다.

    **레일·상태 표시줄(z-30)과 같은 층이다.** 단계 동작 바(z-20)보다 앞이어야 그
    바가 도구 막대 아래로 지나간다.
  -->
  <header
    class="sticky top-0 z-30 flex h-toolbar shrink-0 items-center gap-3 border-b border-line bg-surface px-3"
  >
    <RouterLink
      :to="{ name: ROUTE_PROJECTS }"
      class="flex shrink-0 items-center gap-2 rounded-control px-1.5 py-1 text-lg font-black tracking-tight transition-colors hover:bg-surface-sunken"
    >
      <component :is="BRAND_ICON" :size="24" class="text-brand" aria-hidden="true" />
      <span class="max-lg:hidden">{{ t('app.name') }}</span>
    </RouterLink>

    <template v-if="project.projectId !== null">
      <span class="shrink-0 text-ink-faint" aria-hidden="true">/</span>
      <ProjectName />
    </template>

    <div class="ml-auto flex shrink-0 items-center gap-1">
      <ProjectStatus v-if="project.projectId !== null" />
      <ExportButton v-if="project.projectId !== null" />
    </div>
  </header>
</template>
