<script setup lang="ts">
/**
 * 완성본. **문법과 결과 사이가 아니라 쓰는 화면과 받는 사람이 볼 화면 사이다**
 * (mlpx-spec.md §8.3). 나란히 두지 않는 이유는 휴대폰이 기준이기 때문이다.
 *
 * **읽기 전용으로 굳히는 버튼은 없다.** 이 보기가 이미 그 모양을 주고, 잠금에는
 * 강제력이 없다(압축을 풀면 풀린다). 없는 보증을 있는 것처럼 보이게 하지 않는다.
 *
 * **안 쓴 문항도 제목은 남긴다.** 빈 칸이 보이는 것과 문항이 사라지는 것은 다르다.
 *
 * **프로젝트 요약은 여기 없다** (§8.3, 2026-08-14에 사용자가 걷어내라고 했다). 도구
 * 막대에 요약 버튼이 붙박이로 있어서 같은 것이 한 화면에 두 벌이 된다. **`portfolio.md`
 * 머리에는 그대로 적는다** — 파일만 받은 사람은 그 버튼을 못 누른다 (§8.6).
 *
 * **문항마다 화면의 자리 이름을 받는다.** 목차가 데려가는 곳이 작성 화면과 완성본에서
 * 같아야 한다 — 안 주면 완성본에서 목차를 눌러도 아무 일도 안 일어난다.
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'
import type { OrphanAnswer, PortfolioSection } from '@/project/portfolio'
import OrphanAnswers from './OrphanAnswers.vue'

const props = defineProps<{
  sections: readonly PortfolioSection[]
  orphans: readonly OrphanAnswer[]
  /** 문항 id로 화면의 자리 이름을 만든다. 작성 화면과 같은 함수가 온다. */
  anchorId: (id: string) => string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppCard
      v-for="section in props.sections"
      :id="props.anchorId(section.id)"
      :key="section.id"
      class="under-step-bar"
    >
      <h3 class="text-lg font-bold">{{ section.title }}</h3>
      <p v-if="section.answer.trim() === ''" class="mt-2 text-ink-faint">
        {{ t('portfolio.unanswered') }}
      </p>
      <p v-else class="mt-2 leading-relaxed whitespace-pre-line">{{ section.answer.trim() }}</p>
    </AppCard>

    <OrphanAnswers v-if="props.orphans.length > 0" :orphans="props.orphans" />
  </div>
</template>
