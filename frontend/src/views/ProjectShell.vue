<script setup lang="ts">
/**
 * 프로젝트 하나를 여는 껍데기. 단계 화면들이 이 안에 들어온다.
 *
 * 프로젝트를 실제로 여는 것은 라우터 가드다 (router/index.ts). 여기가 그리기
 * 시작할 때는 스토어에 이미 들어와 있다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppHero from '@/components/AppHero.vue'
import StepTabs from '@/components/StepTabs.vue'
import { ROUTE_PROJECTS } from '@/router'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

/** 배지는 과제 유형이다. 학생이 지금 무엇을 하는 프로젝트인지가 제목 위에 있어야 한다. */
const badgeKey = computed(() => {
  const taskType = project.file?.document.manifest.taskType
  return taskType === undefined ? 'app.name' : `taskTypes.${taskType}`
})
</script>

<template>
  <div class="min-h-screen">
    <AppHero :badge="t(badgeKey)" :title="project.name">
      <template #above>
        <RouterLink
          :to="{ name: ROUTE_PROJECTS }"
          class="inline-flex w-fit items-center gap-2 rounded-pill px-3 py-1 text-sm font-bold opacity-80 transition-opacity hover:opacity-100"
        >
          <span aria-hidden="true">←</span>
          {{ t('nav.projects') }}
        </RouterLink>
      </template>
    </AppHero>

    <StepTabs />

    <main class="mx-auto max-w-shell px-4 py-8 sm:px-6 md:py-12">
      <RouterView />
    </main>
  </div>
</template>
