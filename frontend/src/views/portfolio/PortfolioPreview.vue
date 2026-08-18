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
 * 막대에 요약 버튼이 붙박이로 있어서 같은 것이 한 화면에 두 벌이 된다. **`portfolio/document.md`
 * 머리에는 그대로 적는다** — 파일만 받은 사람은 그 버튼을 못 누른다 (§8.6).
 *
 * **문항마다 화면의 자리 이름을 받는다.** 목차가 데려가는 곳이 작성 화면과 완성본에서
 * 같아야 한다 — 안 주면 완성본에서 목차를 눌러도 아무 일도 안 일어난다.
 *
 * **카드 여럿이 아니라 한 장이다** (architecture.md §8.18). 이 화면이 보여주려는 것은
 * 받는 사람이 볼 `portfolio/document.md`의 모양인데(§8.5), 문항마다 카드가 끊기면 그건 문서가
 * 아니라 목록이다.
 *
 * **경계는 왼쪽 여백의 큰 번호와 옅은 가로선이 만든다** (§8.18.1). 번호 표기는 쓰는
 * 화면의 배지와 같다 — 두 모드가 같은 문서라는 것을 그 표기가 말한다. 답에는 쓰는
 * 화면의 왼쪽 선이 `brand-line`으로 옅게 남는다.
 *
 * **이전 문항의 답은 이 문서 밖이다.** 지금 양식의 문항이 아니므로(§8.4) 같은 장 안에
 * 두면 받는 사람이 그것을 문항 하나로 읽는다.
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'
import type { OrphanAnswer, PortfolioSection } from '@/project/portfolio'
import OrphanAnswers from './OrphanAnswers.vue'
import PhotoCards from './PhotoCards.vue'

const props = defineProps<{
  sections: readonly PortfolioSection[]
  orphans: readonly OrphanAnswer[]
  /** 문항 id로 화면의 자리 이름을 만든다. 작성 화면과 같은 함수가 온다. */
  anchorId: (id: string) => string
  /** 문항에 붙은 사진. 작성 화면과 같은 것을 받는다 - 여기서는 뗄 수 없을 뿐이다. */
  photosOf: (id: string) => { path: string; url: string }[]
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppCard>
      <div class="flex flex-col">
        <article
          v-for="(section, index) in props.sections"
          :id="props.anchorId(section.id)"
          :key="section.id"
          class="grid gap-x-4 py-6 first:pt-0 last:pb-0 doc-gutter-grid under-step-bar"
          :class="index > 0 ? 'border-t border-line' : ''"
        >
          <!-- 조용하되 읽혀야 한다. 선 토큰은 글자로 쓰면 흰 바탕에서 대비가 안 난다. -->
          <span class="text-2xl font-extrabold text-ink-faint tabular-nums">
            {{ String(index + 1).padStart(2, '0') }}
          </span>

          <div class="min-w-0">
            <h3 class="text-lg font-bold">{{ section.title }}</h3>
            <p
              v-if="section.answer.trim() === ''"
              class="mt-2 border-l-2 border-line pl-4 text-ink-faint"
            >
              {{ t('portfolio.unanswered') }}
            </p>
            <p
              v-else
              class="mt-2 max-w-prose border-l-2 border-brand-line pl-4 leading-relaxed whitespace-pre-line"
            >
              {{ section.answer.trim() }}
            </p>

            <PhotoCards class="mt-3" :photos="props.photosOf(section.id)" />
          </div>
        </article>
      </div>
    </AppCard>

    <OrphanAnswers v-if="props.orphans.length > 0" :orphans="props.orphans" />
  </div>
</template>
