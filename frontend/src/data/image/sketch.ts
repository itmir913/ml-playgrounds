/**
 * 그리기의 규칙 (open-decisions.md 67). **순수 함수만 있다** — 캔버스와 포인터는 화면이 갖고,
 * 여기는 획 목록을 다루고 주입받은 2D 컨텍스트에 다시 그릴 뿐이다. jsdom에는 캔버스가 없어서
 * 그리는 함수도 컨텍스트를 받는다.
 *
 * **그리기는 파일을 만드는 것까지만 한다.** 크기 맞추기·흑백 반전·정본 형식은 굽는 워커의
 * 일이다(`bake.ts`). 여기서 나간 PNG는 파일로 고른 사진과 같은 길(`readPicked`)로 들어간다.
 *
 * **그림판 상태는 불변 값이다.** 함수마다 새 값을 돌려주고 받은 것은 안 고친다 — 화면은
 * 돌려받은 값으로 갈아끼우기만 한다. 검사: `sketch.spec.ts`.
 */

import { SKETCH_EXPORT_FORMAT } from '@/data/image/formats'
import {
  SKETCH_BACKGROUND,
  SKETCH_CANVAS_SIZE,
  SKETCH_INK,
  SKETCH_STROKE_DEFAULT,
  SKETCH_STROKE_WIDTHS,
} from '@/limits'

/** 붓 굵기 단계의 이름. 값(비율)은 `limits.ts`가 갖는다. */
export type StrokeWidthId = keyof typeof SKETCH_STROKE_WIDTHS

/**
 * 굵기 단계의 순서 — 가는 것부터. **`limits.ts`의 레코드 순서에서 꺼낸다** — 따로 적으면 단계를
 * 하나 더할 때 둘이 갈린다.
 */
export const STROKE_WIDTH_IDS = Object.keys(SKETCH_STROKE_WIDTHS) as StrokeWidthId[]

/** 캔버스 픽셀 좌표 `[x, y]`. */
export type Point = readonly [number, number]

/**
 * 획 하나. **획이 자기 굵기를 들고 있다** — 그림판이 "지금 굵기" 하나만 들면, 굵기를 바꾼 뒤
 * 되돌리기로 다시 그릴 때 앞 획들까지 새 굵기로 그려진다(계획 감사 B-3).
 */
export interface Stroke {
  readonly points: readonly Point[]
  readonly width: StrokeWidthId
}

/** 그림판 하나의 상태. */
export interface Sketch {
  readonly strokes: readonly Stroke[]
  /** 지금 획을 긋는 중인가 — 포인터가 눌려 있는가. */
  readonly drawing: boolean
  /**
   * 지금 고른 붓 굵기. **다음에 여는 획이 이것을 받는다** — 이미 그은 획은 자기 굵기를 들고
   * 있으므로 이것을 바꿔도 안 바뀐다. 굵기 없이는 그릴 수 없으므로 비어 있는 때가 없다.
   */
  readonly width: StrokeWidthId
}

/** 새 그림판. 붓 굵기는 처음 값이다. */
export const EMPTY_SKETCH: Sketch = { strokes: [], drawing: false, width: SKETCH_STROKE_DEFAULT }

/** 붓 굵기를 바꾼다. 그은 획은 그대로다. */
export function setWidth(sketch: Sketch, width: StrokeWidthId): Sketch {
  return { ...sketch, width }
}

/** 새 획을 연다. 첫 점 하나로 시작한다 — 그대로 끝나면 점 하나가 찍힌다. */
export function beginStroke(sketch: Sketch, point: Point): Sketch {
  return {
    ...sketch,
    strokes: [...sketch.strokes, { points: [point], width: sketch.width }],
    drawing: true,
  }
}

/** 긋는 중인 획에 점을 잇는다. **긋는 중이 아니면 그대로다** — 누르지 않고 지나가는 포인터다. */
export function addPoint(sketch: Sketch, point: Point): Sketch {
  const last = sketch.strokes.at(-1)
  if (!sketch.drawing || last === undefined) return sketch
  return {
    ...sketch,
    strokes: [...sketch.strokes.slice(0, -1), { ...last, points: [...last.points, point] }],
  }
}

/** 획을 끝낸다. 획은 그대로 남는다. */
export function endStroke(sketch: Sketch): Sketch {
  return sketch.drawing ? { ...sketch, drawing: false } : sketch
}

/**
 * 다 그은 획 하나를 통째로 붙인다. 지금 고른 굵기를 받는다. **점이 없으면 그대로다.**
 *
 * **화면이 긋는 동안 쓰는 길이다** (`views/data/SketchDialog.vue`). `addPoint`는 점마다 획의 점
 * 배열을 새로 복사하므로, 포인터가 점을 수백 개 보내는 긴 획에서는 복사 총량이 점 수의 제곱으로
 * 는다. 그래서 화면은 긋는 동안 점을 자기 가변 배열에 쌓고, 획이 끝날 때 이것으로 한 번에 넣는다.
 * **받은 배열을 복사해 든다** — 화면이 그 배열을 다음 획에 다시 쓰더라도 그림판이 안 바뀐다.
 */
export function addStroke(sketch: Sketch, points: readonly Point[]): Sketch {
  if (points.length === 0) return sketch
  return {
    ...sketch,
    strokes: [...sketch.strokes, { points: [...points], width: sketch.width }],
    drawing: false,
  }
}

/** 마지막 획을 뺀다. 긋는 중이었으면 그 획이 빠지고 긋기도 멈춘다. 붓 굵기는 그대로다. */
export function undo(sketch: Sketch): Sketch {
  return { ...sketch, strokes: sketch.strokes.slice(0, -1), drawing: false }
}

/**
 * 획을 전부 비운다. **붓 굵기는 그대로다** — 학생이 고른 것이다. [다음 장 추가]가 새 장을 열 때도
 * 이것을 쓴다.
 */
export function clear(sketch: Sketch): Sketch {
  return { ...EMPTY_SKETCH, width: sketch.width }
}

/** 아무것도 안 그렸는가. [추가]·[다음 장 추가]가 이것으로 거절한다. */
export function isBlank(sketch: Sketch): boolean {
  return sketch.strokes.length === 0
}

/** 굵기 단계의 픽셀 값. 비율 × 캔버스 한 변이다. */
export function strokeWidthPx(width: StrokeWidthId, size: number = SKETCH_CANVAS_SIZE): number {
  return SKETCH_STROKE_WIDTHS[width] * size
}

/**
 * 화면에 보이는 좌표를 캔버스 픽셀 좌표로 바꾼다. **보이는 크기와 픽셀 크기는 다르다** — 픽셀은
 * `SKETCH_CANVAS_SIZE`로 고정이고 보이는 크기는 CSS가 화면 폭에 맞춘다.
 *
 * `offsetX`·`offsetY`는 캔버스 왼쪽 위에서 잰 값이다(`PointerEvent`의 같은 이름). 캔버스 밖으로
 * 나간 점은 자르지 않는다 — 포인터 캡처 중에는 밖에서도 점이 오고, 넘친 획은 캔버스가 자른다.
 */
export function toCanvasPoint(
  offsetX: number,
  offsetY: number,
  displayWidth: number,
  displayHeight: number,
  size: number = SKETCH_CANVAS_SIZE,
): Point {
  if (displayWidth <= 0 || displayHeight <= 0) {
    throw new Error(`invalid display size: ${displayWidth}x${displayHeight}`)
  }
  return [(offsetX * size) / displayWidth, (offsetY * size) / displayHeight]
}

/**
 * 다시 그리기에 쓰는 2D 컨텍스트의 부분. `CanvasRenderingContext2D`와
 * `OffscreenCanvasRenderingContext2D`가 둘 다 맞고, 검사는 가짜를 넘긴다.
 */
export type SketchContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'stroke'
  | 'arc'
  | 'fill'
>

/**
 * 획 목록을 처음부터 다시 그린다. **바탕을 먼저 칠한다** — 되돌리기는 지울 획을 찾아 지우는 것이
 * 아니라 남은 획으로 다시 그리는 것이라, 바탕을 안 칠하면 뺀 획이 남는다. 내보내는 PNG도 바탕이
 * 칠해진 채로 나간다.
 *
 * **점 하나짜리 획은 원으로 찍는다.** 선 하나로 그으면 길이가 0이라 아무것도 안 찍힌다.
 */
export function drawSketch(
  context: SketchContext,
  strokes: readonly Stroke[],
  size: number = SKETCH_CANVAS_SIZE,
): void {
  context.fillStyle = SKETCH_BACKGROUND
  context.fillRect(0, 0, size, size)
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points
    if (first === undefined) continue
    const width = strokeWidthPx(stroke.width, size)
    context.beginPath()
    if (rest.length === 0) {
      context.fillStyle = SKETCH_INK
      context.arc(first[0], first[1], width / 2, 0, 2 * Math.PI)
      context.fill()
      continue
    }
    context.strokeStyle = SKETCH_INK
    context.lineWidth = width
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.moveTo(first[0], first[1])
    for (const [x, y] of rest) context.lineTo(x, y)
    context.stroke()
  }
}

/**
 * 그림 파일 이름 발급기. `drawn-1.png`, `drawn-2.png` … 를 차례로 낸다.
 *
 * **순번은 발급기 인스턴스가 쥔다 — 화면(판)이 사는 동안 하나를 만들어 쓴다.** 새 발급기는 다시
 * 1부터다. 대화상자나 메뉴가 열릴 때마다 만들면 두 번째 그림도 `drawn-1.png`가 되고, 굽기 결과를
 * 이름으로 범주에 되돌리는 맵(`views/data/ImagePanel.vue`의 `byPath`)에서 다른 범주의 두 장이
 * 한 칸으로 합쳐진다. 붙여넣기의 `pasted-<n>`(`composables/usePasteImages.ts`)과 같은 이유다.
 *
 * **파일에 앉는 이름은 이것이 아니다** — 정본 해시다. 이 이름은 굽기 전의 확인 판에서만 산다.
 */
export function createSketchNamer(): () => string {
  let count = 0
  return () => {
    count += 1
    return `drawn-${count}${SKETCH_EXPORT_FORMAT.extension}`
  }
}

/** 내보낼 때 쓰는 캔버스. 화면은 `<canvas>`로, 검사는 가짜로 만든다. */
export interface SketchCanvas {
  readonly context: SketchContext
  /** 캔버스를 이 MIME으로 담은 Blob. 못 만들면 `null`이다(`HTMLCanvasElement.toBlob`과 같다). */
  readonly toBlob: (type: string) => Promise<Blob | null>
}

/**
 * 획 목록을 PNG `File` 하나로 내보낸다. 한 변 `SKETCH_CANVAS_SIZE`의 새 캔버스에 다시 그려서
 * 담는다 — 화면의 캔버스를 그대로 담지 않는 것은, 그 캔버스가 지금 장이 아닐 수 있어서다(모은 장).
 *
 * **형식을 다시 본다.** `toBlob`은 못 하는 타입을 받아도 던지지 않고 다른 형식을 줄 수 있다
 * (`bake.ts`와 같은 이유) — 이름은 `.png`인데 내용이 다른 파일을 내보내지 않는다.
 */
export async function sketchToFile(
  strokes: readonly Stroke[],
  name: string,
  createCanvas: (size: number) => SketchCanvas,
): Promise<File> {
  const canvas = createCanvas(SKETCH_CANVAS_SIZE)
  drawSketch(canvas.context, strokes, SKETCH_CANVAS_SIZE)
  const blob = await canvas.toBlob(SKETCH_EXPORT_FORMAT.mime)
  if (blob === null) throw new Error('sketch canvas produced no blob')
  if (blob.type !== SKETCH_EXPORT_FORMAT.mime) {
    throw new Error(`sketch format mismatch: asked ${SKETCH_EXPORT_FORMAT.mime}, got ${blob.type}`)
  }
  return new File([blob], name, { type: SKETCH_EXPORT_FORMAT.mime })
}
