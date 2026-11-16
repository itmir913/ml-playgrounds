/**
 * 프로젝트 흐름도를 **화면이 그릴 때 묻는 것들** — 종류마다 다른 낱말의 키와, 강조 앞에서 무엇이 켜지고
 * 흐려지는가 (`architecture.md` §8.22). Vue도 스토어도 DOM도 모른다. 컴포넌트는 이 함수들의 답을 클래스와
 * 글자로 옮길 뿐이다.
 *
 * **종류마다 다른 낱말은 `FLOW_TEXT`에 적는다.** 화면이 `dataType`을 직접 견주지 않는다(`CLAUDE.md` §2) —
 * 표는 행·특성·타깃이고 사진은 장·사진·범주다. `Record<DataType, …>`이라 종류를 더하면 칸을 채워야 한다.
 * 키는 따옴표 리터럴로 적는다 — 조립한 키는 `locales.spec.ts`가 쓰인 키로 세지 못한다.
 *
 * **켜짐의 뜻은 하나다.** 강조가 없으면 모두 평소(`plain`)이고, 있으면 켜진 것(`lit`)과 흐린 것(`dim`)뿐이다.
 * 윤곽(아직 안 한 일)은 이 모듈이 아니라 모델의 `state`가 말한다 — 둘을 섞지 않는다.
 * 무는 검사: `tests/flow-view.spec.ts`.
 */

import type { FlowNodeId } from '@/ml/flow'
import type { FlowHighlight, FlowSegment, FlowTarget } from '@/ml/flow-highlight'
import type { FlowPiece } from '@/ml/flow-layout'
import type { DataType } from '@/project/schema'

/** 종류마다 다른 낱말의 키. */
export interface FlowText {
  /** 행(표)이나 장(사진)을 세는 문장. 수는 `{count}`다. */
  readonly countKey: string
  /** 특성 칩. 수를 알 때. */
  readonly featuresKey: string
  /** 특성 칩. 수를 모를 때. */
  readonly featuresUnknownKey: string
  /** 타깃(표)이나 범주(사진)를 정했다는 칩. */
  readonly targetKey: string
  /** 흐름도를 못 여는 이유 — 올린 데이터가 없다. */
  readonly noDataKey: string
}

export const FLOW_TEXT: Readonly<Record<DataType, FlowText>> = {
  tabular: {
    // 표의 행 수는 전처리 요약의 단위를 빌린다 — 문구가 같고(`150행`·`150 rows`), 이름 옆에서도 혼자서도 단위가
    // 붙는다. 사진은 혼자 서면 영어에 낱말이 있어야 해서(`28 photos`) 흐름도의 키를 따로 둔다(`flow.image.count`).
    countKey: 'preprocess.tabular.summaryRowUnit',
    featuresKey: 'flow.tabular.features',
    featuresUnknownKey: 'preprocess.tabular.roleFeature',
    targetKey: 'flow.tabular.targetSet',
    noDataKey: 'steps.preprocess.tabular.locked',
  },
  image: {
    countKey: 'flow.image.count',
    featuresKey: 'flow.image.features',
    featuresUnknownKey: 'flow.image.features',
    targetKey: 'flow.image.targetSet',
    noDataKey: 'steps.preprocess.image.locked',
  },
}

/** 막대 조각의 이름 중 노드의 이름이 아닌 것. 나머지 조각은 자기 노드의 이름을 쓴다. */
const PIECE_NAME_KEYS: Readonly<Partial<Record<FlowSegment, string>>> = {
  'file:bar': 'flow.usedData',
  'file:gray': 'flow.grayData',
  'test:gray': 'flow.grayData',
}

/** 조각의 이름 키. `null`이면 조각의 노드가 이름이다. */
export function pieceNameKey(piece: Pick<FlowPiece, 'segment'>): string | null {
  return piece.segment === null ? null : (PIECE_NAME_KEYS[piece.segment] ?? null)
}

/**
 * 눌러서 가리킬 수 있는 대상의 이름. **노드이거나 회색 조각이다** — 파란 조각은 자기 노드가 대상이다.
 * 가리킴(`ml/flow-hover.ts`)은 이 글자 하나만 안다.
 */
export function pieceTargetKey(piece: Pick<FlowPiece, 'node' | 'segment'>): string {
  return piece.segment === 'file:gray' || piece.segment === 'test:gray' ? piece.segment : piece.node
}

/** 대상의 이름에서 강조의 대상을. `pieceTargetKey`의 거꾸로다. */
export function targetOf(key: string): FlowTarget {
  if (key === 'file:gray' || key === 'test:gray') return { gray: key }
  return { node: key as FlowNodeId }
}

export type Emphasis = 'plain' | 'lit' | 'dim'

const emphasis = (active: boolean, lit: boolean): Emphasis =>
  !active ? 'plain' : lit ? 'lit' : 'dim'

/** 노드(상자·원·카드의 글자). */
export function nodeEmphasis(highlight: FlowHighlight | null, id: FlowNodeId): Emphasis {
  return emphasis(highlight !== null, highlight?.nodes.has(id) === true)
}

/** 막대 조각. 회색 조각을 가리켰을 때는 그 조각과 짝이 되는 파란 조각만 켜진다. */
export function pieceEmphasis(
  highlight: FlowHighlight | null,
  piece: Pick<FlowPiece, 'node' | 'segment'>,
): Emphasis {
  if (highlight === null) return 'plain'
  const segments = highlight.segments
  if (segments !== null)
    return emphasis(true, piece.segment !== null && segments.has(piece.segment))
  return emphasis(true, highlight.nodes.has(piece.node))
}

/** 선. 키는 `from>to`다. */
export function lineEmphasis(highlight: FlowHighlight | null, key: string): Emphasis {
  return emphasis(highlight !== null, highlight?.edges.has(key) === true)
}

/** 기준 선의 줄기와 점. */
export function trunkEmphasis(highlight: FlowHighlight | null): Emphasis {
  return emphasis(highlight !== null, highlight?.trunk === true)
}

/** 분할 막대 위의 비율 글자 둘. 설정의 테스트 몫(0~1)에서 훈련·테스트를 백분율로 낸다. */
export function splitPercents(testSize: number): { train: number; test: number } {
  const test = Math.round(testSize * 100)
  return { train: 100 - test, test }
}

/**
 * 기준 선의 이름 키. **나누는가가 가른다** — 나누는 유형은 "훈련 데이터 기준", 나누지 않는 유형(군집화)은
 * 훈련이라는 몫이 없어 "학습에 사용하는 데이터 기준"이다(`copy.md`). 유형을 견주지 않고 모델의 `splitsData`로 묻는다.
 */
export const FLOW_BASIS_KEYS = {
  split: 'preprocess.previewBasis',
  whole: 'flow.basisWhole',
} as const

export function basisKeyOf(splitsData: boolean): string {
  return splitsData ? FLOW_BASIS_KEYS.split : FLOW_BASIS_KEYS.whole
}
