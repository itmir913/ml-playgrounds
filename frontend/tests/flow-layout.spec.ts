/**
 * **흐름도의 배치** (`ml/flow-layout.ts`, `architecture.md` §8.22) — 좌표와 선의 경로.
 *
 * 좌표의 정답은 코드 소유자가 승인한 시안(v6, flow34와 같은 좌표)이다. 아래 첫 묶음은 그 시안의 숫자를
 * 손으로 적어 못 박고, 나머지는 **모든 경우에서 지켜야 하는 성질**(최소 조각, 화살촉 앞 직선, 끝이 상자의
 * 축에 맞는가, 모델에 없는 노드에 선이 없는가)을 잰다. 선의 길이는 **경로 글자를 따로 읽어서** 센다 —
 * 레이아웃이 낸 `lead`를 그대로 믿으면 둘이 같이 틀린다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { FLOW_ARROW_LEAD_PX, FLOW_MIN_SEGMENT_PX } from '../src/limits'
import type { FlowModel, FlowPrep } from '../src/ml/flow'
import {
  FLOW_GEOMETRY,
  FLOW_LAYERS,
  isDrawnByBars,
  layoutOf,
  segmentWidths,
  type FlowBarValues,
  type FlowLayout,
  type FlowLayoutInput,
  type Rect,
} from '../src/ml/flow-layout'
import { FLOW_CASES, modelOf, withTask } from './fixtures/flow-cases'
import {
  projectFile,
  projectFileWithPredictDataset,
  projectFileWithTestDataset,
} from './fixtures/project'

afterEach(() => {
  vi.doUnmock('../src/limits')
  vi.resetModules()
})

const G = FLOW_GEOMETRY

/** 경로 글자는 소수 첫째 자리로 줄여 적는다. */
const r1 = (value: number): number => Math.round(value * 10) / 10

/** 수를 아는 막대. 시안의 기본 그림(flow34)과 같은 몫이다. */
const KNOWN: FlowBarValues = { train: 104, test: 26, gray: 20, testFile: { usable: 38, gray: 2 } }

function input(overrides: Partial<FlowLayoutInput> = {}): FlowLayoutInput {
  return { bars: KNOWN, testSize: 0.2, chipWrap: false, ...overrides }
}

function layout(model: FlowModel | null, overrides: Partial<FlowLayoutInput> = {}): FlowLayout {
  if (model === null) throw new Error('no model')
  return layoutOf(model, input(overrides))
}

const PREPS: (FlowPrep | undefined)[] = [undefined, 'preprocess', 'preprocessOff']

/** 모든 경우 × 전처리 모양 × 수를 아는지 모르는지 × 칩이 꺾이는지. */
function everyLayout(): { title: string; model: FlowModel; layout: FlowLayout }[] {
  const found: { title: string; model: FlowModel; layout: FlowLayout }[] = []
  for (const entry of FLOW_CASES) {
    for (const prep of PREPS) {
      const model = modelOf(entry.build(), prep)
      if (model === null) continue
      for (const bars of [KNOWN, null]) {
        for (const chipWrap of [false, true]) {
          found.push({
            title: `${entry.no}. ${entry.title} / ${prep ?? 'unknown'} / ${bars ? '수' : '윤곽'} / ${chipWrap ? '꺾임' : '한 줄'}`,
            model,
            layout: layoutOf(model, input({ bars, chipWrap })),
          })
        }
      }
    }
  }
  return found
}

const ALL = everyLayout()

describe('시안(v6, flow34)의 좌표', () => {
  it('표 · 분류 · holdout: 카드와 상자 행이 시안과 같다', () => {
    const found = layout(modelOf(projectFile()))
    const [whole, fresh] = found.cards
    expect(whole?.rect).toEqual({ x: 30, y: 30, w: 340, h: 350 }) // 30 ~ 380
    expect(fresh?.rect.y).toBe(400)
    expect(found.boxes.p1?.y).toBe(140 - 26)
    expect(found.boxes.p2?.y).toBe(310 - 26)
    expect(found.boxes.p3?.y).toBe(456 - 26)
    expect(found.height).toBe(540)
    expect(found.width).toBe(1100)
  })

  describe('데이터 카드의 안쪽 여백은 위·아래·좌우가 같다', () => {
    const CASES: [string, () => ReturnType<typeof modelOf>][] = [
      ['표 · holdout', () => modelOf(projectFile())],
      ['표 · 별도 테스트 데이터', () => modelOf(projectFileWithTestDataset())],
      ['새 데이터 파일 이름', () => modelOf(projectFileWithPredictDataset())],
      ['군집화', () => modelOf(withTask(projectFile(), 'clustering'))],
    ]

    it('칩 줄의 두 칸과 틈이 안쪽 폭이다', () => {
      expect(G.chipColA + G.chipGap + G.chipColB).toBe(G.innerW)
    })

    it('가로: 카드 안쪽 자리가 여백 하나로 서 있다', () => {
      expect(G.innerX - G.cardX).toBe(G.cardPad)
      expect(G.cardX + G.cardW - (G.innerX + G.innerW)).toBe(G.cardPad)
    })

    for (const [name, build] of CASES) {
      for (const chipWrap of [false, true]) {
        it(`세로: ${name}${chipWrap ? ' · 칩이 두 줄' : ''} — 위 여백과 아래 여백이 안쪽 여백이다`, () => {
          const found = layout(build(), {
            chipWrap,
            bars: { train: 8, test: 2, gray: 1, testFile: { usable: 3, gray: 1 } },
          })
          expect(found.cards.length).toBeGreaterThanOrEqual(2)
          for (const card of found.cards) {
            const top = card.headY - card.rect.y
            expect(top, `${card.id} top`).toBe(G.cardPad)
            const bottom = card.rect.y + card.rect.h
            // 마지막 줄의 아랫변: 전체 데이터는 이름 줄, 별도 테스트는 막대, 새 데이터는 칩.
            const last =
              card.id === 'whole'
                ? found.captions.y + G.lineH
                : card.id === 'testFile'
                  ? Math.max(
                      ...found.pieces
                        .filter(
                          (p) => p.node === 'test' && p.layer === 'splitBars' && p.segment !== null,
                        )
                        .map((p) => p.rect.y + p.rect.h),
                    )
                  : card.chipsY + G.newChipH
            expect(bottom - last, `${card.id} bottom`).toBe(G.cardPad)
          }
        })
      }
    }

    it('카드 사이는 틈 하나이고 그림 높이는 마지막 카드와 밑 여백에서 나온다', () => {
      const found = layout(modelOf(projectFileWithTestDataset()), {})
      for (let at = 1; at < found.cards.length; at += 1) {
        const before = found.cards[at - 1]!.rect
        expect(found.cards[at]!.rect.y - (before.y + before.h)).toBe(G.cardGap)
      }
      const last = found.cards.at(-1)!.rect
      expect(found.height).toBe(Math.max(last.y + last.h, G.minHeight) + G.bottomPad)
    })
  })

  it('막대의 모서리는 조금만 둥글다 — 가장 작은 조각도 사각형으로 읽힌다', () => {
    expect(G.barRadius).toBeGreaterThan(0)
    expect(G.barRadius * 2).toBeLessThan(G.barH / 2)
    expect(G.barRadius * 2).toBeLessThan(FLOW_MIN_SEGMENT_PX)
  })

  it('새 데이터 카드에 파일 이름이 있으면 칩이 그만큼 내려가 높이가 는다', () => {
    const named = layout(modelOf(projectFileWithPredictDataset()))
    const plain = layout(modelOf(projectFile()))
    expect(named.boxes.p3?.y).toBe(478 - 26)
    expect(named.height).toBe(plain.height + G.newNameShift)
    expect(named.cards.at(-1)?.nameY).toBe(424 + 24)
    expect(plain.cards.at(-1)?.nameY).toBeNull()
  })

  it('칩이 두 줄로 꺾이면 파일 막대 아래가 한 줄만큼 밀린다', () => {
    const base = layout(modelOf(projectFile()))
    const wrapped = layout(modelOf(projectFile()), { chipWrap: true })
    expect(wrapped.height - base.height).toBe(G.chipWrapShift)
    expect(wrapped.boxes.p2?.y).toBe((base.boxes.p2?.y ?? 0) + G.chipWrapShift)
  })

  it('별도 테스트 데이터면 테스트 카드가 서고 전처리 상자는 막대 가운데 높이다', () => {
    const found = layout(modelOf(projectFileWithTestDataset()))
    expect(found.cards.map((card) => card.id)).toEqual(['whole', 'testFile', 'new'])
    const testBar = found.pieces.find((entry) => entry.segment === 'test:bar')
    expect(testBar).toBeDefined()
    expect(found.boxes.p2?.y).toBe((testBar?.rect.y ?? 0) + G.barH / 2 - G.boxH / 2)
    // 분할 글자 줄과 두 조각 이름이 없다 — 나눈 것이 아니다.
    expect(found.splitTextY).toBeNull()
    expect(found.captions.nodes).toEqual(['train'])
  })

  it('군집이면 테스트 줄이 없고 결과 상자는 정해진 높이에 선다', () => {
    const found = layout(modelOf(withTask(projectFile(), 'clustering')))
    expect(found.boxes.p2).toBeUndefined()
    expect(found.boxes.eval?.y).toBe(G.evalFallbackY - G.boxH / 2)
    expect(found.captions.nodes).toEqual(['train'])
  })

  it('원의 자리와 두 줄로 큰 학습 상자', () => {
    const found = layout(modelOf(projectFile()), {})
    expect(found.circles.exp).toEqual({ x: 872 - 46, y: 140 - 46, w: 92, h: 92 })
    expect(found.circles.pred.x).toBe(1022 - 46)
    // 학습 상자는 두 줄이라 다른 상자보다 크지만 가운데 높이는 같다 — 들어오고 나가는 선의 끝점이 그대로다.
    const learn = found.boxes.learn!
    expect(learn.h).toBe(G.learnH)
    expect(learn.h).toBeGreaterThan(G.boxH)
    expect(learn.y + learn.h / 2).toBe(140)
    expect(found.boxes.p1!.y + G.boxH / 2).toBe(140)
  })
})

describe('깔때기', () => {
  it('파일 막대 밑에서 분할 막대의 가운데 높이까지 퍼진다', () => {
    const found = layout(modelOf(projectFile()))
    const bar = found.pieces.find((entry) => entry.segment === 'file:bar')!
    // 막대 밑에서 분할 막대 가운데까지 80이다.
    const split = found.pieces.find((entry) => entry.node === 'train')!
    expect(split.rect.y + G.barH / 2 - (bar.rect.y + G.barH)).toBe(80)
    expect(found.funnel.fill.startsWith(`M${G.innerX},${bar.rect.y + G.barH / 2}`)).toBe(true)
    expect(found.funnel.fill.endsWith('Z')).toBe(true)
    expect(found.funnel.rails).toHaveLength(2)
    // 오른쪽 가장자리는 파란 조각 끝에서 시작해 카드 안쪽 오른쪽 끝에 닿는다.
    const blueEnd = bar.rect.x + bar.rect.w
    expect(found.funnel.rails[1]?.startsWith(`M${r1(blueEnd)},`)).toBe(true)
    expect(found.funnel.rails[1]).toContain(`L${G.innerX + G.innerW},`)
  })

  it('회색이 없으면 파란 조각이 막대를 채우고 깔때기가 곧게 내려온다', () => {
    const found = layout(modelOf(projectFile()), {
      bars: { ...KNOWN, gray: 0 },
    })
    expect(found.pieces.some((entry) => entry.look === 'gray')).toBe(false)
    const blue = found.pieces.find((entry) => entry.segment === 'file:bar')!
    expect(blue.rect.w).toBe(G.innerW)
  })
})

describe('막대 조각의 폭', () => {
  it('조각과 틈의 합이 막대 폭이다', () => {
    for (const [values, gap] of [
      [[104, 26], 6],
      [[1, 100000], 6],
      [[290, 2, 8], 4],
      [[5, 5], 0],
      [[0, 7], 6],
    ] as const) {
      const out = segmentWidths(values, 292, gap)
      const present = out.filter((entry) => entry !== null)
      const total = present.reduce((sum, entry) => sum + (entry?.w ?? 0), 0)
      expect(total + gap * (present.length - 1), JSON.stringify(values)).toBeCloseTo(292, 6)
    }
  })

  it('0인 몫은 조각이 없고 나머지가 막대를 채운다', () => {
    const out = segmentWidths([0, 7], 292, 6)
    expect(out[0]).toBeNull()
    expect(out[1]).toEqual({ x: 0, w: 292 })
    expect(segmentWidths([0, 0], 292, 6)).toEqual([null, null])
  })

  it('아무리 작은 몫도 최소 폭을 지키고 모자란 만큼은 큰 조각이 낸다', () => {
    const out = segmentWidths([1, 100000], 292, 6)
    expect(out[0]?.w).toBeCloseTo(FLOW_MIN_SEGMENT_PX, 6)
    expect(out[1]?.w).toBeCloseTo(292 - 6 - FLOW_MIN_SEGMENT_PX, 6)
    // 조각은 겹치지 않고 틈이 있다.
    expect(out[1]?.x).toBeCloseTo(FLOW_MIN_SEGMENT_PX + 6, 6)
  })

  it('최소에 안 걸리는 몫은 비례를 그대로 지킨다', () => {
    const out = segmentWidths([104, 26], 292, 6)
    expect((out[0]?.w ?? 0) / (out[1]?.w ?? 1)).toBeCloseTo(4, 6)
  })

  it('몫이 하나뿐이면 막대 전체다', () => {
    expect(segmentWidths([9], 292, 6)).toEqual([{ x: 0, w: 292 }])
  })

  it.each(ALL.map((entry) => [entry.title, entry.layout] as const))(
    '%s: 그려진 조각은 최소 폭을 지키고 막대 안에 든다',
    (_title, found) => {
      for (const entry of found.pieces) {
        expect(entry.rect.h).toBe(G.barH)
        if (entry.look === 'gray') continue // 회색은 틈 없는 트랙이라 파란 조각 밑으로 들어간다
        expect(entry.rect.w, entry.node).toBeGreaterThanOrEqual(FLOW_MIN_SEGMENT_PX - 1e-9)
        expect(entry.rect.x, entry.node).toBeGreaterThanOrEqual(G.innerX - 1e-9)
        expect(entry.rect.x + entry.rect.w, entry.node).toBeLessThanOrEqual(
          G.innerX + G.innerW + 1e-9,
        )
      }
    },
  )
})

describe('화살촉 앞 직선', () => {
  /** 경로 글자를 읽어 마지막 직선의 길이와 끝점을 센다. 레이아웃이 낸 값과 별개의 계산이다. */
  function tail(d: string): { lead: number; end: { x: number; y: number } } {
    const commands = [...d.matchAll(/([MHVLQCZ])([^MHVLQCZ]*)/g)].map((match) => ({
      op: match[1] ?? '',
      args: (match[2] ?? '')
        .trim()
        .split(/[\s,]+/)
        .filter((token) => token !== '')
        .map(Number),
    }))
    let x = 0
    let y = 0
    let lead = 0
    for (const { op, args } of commands) {
      const before = { x, y }
      if (op === 'M' || op === 'L') [x, y] = [args[0] ?? 0, args[1] ?? 0]
      else if (op === 'H') x = args[0] ?? 0
      else if (op === 'V') y = args[0] ?? 0
      else if (op === 'Q' || op === 'C') [x, y] = [args.at(-2) ?? 0, args.at(-1) ?? 0]
      lead = op === 'H' ? Math.abs(x - before.x) : op === 'V' ? Math.abs(y - before.y) : 0
    }
    return { lead, end: { x, y } }
  }

  it.each(ALL.map((entry) => [entry.title, entry.layout] as const))(
    '%s: 모든 선이 마지막에 촉만큼 곧게 간다',
    (_title, found) => {
      for (const line of found.lines) {
        if (!line.arrow) continue
        const read = tail(line.d)
        expect(read.lead, line.key).toBeGreaterThanOrEqual(FLOW_ARROW_LEAD_PX)
        // 레이아웃이 말한 것과 글자에서 읽은 것이 같다.
        expect(read.lead, line.key).toBeCloseTo(line.lead, 6)
        expect(read.end.x, line.key).toBeCloseTo(line.end.x, 6)
        expect(read.end.y, line.key).toBeCloseTo(line.end.y, 6)
      }
    },
  )

  it('줄기는 촉이 없다', () => {
    const found = layout(modelOf(projectFile(), 'preprocess'))
    expect(found.trunk).not.toBeNull()
    // 줄기는 `lines`에 없다 — 갈래만 촉을 단다.
    expect(found.lines.some((line) => !line.arrow)).toBe(false)
  })
})

describe('끝 조각이 상자의 축에 맞는다', () => {
  function center(rect: Rect): { x: number; y: number } {
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
  }

  it.each(ALL.map((entry) => [entry.title, entry.layout] as const))(
    '%s: 가로로 닿는 선은 상자의 가운데 높이에, 세로로 닿는 선은 가운데 x에 닿는다',
    (_title, found) => {
      const targets: Record<string, Rect | undefined> = {
        p1: found.boxes.p1,
        p2: found.boxes.p2,
        p3: found.boxes.p3,
        learn: found.boxes.learn,
        eval: found.boxes.eval,
        exp: found.circles.exp,
        pred: found.circles.pred,
      }
      for (const line of found.lines) {
        const target = targets[line.to]
        expect(target, line.key).toBeDefined()
        const middle = center(target!)
        // 세로로 끝나는 선(마지막이 `V`)은 x가, 가로로 끝나는 선은 y가 축에 맞는다.
        if (/V[-\d.]+$/.test(line.d)) expect(line.end.x, line.key).toBeCloseTo(middle.x, 6)
        else expect(line.end.y, line.key).toBeCloseTo(middle.y, 6)
      }
    },
  )

  it('선은 상자 안으로 파고들지 않는다 — 끝에서 상자까지 틈이 있거나 맞닿는다', () => {
    const found = layout(modelOf(projectFile(), 'preprocess'))
    for (const line of found.lines) {
      const target = { ...found.boxes, ...found.circles }[line.to as 'p1']
      if (target === undefined) continue
      const inside =
        line.end.x > target.x + 0.01 &&
        line.end.x < target.x + target.w - 0.01 &&
        line.end.y > target.y + 0.01 &&
        line.end.y < target.y + target.h - 0.01
      expect(inside, line.key).toBe(false)
    }
  })
})

describe('층 순서', () => {
  it('아래에서 위로: 카드, 깔때기, 파일 막대, 훈련 선, 분할 막대, 나머지 선', () => {
    expect([...FLOW_LAYERS]).toEqual([
      'cards',
      'funnel',
      'fileBar',
      'trainLine',
      'splitBars',
      'lines',
    ])
  })

  it.each(ALL.map((entry) => [entry.title, entry.layout] as const))(
    '%s: 조각과 선이 자기 층에 있고 훈련 선만 막대 사이에 낀다',
    (_title, found) => {
      for (const entry of found.pieces) {
        expect(['fileBar', 'splitBars']).toContain(entry.layer)
        expect(entry.layer === 'fileBar').toBe(entry.segment?.startsWith('file:') ?? false)
      }
      for (const line of found.lines) {
        expect(line.layer === 'trainLine', line.key).toBe(line.key === 'train>p1')
      }
      // 파일 막대는 훈련 선 밑, 분할 막대는 훈련 선 위다 — 훈련 선이 분할 막대 윗변에서 시작한다.
      const order = (layer: (typeof FLOW_LAYERS)[number]) => FLOW_LAYERS.indexOf(layer)
      expect(order('fileBar')).toBeLessThan(order('trainLine'))
      expect(order('trainLine')).toBeLessThan(order('splitBars'))
    },
  )
})

describe('모델에 없는 것은 그리지 않는다', () => {
  it.each(ALL.map((entry) => [entry.title, entry.model, entry.layout] as const))(
    '%s: 선과 상자는 모델의 노드와 간선뿐이다',
    (_title, model, found) => {
      const ids = new Set<string>(model.nodes.map((node) => node.id))
      for (const line of found.lines) {
        expect(ids.has(line.from), line.key).toBe(true)
        expect(ids.has(line.to), line.key).toBe(true)
        expect(
          model.edges.some((edge) => edge.from === line.from && edge.to === line.to),
          line.key,
        ).toBe(true)
      }
      for (const id of Object.keys(found.boxes)) expect(ids.has(id), id).toBe(true)
      // 모델의 간선은 선이거나 막대가 말하거나 둘 중 하나다 — 빠진 것도 겹친 것도 없다.
      for (const edge of model.edges) {
        const drawn = found.lines.some((line) => line.from === edge.from && line.to === edge.to)
        expect(drawn !== isDrawnByBars(edge), `${edge.from}>${edge.to}`).toBe(true)
      }
      // 기준 간선이 없으면 줄기도 없다.
      expect(found.trunk === null).toBe(!model.edges.some((edge) => edge.flow === 'basis'))
    },
  )

  it('군집에는 테스트 쪽 상자와 선이 없다', () => {
    const model = modelOf(withTask(projectFile(), 'clustering'), 'preprocess')!
    const found = layoutOf(model, input())
    expect(found.boxes.p2).toBeUndefined()
    expect(found.lines.map((line) => line.key)).not.toContain('test>p2')
    expect(found.lines.map((line) => line.key)).toContain('p1>eval')
  })

  it('선의 윤곽(pending)은 모델의 간선 상태를 따른다', () => {
    const model = modelOf(projectFile(), 'preprocess')!
    const found = layoutOf(model, input())
    for (const line of found.lines) {
      const edge = model.edges.find((entry) => entry.from === line.from && entry.to === line.to)
      expect(line.pending).toBe(edge?.state === 'pending')
      expect(line.flow).toBe(edge?.flow)
    }
  })

  it('줄기는 갈래가 하나라도 진하면 실선이다', () => {
    const solid = layoutOf(modelOf(projectFile(), 'preprocess')!, input())
    expect(solid.trunk?.pending).toBe(false)
    const none = layoutOf(modelOf(withTask(projectFile(), undefined), 'preprocess')!, input())
    // 유형 미정: 학습 전이라 p3 쪽 갈래는 윤곽이지만 p2 쪽은 진하다 — 하나라도 진하면 실선이다.
    expect(none.trunk?.pending).toBe(false)
  })
})

describe('막대 조각을 누르는 자리', () => {
  it.each(ALL.map((entry) => [entry.title, entry.layout] as const))(
    '%s: 누르는 자리는 그려진 조각을 덮고 한 변이 최소 이상이며 가운데가 같다',
    (_title, found) => {
      for (const entry of found.pieces) {
        const { rect, hit } = entry
        expect(hit.w, entry.node).toBeGreaterThanOrEqual(G.hitMin)
        expect(hit.h, entry.node).toBeGreaterThanOrEqual(G.hitMin)
        expect(hit.x, entry.node).toBeLessThanOrEqual(rect.x + 1e-9)
        expect(hit.y, entry.node).toBeLessThanOrEqual(rect.y + 1e-9)
        expect(hit.x + hit.w, entry.node).toBeGreaterThanOrEqual(rect.x + rect.w - 1e-9)
        expect(hit.y + hit.h, entry.node).toBeGreaterThanOrEqual(rect.y + rect.h - 1e-9)
        expect(hit.x + hit.w / 2).toBeCloseTo(rect.x + rect.w / 2, 6)
        expect(hit.y + hit.h / 2).toBeCloseTo(rect.y + rect.h / 2, 6)
      }
    },
  )

  it('파란 조각은 바깥 테까지 덮는다 — SVG의 테두리 사각형과 같다', () => {
    const found = layout(modelOf(projectFile()))
    const blue = found.pieces.find((entry) => entry.segment === 'file:bar')!
    expect(blue.hit).toEqual({
      x: blue.rect.x - G.barHalo,
      y: blue.rect.y - G.barHalo,
      w: blue.rect.w + 2 * G.barHalo,
      h: blue.rect.h + 2 * G.barHalo,
    })
  })

  it('회색 조각이 좁아도 누르는 자리는 한 변이 최소 이상이다', () => {
    // 사용하지 않는 몫이 1행뿐이라 최소 폭으로 눌려도 손가락이 닿는다.
    const found = layout(modelOf(projectFile()), { bars: { ...KNOWN, gray: 1, train: 104000 } })
    const gray = found.pieces.find((entry) => entry.look === 'gray')!
    expect(gray.rect.w).toBeGreaterThanOrEqual(FLOW_MIN_SEGMENT_PX)
    expect(gray.hit.w).toBeGreaterThanOrEqual(G.hitMin)
    expect(gray.segment).toBe('file:gray')
  })

  it('회색 조각은 파란 조각 밑으로 들어가 틈이 안 보인다', () => {
    const found = layout(modelOf(projectFile()))
    const gray = found.pieces.find((entry) => entry.look === 'gray')!
    const blue = found.pieces.find((entry) => entry.segment === 'file:bar')!
    expect(gray.rect.x).toBe(blue.rect.x + blue.rect.w - G.grayTuck)
    // 그려지는 순서도 회색이 먼저다.
    const order = found.pieces.filter((entry) => entry.layer === 'fileBar')
    expect(order[0]?.look).toBe('gray')
  })
})

describe('수를 모를 때', () => {
  it('분할 막대가 설정 비율의 윤곽이고 훈련 선이 막대 윗변에서 시작한다', () => {
    const model = modelOf(projectFile())!
    const found = layoutOf(model, input({ bars: null, testSize: 0.25 }))
    const [train, test] = found.pieces.filter((entry) => entry.layer === 'splitBars')
    expect(train?.look).toBe('outline')
    expect(test?.look).toBe('outline')
    expect((train?.rect.w ?? 0) / (test?.rect.w ?? 1)).toBeCloseTo(3, 6)
    const line = found.lines.find((entry) => entry.key === 'train>p1')!
    expect(
      line.d.startsWith(`M${r1((train?.rect.x ?? 0) + (train?.rect.w ?? 0) / 2)},${train?.rect.y}`),
    ).toBe(true)
  })

  it('파일 막대는 파란 한 조각이 막대를 채운다', () => {
    const found = layoutOf(modelOf(projectFile())!, input({ bars: null }))
    const file = found.pieces.filter((entry) => entry.layer === 'fileBar')
    expect(file).toHaveLength(1)
    expect(file[0]?.rect.w).toBe(G.innerW)
  })
})

describe('단언과 상수의 출처', () => {
  it('최소 조각은 막대 높이를 넘지 않는다', () => {
    expect(FLOW_MIN_SEGMENT_PX).toBeLessThanOrEqual(G.barH)
  })

  it('화살촉 앞 직선은 촉보다 짧지 않다', () => {
    expect(FLOW_ARROW_LEAD_PX).toBeGreaterThanOrEqual(G.arrowHead)
  })

  it('최소 조각이 막대보다 높으면 모듈이 뜨는 순간 깨진다', async () => {
    vi.resetModules()
    vi.doMock('../src/limits', async (original) => ({
      ...(await original<typeof import('../src/limits')>()),
      FLOW_MIN_SEGMENT_PX: G.barH + 1,
    }))
    await expect(import('../src/ml/flow-layout')).rejects.toThrow(/bar height/)
  })

  it('화살촉 앞 직선이 촉보다 짧으면 모듈이 뜨는 순간 깨진다', async () => {
    vi.resetModules()
    vi.doMock('../src/limits', async (original) => ({
      ...(await original<typeof import('../src/limits')>()),
      FLOW_ARROW_LEAD_PX: G.arrowHead - 1,
    }))
    await expect(import('../src/ml/flow-layout')).rejects.toThrow(/arrowhead/)
  })

  it('배치 모듈이 읽는 상수가 limits.ts에서 온다 — 숫자를 다시 적지 않는다', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ml', 'flow-layout.ts'), 'utf-8')
    expect(source).toMatch(/import \{[^}]*FLOW_MIN_SEGMENT_PX[^}]*\} from '@\/limits'/s)
    expect(source).toMatch(/import \{[^}]*FLOW_ARROW_LEAD_PX[^}]*\} from '@\/limits'/s)
  })
})
