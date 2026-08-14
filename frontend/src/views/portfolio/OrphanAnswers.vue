<script setup lang="ts">
/**
 * 지금 양식에 없는 id에 붙어 있는 답 (mlpx-spec.md §8.4).
 *
 * **정상 경로로는 안 생긴다** - 문항을 지우면 답도 함께 지우고, 가져오기는 대체가
 * 아니다. 남이 손으로 고친 파일에서는 올 수 있고, 그때 조용히 감추면 그 파일을 준
 * 사람의 글이 없는 것이 된다.
 *
 * **완료 판정에는 안 센다** (§8.3). 여기 있는 것은 지금 양식의 문항이 아니다.
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'
import type { OrphanAnswer } from '@/project/portfolio'

defineProps<{ orphans: readonly OrphanAnswer[] }>()

const { t } = useI18n()
</script>

<template>
  <AppCard>
    <h3 class="text-lg font-bold">{{ t('portfolio.orphanTitle') }}</h3>
    <p class="mt-1 text-ink-soft">{{ t('portfolio.orphanLead') }}</p>
    <p
      v-for="orphan in orphans"
      :key="orphan.id"
      class="mt-2 max-w-prose leading-relaxed whitespace-pre-line"
    >
      {{ orphan.answer.trim() }}
    </p>
  </AppCard>
</template>
