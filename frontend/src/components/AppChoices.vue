<script setup lang="ts">
/**
 * 고를 것이 손에 꼽히는 축 하나. **미니 카드를 나란히 늘어놓는다**
 * (architecture.md §8.12).
 *
 * 드롭다운을 쓰지 않는 이유는 **접힌 목록은 학생에게 없는 것과 같기 때문**이다. 무엇이
 * 있는지 모르는 상태로 오는 사람에게 목록을 접어 두면 "그런 게 있는 줄도 몰랐다"가 되고,
 * 축이 서로를 좁히는 것도 열어 보기 전까지 안 보인다.
 *
 * **꺼진 칸은 지우지 않고, 누르면 아래 한 줄로 사유가 뜬다.** 그래서 `disabled`가 아니라
 * `aria-disabled`다 — `disabled`는 클릭 자체가 안 잡혀 **사유에 도달할 방법이 없어진다.**
 * hover에 맡길 수도 없다: 휴대폰에는 hover가 없다.
 *
 * **여기는 무엇을 고르는 축인지 모른다.** 사유 문장도 번역된 채로 온다 — 화면의 어휘를
 * 이 컴포넌트가 알기 시작하면 다른 축에 다시 쓸 수 없다.
 */

import { computed, ref } from 'vue'

import { splitLabel } from '@/i18n'
import { forwardAttrs, isLocked, type Lock } from '@/locks'

/**
 * **넘겨받은 속성을 뿌리에 흘리지 않는다** (결정문 65 "구조 뒤 감사에서 더한 것", `@/locks`의
 * `forwardAttrs`). 흘리면 화면이 이 부품의 이름으로 잠금을 걸 수 있다.
 */
defineOptions({ inheritAttrs: false })

/**
 * 칸 하나. **잠금을 넘기면 이유 문장도 반드시 넘긴다** (0.30.0 최종 승인 감사 C-12) — 이유가 선택
 * 속성이던 때는 잠겼는데 문장이 없는 칸이 타입을 지났고, 그 칸은 **누르면 조용했다**(§10.6 *"결함은
 * 조용한 실패뿐"*). 이제 둘은 한 갈래로만 온다. `app-choices.spec.ts`의 `@ts-expect-error`가 문다.
 */
export type Choice = {
  readonly id: string
  readonly label: string
} & (
  | { readonly lock?: undefined; readonly reason?: undefined }
  | {
      /**
       * 잠금. **`@/locks`만 만든다** (결정문 65) — 칸을 끄는 boolean은 받지 않는다. 전에는
       * `enabled`를 받아서 부르는 쪽이 어떤 조건이든 넣을 수 있었다.
       */
      readonly lock: Lock
      /** 잠긴 칸을 눌렀을 때 보여줄 문장. 이미 번역돼서 온다. 잠기지 않았으면 안 쓴다. */
      readonly reason: string
    }
)

const props = defineProps<{
  label: string
  /**
   * 축 이름 아래 한 줄. **이 축을 고르기 전에 알아야 하는 것**만 온다.
   *
   * 대화상자 설명문으로 밀지 않는 이유는, 거기 적으면 축이 안 보이는 화면에서도
   * 문장이 남기 때문이다 — 종류가 하나뿐이면 이 컴포넌트 자체가 안 그려진다.
   */
  hint?: string | undefined
  items: readonly Choice[]
  /** 지금 골라진 칸. 아무것도 안 골랐으면 undefined다 — 기본값을 지어내지 않는다. */
  selected?: string | undefined
  /**
   * 칸을 **한 줄에 다** 세우는가. **기본은 받은 폭에 따라 두 열·세 열로 접힌다** (아래 격자).
   *
   * **그리기의 붓 굵기 셋 때문에 생겼다** (open-decisions.md 67 결정 12). 단계의 이름이 짧고
   * 셋이 한 축의 눈금이라, 두 열로 접히면 `굵은 붓` 하나만 아랫줄로 떨어져 **눈금의 차례가
   * 안 읽힌다.** 이 줄에서는 이름도 줄을 안 바꾼다(`whitespace-nowrap`) — 이름이 짧은 축에만 준다.
   * `app-choices.spec.ts`의 "한 줄에 세우면"이 문다.
   */
  row?: boolean
  /**
   * 축 이름 줄을 **화면에서만** 숨기는가. 이름은 그대로 묶음(`role="group"`)의 `aria-label`로 읽힌다.
   * **기본은 이름 줄이 선다** — 축이 무엇인지 모르는 채 고르게 하지 않는다.
   *
   * **그리기의 붓 굵기 하나 때문에 생겼다** (open-decisions.md 67 결정 12). 승인된 A3 목업에는 이름 줄이
   * 없고(점의 크기가 곧 무엇의 축인지 말한다), 그 줄이 캔버스 높이 공식을 2rem 깎았다.
   * `app-choices.spec.ts`의 "축 이름을 화면에서만 숨기면"이 문다.
   */
  hideLabel?: boolean
}>()

defineSlots<{
  /**
   * 칸 이름 앞의 표시. 받는 것은 그 칸의 `id`다. **글자가 아니라 꾸밈이다** — 이름을 대신하지
   * 않으므로 스크린리더에는 안 읽히게 부르는 쪽이 `aria-hidden`을 준다(그리기의 붓 점).
   */
  mark?: (props: { id: string }) => unknown
}>()

const emit = defineEmits<{ pick: [id: string] }>()

/** 사유를 펼쳐 둔 칸. 한 번에 하나다 — 축 아래 자리가 하나이기 때문이다. */
const opened = ref<string | null>(null)

/**
 * 목록이 바뀌면 저절로 닫힌다. 축이 좁혀지면서 그 칸이 없어지거나 켜졌을 수 있는데,
 * 그때 남은 사유는 이미 사실이 아니다.
 */
const reason = computed(() => {
  const item = props.items.find((one) => one.id === opened.value)
  return item && isLocked(item.lock) ? item.reason : undefined
})

function press(item: Choice): void {
  if (isLocked(item.lock)) {
    opened.value = item.id
    return
  }
  opened.value = null
  emit('pick', item.id)
}

/**
 * **테두리는 늘 있고 색만 바뀐다.** 골랐을 때만 테두리를 주면 안쪽 폭이 상태에 따라
 * 달라져서 카드가 한 픽셀씩 움직인다.
 */
const STATES = {
  selected: 'border-brand bg-brand text-ink-invert shadow-card',
  idle: 'border-line-strong bg-surface text-ink hover:bg-surface-sunken',
  off: 'cursor-not-allowed border-line bg-surface-sunken text-ink-faint',
} as const

function stateOf(item: Choice): string {
  if (isLocked(item.lock)) return STATES.off
  return props.selected === item.id ? STATES.selected : STATES.idle
}

/**
 * 그릴 칸들. **두 가지를 미리 갈라 둔다** (`splitLabel`).
 *
 * ① **나열 기호(`, `·`、`)로 이어 붙인 라벨은 조각으로 나눈다.** 가운뎃점으로 잇던 때
 * `13번째 실험 · K-평균 · ml.js · 내 컴퓨터`가 아무 데서나 접혀 `ml.js` / `내 컴퓨터`처럼
 * 한 이름이 두 줄로 갈렸다. 조각마다 덩어리로 다니게 하면 **접히는 자리가 나열 기호 뒤뿐**이 된다.
 * 일본어는 `、`로 잇는다 — 그것을 안 보면 일본어 라벨은 통째로 한 조각이라 끝이 아닌
 * 자리의 병기 괄호가 보호되지 않는다.
 *
 * ② **병기 괄호를 뗀다** (`splitTerm`). 조각 안에서도 같은 규칙이 걸린다.
 *
 * 라벨이 번역된 문장이라 여기서 뜻을 읽지는 않는다 - 나누는 규칙은 문구 규약이지
 * 이 축의 어휘가 아니다.
 */
const cells = computed(() => props.items.map((item) => ({ item, parts: splitLabel(item.label) })))
</script>

<template>
  <!--
    **재는 것은 창이 아니라 이 축이 받은 폭이다**(`@container`). 이 컴포넌트는 자기가
    어디에 놓일지 모른다 - 학습 화면에서는 넓은 판이고, 새 프로젝트에서는 `max-w-2xl`인
    대화상자 안이다. `sm:`으로 쓰면 **창이 640px을 넘었다는 이유로 폭 448px짜리
    대화상자 안에서 열이 셋으로 갈린다** (2026-08-30, 같은 실수를 대화상자 단추에서
    먼저 겪었다).

    **자기 폭은 부모에게서 받아야 한다.** 컨테이너는 내용으로 폭을 정하지 않으므로,
    폭이 내용에 달린 자리(가로 flex 칸)에 놓으면 0으로 접힌다. 지금 쓰는 세 곳은
    전부 세로 flex라 폭이 부모에게서 온다.
  -->
  <div v-bind="forwardAttrs($attrs)" class="min-w-0 @container">
    <h3 v-if="!props.hideLabel" class="font-bold text-ink-soft">{{ label }}</h3>
    <!-- 여백은 `AppField`와 같다 — 나란히 선 두 칸의 리듬이 다르면 한쪽이 밀린 것처럼 보인다. -->
    <p v-if="props.hint" class="mt-1.5 text-ink-faint">{{ props.hint }}</p>

    <!--
      **격자다.** flex-wrap으로 두면 글자 수대로 넓이가 제각각이 되고, 언어를 바꾸면 그
      들쭉날쭉이 또 달라진다. `auto-rows-fr`이 행 높이까지 맞춰서 두 줄로 접힌 칸이 있는
      행도 다른 행과 같은 높이로 선다.

      id로 잇지 않는다 — 라벨은 번역된 문장이라 공백이 들어가고, id에는 공백을 못 쓴다.

      **열 셋의 문턱은 안 쪼개지는 낱말 덩어리에서 나온다.** 칸의 좌우 여백이 24px이고
      가장 긴 덩어리가 `(Classification)`(16px 기준 약 120px)이라 한 칸이 144px,
      셋에 간격 8px 둘을 더하면 448px이다. 그게 `@md`(28rem)다.
    -->
    <div
      class="grid auto-rows-fr gap-2"
      :class="[
        props.row ? 'grid-flow-col auto-cols-fr' : 'grid-cols-2 @md:grid-cols-3',
        props.hideLabel && !props.hint ? '' : 'mt-1.5',
      ]"
      role="group"
      :aria-label="label"
    >
      <button
        v-for="cell in cells"
        :key="cell.item.id"
        type="button"
        class="min-w-0 rounded-control border px-3 py-2 text-center font-bold break-keep transition-colors"
        :class="[stateOf(cell.item), props.row ? 'whitespace-nowrap' : '']"
        :aria-pressed="props.selected === cell.item.id"
        :aria-disabled="isLocked(cell.item.lock)"
        @click="press(cell.item)"
      >
        <slot :id="cell.item.id" name="mark" />
        <!--
          **원어는 통째로 다니되, 저 혼자 칸보다 넓으면 저 안에서 접힌다.** `inline-block`이
          그 둘을 동시에 한다 - 줄바꿈에는 덩어리 하나로 참여하고(그래서 괄호 앞이 갈릴
          자리가 된다), 칸보다 넓어지면 제 안에서 다시 접힌다. `whitespace-nowrap`은 앞의
          절반만 해서 `(Logistic Regression)`이 카드 밖으로 삐져나갔다.

          두 조각을 한 줄에 붙여 둔 것도 규칙이다 - 사이에 줄바꿈을 넣으면 Vue가 공백 한
          칸으로 읽어 `의사결정트리 (Decision Tree)`가 된다. 조각 사이의 공백은 그래서
          줄바꿈이 아니라 **보간으로** 넣는다 - 여백 정리가 지워 버리지 않는 유일한 방법이다.
          공백은 라벨에 있던 만큼만 넣는다(`gap`) — 일본어 `、` 뒤에는 없다.
        -->
        <template v-for="(part, index) in cell.parts" :key="index"
          ><span class="inline-block"
            >{{ part.head }}<span v-if="part.term" class="inline-block">{{ part.term }}</span
            >{{ part.tail }}</span
          >{{ part.gap }}</template
        >
      </button>
    </div>

    <!-- 이유 없이 회색이면 학생은 고장으로 본다. 누른 칸의 사유가 여기 뜬다. -->
    <p v-if="reason" role="status" class="mt-1.5 text-caution">{{ reason }}</p>
  </div>
</template>
