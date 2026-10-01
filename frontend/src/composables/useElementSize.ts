/**
 * 요소의 크기(CSS 픽셀)를 따라간다.
 *
 * **산점도가 점을 거르는 칸이 그림 영역의 픽셀이라서 있다** (`open-decisions.md` "94. 그림이
 * 드문 것을 숨기는가"). 데이터 공간의 고정 격자는 창 크기와 안 묶이지만, 큰 화면 기준으로
 * 잘게 잡으면 남는 점이 1.8만~5만 개로 불어났다. 그래서 창이 바뀌면 다시 거른다 — 10만 행에서
 * 다시 거르고 그리기까지 19ms다(개발 PC 브라우저).
 *
 * **마운트 전에는 0×0이다.** 부르는 쪽은 크기가 서기 전에 그리지 않는다.
 * `ResizeObserver`가 없으면(jsdom) 마운트할 때의 값만 쓴다.
 */

import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export interface ElementSize {
  readonly width: number
  readonly height: number
}

export function useElementSize(target: Ref<HTMLElement | null>): Ref<ElementSize> {
  const size = ref<ElementSize>({ width: 0, height: 0 })
  let observer: ResizeObserver | null = null

  function measure(el: HTMLElement): void {
    const next = { width: el.clientWidth, height: el.clientHeight }
    // 같은 크기로 다시 알리면 거르기가 헛돈다 — 창을 안 바꿔도 관찰자는 한 번 부른다.
    if (next.width !== size.value.width || next.height !== size.value.height) size.value = next
  }

  onMounted(() => {
    const el = target.value
    if (!el) return
    measure(el)
    if (typeof ResizeObserver === 'undefined') return
    observer = new ResizeObserver(() => measure(el))
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
  })

  return size
}
