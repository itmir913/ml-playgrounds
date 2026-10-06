/**
 * 그리기 창의 **브라우저 접착** (`SketchDialog.vue`, open-decisions.md 67). 캔버스를 만들고 2D
 * 컨텍스트를 꺼내고, 그린 것을 미리보기 주소로 담고, 다시 그리기를 다음 화면 갱신으로 미룬다.
 *
 * **규칙은 여기 없다** — 획 모델·좌표 변환·다시 그리기·PNG 내보내기는 `data/image/sketch.ts`의 순수
 * 함수다. 여기는 그 함수들이 받는 브라우저 객체만 만든다. jsdom에는 캔버스가 없어 검사는 이 모듈을
 * 통째로 갈아끼운다(`sketch-dialog.spec.ts`). 그래서 **이 파일의 동작은 사람 확인이다** — 획이 보이는가,
 * 내보낸 PNG가 열리는가(합격 조건, `workflow.md` §12의 마지막 줄).
 */

import type { SketchCanvas, SketchContext } from '@/data/image/sketch'

/** 화면 캔버스의 2D 컨텍스트. 못 얻으면 `null`이다 — 그때 창은 그리지 못할 뿐 던지지 않는다. */
export function contextOf(canvas: HTMLCanvasElement): SketchContext | null {
  return canvas.getContext('2d')
}

/**
 * 화면 캔버스에 지금 보이는 것을 미리보기 주소로. **형식을 주지 않는다** — 브라우저 기본(PNG)이고,
 * 이 주소는 창 안의 작은 칸에만 쓴다. 내보내는 파일은 `sketchToFile`이 따로 만든다.
 */
export function snapshotOf(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL()
}

/** 내보낼 때 쓰는 새 캔버스 (`sketchToFile`의 `createCanvas`). 화면 밖에서만 산다. */
export function createSketchCanvas(size: number): SketchCanvas {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('sketch export needs a 2d canvas context')
  return {
    context,
    toBlob: (type) =>
      new Promise((resolve) => {
        canvas.toBlob(resolve, type)
      }),
  }
}

/** 다음 화면 갱신에 한 번 부른다. 돌려준 함수로 거둔다. */
export function onNextFrame(callback: () => void): () => void {
  const id = requestAnimationFrame(callback)
  return () => {
    cancelAnimationFrame(id)
  }
}
