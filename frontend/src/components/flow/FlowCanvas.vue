<script setup lang="ts">
/**
 * **흐름도 창의 판** — 그림 하나를 확대·이동하며 보는 자리다 (`architecture.md` §8.22).
 *
 * 눈금 계산은 전부 `ml/flow-zoom.ts`가 한다. 이 부품은 이벤트에서 숫자를 뽑아 넘기고, 돌려받은 눈금을
 * 변환으로 걸 뿐이다. **노드를 끌어 옮기지 않는다** — 움직이는 것은 판 전체뿐이다.
 *
 * - **휠**은 커서 밑을 붙든 확대, **끌기**는 이동, **두 손가락**은 핀치다. 판 위에서 화면이 스크롤되거나 확대되지
 *   않게 `touch-none`이다.
 * - **끌기가 끝난 뒤의 누름은 삼킨다.** 끌다 놓은 자리의 단추가 눌리면 강조가 고정되어 버린다(포인터 캡처를 안
 *   쓰는 까닭이다 — 캡처하면 단추의 `click`이 판으로 간다).
 * - **초점이 화면 밖 단추로 가도 스크롤하지 않는다.** 브라우저가 자르는 상자를 굴리면 판이 어긋나므로, 스크롤은
 *   되돌리고 눈금을 옮겨 단추를 화면 안으로 들인다.
 * - 첫 화면은 `initialView`다 — 담기는 배율이 1보다 작으면 줄이지 않고 배율 1로 데이터 카드의 왼쪽 위에서
 *   시작한다(줄이면 글자가 가장 작은 글자 규칙을 깬다). 학생이 만지기 전에는 창이 바뀌면 다시 잡는다.
 * - [전체 보기]는 학생이 고른 것이라 1보다 작아도 된다.
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import FlowDiagram from '@/components/flow/FlowDiagram.vue'
import AppPlainButton from '@/components/AppPlainButton.vue'
import { useElementSize } from '@/composables/useElementSize'
import { useFormat } from '@/composables/useFormat'
import { ACTION_ICONS } from '@/icons'
import type { FlowCounts } from '@/ml/flow-counts'
import { FLOW_GEOMETRY, type FlowBarValues } from '@/ml/flow-layout'
import {
  fit,
  initialView,
  isDrag,
  pan,
  pinchView,
  stepZoom,
  wheelZoom,
  type Pinch,
  type Point,
  type View,
} from '@/ml/flow-zoom'
import type { ProjectFile } from '@/project/format'

defineProps<{
  file: ProjectFile
  counts: FlowCounts | null
  bars: FlowBarValues | null
}>()

/** 고정한 강조. `Esc`를 받는 창이 풀 수 있게 모델로 연다. */
const pinned = defineModel<string | null>('pinned', { default: null })

const { t } = useI18n()
const format = useFormat()
const G = FLOW_GEOMETRY

const viewport = ref<HTMLElement | null>(null)
const plane = ref<HTMLElement | null>(null)
const bar = ref<HTMLElement | null>(null)
const viewportSize = useElementSize(viewport)
const planeSize = useElementSize(plane)
const barSize = useElementSize(bar)

const view = ref<View>({ k: 1, x: 0, y: 0 })
/** 학생이 판을 만졌는가. 만지기 전에는 창이 바뀔 때 첫 화면을 다시 잡는다. */
let moved = false
const grabbing = ref(false)

const viewportBox = computed(() => ({ w: viewportSize.value.width, h: viewportSize.value.height }))
const planeBox = computed(() => ({ w: planeSize.value.width, h: planeSize.value.height }))

/**
 * 확대 막대가 데이터 카드의 위를 덮는 폭인가. 그러면 판을 막대 높이만큼 내려 시작한다. 막대는 오른쪽 위에
 * 붙어 있어 폭이 넓으면 카드와 겹치지 않는다.
 */
const topInset = computed(() => {
  const overlaps =
    viewportSize.value.width < G.cardX + G.cardW + barSize.value.width + G.startMargin * 2
  return overlaps ? barSize.value.height + G.startMargin : 0
})

/**
 * 첫 화면이 한 번 잡혔는가. 창이 열리는 순간 `showModal()`이 첫 단추에 초점을 한 번 주는데, 그때는 판이 아직
 * 원점이라 `reveal`이 그 초점을 따라 판을 옮기면 좁은 폭에서 데이터 카드가 화면 밖으로 밀린 채 열린다
 * (감사 실측, 375·500 폭). 첫 화면이 잡히기 전의 초점은 `reveal`이 무시한다.
 */
let settled = false

function settle(): void {
  // 창이 닫혀 판의 폭이 0이 되면 다음에 열릴 때 첫 화면을 다시 잡아야 한다.
  if (viewportBox.value.w === 0) settled = false
  if (moved || viewportBox.value.w === 0 || planeBox.value.w === 0) return
  view.value = initialView(viewportBox.value, planeBox.value, topInset.value)
  settled = true
}

watch([viewportBox, planeBox, topInset], settle, { immediate: true, flush: 'post' })

const transform = computed(
  () => `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.k})`,
)

function touch(next: View): void {
  moved = true
  view.value = next
}

function local(event: { clientX: number; clientY: number }): Point {
  const rect = viewport.value?.getBoundingClientRect()
  return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }
}

// ------------------------------------------------------------------ 단추와 휠

const zoomIn = (): void => touch(stepZoom(view.value, viewportBox.value, 'in'))
const zoomOut = (): void => touch(stepZoom(view.value, viewportBox.value, 'out'))
function fitAll(): void {
  view.value = fit(viewportBox.value, planeBox.value)
  moved = false
}

function onWheel(event: WheelEvent): void {
  touch(wheelZoom(view.value, local(event), event.deltaY))
}

// ------------------------------------------------------------------ 끌기와 핀치

const pointers = new Map<number, Point>()
let gesture: { pinch: Pinch; travel: number } | null = null
/** 끌었는가. 이 동안과 놓은 직후의 `click`을 삼킨다. */
let dragged = false

function summary(): { center: Point; distance: number } {
  const points = [...pointers.values()]
  const center = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
  const [a, b] = points
  const distance = a !== undefined && b !== undefined ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  return { center, distance }
}

function beginGesture(): void {
  gesture = { pinch: { view: view.value, ...summary() }, travel: 0 }
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target
  if (target instanceof Node && bar.value?.contains(target) === true) return
  pointers.set(event.pointerId, local(event))
  beginGesture()
  dragged = false
  grabbing.value = true
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerEnd)
  window.addEventListener('pointercancel', onPointerEnd)
}

function onPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId) || gesture === null) return
  pointers.set(event.pointerId, local(event))
  const now = summary()
  const start = gesture.pinch
  gesture = {
    pinch: start,
    travel: Math.max(
      gesture.travel,
      Math.hypot(now.center.x - start.center.x, now.center.y - start.center.y),
    ),
  }
  if (pointers.size > 1) {
    dragged = true
    touch(pinchView(start, now))
  } else if (isDrag(gesture.travel)) {
    dragged = true
    touch(pan(start.view, now.center.x - start.center.x, now.center.y - start.center.y))
  }
}

function stopListening(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerEnd)
  window.removeEventListener('pointercancel', onPointerEnd)
}

function onPointerEnd(event: PointerEvent): void {
  if (!pointers.delete(event.pointerId)) return
  if (pointers.size > 0) {
    // 손가락이 하나 남았다. 지금 눈금에서 새로 시작한다 — 남은 손가락이 튀지 않게.
    beginGesture()
    dragged = true
    return
  }
  gesture = null
  grabbing.value = false
  stopListening()
  // `click`은 놓은 직후 같은 작업 안에서 온다 — 마이크로태스크로는 그 전에 풀려 버린다. 다음 프레임에 풀어야
  // 그 `click`을 삼킨다(시간을 숫자로 적지 않는다, `limits-rules.spec.ts`).
  requestAnimationFrame(() => {
    dragged = false
  })
}

onBeforeUnmount(stopListening)

/** 끌다 놓은 자리의 단추가 눌리지 않게 한다. */
function swallowClick(event: MouseEvent): void {
  if (!dragged) return
  event.stopPropagation()
  event.preventDefault()
}

// ------------------------------------------------------------------ 초점

/** 브라우저가 초점을 따라 자르는 상자를 굴린다. 되돌리고 눈금을 옮긴다. */
function keepScrollAtOrigin(): void {
  const element = viewport.value
  if (element === null) return
  element.scrollLeft = 0
  element.scrollTop = 0
}

/** 키보드로 온 초점인가. 판정을 못 하는 환경에서는 아니라고 본다. */
function isKeyboardFocus(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return false
  }
}

/** 판의 빈 곳(그림 밖 여백 포함)을 누르면 고정이 풀린다. 단추와 확대 막대는 제외다. */
function onBlank(event: MouseEvent): void {
  if (pinned.value === null) return
  const target = event.target
  if (!(target instanceof Node)) return
  if (bar.value?.contains(target) === true) return
  if (target instanceof Element && target.closest('button') !== null) return
  pinned.value = null
}

function reveal(event: FocusEvent): void {
  const target = event.target
  const frame = viewport.value
  if (!(target instanceof HTMLElement) || frame === null) return
  if (bar.value?.contains(target) === true) return
  keepScrollAtOrigin()
  if (!settled) return
  // 키보드 초점일 때만 판을 옮긴다. 창이 열리며 생기는 첫 초점이나 마우스로 누른 노드는 판을 건드리지 않는다.
  if (!isKeyboardFocus(target)) return
  const box = frame.getBoundingClientRect()
  const rect = target.getBoundingClientRect()
  const margin = G.fitPadding
  const top = margin + topInset.value
  let dx = 0
  let dy = 0
  if (rect.left < box.left + margin) dx = box.left + margin - rect.left
  else if (rect.right > box.right - margin) dx = box.right - margin - rect.right
  if (rect.top < box.top + top) dy = box.top + top - rect.top
  else if (rect.bottom > box.bottom - margin) dy = box.bottom - margin - rect.bottom
  if (dx !== 0 || dy !== 0) touch(pan(view.value, dx, dy))
}

const BUTTON =
  'flex items-center gap-1.5 rounded-control px-2.5 py-1.5 font-semibold text-ink hover:bg-surface-sunken'
</script>

<template>
  <div
    ref="viewport"
    role="group"
    :aria-label="t('flow.title')"
    class="relative min-h-0 flex-1 touch-none overflow-hidden rounded-card border border-line bg-surface-sunken select-none"
    :class="grabbing ? 'cursor-grabbing' : 'cursor-grab'"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @click.capture="swallowClick"
    @click="onBlank"
    @focusin="reveal"
    @scroll="keepScrollAtOrigin"
  >
    <div ref="plane" class="absolute top-0 left-0 origin-top-left" :style="{ transform }">
      <FlowDiagram v-model:pinned="pinned" :file="file" :counts="counts" :bars="bars" />
    </div>

    <!-- 확대 막대. 판 위에 떠 있고 끌기를 시작하지 않는다. -->
    <div
      ref="bar"
      class="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-control border border-line bg-surface p-1 shadow-card"
    >
      <AppPlainButton :class="BUTTON" :aria-label="t('flow.zoomOut')" @click="zoomOut">
        <component :is="ACTION_ICONS.zoomOut" :size="18" aria-hidden="true" />
      </AppPlainButton>
      <output class="min-w-14 text-center text-ink-soft">{{ format.percent(view.k) }}</output>
      <AppPlainButton :class="BUTTON" :aria-label="t('flow.zoomIn')" @click="zoomIn">
        <component :is="ACTION_ICONS.zoomIn" :size="18" aria-hidden="true" />
      </AppPlainButton>
      <AppPlainButton :class="BUTTON" :aria-label="t('flow.fit')" @click="fitAll">
        <component :is="ACTION_ICONS.fitAll" :size="18" aria-hidden="true" />
        <span class="max-sm:hidden">{{ t('flow.fit') }}</span>
      </AppPlainButton>
    </div>
  </div>
</template>
