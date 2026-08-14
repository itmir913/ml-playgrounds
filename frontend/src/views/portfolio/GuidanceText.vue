<script setup lang="ts">
/**
 * 문항의 안내문 (mlpx-spec.md §8.1).
 *
 * **이 저장소에서 `v-html`이 있는 유일한 자리다.** 넣는 것은 `renderGuidance`가 만든
 * 것뿐이고, 그 함수가 살균의 유일한 문이다 - 다른 자리에서 `v-html`을 쓰면
 * `tests/ui-rules.spec.ts`가 운다.
 *
 * **읽기 전용이다.** 답 칸 위에 붙어서 무엇을 쓰라는 것인지만 말한다. **옅은 판에 담는
 * 이유는 읽을 것과 쓸 것을 가르기 위해서다** (architecture.md §8.18.1) - 안 담으면
 * 안내문과 답이 같은 흐름으로 읽혀서 어디까지가 남이 쓴 것인지 안 보인다.
 *
 * 서식은 `prose-guidance`가 준다 (`styles/utilities.css`) - 목록·표·강조가 살아나되
 * 우리 화면의 글자 크기와 색을 따른다. **가장 작은 글자가 `text-base`라는 규칙은 여기도
 * 적용된다** (CLAUDE.md §4).
 */

import { computed } from 'vue'

import { renderGuidance } from '@/project/portfolio-markdown'

const props = defineProps<{ markdown: string }>()

const html = computed(() => renderGuidance(props.markdown))
</script>

<template>
  <!-- eslint-disable vue/no-v-html -- 살균은 renderGuidance가 한다 (위 머리말) -->
  <div
    class="max-w-prose rounded-panel bg-surface-sunken p-4 prose-guidance leading-relaxed text-ink-soft"
    v-html="html"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>
