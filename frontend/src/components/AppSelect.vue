<script setup lang="ts">
/**
 * **꾸밈 없는 목록 칸** — 잠길 수 있는 `<select>`의 기본 부품이다 (`@/locks`의 `LOCK_PRIMITIVES`,
 * 결정문 65). 선택지는 슬롯으로 받고, 그 밖의 속성은 허락된 것만(`@/locks`의 `forwardAttrs`) 아래 `<select>`에 건넌다.
 *
 * **안내 줄(`placeholder`)은 이 부품이 잠근다.** 고른 것이 아니라 명령인 목록(예: "옮길 범주")에서
 * 처음 줄은 안내 글이지 범주가 아니라, 다시 고를 수 없어야 한다. 그 잠금에는 조건이 없어서 화면
 * 파일이 아니라 여기 산다.
 */

import { computed } from 'vue'

import { forwardAttrs, isLocked, type Lock } from '@/locks'

/**
 * **넘겨받은 속성을 뿌리에 흘리지 않는다** (결정문 65 "구조 뒤 감사에서 더한 것", `@/locks`의
 * `forwardAttrs`). 흘리면 화면이 이 부품의 이름으로 잠금을 걸 수 있다.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** 잠금. **`@/locks`만 만든다.** 이 파일이 낸 값이 아니면 그리는 순간 던진다. */
    lock?: Lock | undefined
    /** 맨 위의 안내 줄. 있으면 처음에 골라져 있고 다시 고를 수 없다. */
    placeholder?: string | undefined
  }>(),
  { lock: undefined, placeholder: undefined },
)

const locked = computed(() => isLocked(props.lock))
</script>

<template>
  <select v-bind="forwardAttrs($attrs)" :disabled="locked">
    <option v-if="props.placeholder !== undefined" value="" selected disabled>
      {{ props.placeholder }}
    </option>
    <slot />
  </select>
</template>
