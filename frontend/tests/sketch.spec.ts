/**
 * 그리기의 순수 로직 (`data/image/sketch.ts`, open-decisions.md 67).
 *
 * **캔버스는 여기 없다.** jsdom에 캔버스가 없어서 그리는 함수는 컨텍스트를 주입받고, 여기서는
 * 부른 순서를 적는 가짜를 넘긴다. 실제 브라우저에서 획이 보이는가·손가락이 화면을 안 굴리는가는
 * 사람이 확인한다(`workflow.md` §12 "캔버스·`<dialog>`·CSS 뒤는 jsdom 검사가 구조적으로 못 본다").
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bodyAt, withoutComments } from './fixtures/source'

import {
  CANONICAL_FORMAT_IDS,
  CANONICAL_FORMATS,
  canonicalFormatOfPath,
  SKETCH_EXPORT_FORMAT,
} from '../src/data/image/formats'
import {
  addPoint,
  beginStroke,
  clear,
  createSketchNamer,
  drawSketch,
  EMPTY_SKETCH,
  endStroke,
  isBlank,
  setWidth,
  type Sketch,
  type SketchCanvas,
  type SketchContext,
  sketchToFile,
  STROKE_WIDTH_IDS,
  strokeWidthPx,
  toCanvasPoint,
  undo,
} from '../src/data/image/sketch'
import {
  SKETCH_BACKGROUND,
  SKETCH_CANVAS_SIZE,
  SKETCH_INK,
  SKETCH_STROKE_DEFAULT,
  SKETCH_STROKE_WIDTHS,
} from '../src/limits'
import { BACKBONES } from '../src/ml/backbones'

/** 획 하나를 처음부터 끝까지 긋는다. */
function drawn(sketch: Sketch, points: readonly (readonly [number, number])[]): Sketch {
  const [first, ...rest] = points
  if (first === undefined) throw new Error('a stroke needs a point')
  let next = beginStroke(sketch, first)
  for (const point of rest) next = addPoint(next, point)
  return endStroke(next)
}

describe('획을 더하고 빼고 비운다', () => {
  it('새 그림판은 비었고 처음 굵기를 든다', () => {
    expect(isBlank(EMPTY_SKETCH)).toBe(true)
    expect(EMPTY_SKETCH.drawing).toBe(false)
    expect(EMPTY_SKETCH.width).toBe(SKETCH_STROKE_DEFAULT)
  })

  it('획을 열고 점을 잇고 끝낸다', () => {
    const begun = beginStroke(EMPTY_SKETCH, [1, 2])
    expect(begun.drawing).toBe(true)
    expect(isBlank(begun)).toBe(false)
    const extended = addPoint(addPoint(begun, [3, 4]), [5, 6])
    expect(extended.strokes).toEqual([
      {
        points: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
        width: SKETCH_STROKE_DEFAULT,
      },
    ])
    const ended = endStroke(extended)
    expect(ended.drawing).toBe(false)
    expect(ended.strokes).toEqual(extended.strokes)
  })

  it('긋는 중이 아니면 점을 안 잇는다 - 누르지 않고 지나가는 포인터다', () => {
    expect(addPoint(EMPTY_SKETCH, [1, 1])).toBe(EMPTY_SKETCH)
    const one = drawn(EMPTY_SKETCH, [[1, 1]])
    expect(addPoint(one, [9, 9]).strokes).toEqual(one.strokes)
  })

  it('되돌리기는 마지막 획 하나만 뺀다', () => {
    const two = drawn(drawn(EMPTY_SKETCH, [[1, 1]]), [[2, 2]])
    expect(undo(two).strokes).toEqual([{ points: [[1, 1]], width: SKETCH_STROKE_DEFAULT }])
    expect(isBlank(undo(undo(two)))).toBe(true)
    // 빈 그림판을 되돌려도 던지지 않는다.
    expect(isBlank(undo(EMPTY_SKETCH))).toBe(true)
  })

  it('긋는 중에 되돌리면 그 획이 빠지고 긋기가 멈춘다', () => {
    const drawing = addPoint(beginStroke(EMPTY_SKETCH, [1, 1]), [2, 2])
    const undone = undo(drawing)
    expect(isBlank(undone)).toBe(true)
    expect(undone.drawing).toBe(false)
    // 멈췄으므로 다음 점은 아무 획에도 안 붙는다.
    expect(isBlank(addPoint(undone, [3, 3]))).toBe(true)
  })

  it('초기화는 획을 전부 비우고 고른 굵기는 둔다', () => {
    const thick = setWidth(EMPTY_SKETCH, 'thick')
    const cleared = clear(drawn(drawn(thick, [[1, 1]]), [[2, 2]]))
    expect(isBlank(cleared)).toBe(true)
    expect(cleared.drawing).toBe(false)
    expect(cleared.width).toBe('thick')
  })

  it('받은 상태를 고치지 않는다', () => {
    const frozen = Object.freeze({
      ...drawn(EMPTY_SKETCH, [[1, 1]]),
      strokes: Object.freeze([
        Object.freeze({ points: Object.freeze([[1, 1] as const]), width: 'thin' as const }),
      ]),
    })
    // 얼린 값을 고치려 들면 엄격 모드에서 던진다.
    expect(() => addPoint(beginStroke(frozen, [2, 2]), [3, 3])).not.toThrow()
    expect(() => undo(frozen)).not.toThrow()
    expect(() => clear(frozen)).not.toThrow()
    expect(() => setWidth(frozen, 'thick')).not.toThrow()
    expect(frozen.strokes).toHaveLength(1)
  })
})

describe('획이 자기 굵기를 든다', () => {
  it('굵기를 바꿔도 앞 획의 굵기는 그대로다', () => {
    const first = drawn(setWidth(EMPTY_SKETCH, 'thin'), [[1, 1]])
    const second = drawn(setWidth(first, 'thick'), [[2, 2]])
    expect(second.strokes.map((stroke) => stroke.width)).toEqual(['thin', 'thick'])
  })

  it('되돌린 뒤에도 앞 획의 굵기는 그대로다', () => {
    const first = drawn(setWidth(EMPTY_SKETCH, 'thin'), [[1, 1]])
    const second = drawn(setWidth(first, 'thick'), [[2, 2]])
    const undone = undo(second)
    expect(undone.strokes.map((stroke) => stroke.width)).toEqual(['thin'])
    // 고른 굵기도 되돌리기가 안 건드린다.
    expect(undone.width).toBe('thick')
  })

  it('굵기 단계가 limits.ts의 레코드 순서 그대로다', () => {
    expect(STROKE_WIDTH_IDS).toEqual(['thin', 'medium', 'thick'])
    expect(STROKE_WIDTH_IDS).toContain(SKETCH_STROKE_DEFAULT)
  })

  it('굵기가 가는 것부터 커진다', () => {
    const values = STROKE_WIDTH_IDS.map((id) => SKETCH_STROKE_WIDTHS[id])
    expect([...values].sort((a, b) => a - b)).toEqual(values)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('보이는 좌표를 픽셀 좌표로 바꾼다', () => {
  it('보이는 크기가 픽셀보다 작으면 늘린다', () => {
    expect(toCanvasPoint(112, 56, 224, 224, 448)).toEqual([224, 112])
  })

  it('보이는 크기가 픽셀보다 크면 줄인다', () => {
    expect(toCanvasPoint(600, 300, 600, 600, 448)).toEqual([448, 224])
  })

  it('가로와 세로를 따로 잰다', () => {
    expect(toCanvasPoint(100, 100, 200, 400, 448)).toEqual([224, 112])
  })

  it('크기를 안 주면 캔버스 한 변을 쓴다', () => {
    expect(toCanvasPoint(50, 50, 100, 100)).toEqual([
      SKETCH_CANVAS_SIZE / 2,
      SKETCH_CANVAS_SIZE / 2,
    ])
  })

  it('캔버스 밖의 점을 자르지 않는다 - 포인터 캡처 중에는 밖에서도 점이 온다', () => {
    expect(toCanvasPoint(-10, 120, 100, 100, 100)).toEqual([-10, 120])
  })

  it('보이는 크기가 0이면 던진다', () => {
    expect(() => toCanvasPoint(1, 1, 0, 100)).toThrow(/invalid display size/)
  })
})

/** 부른 것을 차례로 적는 가짜 컨텍스트. 칠할 때마다 그때의 색과 굵기를 함께 적는다. */
function recorder(): { context: SketchContext; calls: string[] } {
  const calls: string[] = []
  const state = {
    fillStyle: '' as SketchContext['fillStyle'],
    strokeStyle: '' as SketchContext['strokeStyle'],
    lineWidth: 0,
    lineCap: 'butt' as CanvasLineCap,
    lineJoin: 'miter' as CanvasLineJoin,
  }
  const context: SketchContext = Object.assign(state, {
    fillRect: (x: number, y: number, w: number, h: number) =>
      calls.push(`fillRect ${String(state.fillStyle)} ${x} ${y} ${w} ${h}`),
    beginPath: () => calls.push('beginPath'),
    moveTo: (x: number, y: number) => calls.push(`moveTo ${x} ${y}`),
    lineTo: (x: number, y: number) => calls.push(`lineTo ${x} ${y}`),
    stroke: () =>
      calls.push(
        `stroke ${String(state.strokeStyle)} ${state.lineWidth} ${state.lineCap} ${state.lineJoin}`,
      ),
    arc: (x: number, y: number, r: number) => calls.push(`arc ${x} ${y} ${r}`),
    fill: () => calls.push(`fill ${String(state.fillStyle)}`),
  })
  return { context, calls }
}

describe('획 목록을 다시 그린다', () => {
  it('바탕을 먼저 칠하고 획을 순서대로 긋는다', () => {
    const { context, calls } = recorder()
    const sketch = drawn(setWidth(EMPTY_SKETCH, 'thin'), [
      [1, 2],
      [3, 4],
    ])
    drawSketch(context, drawn(setWidth(sketch, 'thick'), [[5, 6]]).strokes, 100)
    expect(calls).toEqual([
      `fillRect ${SKETCH_BACKGROUND} 0 0 100 100`,
      'beginPath',
      'moveTo 1 2',
      'lineTo 3 4',
      `stroke ${SKETCH_INK} ${SKETCH_STROKE_WIDTHS.thin * 100} round round`,
      'beginPath',
      // 점 하나짜리 획은 지름이 굵기인 원이다.
      `arc 5 6 ${(SKETCH_STROKE_WIDTHS.thick * 100) / 2}`,
      `fill ${SKETCH_INK}`,
    ])
  })

  it('빈 획 목록은 바탕만 칠한다 - 되돌린 획이 남지 않는다', () => {
    const { context, calls } = recorder()
    drawSketch(context, [])
    expect(calls).toEqual([
      `fillRect ${SKETCH_BACKGROUND} 0 0 ${SKETCH_CANVAS_SIZE} ${SKETCH_CANVAS_SIZE}`,
    ])
  })

  it('굵기는 비율 × 캔버스 한 변이다', () => {
    for (const id of STROKE_WIDTH_IDS) {
      expect(strokeWidthPx(id)).toBe(SKETCH_STROKE_WIDTHS[id] * SKETCH_CANVAS_SIZE)
      expect(strokeWidthPx(id, 200)).toBe(SKETCH_STROKE_WIDTHS[id] * 200)
    }
  })
})

describe('그림 파일 이름', () => {
  it('거듭 불러도 안 겹친다', () => {
    const next = createSketchNamer()
    const names = Array.from({ length: 5 }, () => next())
    expect(names).toEqual([
      'drawn-1.png',
      'drawn-2.png',
      'drawn-3.png',
      'drawn-4.png',
      'drawn-5.png',
    ])
  })

  /**
   * **새 발급기는 1부터다 — 그래서 화면 수명에 하나여야 한다.** 대화상자를 열 때마다 새로 만들면
   * 두 번째 연 창의 첫 그림도 `drawn-1.png`가 되고, 확인 판의 `byPath`가 다른 범주의 두 장을
   * 한 칸으로 합친다. 여기서 못 박는 것은 발급기의 성질이고, 판이 하나만 만드는지는 화면의 검사가 본다.
   */
  it('새 발급기는 다시 1부터 낸다', () => {
    const first = createSketchNamer()
    first()
    first()
    expect(createSketchNamer()()).toBe('drawn-1.png')
    expect(first()).toBe('drawn-3.png')
  })

  it('확장자는 그리기 내보내기 형식의 것이다', () => {
    expect(createSketchNamer()().endsWith(SKETCH_EXPORT_FORMAT.extension)).toBe(true)
  })
})

describe('PNG 파일로 내보낸다', () => {
  /** 가짜 캔버스. 부른 크기와 타입을 적고, 그 타입의 Blob을 준다. */
  function fakeCanvas(blobType: string | null): {
    create: (size: number) => SketchCanvas
    sizes: number[]
    asked: string[]
    calls: string[]
  } {
    const { context, calls } = recorder()
    const sizes: number[] = []
    const asked: string[] = []
    return {
      create: (size) => {
        sizes.push(size)
        return {
          context,
          toBlob: (type) => {
            asked.push(type)
            return Promise.resolve(
              blobType === null ? null : new Blob([new Uint8Array([1, 2, 3])], { type: blobType }),
            )
          },
        }
      },
      sizes,
      asked,
      calls,
    }
  }

  it('캔버스 한 변의 새 캔버스에 다시 그려 그리기 형식의 File을 만든다', async () => {
    const canvas = fakeCanvas(SKETCH_EXPORT_FORMAT.mime)
    const strokes = drawn(EMPTY_SKETCH, [[10, 10]]).strokes
    const file = await sketchToFile(strokes, 'drawn-1.png', canvas.create)

    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('drawn-1.png')
    expect(file.type).toBe(SKETCH_EXPORT_FORMAT.mime)
    expect(file.size).toBe(3)
    expect(canvas.sizes).toEqual([SKETCH_CANVAS_SIZE])
    expect(canvas.asked).toEqual([SKETCH_EXPORT_FORMAT.mime])
    // 바탕 → 획 순서로 그린 뒤에 담았다.
    expect(canvas.calls[0]).toBe(
      `fillRect ${SKETCH_BACKGROUND} 0 0 ${SKETCH_CANVAS_SIZE} ${SKETCH_CANVAS_SIZE}`,
    )
    expect(canvas.calls.at(-1)).toBe(`fill ${SKETCH_INK}`)
  })

  it('캔버스가 다른 형식을 주면 던진다 - 이름과 내용이 다른 파일을 안 낸다', async () => {
    const canvas = fakeCanvas(CANONICAL_FORMATS.jpeg.mime)
    await expect(sketchToFile([], 'drawn-1.png', canvas.create)).rejects.toThrow(
      /sketch format mismatch/,
    )
  })

  it('캔버스가 Blob을 못 만들면 던진다', async () => {
    const canvas = fakeCanvas(null)
    await expect(sketchToFile([], 'drawn-1.png', canvas.create)).rejects.toThrow(/no blob/)
  })
})

describe('그리기 형식은 정본 형식이 아니다', () => {
  it('정본 등록부에 없다', () => {
    for (const id of CANONICAL_FORMAT_IDS) {
      expect(CANONICAL_FORMATS[id].mime).not.toBe(SKETCH_EXPORT_FORMAT.mime)
      expect(CANONICAL_FORMATS[id].extension).not.toBe(SKETCH_EXPORT_FORMAT.extension)
    }
  })

  it('그림 이름을 정본 경로로 읽지 않는다', () => {
    expect(canonicalFormatOfPath(createSketchNamer()())).toBeNull()
  })
})

describe('그리기 규격 (limits.ts)', () => {
  it('캔버스가 모든 백본의 정본보다 작지 않다', () => {
    // 작으면 굽는 워커가 늘려 굽고 획 가장자리가 흐려진다 (canonical.ts의 fitBox).
    expect(BACKBONES.length).toBeGreaterThan(0)
    for (const backbone of BACKBONES) {
      expect(SKETCH_CANVAS_SIZE, backbone.id).toBeGreaterThanOrEqual(backbone.canonicalSize)
    }
  })

  /**
   * **같은 숫자는 같은 상수가 아니다** (`workflow.md` §12) — 그리기 바탕과 굽기 여백은 경로가
   * 달라 한 상수로 묶지 않는다. 대신 굽기의 여백 칠하기를 글자로 읽어 둘이 같은지 문다.
   * 굽기의 색은 상수가 아니라 `bake.ts` 안의 리터럴이다.
   */
  it('그리기 바탕이 굽기 여백색과 같다', () => {
    const source = withoutComments(
      readFileSync(join(process.cwd(), 'src', 'data', 'image', 'bake.ts'), 'utf-8'),
    ).join(String.fromCharCode(10))
    const head = source.indexOf('export async function bakeCanonical(')
    expect(head, 'bakeCanonical moved or was renamed').toBeGreaterThan(-1)
    const body = bodyAt(source, source.indexOf('{', source.indexOf(')', head)))
    const fills = [...body.matchAll(/fillStyle\s*=\s*['"]([^'"]+)['"]/g)].map((match) =>
      (match[1] ?? '').toLowerCase(),
    )
    expect(fills.length, 'the letterbox fill in bakeCanonical was not found').toBeGreaterThan(0)
    expect(new Set(fills)).toEqual(new Set([SKETCH_BACKGROUND.toLowerCase()]))
  })

  it('바탕과 잉크가 다르다', () => {
    expect(SKETCH_INK.toLowerCase()).not.toBe(SKETCH_BACKGROUND.toLowerCase())
  })
})
