<script setup lang="ts">
/**
 * **포트폴리오 열람** — 학생이 쓴 글을 교사가 읽는다 (architecture.md §8.21).
 *
 * **읽는 화면은 이미 있다** (`views/portfolio/PortfolioPreview.vue`). 학생이 [완성본]에서
 * 보던 그 화면을 그대로 쓴다 — 교사가 다른 모양으로 읽으면 "내가 낸 것이 이렇게 보이나"를
 * 학생이 알 수 없다.
 *
 * **사진 주소도 같은 원시 연산에서 나온다** (`useObjectUrls`·`photosOf`). 이 화면이 다시
 * 만들면 놓아주는 시점이 또 하나 생기고, 그 병은 이미 여섯 번 겪었다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppEmpty from '@/components/AppEmpty.vue'
import { useObjectUrls } from '@/composables/useObjectUrls'
import type { ProjectFile } from '@/project/format'
import { orphanAnswers, photosOf, portfolioSections } from '@/project/portfolio'
import PortfolioPreview from '../portfolio/PortfolioPreview.vue'

const props = defineProps<{ file: ProjectFile }>()

const { t } = useI18n()

const portfolio = computed(() => props.file.document.portfolio)

const { urls } = useObjectUrls(
  computed(() => [...props.file.attachments].map(([key, bytes]) => ({ key, bytes }))),
)

const sections = computed(() => portfolioSections(portfolio.value))
const orphans = computed(() => orphanAnswers(portfolio.value))

/** 문항 하나에 붙은 사진들. **작성 화면과 같은 순수 함수가 고른다.** */
function photosFor(sectionId: string): { path: string; url: string }[] {
  return photosOf(portfolio.value, sectionId, urls.value)
}

/**
 * 자리 이름. **작성 화면과 같은 규칙이다** — 그쪽이 글 안의 목차에서 이 이름으로 뛴다.
 * 점검에는 목차가 없지만 미리보기가 이 함수를 요구하므로 같은 모양을 준다.
 */
function anchorId(id: string): string {
  return `inspect-portfolio-${id}`
}

/**
 * 읽을 것이 있는가. **양식만 있고 답이 없는 제출물도 있다** — 그때 빈 문항 목록을
 * 그리는 것보다 "아직 안 썼다"가 교사에게 필요한 말이다.
 *
 * **미리보기가 그릴 것이 하나라도 있으면 읽을 것이다** — 글, 사진, 지금 양식에 없는
 * 문항의 답. 사진만 붙인 문항이나 떠도는 답만 있는 제출물을 "아직 안 썼다"로 덮으면
 * 교사는 그 학생이 낸 것을 못 본다. `inspect-portfolio-panel.spec.ts`가 문다.
 */
const written = computed(
  () =>
    sections.value.some((one) => one.answer.trim() !== '' || photosFor(one.id).length > 0) ||
    orphans.value.length > 0,
)
</script>

<template>
  <!--
    **머리글이 없다.** 이 판이 서는 자리가 포트폴리오 모드 하나뿐이고, 모드 스위치가
    이미 그 이름으로 눌려 있다 (§8.21) — 바로 아래에 같은 낱말을 또 적으면 소음이다.
  -->
  <section class="flex min-w-0 flex-1 flex-col gap-1.5">
    <PortfolioPreview
      v-if="written"
      :sections="sections"
      :orphans="orphans"
      :anchor-id="anchorId"
      :photos-of="photosFor"
    />

    <!--
      **빈 상태는 자리를 넉넉히 잡는다** (2026-09-18, 사용자). 한 줄짜리 판이던 동안에는
      포트폴리오 모드로 바꾸는 순간 화면이 통째로 접혀서, **굴릴 것이 없어진 화면이 맨
      위로 튀었다.** 남은 높이를 이 카드가 채우면 모드를 오갈 때 자리가 안 흔들린다.
      다른 화면의 빈 상태와 같은 부품이고 같은 여백이다 (`AppEmpty`, §8.9).
    -->
    <div
      v-else
      class="grid min-h-64 flex-1 place-items-center rounded-panel border border-line bg-surface"
    >
      <AppEmpty :reason="t('inspect.portfolioEmpty')" :next="t('inspect.portfolioEmptyNext')" />
    </div>
  </section>
</template>
