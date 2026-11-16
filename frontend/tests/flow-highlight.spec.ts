/**
 * **경로 강조** (`ml/flow-highlight.ts`, `architecture.md` §8.22) — 무엇을 가리키면 무엇이 켜지는가.
 *
 * 열여섯 경우 전부에서 모든 노드를 가리켜 보고(완전성), 그다음 **켜지면 안 되는 것**을 못 박는다 —
 * 새 데이터가 결과에 닿는 것처럼 보이거나, 학습 상자에 기준 선이 들어오는 것처럼 보이면 학생이
 * 누수의 방향을 거꾸로 배운다.
 */

import { describe, expect, it } from 'vitest'

import type { FlowModel, FlowNodeId, FlowPrep } from '../src/ml/flow'
import { edgeKey, FLOW_SEGMENTS, highlightOf } from '../src/ml/flow-highlight'
import { FLOW_CASES, modelOf, withTask } from './fixtures/flow-cases'
import { projectFile, projectFileWithTestDataset } from './fixtures/project'

const PREPS: (FlowPrep | undefined)[] = [undefined, 'preprocess', 'preprocessOff']

/** 모델이 있는 경우만 — 데이터가 없는 경우(15)는 그릴 모델이 없다. */
function modelsOfCases(): { title: string; model: FlowModel }[] {
  const found: { title: string; model: FlowModel }[] = []
  for (const entry of FLOW_CASES) {
    for (const prep of PREPS) {
      const model = modelOf(entry.build(), prep)
      if (model !== null)
        found.push({ title: `${entry.no}. ${entry.title} / ${prep ?? 'unknown'}`, model })
    }
  }
  return found
}

const CASES = modelsOfCases()

function lit(model: FlowModel, node: FlowNodeId) {
  return highlightOf(model, { node })
}

describe('열여섯 경우 × 모든 노드', () => {
  it('모델이 있는 경우를 실제로 훑는다 — 데이터 없음(15)만 빠진다', () => {
    const numbers = new Set(CASES.map((entry) => entry.title.split('.')[0]))
    expect(numbers.size).toBe(15)
    expect(numbers.has('15')).toBe(false)
  })

  it.each(CASES.map((entry) => [entry.title, entry.model] as const))(
    '%s: 가리킨 노드는 늘 자기가 켜지고, 켜진 선은 양 끝이 켜진 칸이다',
    (_title, model) => {
      const known = new Set(model.edges.map((edge) => edgeKey(edge.from, edge.to)))
      for (const node of model.nodes) {
        const found = lit(model, node.id)
        expect(found.nodes.has(node.id), node.id).toBe(true)
        for (const key of found.edges) {
          expect(known.has(key), `${node.id}: ${key}`).toBe(true)
          const [from, to] = key.split('>') as [FlowNodeId, FlowNodeId]
          expect(found.nodes.has(from) && found.nodes.has(to), `${node.id}: ${key}`).toBe(true)
        }
        // 켜진 칸은 모델의 칸이다.
        for (const id of found.nodes) {
          expect(
            model.nodes.some((entry) => entry.id === id),
            `${node.id}: ${id}`,
          ).toBe(true)
        }
        expect(found.segments).toBeNull()
      }
    },
  )

  it.each(CASES.map((entry) => [entry.title, entry.model] as const))(
    '%s: 결과 쪽 칸은 들어오는 것 전부이고 데이터 쪽 칸은 닿는 곳의 입구 전부다',
    (_title, model) => {
      for (const node of model.nodes) {
        const expected =
          node.kind === 'result'
            ? ancestors(model, node.id)
            : new Set([...descendants(model, node.id)].flatMap((id) => [...ancestors(model, id)]))
        expect([...lit(model, node.id).nodes].sort(), node.id).toEqual([...expected].sort())
      }
    },
  )
})

/**
 * 구현과 다른 방법으로 센 정답. **고정점을 찾을 때까지 간선을 훑는다** — 구현은 스택으로 걷는다.
 * 둘이 같은 걸음을 밟으면 같은 틀린 답을 낼 수 있어서 방법을 달리했다.
 */
function closure(model: FlowModel, start: FlowNodeId, direction: 'up' | 'down'): Set<FlowNodeId> {
  const found = new Set<FlowNodeId>([start])
  for (let changed = true; changed;) {
    changed = false
    for (const edge of model.edges) {
      const [near, far] = direction === 'up' ? [edge.to, edge.from] : [edge.from, edge.to]
      if (found.has(near) && !found.has(far)) {
        found.add(far)
        changed = true
      }
    }
  }
  return found
}
const ancestors = (model: FlowModel, id: FlowNodeId) => closure(model, id, 'up')
const descendants = (model: FlowModel, id: FlowNodeId) => closure(model, id, 'down')

describe('켜지면 안 되는 것', () => {
  const trained = modelOf(projectFile(), 'preprocess')!

  it('실험 원을 가리키면 결과와 예측은 안 켜진다 — 둘 다 실험의 다음이다', () => {
    const found = lit(trained, 'exp')
    expect([...found.nodes].sort()).toEqual(['exp', 'file', 'learn', 'p1', 'train'])
    expect(found.nodes.has('eval')).toBe(false)
    expect(found.nodes.has('pred')).toBe(false)
  })

  it('새 데이터를 가리키면 예측까지 켜지고 결과와 테스트 쪽은 안 켜진다', () => {
    const found = lit(trained, 'new')
    expect(found.nodes.has('pred')).toBe(true)
    for (const id of ['eval', 'test', 'p2'] as const) {
      expect(found.nodes.has(id), id).toBe(false)
    }
    expect(found.edges.has(edgeKey('p2', 'eval'))).toBe(false)
  })

  it('학습 상자를 가리켜도 기준 선은 안 켜진다 — 학습에 들어오지 않는다', () => {
    const found = lit(trained, 'learn')
    expect([...found.nodes].sort()).toEqual(['file', 'learn', 'p1', 'train'])
    expect(found.trunk).toBe(false)
    expect(found.edges.has(edgeKey('p1', 'p2'))).toBe(false)
    expect(found.edges.has(edgeKey('p1', 'p3'))).toBe(false)
  })

  it('테스트 데이터를 가리키면 새 데이터 쪽은 안 켜진다', () => {
    const found = lit(trained, 'test')
    for (const id of ['new', 'p3', 'pred'] as const) {
      expect(found.nodes.has(id), id).toBe(false)
    }
  })
})

describe('기준 선의 줄기와 갈래', () => {
  const holdout = modelOf(projectFile(), 'preprocess')!

  it('결과를 가리키면 테스트 쪽 갈래만 켜지고 줄기도 켜진다', () => {
    const found = lit(holdout, 'eval')
    expect(found.edges.has(edgeKey('p1', 'p2'))).toBe(true)
    expect(found.edges.has(edgeKey('p1', 'p3'))).toBe(false)
    expect(found.trunk).toBe(true)
  })

  it('예측을 가리키면 새 데이터 쪽 갈래만 켜진다', () => {
    const found = lit(holdout, 'pred')
    expect(found.edges.has(edgeKey('p1', 'p3'))).toBe(true)
    expect(found.edges.has(edgeKey('p1', 'p2'))).toBe(false)
    expect(found.trunk).toBe(true)
  })

  it('파일을 가리키면 두 갈래와 줄기가 다 켜진다', () => {
    const found = lit(holdout, 'file')
    expect(found.edges.has(edgeKey('p1', 'p2'))).toBe(true)
    expect(found.edges.has(edgeKey('p1', 'p3'))).toBe(true)
    expect(found.trunk).toBe(true)
  })

  it('갈래가 하나도 안 켜지면 줄기도 안 켜진다', () => {
    expect(lit(holdout, 'p2').trunk).toBe(true) // p2는 기준 선의 끝이다
    expect(lit(holdout, 'test').trunk).toBe(true) // 테스트가 닿는 결과가 기준을 받는다
    expect(lit(holdout, 'exp').trunk).toBe(false)
  })

  it.each([
    ['unknown', undefined],
    ['preprocessOff', 'preprocessOff'],
  ] as const)('전처리가 %s이면 모델에 기준 선이 없어 줄기도 안 켜진다', (_name, prep) => {
    const model = modelOf(projectFile(), prep)!
    for (const node of model.nodes) {
      const found = lit(model, node.id)
      expect(found.trunk, node.id).toBe(false)
      expect(
        [...found.edges].some((key) => key === edgeKey('p1', 'p2') || key === edgeKey('p1', 'p3')),
        node.id,
      ).toBe(false)
    }
  })

  it('이미지는 백본이라 기준 선도 줄기도 없다', () => {
    const model = CASES.find((entry) => entry.title.startsWith('11.'))!.model
    expect(model.prep).toBe('backbone')
    for (const node of model.nodes) expect(lit(model, node.id).trunk, node.id).toBe(false)
  })
})

describe('유형과 분할 방식에 따라 경로가 달라진다', () => {
  it('군집의 결과는 훈련 쪽 전처리를 곧장 받는다 — 테스트 줄이 없다', () => {
    const model = modelOf(withTask(projectFile(), 'clustering'), 'preprocess')!
    const found = lit(model, 'eval')
    expect([...found.nodes].sort()).toEqual(['eval', 'exp', 'file', 'learn', 'p1', 'train'])
    expect(found.edges.has(edgeKey('p1', 'eval'))).toBe(true)
  })

  it('별도 테스트 데이터에는 파일에서 테스트로 가는 선이 없어 그 선이 안 켜진다', () => {
    const provided = modelOf(projectFileWithTestDataset(), 'preprocess')!
    expect(provided.edges.some((edge) => edge.from === 'file' && edge.to === 'test')).toBe(false)
    for (const node of provided.nodes) {
      expect(lit(provided, node.id).edges.has(edgeKey('file', 'test')), node.id).toBe(false)
    }
    // 같은 노드를 holdout에서 가리키면 그 선이 켜진다 — 둘의 차이가 이 선 하나다.
    const holdout = modelOf(projectFile(), 'preprocess')!
    expect(lit(holdout, 'test').edges.has(edgeKey('file', 'test'))).toBe(true)
  })

  it('별도 테스트 데이터에서도 파일은 훈련을 거쳐 결과에 닿는다', () => {
    const provided = modelOf(projectFileWithTestDataset(), 'preprocess')!
    expect(lit(provided, 'file').nodes.has('eval')).toBe(true)
    // 테스트는 다른 파일에서 오지만 결과를 만드는 입구라 켜진다. 선만 없다.
    expect(lit(provided, 'file').nodes.has('test')).toBe(true)
  })
})

describe('회색 조각과 모델에 없는 칸', () => {
  const model = modelOf(projectFile(), 'preprocess')!

  it('회색 조각은 자기와 같은 막대의 파란 조각만 켠다', () => {
    const found = highlightOf(model, { gray: 'file:gray' })
    expect([...(found.segments ?? [])].sort()).toEqual(['file:bar', 'file:gray'])
    expect(found.nodes.size).toBe(0)
    expect(found.edges.size).toBe(0)
    expect(found.trunk).toBe(false)
    const test = highlightOf(model, { gray: 'test:gray' })
    expect([...(test.segments ?? [])].sort()).toEqual(['test:bar', 'test:gray'])
  })

  it('조각의 이름은 닫힌 목록이다', () => {
    expect([...FLOW_SEGMENTS].sort()).toEqual(['file:bar', 'file:gray', 'test:bar', 'test:gray'])
  })

  it('모델에 없는 칸을 가리키면 아무것도 안 켜진다', () => {
    const clustering = modelOf(withTask(projectFile(), 'clustering'))!
    const found = highlightOf(clustering, { node: 'p2' })
    expect(found.nodes.size).toBe(0)
    expect(found.edges.size).toBe(0)
    expect(found.trunk).toBe(false)
  })
})
