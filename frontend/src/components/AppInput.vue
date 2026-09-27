<script setup lang="ts">
/**
 * **꾸밈 없는 입력 칸** — 체크박스·라디오·숫자·글자 칸 중 **잠길 수 있는 것**의 기본 부품이다
 * (`@/locks`의 `LOCK_PRIMITIVES`, 결정문 65). 잠기지 않는 칸은 그냥 `<input>`으로 둔다.
 *
 * **그 밖의 속성은 전부 그대로 건넌다** — `type`·`:checked`·`:value`·`@change`·`class`가 아래
 * `<input>`에 붙는다(Vue의 속성 전달). `v-model`은 쓰지 않는다 — 부품에 걸면 `modelValue`가 속성으로
 * 새어 칸에 박힌다. 잠길 수 있는 칸은 지금도 전부 `:checked`/`:value` + `@change`다.
 *
 * **두 가지로 잠근다.**
 * - 기본: `disabled`.
 * - `readable`: `readonly`. **읽으라고 두는 값**이다 — `disabled`는 글자가 흐려져 안 읽힌다
 *   (architecture.md §8.9.1.1). 잠긴 모양은 바꾸지 않는다(결정문 56 "현행 유지").
 */

import { computed } from 'vue'

import { isLocked, type Lock } from '@/locks'

const props = withDefaults(
  defineProps<{
    /** 잠금. **`@/locks`만 만든다.** 이 파일이 낸 값이 아니면 그리는 순간 던진다. */
    lock?: Lock | undefined
    /** 잠겨도 값을 읽을 수 있게 둔다(`readonly`). 체크박스·라디오에는 뜻이 없다. */
    readable?: boolean
  }>(),
  { lock: undefined, readable: false },
)

const locked = computed(() => isLocked(props.lock))
</script>

<template>
  <input :disabled="locked && !props.readable" :readonly="locked && props.readable" />
</template>
