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
 *
 * **모든 팝오버가 휴대폰에서도 열린다고 전제한다.** 크기는 `popover-panel`이 화면에
 * 매어 두므로(styles/utilities.css) 폭도 높이도 화면을 넘지 않는다.
 *
 * **크기만으로는 부족하다.** 트리거가 화면 가장자리에 없으면 정렬만으로 밀려난다 —
 * 요약 버튼은 내보내기 버튼 왼쪽에 있어서, 320px에서 오른쪽 끝을 맞추면 패널 왼쪽이
 * 화면 밖 44px로 나갔다. 그래서 연 뒤에 재서 **화면 안으로 밀어 넣는다.**
 *
 * 정렬을 대신하는 것이 아니라 **모자란 만큼만 민다.** 들어가는 팝오버는 한 픽셀도
 * 안 움직이므로 "트리거에 붙어 있다"는 성질이 그대로 남는다.
 */

import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 패널이 트리거의 어느 쪽 끝에 맞춰 열리는가. */
    align?: 'left' | 'right'
    /**
     * 트리거의 위로 열리는가 아래로 열리는가.
     *
     * 화면 맨 아래에 있는 트리거(상태 표시줄)는 아래로 열면 패널이 화면 밖으로 나간다.
     */
    side?: 'top' | 'bottom'
  }>(),
  { align: 'left', side: 'bottom' },
)

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

/** 화면 가장자리에서 띄울 간격. `styles/utilities.css`의 `popover-panel` 여백과 같다. */
const EDGE = 12

/** 화면 밖으로 나간 만큼만 되민 거리(px). 0이면 정렬 그대로다. */
const shift = ref(0)

/**
 * 열린 패널을 화면 안으로 들인다.
 *
 * **먼저 0으로 되돌리고 잰다.** 지난번에 민 값을 안고 재면 그만큼 어긋난 자리를
 * 재게 되고, 열고 닫을 때마다 조금씩 밀려난다.
 */
async function place(): Promise<void> {
  shift.value = 0
  await nextTick()
  const rect = panel.value?.getBoundingClientRect()
  if (!rect) return

  if (rect.left < EDGE) shift.value = EDGE - rect.left
  else if (rect.right > window.innerWidth - EDGE) {
    shift.value = window.innerWidth - EDGE - rect.right
  }
}

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
// 화면 크기가 바뀌면 다시 잰다 - 가로로 눕히는 동안 열려 있을 수 있다.
watch(open, (isOpen) => {
  const method = isOpen ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', onPointerDown as EventListener)
  document[method]('keydown', onKeydown as EventListener)
  window[method]('resize', place as EventListener)
  if (isOpen) void place()
})

// 라우트가 바뀌며 열린 채로 사라질 수 있다. 리스너가 남으면 다음 클릭이 이상해진다.
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown as EventListener)
  document.removeEventListener('keydown', onKeydown as EventListener)
  window.removeEventListener('resize', place as EventListener)
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
      ref="panel"
      :style="{ transform: `translateX(${shift}px)` }"
      class="popover-panel absolute z-50 rounded-panel border border-line bg-surface p-4 text-ink shadow-pop"
      :class="[
        props.align === 'right' ? 'right-0' : 'left-0',
        props.side === 'top' ? 'bottom-full mb-1' : 'top-full mt-1',
      ]"
    >
      <slot :close="close" />
    </div>
  </div>
</template>
