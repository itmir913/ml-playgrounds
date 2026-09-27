<script setup lang="ts">
/**
 * **꾸밈 없는 버튼** — `AppButton`의 변종이 아닌 자리(도구 격자·쪽 넘기기 화살표·순서 옮기기·
 * 레일 칸·필터 칩)의 기본 부품이다 (`@/locks`의 `LOCK_PRIMITIVES`, 결정문 65).
 *
 * **모양은 부르는 쪽의 `class`가 정한다.** 이 부품이 정하는 것은 잠겼을 때뿐이다 — 잠금 모양은
 * 잠금 낱말(`cursor-not-allowed` 등)이라 화면 파일에 둘 수 없다. 잠긴 동안 부르는 쪽은 자기 색을
 * 비워 두고(`isLocked`) 아래 `look`이 칠한다.
 *
 * **두 가지로 잠근다.**
 * - 기본: `disabled`. 눌리지 않는다.
 * - `announce`: 보이게 두되 누를 수 없다고 알리고(`aria-disabled`) **누르면 `refused`를 낸다.**
 *   부르는 쪽이 그 자리에 이유를 세운다 — `title`은 마우스를 올려야 보이고 휴대폰에는 올릴
 *   마우스가 없다 (결정문 65 "터치에서도 이유가 보인다"). 차트 도구와 단계 레일이 이것이다.
 *
 * `click`은 **잠기지 않았을 때만** 낸다 — 그래서 `emits`로 받는다(그냥 두면 리스너가 버튼에
 * 그대로 붙어 잠긴 채로도 불린다).
 */

import { computed } from 'vue'

import { forwardAttrs, isLocked, lockReasons, type Lock } from '@/locks'

/**
 * **넘겨받은 속성을 뿌리에 흘리지 않는다** (결정문 65 "구조 뒤 감사에서 더한 것", `@/locks`의
 * `forwardAttrs`). 흘리면 화면이 이 부품의 이름으로 잠금을 걸 수 있다.
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** 잠금. **`@/locks`만 만든다.** 이 파일이 낸 값이 아니면 그리는 순간 던진다. */
    lock?: Lock | undefined
    /** 잠겨도 누를 수 있게 두고, 누르면 `refused`를 낸다. */
    announce?: boolean
    type?: 'button' | 'submit'
    /**
     * 잠겼을 때의 모양. **이름으로 고른다** — 값은 아래 표에 있다.
     *
     * - `fade` 흐리게. `AppButton`과 같은 모양이다.
     * - `sunken` 가라앉은 면. 격자 안의 도구 칸(`AppChoices`의 꺼진 칸과 같은 뜻).
     * - `faint` 흐린 글자만. 레일 칸처럼 면이 없는 자리.
     */
    look?: 'fade' | 'sunken' | 'faint'
  }>(),
  { lock: undefined, announce: false, type: 'button', look: 'fade' },
)

const emit = defineEmits<{
  click: [event: MouseEvent]
  /** 잠긴 채 눌렸다(`announce`에서만). 이유 코드를 함께 준다. */
  refused: [reasons: readonly string[]]
}>()

const locked = computed(() => isLocked(props.lock))

/** 잠긴 모양. **테두리 두께는 안 바꾼다** — 색만 바뀐다(칸이 움직이지 않게). */
const LOOKS: Readonly<Record<NonNullable<typeof props.look>, string>> = {
  fade: 'pointer-events-none opacity-45',
  sunken: 'cursor-not-allowed border-line bg-surface-sunken text-ink-soft',
  faint: 'cursor-not-allowed text-ink-faint',
}

function press(event: MouseEvent): void {
  if (locked.value) {
    emit('refused', lockReasons(props.lock))
    return
  }
  emit('click', event)
}
</script>

<template>
  <button
    v-bind="forwardAttrs($attrs)"
    :type="props.type"
    :disabled="locked && !props.announce"
    :aria-disabled="props.announce ? locked : undefined"
    :class="locked ? LOOKS[props.look] : ''"
    @click="press"
  >
    <slot />
  </button>
</template>
