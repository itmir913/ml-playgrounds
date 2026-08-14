<script setup lang="ts">
/**
 * 완성본. **문법과 결과 사이가 아니라 쓰는 화면과 받는 사람이 볼 화면 사이다**
 * (mlpx-spec.md §8.3). 나란히 두지 않는 이유는 휴대폰이 기준이기 때문이다.
 *
 * **읽기 전용으로 굳히는 버튼은 없다.** 이 보기가 이미 그 모양을 주고, 잠금에는
 * 강제력이 없다(압축을 풀면 풀린다). 없는 보증을 있는 것처럼 보이게 하지 않는다.
 *
 * **안 쓴 문항도 제목은 남긴다.** 빈 칸이 보이는 것과 문항이 사라지는 것은 다르다.
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'
import ProjectSummary from '@/components/ProjectSummary.vue'
import type { OrphanAnswer, PortfolioSection } from '@/project/portfolio'
import OrphanAnswers from './OrphanAnswers.vue'

defineProps<{
  sections: readonly PortfolioSection[]
  orphans: readonly OrphanAnswer[]
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-5">
    <!--
      **프로젝트 요약을 새로 만들지 않는다** (§8.3). 도구 막대와 대시보드가 이미 같은
      것을 보여준다 - 두 벌이면 한쪽만 고쳐진다.
    -->
    <AppCard>
      <ProjectSummary />
    </AppCard>

    <AppCard v-for="section in sections" :key="section.id">
      <h3 class="text-lg font-bold">{{ section.title }}</h3>
      <p v-if="section.answer.trim() === ''" class="mt-2 text-ink-faint">
        {{ t('portfolio.unanswered') }}
      </p>
      <p v-else class="mt-2 leading-relaxed whitespace-pre-line">{{ section.answer.trim() }}</p>
    </AppCard>

    <OrphanAnswers v-if="orphans.length > 0" :orphans="orphans" />
  </div>
</template>
