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
 * 그게 모달이다. 트리거에 붙이는 것이 이 컴포넌트의 존재 이유다.
 *
 * **그래서 패널은 `body`로 옮겨 띄우되(`Teleport`) 자리는 우리가 잰다.** 조상 중 하나라도
 * `overflow`를 잘라내면 `absolute`는 그 상자 안에 갇힌다 — 표 머리글에서 용어 설명을 열자
 * (§8.13) `AppTable`의 스크롤 상자가 패널을 통째로 잘랐다. 트리거의 화면 좌표를 재서
 * `fixed`로 붙이므로 **"트리거에 붙어 있다"는 성질은 그대로이고 잘릴 조상만 사라진다.**
 *
 * **스크롤하면 닫는다.** 붙어 있던 자리가 움직이는데 패널만 떠 있으면 어디서 나온
 * 것인지 알 수 없다. 위치를 따라다니게 만들 수도 있지만, 팝오버는 읽고 닫는 물건이라
 * 그 복잡함을 살 이유가 없다.
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
    /**
     * 넓은 패널로 연다.
     *
     * **폭을 px로 받지 않는다.** 자리마다 다른 숫자를 넘기기 시작하면 "화면 밖으로 안
     * 나간다"는 규칙(`popover-panel`의 max-width)을 자리마다 다시 지켜야 한다. 여기서
     * 고르는 것은 숫자가 아니라 **둘 중 하나**이고, 값은 `styles/utilities.css`가 갖는다.
     */
    wide?: boolean
  }>(),
  { align: 'left', side: 'bottom', wide: false },
)

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

/** 화면 가장자리에서 띄울 간격. `styles/utilities.css`의 `popover-panel` 여백과 같다. */
const EDGE = 12

/** 트리거와 패널 사이. 붙어 있으면 떠 있는 패널이 아니라 줄이 늘어난 것으로 보인다. */
const GAP = 8

/** 패널의 화면 좌표. `body`로 옮겨 띄우므로 위치를 우리가 준다. */
const style = ref<Record<string, string>>({})

/**
 * 트리거를 재서 패널을 그 옆에 붙인다.
 *
 * **두 번에 걸쳐 잰다.** 패널의 폭과 높이는 열어 봐야 알 수 있고(내용과 `max-width`가
 * 정한다), 그 값을 알아야 화면 안으로 당기고 모자란 쪽을 뒤집을 수 있다. 첫 프레임에는
 * 화면 밖에 두어 **자리를 잡는 동안 눈에 안 보이게** 한다 - 왼쪽 끝에 잠깐 나타났다
 * 옮겨 가면 그 깜빡임이 보인다.
 */
async function place(): Promise<void> {
  const trigger = root.value?.getBoundingClientRect()
  if (!trigger) return

  style.value = { top: '-9999px', left: '-9999px' }
  await nextTick()

  const rect = panel.value?.getBoundingClientRect()
  if (!rect) return

  // **모자라면 반대쪽으로 뒤집는다.** 표 머리글은 위로 열지만(§8.13 - 아래는 전부 값이라
  // 가리면 안 된다) 그 표가 화면 맨 위에 있으면 위쪽에 자리가 없다. 요청한 쪽을 먼저
  // 보고, 안 들어갈 때만 더 넓은 쪽으로 옮긴다.
  const above = trigger.top - GAP - EDGE
  const below = window.innerHeight - trigger.bottom - GAP - EDGE
  const wanted = props.side === 'top'
  const useTop = (wanted ? above : below) >= rect.height ? wanted : above > below

  const vertical = useTop
    ? { bottom: `${window.innerHeight - trigger.top + GAP}px` }
    : { top: `${trigger.bottom + GAP}px` }

  const start = props.align === 'right' ? trigger.right - rect.width : trigger.left
  // 가로도 모자란 만큼만 민다. 들어가는 팝오버는 정렬 그대로다.
  const left = Math.min(
    Math.max(start, EDGE),
    Math.max(EDGE, window.innerWidth - EDGE - rect.width),
  )

  style.value = { ...vertical, left: `${left}px` }
}

function close(): void {
  open.value = false
}

function onPointerDown(event: MouseEvent): void {
  // 패널 안이나 트리거를 누른 것은 바깥이 아니다. **패널은 body에 있으므로 따로 본다** -
  // root만 보면 패널 안의 글자를 드래그해 고르는 순간 닫힌다.
  const target = event.target as Node
  if (root.value?.contains(target) || panel.value?.contains(target)) return
  close()
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
  // 캡처로 듣는다 - 표나 작업 공간처럼 **안쪽 상자가 스크롤할 때는 이벤트가 안 올라온다.**
  document[method]('scroll', close as EventListener, true)
  if (isOpen) void place()
})

// 라우트가 바뀌며 열린 채로 사라질 수 있다. 리스너가 남으면 다음 클릭이 이상해진다.
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown as EventListener)
  document.removeEventListener('keydown', onKeydown as EventListener)
  document.removeEventListener('scroll', close as EventListener, true)
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

    <!--
      **여는 자리와 떨어뜨린다.** 붙어 있으면 떠 있는 패널이 아니라 줄이 늘어난 것으로
      보인다. 상태 표시줄처럼 화면 끝에 붙은 자리에서 특히 그렇다.
    -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="panel"
        :style="style"
        class="popover-panel fixed z-50 rounded-panel border border-line bg-surface p-4 text-ink shadow-pop"
        :class="props.wide ? 'popover-panel-wide' : ''"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </div>
</template>
