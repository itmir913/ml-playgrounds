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
  <!--
    **넓게 연다.** 이름-값이 한 줄에 하나씩 열두 줄 쌓이는 표라, 기본 폭에서는 파일
    이름과 타깃 열 이름이 자주 잘렸다(`ProjectSummary`의 `truncate`) - 이 팝오버가
    있는 이유가 **잘린 이름을 읽는 것**인데 여기서 또 잘리면 앞뒤가 안 맞는다.
    좁은 화면에서는 `popover-panel`의 max-width가 그대로 걸린다.
  -->
  <AppPopover v-if="project.file !== null" align="right" size="wide">
    <template #trigger>
      <!--
        아이콘이 붙는 이유는 장식이 아니다. 좁은 화면에서 프로젝트 이름이 잘리는데
        (ProjectName의 truncate) **전체 이름을 읽을 수 있는 유일한 자리가 이 팝오버다.**
        글자만 있으면 잘린 이름과 이 버튼이 이어져 보이지 않는다.
      -->
      <!--
        **상자는 옆의 [파일로 저장]과 같다** (`AppButton`의 md: `px-4 py-2.5`, 테두리 1px).
        여기만 여백이 좁아서 나란히 선 둘의 크기가 달랐다 (2026-08-13). 테두리는 투명하게
        둔다 — 보이지는 않되 **자리는 차지해야** 두 버튼의 높이가 같아진다(`AppButton`이
        모든 변종에 테두리를 두는 것과 같은 이유다).

        `AppButton`을 쓰지 않는 이유는 이 자리가 팝오버를 여는 손잡이이고, 글자 버튼의
        밑줄(ghost)이 여기서는 뜻이 다르기 때문이다 — 이건 동작이 아니라 펼침이다.
      -->
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-control border border-transparent px-4 py-2.5 font-bold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        <component :is="ACTION_ICONS.showSummary" :size="18" aria-hidden="true" />
        <span class="max-md:hidden">{{ t('meta.title') }}</span>
      </button>
    </template>

    <ProjectSummary with-name />
  </AppPopover>
</template>
