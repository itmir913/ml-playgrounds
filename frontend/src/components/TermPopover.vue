<script setup lang="ts">
/**
 * 용어 하나의 설명 (architecture.md §8.13 "용어는 눌러야 설명이 나온다").
 *
 * **누르는 것이 묻는 행위다.** 상시 설명을 깔지 않는다는 규칙(§8.7, `copy.md`)과
 * 부딪히지 않는 이유가 그것이다 - 궁금한 학생에게만, 그 자리에서 답한다.
 *
 * **hover가 아니라 클릭이다.** 툴팁으로 만들면 터치 기기에서는 영원히 안 뜬다 -
 * 이 저장소가 `save.exportWarning`으로 이미 겪은 실패다 (§8.8).
 *
 * **이미 번역된 문자열을 받는다. 키를 여기서 조립하지 않는다.** `t('metricHelp.' + name)`
 * 같은 조립을 하면 로케일에 없는 키를 화면에 흘려도 CI의 정적 `t()` 검사가 못 잡는다
 * (`docs/i18n.md`). 부르는 자리마다 키를 적어 두는 것이 그 검사를 살려 둔다.
 */

import AppPopover from '@/components/AppPopover.vue'
import { ACTION_ICONS } from '@/icons'

defineProps<{
  /** 팝오버의 제목이자 눌리는 글자. 그 용어 자체다. */
  title: string
  /** 두세 줄 설명. */
  body: string
  /**
   * 수식의 분자·분모. **둘 다 있을 때만 수식을 그린다** - 셀 수 없는 것(실제 데이터
   * 수)에는 수식이 없다.
   *
   * 라이브러리를 쓰지 않는 이유는 architecture.md §8.13에 있다 - 그릴 것이 가로줄
   * 하나에 낱말 둘이다.
   */
  numerator?: string
  denominator?: string
}>()
</script>

<template>
  <!--
    **가로로 긴 직사각형이다** (`wide`). 두세 줄짜리 설명이라 세로로 좁고, 좁은 화면에서는
    `popover-panel`의 max-width가 그대로 걸려 화면을 넘지 않는다.

    **위로 연다.** 이 트리거는 전부 표 머리글이고 그 아래는 전부 값이라, 아래로 열면
    설명을 읽는 동안 정작 설명이 걸린 숫자들이 가려진다. 위쪽에 자리가 모자라면
    `AppPopover`가 알아서 아래로 뒤집는다.
  -->
  <AppPopover size="wide" side="top">
    <template #trigger="{ open }">
      <!--
        **표 머리글 전체가 아니라 그 안의 버튼이 눌린다.** 머리글 자체를 버튼으로 만들면
        스크린 리더에서 열 이름이 버튼으로 읽혀, 표를 훑는 사람이 열 이름을 잃는다.

        아이콘이 붙는 이유는 **누를 수 있다는 것이 보여야** 하기 때문이다. 글자만 있으면
        옆 열과 구별되지 않아 아무도 안 누른다.
      -->
      <button
        type="button"
        :aria-expanded="open"
        class="flex items-center gap-1 rounded-control transition-colors hover:text-ink"
      >
        {{ title }}
        <component :is="ACTION_ICONS.explainTerm" :size="16" aria-hidden="true" />
      </button>
    </template>

    <h4 class="font-bold text-ink">{{ title }}</h4>

    <!--
      **교과서처럼 분자를 위에, 분모를 아래에 둔다.** 글로 푼 문장보다 이 한 줄이 먼저
      읽힌다. `=`와 `×`는 번역하지 않으므로 여기 그대로 둔다 - 자연어가 아니다.

      **스크린 리더에는 빗금을 들려준다.** 위아래로 쌓인 낱말 둘은 소리로는 그냥 이어져
      "옳게 분류된 수 예측한 수"가 된다.
    -->
    <p v-if="numerator && denominator" class="mt-2 flex flex-wrap items-center gap-2">
      <span class="font-bold text-ink">{{ title }}</span>
      <span aria-hidden="true">=</span>
      <span class="inline-flex flex-col items-center text-center text-ink">
        <span class="px-2">{{ numerator }}</span>
        <span class="sr-only">/</span>
        <span class="mt-1 border-t border-line-strong px-2 pt-1">{{ denominator }}</span>
      </span>
    </p>

    <p class="mt-2 text-ink-soft">{{ body }}</p>
  </AppPopover>
</template>
