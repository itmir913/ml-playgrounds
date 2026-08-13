<script setup lang="ts">
/**
 * 버튼.
 *
 * **일반적인 웹보다 굵고 크다.** 취향이 아니라 대상 때문이다 — 중고등학교 컴퓨터실의
 * 낮은 해상도 모니터와 휴대폰에서 학생이 눌러야 하는 것들이다.
 *
 * **고정 너비를 주지 않는다** (docs/i18n.md 규칙 7). 같은 문장이 영어에서 30% 정도
 * 길어서, 폭을 박으면 그 자리는 한국어에서만 맞는다. 여백으로만 키운다.
 *
 * **오래 걸리는 일은 `@click`이 아니라 `action`으로 준다** (CLAUDE.md §4).
 * 그러면 버튼이 도는 동안 스스로 꺼져서 두 번 눌리지 않는다. 파일을 두 번 내려받거나
 * 같은 프로젝트를 두 번 만드는 것은 **학생이 느리다고 생각해서 한 번 더 누르는 순간
 * 실제로 일어난다.** `@click`으로는 그 보장을 할 수 없다 — 리스너의 반환값을 Vue가
 * 기다려 주지 않는다.
 */

import { computed, ref } from 'vue'

type Variant = 'primary' | 'secondary' | 'subtle' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit'
    disabled?: boolean
    /** 아이콘만 있는 버튼에 준다. 읽을 이름이 없으면 스크린리더가 읽을 것이 없다. */
    label?: string | undefined
    /**
     * 누르면 할 일. **끝날 때까지 버튼이 꺼진다.**
     *
     * 던져도 여기서 삼키지 않는다 — 실패를 다루는 것은 부르는 쪽의 일이다.
     * 다만 꺼진 상태는 어떤 경우에도 풀어 준다.
     */
    action?: (() => unknown | Promise<unknown>) | undefined
  }>(),
  {
    variant: 'primary',
    size: 'md',
    type: 'button',
    disabled: false,
    label: undefined,
    action: undefined,
  },
)

/** action이 도는 중인가. 이 동안 버튼은 꺼져 있다. */
const running = ref(false)

const blocked = computed(() => props.disabled || running.value)

async function run(): Promise<void> {
  if (props.action === undefined || blocked.value) return
  running.value = true
  try {
    await props.action()
  } finally {
    running.value = false
  }
}

/**
 * `if`로 고르지 않는다. 변종을 늘리는 일이 표에 줄 하나 넣는 일이어야 한다.
 *
 * **넷은 무게 순서다** — primary > secondary > subtle > ghost. 나란히 놓인 선택지의
 * 무게가 같으면 학생은 어느 것이 보통의 길인지 모른다. subtle이 있는 이유가 그것이다:
 * ghost는 글자처럼 보여서 버튼인 줄 모르고, secondary는 흰 면이라 그 위와 비중이 같다.
 *
 * **모든 변종이 테두리를 갖는다. 보이든 안 보이든.** 테두리가 있는 것만 2px 높으면
 * 나란히 세운 순간 줄이 어긋나고, 원인이 색이 아니라 상자라서 눈으로는 안 잡힌다.
 * 실제로 첫 화면의 버튼 셋이 64·66·69px이었다. 안 보여야 하는 자리는 `transparent`로
 * 두고 **자리는 언제나 차지한다** — 칸의 안쪽 폭이 상태에 따라 달라지면 안 된다는
 * 규칙(CLAUDE.md)의 변종 판이다. `tests/ui-rules.spec.ts`가 이 표를 검사한다.
 *
 * **ghost만 밑줄을 갖는다** (2026-08-13). 면도 테두리도 없어서 가만히 있을 때는 버튼인
 * 줄 모르고, hover로는 못 알린다 — 휴대폰에는 hover가 없다. 실선인 이유는 **점선이
 * 이미 다른 뜻이기 때문이다**: 점선 밑줄에 아이콘이 붙은 글자는 눌러도 아무 일이 안
 * 일어나고 설명만 펼쳐진다(`TermPopover`·`이유 보기`). 실선은 실제로 무언가를 한다.
 *
 * **두께는 1px로 못 박는다.** 굵은 글자에 기본값을 두면 브라우저가 2px을 그어서 줄이
 * 글자만큼 무거워진다 — 조용해야 하는 변종에서 그건 목적을 뒤집는다.
 *
 * **ghost는 나란한 선택지에 쓰지 마라.** 줄 안에서 눈에 안 띄어야 하는 것([빼기] 같은
 * 것)에만 쓴다. 대화상자의 [취소]처럼 **고르는 것 둘이 나란히 설 때 한쪽만 면이 없으면
 * 그건 버튼이 아니라 글자로 보인다.** 그 자리는 secondary다.
 */
const VARIANTS: Readonly<Record<Variant, string>> = {
  primary: 'border border-brand bg-brand text-ink-invert shadow-card hover:bg-brand-strong',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-sunken',
  subtle: 'border border-transparent bg-surface-sunken text-ink-soft hover:bg-line hover:text-ink',
  ghost:
    'border border-transparent text-ink-soft underline decoration-1 underline-offset-4 hover:bg-surface-sunken hover:text-ink',
  danger: 'border border-danger bg-danger text-ink-invert shadow-card hover:brightness-95',
}

const SIZES: Readonly<Record<Size, string>> = {
  md: 'px-4 py-2.5 text-base',
  lg: 'px-6 py-3.5 text-lg',
}
</script>

<template>
  <button
    :type="type"
    :disabled="blocked"
    :aria-label="label"
    :aria-busy="running"
    class="inline-flex items-center justify-center gap-2 rounded-control font-bold transition-colors disabled:pointer-events-none disabled:opacity-45"
    :class="[VARIANTS[variant], SIZES[size]]"
    @click="run"
  >
    <slot />
  </button>
</template>
