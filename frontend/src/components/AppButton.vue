<script setup lang="ts">
/**
 * 버튼.
 *
 * **일반적인 웹보다 굵고 크다.** 취향이 아니라 대상 때문이다 — 중고등학교 컴퓨터실의
 * 낮은 해상도 모니터와 휴대폰에서 학생이 눌러야 하는 것들이다.
 *
 * **고정 너비를 주지 않는다** (CLAUDE.md §3 규칙 7). 같은 문장이 영어에서 30% 정도
 * 길어서, 폭을 박으면 그 자리는 한국어에서만 맞는다. 여백으로만 키운다.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'lg'

withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: 'button' | 'submit'
    disabled?: boolean
    /** 아이콘만 있는 버튼에 준다. 읽을 이름이 없으면 스크린리더가 읽을 것이 없다. */
    label?: string | undefined
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false, label: undefined },
)

/** `if`로 고르지 않는다. 변종을 늘리는 일이 표에 줄 하나 넣는 일이어야 한다. */
const VARIANTS: Readonly<Record<Variant, string>> = {
  primary: 'bg-brand text-ink-invert shadow-card hover:bg-brand-strong',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-danger text-ink-invert shadow-card hover:brightness-95',
}

const SIZES: Readonly<Record<Size, string>> = {
  md: 'px-4 py-2.5 text-base',
  lg: 'px-6 py-3.5 text-lg',
}
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    :aria-label="label"
    class="inline-flex items-center justify-center gap-2 rounded-control font-bold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-45"
    :class="[VARIANTS[variant], SIZES[size]]"
  >
    <slot />
  </button>
</template>
