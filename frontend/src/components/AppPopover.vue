<script setup lang="ts">
/**
 * 누른 버튼 **바로 아래에 붙어서 열리는 패널**.
 *
 * macOS 상태바 메뉴, IntelliJ 툴바 팝오버, Canva의 공유→다운로드가 이 모양이다.
 * 모달이 아니다 — 화면을 가리지 않고, 어디서 나왔는지가 눈에 보이고, 바깥을 누르면
 * 그냥 닫힌다.
 *
 * **브라우저의 `popover` 속성을 쓰지 않는다.** 그건 요소를 최상위 층으로 올려서
 * 조상 기준의 위치 잡기가 통하지 않고, 결국 화면 한가운데 뜨는 상자가 된다 —
 * 그게 모달이다. 트리거에 붙이는 것이 이 컴포넌트의 존재 이유이므로 평범한
 * `absolute`로 둔다.
 *
 * CSS 앵커 위치 지정(`anchor-name`)을 쓰지 않은 이유는 파이어폭스와 사파리가 아직
 * 모르기 때문이다. 학교 PC의 브라우저를 우리가 고를 수 없다.
 *
 * 바깥 클릭과 Esc는 여기서 한 번만 처리한다. 쓰는 쪽마다 다시 짜면 어딘가는 빠진다.
 */

import { onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 패널이 트리거의 어느 쪽 끝에 맞춰 열리는가. */
    align?: 'left' | 'right'
  }>(),
  { align: 'left' },
)

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function close(): void {
  open.value = false
}

function onPointerDown(event: MouseEvent): void {
  // 패널 안이나 트리거를 누른 것은 바깥이 아니다.
  if (!root.value?.contains(event.target as Node)) close()
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') close()
}

// 열려 있는 동안만 문서를 듣는다. 닫힌 팝오버가 이벤트를 붙들고 있을 이유가 없다.
watch(open, (isOpen) => {
  const method = isOpen ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', onPointerDown as EventListener)
  document[method]('keydown', onKeydown as EventListener)
})

// 라우트가 바뀌며 열린 채로 사라질 수 있다. 리스너가 남으면 다음 클릭이 이상해진다.
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown as EventListener)
  document.removeEventListener('keydown', onKeydown as EventListener)
})

defineExpose({ close })
</script>

<template>
  <div ref="root" class="relative">
    <!-- 트리거. 여는 것은 이 컴포넌트가 쥔다. -->
    <div @click="open = !open">
      <slot name="trigger" :open="open" />
    </div>

    <div
      v-if="open"
      class="absolute top-full z-50 mt-1 w-80 rounded-panel border border-line bg-surface p-4 text-ink shadow-pop"
      :class="props.align === 'right' ? 'right-0' : 'left-0'"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
