<script setup lang="ts">
/**
 * 도구 막대의 프로젝트 요약 팝오버.
 *
 * **내용은 `ProjectSummary`가 갖는다.** 여기는 그것을 좁은 화면에서도 닿게 하는
 * 껍데기다 — 대시보드 오른쪽 열에는 같은 요약이 늘 펼쳐져 있고, 다른 단계 화면에
 * 있을 때나 휴대폰에서는 이 버튼이 그 자리를 대신한다.
 *
 * 학생이 파일을 열고 "이게 뭐였더라"를 확인하는 자리이고, 교사가 제출물을 열었을 때
 * 가장 먼저 보는 자리이기도 하다.
 */

import { useI18n } from 'vue-i18n'

import AppPopover from '@/components/AppPopover.vue'
import ProjectSummary from '@/components/ProjectSummary.vue'
import { ACTION_ICONS } from '@/icons'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()
</script>

<template>
  <AppPopover v-if="project.file !== null" align="right">
    <template #trigger>
      <!--
        아이콘이 붙는 이유는 장식이 아니다. 좁은 화면에서 프로젝트 이름이 잘리는데
        (ProjectName의 truncate) **전체 이름을 읽을 수 있는 유일한 자리가 이 팝오버다.**
        글자만 있으면 잘린 이름과 이 버튼이 이어져 보이지 않는다.
      -->
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-control px-2.5 py-1.5 font-bold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <component :is="ACTION_ICONS.showSummary" :size="18" aria-hidden="true" />
        <!--
          좁은 화면에서는 짧은 쪽을 쓴다. 이 버튼이 넓어진 만큼 프로젝트 이름이
          깎이는데, **이름이 잘려서 여기까지 오는 것**이므로 이름을 먹으면 앞뒤가
          안 맞는다. 조각을 잇는 것이 아니라 처음부터 다른 문자열이다 (CLAUDE.md §3).
        -->
        <span class="max-md:hidden">{{ t('meta.title') }}</span>
        <span class="md:hidden">{{ t('meta.titleShort') }}</span>
      </button>
    </template>

    <ProjectSummary with-name />
  </AppPopover>
</template>
