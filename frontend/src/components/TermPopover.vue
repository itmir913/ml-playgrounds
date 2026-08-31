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
   * 이 묶음이 가진 선택지들. **있으면 설명 아래에 목록으로 붙는다**
   * (`architecture.md` §8.13 "고르는 묶음도 같은 자리를 쓴다").
   *
   * 고르는 축의 머리글이 트리거일 때 쓴다 — 학생이 묻는 것이 "스케일링이 뭐냐"에서
   * 곧바로 "표준화랑 정규화랑 뭐가 다르냐"로 이어지므로, 그 둘이 한 판에 있어야 한다.
   *
   * **문자열은 이미 번역돼서 온다.** 여기서 키를 조립하지 않는 이유는 위와 같다.
   */
  items?: readonly { readonly term: string; readonly body: string }[]
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

    <!--
      **제목이 곧 수식의 왼쪽이다.** 제목 줄과 수식 줄을 따로 두었더니 `정확도(Accuracy)`가
      두 줄 연속으로 나와 같은 말을 두 번 했다 (2026-08-13). 제목을 숨기는 대신 한 줄로
      합친 이유는 **수식이 없는 지표(R²·RMSE·실제 데이터 수)도 제목을 갖기 때문**이다 -
      숨기면 팝오버의 생김새가 두 가지가 되고, 읽어 주는 기계에는 제목이 아예 없어진다.

      **교과서처럼 분자를 위에, 분모를 아래에 둔다.** 글로 푼 문장보다 이 한 줄이 먼저
      읽힌다. `=`와 `×`는 번역하지 않으므로 여기 그대로 둔다 - 자연어가 아니다.

      **스크린 리더에는 빗금을 들려준다.** 위아래로 쌓인 낱말 둘은 소리로는 그냥 이어져
      "옳게 예측한 데이터 수 예측한 데이터 수"가 된다.
    -->
    <div class="flex flex-wrap items-center gap-2">
      <h4 class="font-bold text-ink">{{ title }}</h4>
      <template v-if="numerator && denominator">
        <span aria-hidden="true">=</span>
        <span class="inline-flex flex-col items-center text-center text-ink">
          <span class="px-2">{{ numerator }}</span>
          <span class="sr-only">/</span>
          <span class="mt-1 border-t border-line-strong px-2 pt-1">{{ denominator }}</span>
        </span>
      </template>
    </div>

    <p class="mt-2 text-ink-soft">{{ body }}</p>

    <!--
      **이름과 설명이 한 줄에서 이어진다**(run-in). 이름을 줄로 띄우면 항목마다 두 줄을
      먼저 쓰고 시작해서, 여섯 개짜리 결측치 목록이 화면 한 판을 넘었다 (2026-08-31).
      **줄 수가 절반 가까이 준다.**

      **불릿을 안 쓴다.** 왼쪽 여백을 먹으면서 줄 수는 그대로이고, 이름이 이미 굵어서
      항목이 어디서 시작하는지는 그것으로 보인다.

      `<dl>`인 이유는 이것이 **이름과 뜻의 짝**이기 때문이다. 읽어 주는 기계에 그렇게
      들리고, `<ul>`로 두면 열세 줄이 그냥 목록이 된다. 짝을 `inline`으로 눕혀도 그
      관계는 그대로 남는다.

      **사이 여백은 `ml-1`이다.** 요소 사이의 공백은 여백 정리가 지워 버리므로
      (`AppChoices`가 같은 자리에서 겪었다) 글자로 넣지 않고 여백으로 준다.
    -->
    <dl v-if="items && items.length > 0" class="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div v-for="item in items" :key="item.term">
        <dt class="inline font-bold text-ink">{{ item.term }}</dt>
        <dd class="ml-1 inline text-ink-soft">{{ item.body }}</dd>
      </div>
    </dl>
  </AppPopover>
</template>
