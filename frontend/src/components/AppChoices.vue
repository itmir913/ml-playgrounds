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

import { splitTerm } from '@/i18n'

export interface Choice {
  readonly id: string
  readonly label: string
  readonly enabled: boolean
  /** 꺼진 칸을 눌렀을 때 보여줄 문장. 이미 번역돼서 온다. */
  readonly reason?: string | undefined
}

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
  return item && !item.enabled ? item.reason : undefined
})

function press(item: Choice): void {
  if (!item.enabled) {
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
  if (!item.enabled) return STATES.off
  return props.selected === item.id ? STATES.selected : STATES.idle
}

/** 조각을 잇는 가운뎃점. 라벨을 만드는 로케일(`predict.modelName` 등)이 쓰는 그것이다. */
const JOINER = ' · '

/**
 * 그릴 칸들. **두 가지를 미리 갈라 둔다.**
 *
 * ① **가운뎃점으로 이어 붙인 라벨은 조각으로 나눈다.** `13번째 실험 · K-평균 · ml.js ·
 * 내 컴퓨터`가 아무 데서나 접혀 `ml.js` / `내 컴퓨터`처럼 한 이름이 두 줄로 갈렸다.
 * 조각마다 덩어리로 다니게 하면 **접히는 자리가 가운뎃점뿐**이 된다.
 *
 * ② **병기 괄호를 뗀다** (`splitTerm`). 조각 안에서도 같은 규칙이 걸린다.
 *
 * 라벨이 번역된 문장이라 여기서 뜻을 읽지는 않는다 - 나누는 규칙은 문구 규약이지
 * 이 축의 어휘가 아니다.
 */
const cells = computed(() =>
  props.items.map((item) => {
    const pieces = item.label.split(JOINER)
    return {
      item,
      parts: pieces.map((piece, index) => ({
        ...splitTerm(piece),
        // 가운뎃점은 앞 조각에 붙어 다닌다 - 안 그러면 줄 첫머리에 점이 선다.
        tail: index < pieces.length - 1 ? ' ·' : '',
      })),
    }
  }),
)
</script>

<template>
  <div class="min-w-0">
    <h3 class="font-bold text-ink-soft">{{ label }}</h3>
    <!-- 여백은 `AppField`와 같다 — 나란히 선 두 칸의 리듬이 다르면 한쪽이 밀린 것처럼 보인다. -->
    <p v-if="props.hint" class="mt-1.5 text-ink-faint">{{ props.hint }}</p>

    <!--
      **격자다.** flex-wrap으로 두면 글자 수대로 넓이가 제각각이 되고, 언어를 바꾸면 그
      들쭉날쭉이 또 달라진다. `auto-rows-fr`이 행 높이까지 맞춰서 두 줄로 접힌 칸이 있는
      행도 다른 행과 같은 높이로 선다.

      id로 잇지 않는다 — 라벨은 번역된 문장이라 공백이 들어가고, id에는 공백을 못 쓴다.
    -->
    <div
      class="mt-1.5 grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3"
      role="group"
      :aria-label="label"
    >
      <button
        v-for="cell in cells"
        :key="cell.item.id"
        type="button"
        class="min-w-0 rounded-control border px-3 py-2 text-center font-bold break-keep transition-colors"
        :class="stateOf(cell.item)"
        :aria-pressed="props.selected === cell.item.id"
        :aria-disabled="!cell.item.enabled"
        @click="press(cell.item)"
      >
        <!--
          **원어는 통째로 다니되, 저 혼자 칸보다 넓으면 저 안에서 접힌다.** `inline-block`이
          그 둘을 동시에 한다 - 줄바꿈에는 덩어리 하나로 참여하고(그래서 괄호 앞이 갈릴
          자리가 된다), 칸보다 넓어지면 제 안에서 다시 접힌다. `whitespace-nowrap`은 앞의
          절반만 해서 `(Logistic Regression)`이 카드 밖으로 삐져나갔다.

          두 조각을 한 줄에 붙여 둔 것도 규칙이다 - 사이에 줄바꿈을 넣으면 Vue가 공백 한
          칸으로 읽어 `의사결정트리 (Decision Tree)`가 된다. 조각 사이의 공백은 그래서
          줄바꿈이 아니라 **보간으로** 넣는다 - 여백 정리가 지워 버리지 않는 유일한 방법이다.
        -->
        <template v-for="(part, index) in cell.parts" :key="index"
          ><span class="inline-block"
            >{{ part.head }}<span v-if="part.term" class="inline-block">{{ part.term }}</span
            >{{ part.tail }}</span
          >{{ index < cell.parts.length - 1 ? ' ' : '' }}</template
        >
      </button>
    </div>

    <!-- 이유 없이 회색이면 학생은 고장으로 본다. 누른 칸의 사유가 여기 뜬다. -->
    <p v-if="reason" role="status" class="mt-1.5 text-caution">{{ reason }}</p>
  </div>
</template>
