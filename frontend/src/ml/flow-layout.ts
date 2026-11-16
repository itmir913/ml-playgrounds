/**
 * 프로젝트 흐름도의 **배치** — 모델(`ml/flow.ts`)과 수에서 좌표와 선의 경로를 돌려주는 순수 함수
 * (`architecture.md` §8.22). 좌표와 크기의 출처는 `FLOW_GEOMETRY` 하나이고, 코드 소유자가 승인한 시안(v6)의
 * 값이다. 이 문서와 컴포넌트에 사본을 두지 않는다.
 *
 * **글자를 재지 않는다.** 칩이 두 줄로 꺾이는지는 글자 폭을 재야 알 수 있어 호출 쪽(렌더러)이
 * `chipWrap`으로 알려 준다 — 그러면 이 모듈은 DOM 없이 서고 `vitest`가 좌표를 곧장 잰다.
 *
 * **선은 모델의 간선에서 나온다.** 간선이 모델에 없으면 선도 없다 — 경우마다 그리는 코드가 없다.
 * 간선 하나가 선 하나로 이어지지 않는 것은 둘뿐이다: 전체 데이터에서 훈련·테스트로 가는 간선(깔때기와
 * 막대가 그것을 말한다), 그리고 기준 간선의 줄기(갈래 둘을 묶는 선, `FlowLayout.trunk`).
 *
 * **막대 조각은 최소 폭을 지킨다.** 작은 몫도 눈에 보여야 하고 모자란 만큼은 큰 조각이 낸다. 최소 폭은
 * 막대 높이를 넘으면 안 된다 — 아래 단언과 `tests/flow-layout.spec.ts`가 문다.
 */

import { FLOW_ARROW_LEAD_PX, FLOW_MIN_SEGMENT_PX } from '@/limits'
import type { FlowEdge, FlowFlow, FlowModel, FlowNodeId } from '@/ml/flow'
import { edgeKey, type FlowSegment } from '@/ml/flow-highlight'

/**
 * 그림의 좌표와 크기. **캔버스 한 장의 좌표계이고 배율과 무관하다**(배율은 `ml/flow-zoom.ts`).
 * 값은 시안(v6)이 정하고, 바꾸려면 코드 소유자가 시안을 다시 본다. 학습 상자만 시안(flow34 좌표)과 달리 두 줄(이름·유형 칩)이라 높이를 키웠다(소유자 결정).
 */
export const FLOW_GEOMETRY = {
  /** 캔버스 폭. 대시보드 카드가 이 폭보다 좁으면 그림 대신 열기 단추가 선다. */
  width: 1100,
  /** 캔버스 최소 높이(밑 여백 앞). 카드가 낮으면 이만큼은 확보한다. */
  minHeight: 420,
  bottomPad: 30,

  /** 데이터 카드의 가로 자리. 안쪽은 막대와 글자가 서는 자리다. */
  cardX: 30,
  cardW: 340,
  cardTop: 30,
  innerX: 54,
  innerW: 292,
  /**
   * 데이터 카드의 안쪽 여백 — **위·아래·왼쪽·오른쪽이 이 한 값이다.** 안쪽 가로 자리(`innerX`·`innerW`)가 이 값에서
   * 나오고(`flow-layout.spec.ts`가 같음을 문다), 세로는 첫 줄의 윗변과 마지막 줄의 아랫변이 이만큼 안쪽에 선다.
   * 카드 높이는 내용에서 계산한다 — 고정 높이가 아니다.
   */
  cardPad: 24,
  /** 카드 안 글자 한 줄의 높이. */
  lineH: 24,
  /** 카드 사이의 틈. */
  cardGap: 20,

  /** 막대. 높이는 최소 조각 폭과 같거나 크다. 조각 사이의 틈은 분할 막대에만 있다. */
  barH: 20,
  barGap: 6,
  /** 회색 조각이 파란 조각 밑으로 들어가는 길이. 틈 없는 연속 트랙으로 읽힌다. */
  grayTuck: 10,
  /** 창에서 판이 화면에 담길 때 남기는 가장자리 여백과, 담기지 않을 때 판의 왼쪽 위가 시작하는 여백. */
  fitPadding: 24,
  startMargin: 12,
  /** 막대 조각을 누르는 자리의 최소 한 변. 손가락이 닿을 만큼이다. */
  hitMin: 24,
  /** 파란 조각의 바깥 테 두께. 누르는 자리가 이만큼 넓다. */
  barHalo: 2,
  /** 막대와 조각의 모서리 반지름. 막대 높이의 1/5 — 완전한 반원이면 작은 조각이 원 하나로 읽혔다. 바깥 테는 이 값에 테 두께를 더한다. */
  barRadius: 4,
  /**
   * **아직 안 한 일의 윤곽(상자·원·칩·카드·막대, 점선 선)은 한 문법이다.** 굵기와 점선의 길이·간격이 이 셋이고 색은
   * `flow-outline`(utilities.css) 한 곳이다. 점선 간선도 같은 점선 리듬을 쓴다 — 선과 윤곽이 한 그림 안에서 같은
   * 박자로 읽히게 하려는 것이고, 선은 굵기만 다르다(`stroke`).
   */
  pendingStroke: 1.5,
  pendingDashOn: 6,
  pendingDashOff: 5,
  /** 상자의 모서리(`rounded-control`)와 칩의 모서리(`rounded-2xl`) — 윤곽이 HTML 가장자리와 겹치게 같은 값이다. */
  boxRadius: 8,
  chipRadius: 16,

  /** 데이터 카드 안의 세로 자리(안쪽 여백 안의 첫 줄 윗변에서). */
  nameRow: 30,
  chipsRow: 60,
  /** 칩이 두 줄로 꺾일 때 아래로 미는 길이. */
  chipWrapShift: 18,
  /** 파일 막대의 윗변(칩이 한 줄일 때, 안쪽 첫 줄 윗변에서)과 파일 막대에서 분할 막대까지. */
  fileBarOffset: 110,
  fileToSplit: 90,
  /** 분할 막대 아래: 분할 글자 줄과 이름 줄(막대가 둘일 때와 하나일 때). 카드 밑은 이름 줄 아래 안쪽 여백이다. */
  splitText: 34,
  captionTwo: 78,
  captionOne: 38,

  /** 새 데이터 카드. 파일 이름 줄이 있으면 칩이 그만큼 내려간다. */
  newName: 24,
  newChips: 32,
  newNameShift: 22,
  newChipH: 30,

  /** 가운데 열: 전처리 상자, 학습, 결과. */
  boxH: 52,
  prepX: 430,
  prepW: 150,
  // 학습 상자는 두 줄(이름과 유형 칩)이고 칩이 세 로케일의 가장 긴 유형 이름(en Classification, ja クラスタリング)을 통째로 담는 폭이다.
  // 넓어진 만큼은 전처리 상자의 폭과 열 간격, 실험·예측 원의 간격에서 흡수해 캔버스 폭은 그대로다.
  learnX: 608,
  learnW: 190,
  evalX: 815,
  evalW: 114,
  /** 실험 원 밑에서 결과로 내려가는 선이 시작하는 틈. */
  expBottomGap: 2,
  /** 나누지 않는 분할 막대(군집화·별도 테스트 데이터)에서 훈련 선이 나오는 자리(안쪽 폭의 몫). */
  trainShare: 0.4,
  /** 테스트 쪽 전처리 상자의 가운데가 분할 막대에서 내려가는 길이. */
  p2BelowSplit: 56,
  /** 기준 선 이름표가 줄기에서 오른쪽으로 떨어진 길이. */
  basisLabelLeft: 10,
  /** 첫 줄(훈련 → 모델 → 예측)의 가운데 높이. */
  rowY: 140,
  /** 결과 상자의 가운데 높이가 정해지지 않을 때(군집화). */
  evalFallbackY: 300,
  /** 실험·예측 원. */
  expCx: 872,
  predCx: 1022,
  circleR: 46,
  /** 학습 상자만 두 줄(이름과 유형 칩)이라 키운다. 가운데 높이는 다른 상자와 같아 선의 끝점이 그대로다. */
  learnH: 80,

  /** 선. 굵기는 평소와 강조일 때다. 꺾임의 반지름과 화살촉의 크기. */
  stroke: 2,
  strokeLit: 3.5,
  corner: 8,
  arrowHead: 12,
  /** 선의 시작과 끝이 데이터 카드 밖으로 나가는 x. */
  exitX: 370,
  /** 훈련 선이 분할 막대에서 곡선으로 올라가는 모양. */
  trainRise: 58,
  trainBend: 90,
  trainBendRise: 50,
  trainMid: 150,
  trainMidRise: 74,
  trainFar: 190,
  trainFarRise: 90,
  trainJoinX: 406,
  /** 군집화에서 훈련 쪽 전처리 상자 밑으로 내려오는 선의 x(상자 왼쪽에서). */
  clusterDropX: 20,
  /** 선 끝과 상자·원 사이의 틈. 화살촉의 모양이 다르므로 끝마다 다르다. */
  gapEvalLeft: 4,
  gapExpLeft: 4,
  gapPredLeft: 6,
  gapEvalTop: 6,
  gapPredBottom: 6,
  gapPrepTop: 2,
  /** 기준 선: 줄기가 내려가 갈라지는 높이, 고리가 상자 오른쪽으로 나가는 길이와 새 데이터 쪽으로 올라오는 높이. */
  basisJunction: 72,
  basisLoopOut: 20,
  basisLoopRise: 64,
  basisDot: 3.5,
  basisLabelDrop: 38,
  basisLabelW: 260,

  /** 칩 줄의 두 칸 폭(전체 데이터·테스트 카드). 새 데이터 카드는 한 칸이다. */
  chipColA: 128,
  chipColB: 156,
  /** 두 칩 사이의 틈. 안쪽 폭(`innerW`)은 두 칸과 이 틈의 합이다. */
  chipGap: 8,
  /** 카드 모서리. 선 밑에 까는 바탕색 굵은 선의 굵기. */
  cardRadius: 14,
  haloStroke: 6,
  /** 깔때기 두 가장자리 선의 굵기와 점선(켜짐·꺼짐), 채움과 선의 불투명도. */
  railStroke: 1.5,
  railDashOn: 3,
  railDashOff: 3,
  funnelFillOpacity: 0.15,
  railOpacity: 0.6,
  /** 화살촉이 선 끝에서 물러서 앉는 자리(마커 좌표계, 촉 10칸 중). */
  arrowRefX: 8,
  arrowRefY: 5,
} as const

// 최소 조각이 막대보다 높으면 조각이 길쭉한 알이 되어 비례를 거짓으로 말한다. 모듈이 뜰 때 바로 깨뜨린다.
if (FLOW_MIN_SEGMENT_PX > FLOW_GEOMETRY.barH) {
  throw new Error('FLOW_MIN_SEGMENT_PX must not exceed the bar height')
}
// 화살촉 앞 직선이 촉보다 짧으면 곡선이 촉까지 휘어 삐뚤게 놓인다.
if (FLOW_ARROW_LEAD_PX < FLOW_GEOMETRY.arrowHead) {
  throw new Error('FLOW_ARROW_LEAD_PX must not be shorter than the arrowhead')
}

/** 그리는 층. **아래에서 위로** 쌓인다 — 깔때기가 막대 밑에, 선이 맨 위에 선다. */
export const FLOW_LAYERS = [
  'cards',
  'funnel',
  'fileBar',
  'trainLine',
  'splitBars',
  'lines',
] as const
export type FlowLayer = (typeof FLOW_LAYERS)[number]

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface Point {
  readonly x: number
  readonly y: number
}

/** 막대 조각이 어떻게 그려지는가. `outline`은 수를 모를 때의 설정 비율이다. */
export type FlowPieceLook = 'solid' | 'outline' | 'gray'

export interface FlowPiece {
  readonly node: FlowNodeId
  /** 눌러서 따로 설명하는 조각의 묶음. 훈련·테스트 조각은 노드가 곧 대상이라 없다. */
  readonly segment: FlowSegment | null
  readonly look: FlowPieceLook
  readonly layer: 'fileBar' | 'splitBars'
  /** 그려지는 사각형. */
  readonly rect: Rect
  /** 누르는 자리. 그려진 것을 덮고 한 변이 `hitMin` 이상이다. */
  readonly hit: Rect
}

export interface FlowLine {
  /** `from>to`. 렌더러와 강조가 같은 글자로 부른다. */
  readonly key: string
  readonly from: FlowNodeId
  readonly to: FlowNodeId
  readonly flow: FlowFlow
  readonly pending: boolean
  readonly d: string
  readonly arrow: boolean
  /** 다른 선 위를 지나는 선. 바탕색 굵은 선을 밑에 깐다. */
  readonly halo: boolean
  /** 선이 끝나는 자리와 마지막 직선의 길이. 화살촉 앞이 곧은지 재는 데 쓴다. */
  readonly end: Point
  readonly lead: number
  readonly layer: 'trainLine' | 'lines'
}

export interface FlowCardLayout {
  readonly id: 'whole' | 'testFile' | 'new'
  readonly node: 'file' | 'test' | 'new'
  readonly rect: Rect
  readonly headY: number
  /** 파일 이름 줄. 새 데이터 카드는 이름이 없으면 줄이 없다. */
  readonly nameY: number | null
  readonly chipsY: number
}

/** 막대에 들어갈 수. 모르면 `null`을 넘기고 그림은 윤곽이다. */
export interface FlowBarValues {
  readonly train: number
  readonly test: number
  /** 전체 데이터 파일에서 사용하지 않는 몫 — 사용할 수 없는 행과 추출하지 않은 행의 합. */
  readonly gray: number
  /** 별도 테스트 파일의 사용하는 몫과 사용하지 않는 몫. 별도 테스트 데이터가 아니면 `null`이다. */
  readonly testFile: { readonly usable: number; readonly gray: number } | null
}

export interface FlowLayoutInput {
  readonly bars: FlowBarValues | null
  /** 설정의 테스트 비율. 수를 모를 때 분할 막대를 이 비율의 윤곽으로 그린다. */
  readonly testSize: number
  /** 칩이 두 줄로 꺾이는가. 글자 폭을 재야 알므로 렌더러가 알려 준다. */
  readonly chipWrap: boolean
}

export interface FlowLayout {
  readonly width: number
  readonly height: number
  readonly cards: readonly FlowCardLayout[]
  /** 파일 막대에서 분할 막대로 퍼지는 깔때기의 채움과 두 가장자리 선. */
  readonly funnel: { readonly fill: string; readonly rails: readonly string[] }
  readonly pieces: readonly FlowPiece[]
  readonly lines: readonly FlowLine[]
  /** 기준 선의 줄기. 갈래가 하나도 없으면 `null`이다. */
  readonly trunk: {
    readonly d: string
    readonly pending: boolean
    readonly dot: Point
    readonly label: Rect
  } | null
  /** 분할 글자 줄(`분할 80 : 20`)의 윗변. 나누는 막대가 아니면 `null`이다. */
  readonly splitTextY: number | null
  /** 분할 막대 밑 이름 줄. 노드가 곧 조각의 이름이다. */
  readonly captions: { readonly y: number; readonly nodes: readonly FlowNodeId[] }
  readonly boxes: Readonly<Partial<Record<'p1' | 'p2' | 'p3' | 'learn' | 'eval', Rect>>>
  readonly circles: Readonly<Record<'exp' | 'pred', Rect>>
}

const G = FLOW_GEOMETRY

/** 좌표를 소수 첫째 자리로 줄인다. 경로 글자가 부동소수의 꼬리를 달지 않게 한다. */
const num = (value: number): number => Math.round(value * 10) / 10

/**
 * 막대 조각의 폭을 나눈다. **0인 몫은 조각이 없다(`null`).** 아무리 작아도 `FLOW_MIN_SEGMENT_PX`를
 * 지키고, 모자란 만큼은 아직 최소를 넘는 조각이 비례해서 낸다. 폭과 틈의 합은 `total`과 같다.
 */
export function segmentWidths(
  values: readonly number[],
  total: number,
  gap: number,
  min: number = FLOW_MIN_SEGMENT_PX,
): ({ readonly x: number; readonly w: number } | null)[] {
  const present = values.map((_, at) => at).filter((at) => (values[at] ?? 0) > 0)
  const out: ({ x: number; w: number } | null)[] = values.map(() => null)
  if (present.length === 0) return out
  const room = total - gap * (present.length - 1)
  const sum = present.reduce((acc, at) => acc + (values[at] ?? 0), 0)
  const widths = present.map((at) => (room * (values[at] ?? 0)) / sum)
  const fixed = new Set<number>()
  // 최소에 못 미친 조각을 최소로 올리고 그만큼을 안 고정된 조각에서 뺀다. 조각이 둘이라 두 판이면 끝나지만
  // 조각이 늘어도 되도록 고정점까지 돈다 — 한 번 고정된 조각은 다시 줄지 않아 조각 수를 넘겨 돌지 않는다.
  for (let round = 0; round <= present.length; round += 1) {
    let deficit = 0
    widths.forEach((width, at) => {
      if (width < min && !fixed.has(at)) {
        deficit += min - width
        widths[at] = min
        fixed.add(at)
      }
    })
    if (deficit === 0) break
    const free = widths.map((width, at) => (fixed.has(at) ? 0 : width))
    const freeSum = free.reduce((acc, width) => acc + width, 0)
    if (freeSum === 0) break
    free.forEach((width, at) => {
      if (!fixed.has(at)) widths[at] = width - (deficit * width) / freeSum
    })
  }
  let x = 0
  present.forEach((at, order) => {
    const width = widths[order] ?? 0
    out[at] = { x, w: width }
    x += width + gap
  })
  return out
}

/** 그려진 사각형을 덮고 한 변이 `hitMin` 이상인 누르는 자리. */
function hitOf(rect: Rect, pad: number): Rect {
  const width = Math.max(rect.w + 2 * pad, G.hitMin)
  const height = Math.max(rect.h + 2 * pad, G.hitMin)
  return {
    x: rect.x + rect.w / 2 - width / 2,
    y: rect.y + rect.h / 2 - height / 2,
    w: width,
    h: height,
  }
}

function boxOf(x: number, cy: number, w: number, h: number = G.boxH): Rect {
  return { x, y: cy - h / 2, w, h }
}

function circleOf(cx: number, cy: number): Rect {
  return { x: cx - G.circleR, y: cy - G.circleR, w: 2 * G.circleR, h: 2 * G.circleR }
}

/** 경로가 닿는 자리의 사정. 선마다 이 안에서 경로를 짓는다. */
interface Spots {
  readonly p1Y: number
  readonly p2Y: number
  readonly p3Y: number
  readonly evalY: number
  /** 테스트 조각의 가운데 x. 별도 테스트 데이터이거나 테스트 조각이 없으면 `null`이다. */
  readonly testCx: number | null
  readonly testFromFile: boolean
  readonly splitY: number
  readonly trainCx: number
  readonly trainOutline: boolean
  readonly trunkX: number
  readonly junctionY: number
}

interface Route {
  readonly d: string
  readonly arrow: boolean
  readonly halo: boolean
  readonly end: Point
  /** 마지막 직선의 길이. */
  readonly lead: number
}

const C = G.corner

/** 가로로 끝나는 선. `lead`는 마지막 꺾임 뒤의 직선이다. */
const horizontal = (d: string, end: Point, lead: number, halo = false): Route => ({
  d,
  arrow: true,
  halo,
  end,
  lead,
})

const P_RIGHT = G.prepX + G.prepW
const EXP_RIGHT = G.expCx + G.circleR
const EVAL_IN = G.evalX - G.gapEvalLeft
const PRED_IN = G.predCx - G.circleR - G.gapPredLeft
const EXP_IN = G.expCx - G.circleR - G.gapExpLeft

/**
 * **간선에서 경로를 짓는 표.** 키는 `from>to`다. 표에 없는 간선(전체 데이터에서 훈련·테스트로 가는 것)은
 * 선이 아니라 깔때기와 막대가 말한다. 간선이 모델에 없으면 이 표의 줄이 안 불린다.
 */
const ROUTES: Readonly<Partial<Record<string, (spots: Spots) => Route>>> = {
  'train>p1': (s) => {
    const y0 = s.trainOutline ? s.splitY : s.splitY + G.barH / 2
    const x = s.trainCx
    return horizontal(
      `M${num(x)},${y0} C${num(x)},${y0 - G.trainRise} ${num(x + G.trainBend)},${y0 - G.trainBendRise} ${num(x + G.trainMid)},${y0 - G.trainMidRise} C${num(x + G.trainFar)},${y0 - G.trainFarRise} ${G.exitX},${s.p1Y} ${G.trainJoinX},${s.p1Y} H${G.prepX}`,
      { x: G.prepX, y: s.p1Y },
      G.prepX - G.trainJoinX,
    )
  },
  // 별도 테스트 데이터는 카드 오른쪽에서 곧장 나가고, 나눈 테스트 조각은 막대에서 내려와 꺾인다.
  'test>p2': (s) =>
    s.testFromFile || s.testCx === null
      ? horizontal(`M${G.exitX},${s.p2Y} H${G.prepX}`, { x: G.prepX, y: s.p2Y }, G.prepX - G.exitX)
      : horizontal(
          `M${num(s.testCx)},${s.splitY + G.barH} V${s.p2Y - C} Q${num(s.testCx)},${s.p2Y} ${num(s.testCx) + C},${s.p2Y} H${G.prepX}`,
          { x: G.prepX, y: s.p2Y },
          G.prepX - (s.testCx + C),
        ),
  'new>p3': (s) =>
    horizontal(`M${G.exitX},${s.p3Y} H${G.prepX}`, { x: G.prepX, y: s.p3Y }, G.prepX - G.exitX),
  'p1>learn': (s) =>
    horizontal(`M${P_RIGHT},${s.p1Y} H${G.learnX}`, { x: G.learnX, y: s.p1Y }, G.learnX - P_RIGHT),
  'learn>exp': (s) =>
    horizontal(
      `M${G.learnX + G.learnW},${s.p1Y} H${EXP_IN}`,
      { x: EXP_IN, y: s.p1Y },
      EXP_IN - (G.learnX + G.learnW),
    ),
  'p2>eval': (s) =>
    horizontal(`M${P_RIGHT},${s.p2Y} H${EVAL_IN}`, { x: EVAL_IN, y: s.p2Y }, EVAL_IN - P_RIGHT),
  // 군집화: 결과가 훈련 쪽 전처리를 곧장 받는다. 상자 밑에서 내려와 결과 높이에서 꺾는다.
  'p1>eval': (s) => {
    const x = G.prepX + G.clusterDropX
    return horizontal(
      `M${x},${s.p1Y + G.boxH / 2} V${s.evalY - C} Q${x},${s.evalY} ${x + C},${s.evalY} H${EVAL_IN}`,
      { x: EVAL_IN, y: s.evalY },
      EVAL_IN - (x + C),
    )
  },
  // 실험 원에서 결과 상자로 내려온다. 끝이 위를 보고, 마지막 직선이 곧 세로 길이다.
  'exp>eval': (s) => {
    const y0 = s.p1Y + G.circleR + G.expBottomGap
    const y1 = s.evalY - G.boxH / 2 - G.gapEvalTop
    return {
      d: `M${G.expCx},${y0} V${y1}`,
      arrow: true,
      halo: false,
      end: { x: G.expCx, y: y1 },
      lead: y1 - y0,
    }
  },
  'exp>pred': (s) =>
    horizontal(`M${EXP_RIGHT},${s.p1Y} H${PRED_IN}`, { x: PRED_IN, y: s.p1Y }, PRED_IN - EXP_RIGHT),
  // 새 데이터 쪽 전처리에서 예측 원 밑으로 올라간다. 오른쪽으로 가다 위로 꺾는다.
  'p3>pred': (s) => {
    const turn = G.predCx - C
    const y1 = s.p1Y + G.circleR + G.gapPredBottom
    return {
      d: `M${P_RIGHT},${s.p3Y} H${turn} Q${G.predCx},${s.p3Y} ${G.predCx},${s.p3Y - C} V${y1}`,
      arrow: true,
      halo: false,
      end: { x: G.predCx, y: y1 },
      lead: s.p3Y - C - y1,
    }
  },
  // 기준 선의 갈래. 줄기에서 내려와 상자 위에서 끝난다.
  'p1>p2': (s) => {
    const y1 = s.p2Y - G.boxH / 2 - G.gapPrepTop
    return {
      d: `M${s.trunkX},${s.junctionY} V${y1}`,
      arrow: true,
      halo: false,
      end: { x: s.trunkX, y: y1 },
      lead: y1 - s.junctionY,
    }
  },
  // 다른 상자 오른쪽을 돌아 새 데이터 쪽 전처리 위로 내려온다. 바탕색 굵은 선을 밑에 깐다.
  'p1>p3': (s) => {
    const out = P_RIGHT + G.basisLoopOut
    const loopY = s.p3Y - G.basisLoopRise
    const y1 = s.p3Y - G.boxH / 2 - G.gapPrepTop
    const left = s.trunkX + C
    return {
      d: `M${s.trunkX},${s.junctionY} H${out - C} Q${out},${s.junctionY} ${out},${s.junctionY + C} V${loopY - C} Q${out},${loopY} ${out - C},${loopY} H${left} Q${s.trunkX},${loopY} ${s.trunkX},${loopY + C} V${y1}`,
      arrow: true,
      halo: true,
      end: { x: s.trunkX, y: y1 },
      lead: y1 - (loopY + C),
    }
  },
}

/** 전체 데이터에서 훈련·테스트로 가는 간선은 선이 아니라 깔때기와 막대가 말한다. */
const DRAWN_BY_BARS: ReadonlySet<string> = new Set(['file>train', 'file>test'])

/** 이 간선이 선으로 그려지는가. 아니면 막대와 깔때기가 말한다. */
export function isDrawnByBars(edge: Pick<FlowEdge, 'from' | 'to'>): boolean {
  return DRAWN_BY_BARS.has(edgeKey(edge.from, edge.to))
}

/**
 * 모델을 좌표로 옮긴다. **모델에 없는 노드와 간선은 그리지 않는다** — 그 자리를 비워 두는 것이 아니라
 * 아예 값이 없다(`boxes.p2`는 군집화에서 `undefined`다).
 */
export function layoutOf(model: FlowModel, input: FlowLayoutInput): FlowLayout {
  const has = (id: FlowNodeId): boolean => model.nodes.some((node) => node.id === id)
  const shift = input.chipWrap ? G.chipWrapShift : 0
  const holdout = model.splits
  const bars = input.bars

  // --- 전체 데이터 카드.
  const inner0 = G.cardTop + G.cardPad
  const fileBarY = inner0 + G.fileBarOffset + shift
  const splitY = fileBarY + G.fileToSplit
  const wholeBottom = splitY + (holdout ? G.captionTwo : G.captionOne) + G.lineH + G.cardPad
  const splitTextY = holdout ? splitY + G.splitText : null
  const captionY = splitY + (holdout ? G.captionTwo : G.captionOne)
  let cursor = wholeBottom + G.cardGap

  const cards: FlowCardLayout[] = [
    {
      id: 'whole',
      node: 'file',
      rect: { x: G.cardX, y: G.cardTop, w: G.cardW, h: wholeBottom - G.cardTop },
      headY: inner0,
      nameY: inner0 + G.nameRow,
      chipsY: inner0 + G.chipsRow,
    },
  ]

  // --- 별도 테스트 데이터 카드.
  let testBarY: number | null = null
  if (model.provided) {
    const top = cursor
    const top0 = top + G.cardPad
    testBarY = top0 + G.fileBarOffset + shift
    const bottom = testBarY + G.barH + G.cardPad
    cards.push({
      id: 'testFile',
      node: 'test',
      rect: { x: G.cardX, y: top, w: G.cardW, h: bottom - top },
      headY: top0,
      nameY: top0 + G.nameRow,
      chipsY: top0 + G.chipsRow,
    })
    cursor = bottom + G.cardGap
  }

  // --- 새 데이터 카드.
  const named = model.cards.find((card) => card.id === 'new')?.fileName !== undefined
  const newTop = cursor + G.cardPad
  const newChipsY = newTop + G.newChips + (named ? G.newNameShift : 0)
  const newBottom = newChipsY + G.newChipH + G.cardPad
  cards.push({
    id: 'new',
    node: 'new',
    rect: { x: G.cardX, y: cursor, w: G.cardW, h: newBottom - cursor },
    headY: newTop,
    nameY: named ? newTop + G.newName : null,
    chipsY: newChipsY,
  })

  const height = Math.max(newBottom, G.minHeight) + G.bottomPad

  // --- 막대 조각.
  const pieces: FlowPiece[] = []
  const known = bars !== null
  // 수를 모르면 **모든 막대가 윤곽이다**(결정 120 "행 수는 열 때 구한다") — 진한 막대는 "다 쓰인다"로 읽히므로
  // 숫자를 지어내는 것과 같다. 나누는 막대만이 아니라 전체 데이터·학습에 사용하는 데이터·별도 테스트 막대도 같다.
  const barLook: FlowPieceLook = known ? 'solid' : 'outline'
  const used = !known ? 1 : holdout ? bars.train + bars.test : bars.train
  const fileSegments = segmentWidths([Math.max(used, 1), known ? bars.gray : 0], G.innerW, 0)
  const blue = fileSegments[0] ?? { x: 0, w: G.innerW }
  const piece = (
    node: FlowNodeId,
    segment: FlowSegment | null,
    look: FlowPieceLook,
    layer: FlowPiece['layer'],
    rect: Rect,
  ): FlowPiece => ({
    node,
    segment,
    look,
    layer,
    rect,
    hit: hitOf(rect, look === 'solid' ? G.barHalo : 0),
  })

  const gray = fileSegments[1]
  if (gray) {
    // 회색은 파란 막대 밑에 깔린 트랙이다. 왼쪽 일부가 파란 조각 밑으로 들어가 틈이 안 보인다.
    pieces.push(
      piece('file', 'file:gray', 'gray', 'fileBar', {
        x: G.innerX + gray.x - G.grayTuck,
        y: fileBarY,
        w: gray.w + G.grayTuck,
        h: G.barH,
      }),
    )
  }
  pieces.push(
    piece('file', 'file:bar', barLook, 'fileBar', {
      x: G.innerX + blue.x,
      y: fileBarY,
      w: blue.w,
      h: G.barH,
    }),
  )

  const usableEnd = G.innerX + blue.w
  const funnelTop = fileBarY + G.barH / 2
  const funnelBottom = splitY + G.barH / 2
  const funnel = {
    fill: `M${G.innerX},${funnelTop} H${num(usableEnd)} V${funnelTop + G.barH / 2} L${G.innerX + G.innerW},${funnelBottom} H${G.innerX}Z`,
    rails: [
      `M${G.innerX},${funnelTop + G.barH / 2} V${funnelBottom}`,
      `M${num(usableEnd)},${funnelTop + G.barH / 2} L${G.innerX + G.innerW},${funnelBottom}`,
    ],
  }

  // 분할 막대: 나눌 때는 훈련·테스트 두 조각, 그 밖에는 한 조각이다.
  let trainCx: number
  let testCx: number | null = null
  const trainOutline = !known
  if (holdout) {
    const shares = known ? [bars.train, bars.test] : [1 - input.testSize, input.testSize]
    const split = segmentWidths(shares, G.innerW, G.barGap)
    const look = barLook
    const train = split[0] ?? { x: 0, w: G.innerW }
    pieces.push(
      piece('train', null, look, 'splitBars', {
        x: G.innerX + train.x,
        y: splitY,
        w: train.w,
        h: G.barH,
      }),
    )
    trainCx = G.innerX + train.x + train.w / 2
    const test = split[1]
    if (test) {
      pieces.push(
        piece('test', null, look, 'splitBars', {
          x: G.innerX + test.x,
          y: splitY,
          w: test.w,
          h: G.barH,
        }),
      )
      testCx = G.innerX + test.x + test.w / 2
    }
  } else {
    pieces.push(
      piece('train', null, barLook, 'splitBars', {
        x: G.innerX,
        y: splitY,
        w: G.innerW,
        h: G.barH,
      }),
    )
    trainCx = G.innerX + G.innerW * G.trainShare
  }

  // 별도 테스트 데이터 카드의 막대. 회색은 같은 모양으로 파란 조각 밑에 깔린다.
  if (model.provided && testBarY !== null) {
    const testFile = bars?.testFile ?? null
    const segments = segmentWidths(
      testFile === null ? [1, 0] : [Math.max(testFile.usable, 1), testFile.gray],
      G.innerW,
      0,
    )
    const testBlue = segments[0] ?? { x: 0, w: G.innerW }
    const testGray = segments[1]
    if (testGray) {
      pieces.push(
        piece('test', 'test:gray', 'gray', 'splitBars', {
          x: G.innerX + testGray.x - G.grayTuck,
          y: testBarY,
          w: testGray.w + G.grayTuck,
          h: G.barH,
        }),
      )
    }
    pieces.push(
      piece('test', 'test:bar', testFile === null ? 'outline' : 'solid', 'splitBars', {
        x: G.innerX + testBlue.x,
        y: testBarY,
        w: testBlue.w,
        h: G.barH,
      }),
    )
  }

  // --- 높이와 자리.
  const p1Y = G.rowY
  const p3Y = newChipsY
  const p2Y = !has('p2') ? p1Y : testBarY !== null ? testBarY + G.barH / 2 : splitY + G.p2BelowSplit
  const evalY = has('p2') ? p2Y : G.evalFallbackY
  const trunkX = G.prepX + G.prepW / 2
  const spots: Spots = {
    p1Y,
    p2Y,
    p3Y,
    evalY,
    testCx,
    testFromFile: model.provided,
    splitY,
    trainCx,
    trainOutline,
    trunkX,
    junctionY: p1Y + G.basisJunction,
  }

  // --- 선. 모델의 간선마다 하나.
  const lines: FlowLine[] = []
  for (const edge of model.edges) {
    const key = edgeKey(edge.from, edge.to)
    const route = ROUTES[key]?.(spots)
    if (route === undefined) continue
    lines.push({
      key,
      from: edge.from,
      to: edge.to,
      flow: edge.flow,
      pending: edge.state === 'pending',
      d: route.d,
      arrow: route.arrow,
      halo: route.halo,
      end: route.end,
      lead: route.lead,
      layer: edge.from === 'train' ? 'trainLine' : 'lines',
    })
  }

  const branches = model.edges.filter((edge) => edge.flow === 'basis')
  const trunk =
    branches.length === 0
      ? null
      : {
          d: `M${trunkX},${p1Y + G.boxH / 2} V${spots.junctionY}`,
          // 갈래 중 하나라도 한 일이면 줄기는 실선이다.
          pending: branches.every((edge) => edge.state === 'pending'),
          dot: { x: trunkX, y: spots.junctionY },
          label: {
            x: trunkX + G.basisLabelLeft,
            y: p1Y + G.basisLabelDrop,
            w: G.basisLabelW,
            h: G.lineH,
          },
        }

  const boxes: Partial<Record<'p1' | 'p2' | 'p3' | 'learn' | 'eval', Rect>> = {
    p1: boxOf(G.prepX, p1Y, G.prepW),
    p3: boxOf(G.prepX, p3Y, G.prepW),
    learn: boxOf(G.learnX, p1Y, G.learnW, G.learnH),
    eval: boxOf(G.evalX, evalY, G.evalW),
  }
  if (has('p2')) boxes.p2 = boxOf(G.prepX, p2Y, G.prepW)

  return {
    width: G.width,
    height,
    cards,
    funnel,
    pieces,
    lines,
    trunk,
    splitTextY,
    captions: { y: captionY, nodes: holdout ? ['train', 'test'] : ['train'] },
    boxes,
    circles: { exp: circleOf(G.expCx, p1Y), pred: circleOf(G.predCx, p1Y) },
  }
}
