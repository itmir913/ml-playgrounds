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
 * **막대는 숨긴다** (`scrollbar-none`). 좁고 늘 보이는 자리라 막대가 내용보다 자리를
 * 먹고, **막대가 보인다는 것 자체가 무언가 잘못됐다는 신호로 읽힌다.** 자리를 비워 두는
 * 것(`scroll-gutter-stable`)도 함께 걷는다 - 막대가 없으면 비켜설 자리도 없다.
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
 * **안 쓴 문항을 색으로만 말하지 않는다.** 쓴 문항에는 체크, 안 쓴 문항에는 빈 동그라미가
 * 붙고 읽어 주는 문장이 따라간다 - **표시가 없는 것과 안 쓴 것은 다르다.** 지금 보고 있는
 * 문항도 같다: 바탕색만이 아니라 **왼쪽에 막대가 선다.**
 *
 * **읽는 화면에서는 답의 첫 줄을 함께 단다** (`outline`, architecture.md §8.18.1).
 * 개요는 **답이 있어야 개요가 되므로** 쓰는 화면에서는 안 단다 - 거기서는 대부분 비어
 * 있어 줄 높이만 두 배가 된다.
 *
 * **제목은 줄을 안 바꾸고 `…`으로 줄인다.** 줄 높이가 항목마다 달라지면 훑는 눈이 걸리고,
 * 좁은 칸에서 두 줄이 되면 다섯 줄이 여덟 줄이 된다.
 *
 * **줄 사이는 띄운다.** 막대가 줄마다 서는데 줄이 붙어 있으면 그 막대들이 한 줄로
 * 이어진다 - 줄이 몇인지는 간격이 말한다.
 *
 * **표시한 문항을 자기 안으로 데려온다.** 문항이 열둘이면 목록이 자기 안에서 스크롤하고,
 * 그때 표시가 목록 밖에 있으면 **표시를 해 둔 것이 아무 일도 안 한 것과 같다**
 * (2026-08-15, 사용자 화면에서 실제로 그랬다). 굴리는 것은 이 목록뿐이다 -
 * `scrollIntoView`는 조상을 전부 굴려서 **읽던 자리가 따라 움직인다.**
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { ACTION_ICONS } from '@/icons'
import type { PortfolioSection } from '@/project/portfolio'

const props = defineProps<{
  sections: readonly PortfolioSection[]
  /** 지금 화면에 보이는 문항. 아직 판정 전이면 없다. */
  active?: string | undefined
  /** 줄마다 답의 첫 줄을 단다. 읽는 화면에서만 켠다 (§8.18.1). */
  outline?: boolean
}>()

const emit = defineEmits<{ pick: [id: string] }>()

const { t } = useI18n()

const done = computed(() => props.sections.filter((section) => section.answer.trim() !== '').length)

/** 진행 막대의 너비. 문항이 없으면 0이다 - 나눗셈이 `NaN`이 되는 자리다. */
const donePercent = computed(() =>
  props.sections.length === 0
    ? '0%'
    : `${((done.value / props.sections.length) * 100).toFixed(2)}%`,
)

const list = ref<HTMLElement | null>(null)

/** 표시한 줄이 목록 밖이면 모자란 만큼만 민다. 들어와 있으면 한 픽셀도 안 움직인다. */
function reveal(id: string | undefined): void {
  const box = list.value
  if (box === null || id === undefined) return
  const item = box.querySelector(`[data-section="${CSS.escape(id)}"]`)
  if (item === null) return

  const outer = box.getBoundingClientRect()
  const inner = item.getBoundingClientRect()
  if (inner.top < outer.top) box.scrollTop -= outer.top - inner.top
  else if (inner.bottom > outer.bottom) box.scrollTop += inner.bottom - outer.bottom
}

watch(() => props.active, reveal)
</script>

<template>
  <div class="flex flex-col rounded-panel border border-line bg-surface p-4 md:fit-under-step-bar">
    <h2 class="font-bold">{{ t('portfolio.contents') }}</h2>
    <!--
      **진행은 막대만 준다.** 문장은 동작 바가 이미 말하고, 줄마다 붙는 표시가 한 번 더
      말한다 - 같은 사실을 세 번 적으면 그 판이 시끄러워진다. 읽어 줄 것은
      `portfolio.progress`가 그쪽에서 갖는다.
    -->
    <div class="mt-2 h-1 w-full overflow-hidden rounded-pill bg-surface-sunken" aria-hidden="true">
      <div class="h-full rounded-pill bg-brand transition-all" :style="{ width: donePercent }" />
    </div>

    <!--
      **좁은 화면에서는 다섯 줄 높이까지다** (§8.18.1). 목차가 맨 위에 서므로, 문항이
      열넷이면 목록이 첫 문항을 화면 밖으로 밀어낸다.
    -->
    <ol
      ref="list"
      class="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto scrollbar-none max-md:max-h-48"
    >
      <li v-for="(section, index) in props.sections" :key="section.id">
        <!--
          **말하는 것은 왼쪽 막대다** (2026-08-15, 사용자). 줄을 채우면 옅은 면이라도 흰 판
          위에서 떠 있는 덩어리로 보이고, 줄이 열넷이면 그 덩어리가 열넷이다. 손이 올라간
          줄은 막대가 옅게, 표시된 줄은 막대가 브랜드 색으로 서고 글자가 굵어진다.

          **막대는 언제나 자리를 차지한다.** 표시된 줄에만 테두리를 주면 그 줄의 글자가
          2px씩 밀린다 - 칸의 안쪽 폭이 상태에 따라 달라지면 안 된다(`AppButton`).
        -->
        <button
          type="button"
          :data-section="section.id"
          class="flex w-full items-baseline gap-2 rounded-control border-l-2 border-transparent px-2 py-1.5 text-left transition-colors hover:border-line-strong"
          :class="props.active === section.id ? 'border-brand font-bold' : ''"
          :aria-current="props.active === section.id ? 'true' : undefined"
          @click="emit('pick', section.id)"
        >
          <span class="text-ink-faint tabular-nums">{{ index + 1 }}</span>
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="truncate" :class="section.answer.trim() === '' ? 'text-ink-faint' : ''">
              {{ section.title }}
            </span>
            <!-- 답의 첫 줄. **잘리면 잘린 대로 둔다** - 개요는 훑는 것이지 읽는 것이 아니다. -->
            <span
              v-if="props.outline && section.answer.trim() !== ''"
              class="truncate font-normal text-ink-faint"
            >
              {{ section.answer.trim() }}
            </span>
          </span>
          <component
            :is="section.answer.trim() === '' ? ACTION_ICONS.unwritten : ACTION_ICONS.written"
            :size="16"
            class="shrink-0 self-center"
            :class="section.answer.trim() === '' ? 'text-ink-faint' : 'text-positive'"
            aria-hidden="true"
          />
          <span v-if="section.answer.trim() === ''" class="sr-only">
            {{ t('portfolio.unanswered') }}
          </span>
        </button>
      </li>
    </ol>
  </div>
</template>
