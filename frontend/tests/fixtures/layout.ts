/**
 * jsdom에 없는 레이아웃의 대역.
 *
 * jsdom은 요소의 크기를 늘 0으로 준다. 산점도는 그림 영역의 픽셀로 점을 거르고 크기가 서기
 * 전에는 안 그리므로(`composables/useElementSize.ts`, `open-decisions.md` "94. 그림이 드문
 * 것을 숨기는가") 그림을 띄우는 검사는 **그림 영역 하나의 크기를 심어야** 그림이 선다.
 *
 * 되돌리는 것은 부르는 쪽의 `vi.restoreAllMocks()`다.
 */

import { vi } from 'vitest'

export function stubElementSize(width = 800, height = 500): void {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height)
}
