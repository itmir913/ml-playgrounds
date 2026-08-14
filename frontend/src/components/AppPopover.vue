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
 *
 * **넘칠 때는 잘리는 대신 스크롤한다.** 자리를 고른 뒤 **그쪽에 남은 만큼**을 천장으로
 * 걸어 준다(`--popover-room`) — 뒤집기는 더 넓은 쪽으로 옮기는 것이지 들어간다는
 * 보장이 아니라서, 둘 다 모자란 화면에서는 이 천장만이 잘림을 막는다.
 *
 * **한 번 재고 끝내지 않는다.** 안의 것이 나중에 채워지는 패널이 있다 — 군집 대표 사진은
 * 상자가 먼저 서고 그다음 찾는다. 열 때 잰 높이로 붙여 두면 **사진이 들어오면서 자란
 * 만큼 화면 위로 빠져나간다**(2026-08-14, 사용자가 겪었다). 그래서 크기가 바뀌면 다시
 * 잰다.
 */

import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

import { prefersTop } from '@/screen'

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
     * 패널의 폭. **숫자가 아니라 정해진 셋 중 하나다.**
     *
     * **폭을 px로 받지 않는다.** 자리마다 다른 숫자를 넘기기 시작하면 "화면 밖으로 안
     * 나간다"는 규칙(`popover-panel`의 max-width)을 자리마다 다시 지켜야 한다. 여기서
     * 고르는 것은 **이름**이고, 값은 `styles/utilities.css`가 갖는다.
     *
     * **불리언이었다가 셋이 되면서 이름이 바뀌었다** — `wide`는 "넓게"였지 "얼마나"가
     * 아니라서, 셋째가 생기는 순간 `wide && !medium` 같은 조합이 생길 자리였다.
     *
     * **어느 것도 높이를 안 정한다.** 높이를 박으면 그 안의 내용이 눌려서 읽으려면
     * 굴려야 하는 상자가 된다 — 사진 격자에서 실제로 그랬다 (2026-08-14).
     */
    size?: 'default' | 'medium' | 'wide' | 'photos'
  }>(),
  { align: 'left', side: 'bottom', size: 'default' },
)

/** 이름 -> 폭 유틸리티. 기본은 `popover-panel`이 이미 갖고 있어 더할 것이 없다. */
const WIDTHS: Readonly<Record<NonNullable<typeof props.size>, string>> = {
  default: '',
  medium: 'popover-panel-medium',
  wide: 'popover-panel-wide',
  photos: 'popover-panel-photos',
}

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const panel = ref<HTMLElement | null>(null)

/**
 * 패널이 자라는 것을 본다. **`place()`는 자리만 바꾸고 크기는 안 바꾸므로** 다시 재는
 * 것이 또 다른 크기 변화를 부르지 않는다.
 *
 * 없으면 첫 값만 쓴다 — jsdom에 그것이 없어서, 안 막으면 이 컴포넌트에 닿는 스펙이
 * 전부 죽는다 (`StepActionBar`와 같은 사정).
 */
let growth: ResizeObserver | null = null

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

  // **첫 자리잡기에서만 화면 밖에 숨긴다.** 이미 서 있는 패널을 숨겼다 옮기면 그
  // 깜빡임이 그대로 보인다 — 자란 만큼 다시 잴 때가 그 경우다.
  if (Object.keys(style.value).length === 0) {
    style.value = { top: '-9999px', left: '-9999px' }
    await nextTick()
  }

  const rect = panel.value?.getBoundingClientRect()
  if (!rect) return

  // **안 들어갈 때만 반대쪽으로 뒤집는다.** 표 머리글은 위로 열지만(§8.13 - 아래는 전부
  // 값이라 가리면 안 된다) 그 표가 화면 맨 위에 있으면 위쪽에 자리가 없다. 판정은
  // 순수 함수가 한다 (`screen.ts`의 `prefersTop`) — **둘 다 모자라면 요청한 쪽으로
  // 돌아오는 이유**가 거기 적혀 있다.
  const above = trigger.top - GAP - EDGE
  const below = window.innerHeight - trigger.bottom - GAP - EDGE
  const wanted = props.side === 'top'
  const useTop = prefersTop({ above, below, height: rect.height, wantsTop: wanted })

  const vertical = useTop
    ? { bottom: `${window.innerHeight - trigger.top + GAP}px` }
    : { top: `${trigger.bottom + GAP}px` }

  /**
   * **고른 쪽에 남은 자리가 곧 천장이다** (`popover-panel`의 `--popover-room`).
   *
   * 뒤집기만으로는 모자란다 — 그건 "더 넓은 쪽으로 옮긴다"이지 "들어간다"가 아니다.
   * 둘 다 모자라면 어느 쪽으로 가도 넘치고, 그때 **넘치는 대신 그 안에서 스크롤해야**
   * 한다. 잘린 머리는 아무도 되돌릴 수 없지만 스크롤은 학생이 굴리면 된다.
   */
  const room = Math.max(0, useTop ? above : below)

  const start = props.align === 'right' ? trigger.right - rect.width : trigger.left
  // 가로도 모자란 만큼만 민다. 들어가는 팝오버는 정렬 그대로다.
  const left = Math.min(
    Math.max(start, EDGE),
    Math.max(EDGE, window.innerWidth - EDGE - rect.width),
  )

  style.value = { ...vertical, left: `${left}px`, '--popover-room': `${room}px` }
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

/**
 * 스크롤하면 닫는다 — **다만 패널 자신이 스크롤한 것은 아니다.**
 *
 * 닫는 이유는 붙어 있던 자리가 움직이기 때문인데(위 주석), **패널 안을 굴리는 것은 그
 * 자리를 안 움직인다.** 캡처로 듣느라 패널 안의 스크롤까지 여기로 오는 바람에, 내용이
 * 넘치는 팝오버는 **읽으려고 굴리는 순간 닫혔다** (2026-08-14, 군집 대표 사진에서
 * 사용자가 겪었다).
 *
 * **상자를 키워서 넘어가는 문제가 아니다.** 내용이 넘칠 수 있는 것은 이미 정해져 있고
 * (`popover-panel`이 `overflow-y: auto`와 `max-height`를 갖는다), 화면이 작으면 어떤
 * 크기로도 넘친다.
 */
function onScroll(event: Event): void {
  if (panel.value?.contains(event.target as Node)) return
  close()
}

// 열려 있는 동안만 문서를 듣는다. 닫힌 팝오버가 이벤트를 붙들고 있을 이유가 없다.
// 화면 크기가 바뀌면 다시 잰다 - 가로로 눕히는 동안 열려 있을 수 있다.
/** 패널이 자라면 다시 잰다. 닫히면 놓아준다. */
async function watchGrowth(): Promise<void> {
  await place()
  const el = panel.value
  if (!el || typeof ResizeObserver === 'undefined') return
  growth = new ResizeObserver(() => void place())
  growth.observe(el)
}

function stopGrowth(): void {
  growth?.disconnect()
  growth = null
  // **다음에 열 때는 다시 숨기고 잰다.** 남겨 두면 옛 자리에 한 프레임 나타난다.
  style.value = {}
}

watch(open, (isOpen) => {
  const method = isOpen ? 'addEventListener' : 'removeEventListener'
  document[method]('pointerdown', onPointerDown as EventListener)
  document[method]('keydown', onKeydown as EventListener)
  window[method]('resize', place as EventListener)
  // 캡처로 듣는다 - 표나 작업 공간처럼 **안쪽 상자가 스크롤할 때는 이벤트가 안 올라온다.**
  document[method]('scroll', onScroll as EventListener, true)
  if (isOpen) void watchGrowth()
  else stopGrowth()
})

// 라우트가 바뀌며 열린 채로 사라질 수 있다. 리스너가 남으면 다음 클릭이 이상해진다.
onBeforeUnmount(() => {
  stopGrowth()
  document.removeEventListener('pointerdown', onPointerDown as EventListener)
  document.removeEventListener('keydown', onKeydown as EventListener)
  document.removeEventListener('scroll', onScroll as EventListener, true)
  window.removeEventListener('resize', place as EventListener)
})

defineExpose({ close })
</script>

<template>
  <div ref="root" class="relative">
    <!--
      트리거. 여는 것은 이 컴포넌트가 쥔다.

      **격자다.** 안에 든 단추가 이 칸의 너비를 그대로 받게 하려는 것이다 - 격자 칸의
      아이는 기본으로 늘어나므로, 맨 `AppButton`을 놓았을 때와 팝오버를 놓았을 때가
      같아진다. 안 그러면 나란히 세운 둘의 폭이 갈린다 (architecture.md §8.19,
      2026-08-15에 시작 화면에서 실제로 그랬다).

      **줄 안에 설 때는 아무 일도 안 일어난다** - 그 자리에서는 이 상자가 내용 너비라
      늘어날 자리가 없다.
    -->
    <div class="grid" @click="open = !open">
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
        :class="WIDTHS[props.size]"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </div>
</template>
