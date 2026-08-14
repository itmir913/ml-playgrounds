<script setup lang="ts">
/**
 * 문항 목차. **넓은 화면의 왼쪽에 붙박이로 선다** (architecture.md §8.10.1).
 *
 * 포트폴리오는 세로로만 자라는 화면이다 - 문항이 일곱이면 아래쪽 문항은 언제나 화면
 * 밖이고, 어디까지 썼는지도 굴려 봐야 안다. **옆에 놓을 수 있는 것을 스크롤로 미루지
 * 않는다.**
 *
 * **목록이 길면 자기 안에서 스크롤한다** (`fit-under-step-bar`). 붙박이가 화면 아래로
 * 흘러나가면 아래쪽 문항에는 닿을 방법이 없다. 그래서 카드가 아니라 판이다 - 안에서
 * 스크롤하려면 머리와 목록이 높이를 나눠 가져야 한다.
 *
 * **붙는 자리는 동작 바가 정한다** (`styles/utilities.css`의 `stick-under-step-bar`).
 * 숫자를 여기 적으면 좁은 화면에서 바가 두 줄이 되는 순간 바가 이 칸의 머리를 덮는다.
 *
 * **`md` 미만에서는 아예 안 그린다.** 좁은 화면에서 목차는 문항 위에 쌓이는 또 하나의
 * 목록일 뿐이고, 거기서는 그냥 굴리는 것이 빠르다 (§8.10.1의 "무조건 1열").
 *
 * **지금 보고 있는 문항을 표시한다.** 어느 문항에 와 있는지는 판정하는 쪽(화면)이
 * 넘겨준다 - 여기는 받은 것을 그릴 뿐이다.
 *
 * **안 쓴 문항을 색으로만 말하지 않는다.** 옅은 글자 옆에 읽어 주는 문장을 함께 둔다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { PortfolioSection } from '@/project/portfolio'

const props = defineProps<{
  sections: readonly PortfolioSection[]
  /** 지금 화면에 보이는 문항. 아직 판정 전이면 없다. */
  active?: string | undefined
}>()

const emit = defineEmits<{ pick: [id: string] }>()

const { t } = useI18n()

const done = computed(() => props.sections.filter((section) => section.answer.trim() !== '').length)
</script>

<template>
  <div class="flex flex-col rounded-panel border border-line bg-surface p-4 fit-under-step-bar">
    <h2 class="font-bold">{{ t('portfolio.contents') }}</h2>
    <p class="mt-1 text-ink-soft tabular-nums">
      {{ t('portfolio.progress', { done, total: props.sections.length }) }}
    </p>

    <ol class="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto scroll-gutter-stable">
      <li v-for="(section, index) in props.sections" :key="section.id">
        <button
          type="button"
          class="flex w-full items-baseline gap-2 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken"
          :class="props.active === section.id ? 'bg-surface-sunken font-bold' : ''"
          :aria-current="props.active === section.id ? 'true' : undefined"
          @click="emit('pick', section.id)"
        >
          <span class="text-ink-faint tabular-nums">{{ index + 1 }}</span>
          <span
            class="min-w-0 flex-1 truncate"
            :class="section.answer.trim() === '' ? 'text-ink-faint' : ''"
          >
            {{ section.title }}
          </span>
          <span v-if="section.answer.trim() === ''" class="sr-only">
            {{ t('portfolio.unanswered') }}
          </span>
        </button>
      </li>
    </ol>
  </div>
</template>
