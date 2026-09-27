<script setup lang="ts">
/**
 * **통째로 멈추는 구역** — 잠긴 동안 하위 전체를 못 누르게 하고 접근성 트리에서도 뺀다
 * (`inert`, `@/locks`의 `LOCK_PRIMITIVES`, 결정문 65). 흐리게 보여서 멈춘 것이 눈에도 보인다.
 *
 * 학습 화면의 모델 축이 이것이다 — 학습이 도는 동안 목록과 유형이 흔들리면 도는 줄과 화면의
 * 줄이 서로에 대해 거짓말을 하게 된다(`TrainView.vue`의 그 자리 주석).
 */

import { computed } from 'vue'

import { forwardAttrs, isLocked, type Lock } from '@/locks'

/**
 * **넘겨받은 속성을 뿌리에 흘리지 않는다** (결정문 65 "구조 뒤 감사에서 더한 것", `@/locks`의
 * `forwardAttrs`). 흘리면 화면이 이 부품의 이름으로 잠금을 걸 수 있다.
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** 잠금. **`@/locks`만 만든다.** 이 파일이 낸 값이 아니면 그리는 순간 던진다. */
  lock?: Lock | undefined
}>()

const locked = computed(() => isLocked(props.lock))
</script>

<template>
  <div v-bind="forwardAttrs($attrs)" :class="locked ? 'opacity-60' : ''" :inert="locked">
    <slot />
  </div>
</template>
