/**
 * 프로젝트 흐름도의 **경로 강조** — 무엇을 가리키면 무엇이 켜지는가 (`architecture.md` §8.22).
 *
 * 모델(`ml/flow.ts`)의 간선만 본다. 좌표도 DOM도 모른다 — 렌더러는 이 결과를 받아 켜진 것은 그대로,
 * 나머지는 흐리게 그린다. 흐린 것과 윤곽(아직 안 한 일)은 다른 뜻이라 섞지 않는다.
 *
 * **규칙은 둘이고 방향이 반대다.**
 *
 * - **결과 쪽 칸(전처리·학습·실험·결과·예측)을 가리키면 그 칸에 들어오는 것 전부**다 — "이 결과를 만드는 데
 *   무엇이 쓰였나". 학습 상자를 가리키면 전처리와 훈련 데이터까지 켜지고, 기준 선은 안 켜진다(학습에 들어오지
 *   않는다).
 * - **데이터 쪽 칸(전체 데이터·훈련·테스트·새 데이터)을 가리키면 거기서 나가는 경로만**이다 — "이 데이터가
 *   어디로 가나". 훈련 데이터를 가리키면 전처리 → 학습 → 실험 → 결과·예측이 켜지지만 테스트 데이터와 새 데이터는
 *   안 켜진다. 옛 규칙(닿는 결과의 위쪽 합집합)은 훈련을 가리키면 그림 전체가, 테스트를 가리켜도 훈련과 학습이
 *   켜져 "훈련 데이터가 테스트로 흘러간다"는 누수 오개념을 줄 수 있었다.
 * - **기준 선은 건너가되 거기서 멈춘다.** 훈련 쪽 전처리에서 테스트·새 데이터 쪽 전처리 상자로 가는 기준 선은
 *   켜지고 그 끝의 상자도 켜지지만, 거기서 더 나가지 않는다 — 기준은 값이 건너가는 것이지 데이터가 건너가는
 *   것이 아니다. 테스트·새 데이터 카드와 그들에서 오는 선은 안 켜진다.
 *
 * **선은 "양 끝이 켜졌는가"가 아니라 "그 경로가 실제로 지나간 선인가"로 켠다** — 테스트 색 선이 훈련 강조에 딸려
 * 켜지지 않게. 기준 선은 줄기 하나와 갈래 둘로 그려지고 줄기는 지나간 갈래가 하나라도 있으면 켠다
 * (`FlowHighlight.trunk`). 기준 선이 모델에 없으면 줄기도 없다. 군집화(테스트 줄 없음)와 이미지(기준 선 없음),
 * 별도 테스트 데이터에서도 같은 원칙이다.
 *
 * **회색 조각은 따로 가리킨다** — 누르면 자기와 같은 막대의 파란 조각만 켜진다(어디로도 안 흐르는 몫이라
 * 경로가 없다). 무는 검사: `tests/flow-highlight.spec.ts`.
 */

import type { FlowModel, FlowNodeId } from '@/ml/flow'

/** 막대 조각의 묶음. 파일 막대와 별도 테스트 막대, 각각 사용하는 쪽(`bar`)과 사용하지 않는 쪽(`gray`)이다. */
export const FLOW_SEGMENTS = ['file:bar', 'file:gray', 'test:bar', 'test:gray'] as const
export type FlowSegment = (typeof FLOW_SEGMENTS)[number]

/** 회색 조각이 켜질 때 함께 켜지는 파란 조각. 자기 막대 하나다. */
const GRAY_PARTNER: Readonly<Partial<Record<FlowSegment, FlowSegment>>> = {
  'file:gray': 'file:bar',
  'test:gray': 'test:bar',
}

/** 가리키는 대상. 노드이거나 회색 조각이다. */
export type FlowTarget =
  { readonly node: FlowNodeId } | { readonly gray: 'file:gray' | 'test:gray' }

export interface FlowHighlight {
  readonly nodes: ReadonlySet<FlowNodeId>
  /** 켜진 선. 키는 `edgeKey`다. */
  readonly edges: ReadonlySet<string>
  /** 기준 선의 줄기. 갈래가 하나라도 켜지면 켠다. 갈래가 모델에 없으면 거짓이다. */
  readonly trunk: boolean
  /**
   * 켜진 막대 조각. **`null`이면 칸의 켜짐을 따른다**(파일 칸이 켜지면 그 막대의 조각이 다 켜진다).
   * 회색 조각을 가리킨 때만 집합이고, 그때는 그 집합만 켜진다.
   */
  readonly segments: ReadonlySet<FlowSegment> | null
}

/** 선의 키. 렌더러와 검사가 같은 글자로 부른다. */
export function edgeKey(from: FlowNodeId, to: FlowNodeId): string {
  return `${from}>${to}`
}

/** 시작 칸에서 `next`를 따라 닿는 칸 전부(시작 포함). */
function reach(
  start: FlowNodeId,
  next: ReadonlyMap<FlowNodeId, readonly FlowNodeId[]>,
): Set<FlowNodeId> {
  const seen = new Set<FlowNodeId>()
  const stack: FlowNodeId[] = [start]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue
    seen.add(id)
    for (const following of next.get(id) ?? []) stack.push(following)
  }
  return seen
}

/**
 * 데이터 칸에서 **나가는 길**. 지나간 간선과 닿은 칸을 돌려준다. **기준 간선은 건너가되 그 끝에서 멈춘다** —
 * 기준 간선으로 닿은 칸은 켜지지만 거기서 더 나가지 않는다(다른 길로 닿으면 그때 나간다).
 */
function walkDown(
  model: FlowModel,
  start: FlowNodeId,
): { nodes: Set<FlowNodeId>; edges: Set<string>; trunk: boolean } {
  const nodes = new Set<FlowNodeId>([start])
  const edges = new Set<string>()
  const expanded = new Set<FlowNodeId>()
  let trunk = false
  const stack: FlowNodeId[] = [start]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (expanded.has(id)) continue
    expanded.add(id)
    for (const edge of model.edges) {
      if (edge.from !== id) continue
      edges.add(edgeKey(edge.from, edge.to))
      nodes.add(edge.to)
      if (edge.flow === 'basis') trunk = true
      else stack.push(edge.to)
    }
  }
  return { nodes, edges, trunk }
}

function adjacency(model: FlowModel, direction: 'up' | 'down'): Map<FlowNodeId, FlowNodeId[]> {
  const map = new Map<FlowNodeId, FlowNodeId[]>()
  for (const edge of model.edges) {
    const [near, far] = direction === 'up' ? [edge.to, edge.from] : [edge.from, edge.to]
    map.set(near, [...(map.get(near) ?? []), far])
  }
  return map
}

const EMPTY: FlowHighlight = { nodes: new Set(), edges: new Set(), trunk: false, segments: null }

/** 대상을 가리켰을 때 켜지는 것. 모델에 없는 칸이면 아무것도 안 켜진다. */
export function highlightOf(model: FlowModel, target: FlowTarget): FlowHighlight {
  if ('gray' in target) {
    const partner = GRAY_PARTNER[target.gray]
    const segments = new Set<FlowSegment>([
      target.gray,
      ...(partner === undefined ? [] : [partner]),
    ])
    return { ...EMPTY, segments }
  }

  const node = model.nodes.find((entry) => entry.id === target.node)
  if (node === undefined) return EMPTY

  if (node.kind === 'data') {
    const down = walkDown(model, node.id)
    return { nodes: down.nodes, edges: down.edges, trunk: down.trunk, segments: null }
  }

  // 결과 쪽 칸: 들어오는 것 전부. 닿은 칸 안에서 서로 이어진 선이 지나간 선이다.
  const nodes = reach(node.id, adjacency(model, 'up'))
  const edges = new Set<string>()
  let trunk = false
  for (const edge of model.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue
    edges.add(edgeKey(edge.from, edge.to))
    if (edge.flow === 'basis') trunk = true
  }
  return { nodes, edges, trunk, segments: null }
}
