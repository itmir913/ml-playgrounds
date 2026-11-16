/**
 * **경로 강조** (`ml/flow-highlight.ts`, `architecture.md` §8.22) — 무엇을 가리키면 무엇이 켜지는가.
 *
 * 열여섯 경우 전부에서 모든 노드를 가리켜 보고(완전성), 그다음 **켜지면 안 되는 것**을 못 박는다 —
 * 훈련 데이터를 가리켰는데 테스트 데이터가 켜지거나, 학습 상자에 기준 선이 들어오는 것처럼 보이면 학생이
 * 누수의 방향을 거꾸로 배운다. **결과 쪽 칸은 들어오는 것(위쪽)을, 데이터 쪽 칸은 나가는 길(아래쪽)만 켠다.**
 * 기준 선은 건너가되 그 끝의 전처리 상자에서 멈춘다.
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
    '%s: 결과 쪽 칸은 들어오는 것 전부이고 데이터 쪽 칸은 나가는 길만이다',
    (_title, model) => {
      for (const node of model.nodes) {
        const found = lit(model, node.id)
        if (node.kind === 'result') {
          // 켜진 칸의 부모는 모두 켜져 있고(완전), 정답과 같다.
          for (const id of found.nodes) {
            for (const parent of model.parents[id] ?? []) {
              expect(found.nodes.has(parent), `${node.id}: ${id} <- ${parent}`).toBe(true)
            }
          }
          expect([...found.nodes].sort(), node.id).toEqual([...ancestors(model, node.id)].sort())
        } else {
          // 켜진 칸은 모두 대상에서 아래로 닿는 것이다(건너뛰어 켜진 것이 없다).
          const below = descendants(model, node.id)
          for (const id of found.nodes) expect(below.has(id), `${node.id}: ${id}`).toBe(true)
          const expected = walked(model, node.id)
          expect([...found.nodes].sort(), node.id).toEqual([...expected.nodes].sort())
          expect([...found.edges].sort(), node.id).toEqual([...expected.edges].sort())
          expect(found.trunk, node.id).toBe(expected.trunk)
        }
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
/**
 * 데이터 칸에서 나가는 길의 정답. **고정점**으로 센다 — 기준 간선으로 닿은 칸은 켜지지만 나가는 칸이 아니다.
 * 나가는 칸은 시작과 기준이 아닌 간선으로 닿은 칸이다.
 */
function walked(model: FlowModel, start: FlowNodeId) {
  const lit = new Set<FlowNodeId>([start])
  const leaving = new Set<FlowNodeId>([start])
  for (let changed = true; changed;) {
    changed = false
    for (const edge of model.edges) {
      if (!leaving.has(edge.from)) continue
      if (!lit.has(edge.to)) {
        lit.add(edge.to)
        changed = true
      }
      if (edge.flow !== 'basis' && !leaving.has(edge.to)) {
        leaving.add(edge.to)
        changed = true
      }
    }
  }
  const edges = model.edges.filter((edge) => leaving.has(edge.from))
  return {
    nodes: lit,
    edges: edges.map((edge) => edgeKey(edge.from, edge.to)),
    trunk: edges.some((edge) => edge.flow === 'basis'),
  }
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

  it('학습 상자를 가리켜도 기준 선은 안 켜진다 — 학습에 들어오지 않는다', () => {
    const found = lit(trained, 'learn')
    expect([...found.nodes].sort()).toEqual(['file', 'learn', 'p1', 'train'])
    expect(found.trunk).toBe(false)
    expect(found.edges.has(edgeKey('p1', 'p2'))).toBe(false)
    expect(found.edges.has(edgeKey('p1', 'p3'))).toBe(false)
  })

  it('훈련을 가리키면 새 데이터와 테스트 카드·그 선은 꺼진다 — 기준 끝의 전처리 상자까지만 켜진다', () => {
    const found = lit(trained, 'train')
    expect([...found.nodes].sort()).toEqual([
      'eval',
      'exp',
      'learn',
      'p1',
      'p2',
      'p3',
      'pred',
      'train',
    ])
    for (const id of ['new', 'test', 'file'] as const) expect(found.nodes.has(id), id).toBe(false)
    // 테스트·새 데이터 쪽에서 오는 선과 기준 끝에서 더 나가는 선은 안 켜진다. 훈련에서 나가는 선만 켜진다.
    for (const key of ['test>p2', 'new>p3', 'file>train', 'file>test', 'p2>eval', 'p3>pred']) {
      expect(found.edges.has(key), key).toBe(false)
    }
    expect([...found.edges].sort()).toEqual(
      ['exp>eval', 'exp>pred', 'learn>exp', 'p1>learn', 'p1>p2', 'p1>p3', 'train>p1'].sort(),
    )
    expect(found.trunk).toBe(true)
  })

  it('테스트를 가리키면 훈련과 학습은 꺼지고 테스트 → 전처리 → 결과만 켜진다', () => {
    const found = lit(trained, 'test')
    expect([...found.nodes].sort()).toEqual(['eval', 'p2', 'test'])
    for (const id of ['train', 'learn', 'p1', 'exp', 'new', 'p3', 'pred'] as const) {
      expect(found.nodes.has(id), id).toBe(false)
    }
    expect([...found.edges].sort()).toEqual(['p2>eval', 'test>p2'])
    expect(found.trunk).toBe(false)
  })

  it('새 데이터를 가리키면 새 데이터 → 전처리 → 예측만 켜진다', () => {
    const found = lit(trained, 'new')
    expect([...found.nodes].sort()).toEqual(['new', 'p3', 'pred'])
    expect([...found.edges].sort()).toEqual(['new>p3', 'p3>pred'])
    expect(found.trunk).toBe(false)
  })

  it('전체 데이터를 가리키면 훈련과 테스트 두 길이 다 켜지고 새 데이터는 안 켜진다', () => {
    const found = lit(trained, 'file')
    expect([...found.nodes].sort()).toEqual([
      'eval',
      'exp',
      'file',
      'learn',
      'p1',
      'p2',
      'p3',
      'pred',
      'test',
      'train',
    ])
    expect(found.nodes.has('new')).toBe(false)
    expect(found.edges.has(edgeKey('file', 'train'))).toBe(true)
    expect(found.edges.has(edgeKey('file', 'test'))).toBe(true)
    expect(found.edges.has(edgeKey('test', 'p2'))).toBe(true)
    expect(found.edges.has(edgeKey('new', 'p3'))).toBe(false)
    expect(found.trunk).toBe(true)
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

  it('훈련·파일을 가리키면 두 갈래와 줄기가 다 켜진다 — 지나간 선이다', () => {
    for (const id of ['train', 'file'] as const) {
      const found = lit(holdout, id)
      expect(found.edges.has(edgeKey('p1', 'p2')), id).toBe(true)
      expect(found.edges.has(edgeKey('p1', 'p3')), id).toBe(true)
      expect(found.trunk, id).toBe(true)
    }
  })

  it('갈래가 하나도 지나가지 않으면 줄기도 안 켜진다', () => {
    expect(lit(holdout, 'p2').trunk).toBe(true) // 결과 쪽 칸: 기준 선이 들어온다
    expect(lit(holdout, 'test').trunk).toBe(false) // 테스트에서 나가는 길에 기준 선이 없다
    expect(lit(holdout, 'new').trunk).toBe(false)
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
    expect(lit(holdout, 'file').edges.has(edgeKey('file', 'test'))).toBe(true)
  })

  it('별도 테스트 데이터: 파일은 훈련 길만 켜고 테스트 카드는 따로 서 있다', () => {
    const provided = modelOf(projectFileWithTestDataset(), 'preprocess')!
    const file = lit(provided, 'file')
    expect(file.nodes.has('eval')).toBe(true) // 훈련 → 실험 → 결과
    expect(file.nodes.has('test')).toBe(false) // 다른 파일에서 오는 몫
    expect(file.nodes.has('p2')).toBe(true) // 기준 선이 건너가 끝에서 멈춘다
    expect([...lit(provided, 'test').nodes].sort()).toEqual(['eval', 'p2', 'test'])
    expect([...lit(provided, 'train').nodes].sort()).toEqual([
      'eval',
      'exp',
      'learn',
      'p1',
      'p2',
      'p3',
      'pred',
      'train',
    ])
  })

  it('군집화: 훈련이 곧 학습에 쓰는 몫이다 — 나가는 길은 결과와 예측, 기준 끝은 새 데이터 쪽 전처리', () => {
    const model = modelOf(withTask(projectFile(), 'clustering'), 'preprocess')!
    expect([...lit(model, 'train').nodes].sort()).toEqual([
      'eval',
      'exp',
      'learn',
      'p1',
      'p3',
      'pred',
      'train',
    ])
    expect([...lit(model, 'new').nodes].sort()).toEqual(['new', 'p3', 'pred'])
    expect([...lit(model, 'file').nodes].sort()).toEqual([
      'eval',
      'exp',
      'file',
      'learn',
      'p1',
      'p3',
      'pred',
      'train',
    ])
    expect(lit(model, 'train').edges.has(edgeKey('p1', 'eval'))).toBe(true)
  })

  it('이미지: 기준 선이 없어 훈련에서 나가는 길에 새 데이터 쪽 전처리가 안 든다', () => {
    const model = CASES.find(
      (entry) => entry.title.startsWith('11.') && entry.title.endsWith('unknown'),
    )!.model
    const train = lit(model, 'train')
    expect(train.nodes.has('p3')).toBe(false)
    expect(train.trunk).toBe(false)
    expect([...lit(model, 'new').nodes].sort()).toEqual(['new', 'p3', 'pred'])
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
