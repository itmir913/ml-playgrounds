/**
 * **프로젝트 흐름도의 모델** (`ml/flow.ts`, `architecture.md` §8.22).
 *
 * 경우마다 같은 함수 하나를 지난다 — 경우별 코드가 없다는 것이 이 검사의 전제다. 열여섯 경우를
 * **줄 하나씩 손으로 적은 기대값**으로 못 박는다. 스냅샷 파일로 두면 바뀐 값을 받아 적는 것으로 초록이
 * 되고, 읽는 사람이 값을 못 본다.
 *
 * 기대값은 규칙에서 따로 끌어냈다. 노드는 `+`(한 일, 진하다)와 `-`(아직 안 한 일, 윤곽)로, 간선은
 * `from>to`에 윤곽이면 `~`를 붙여 적는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLOW_FLOWS,
  FLOW_KINDS,
  FLOW_LABEL_KEYS,
  FLOW_NODE_IDS,
  FLOW_TASK_LABEL_KEYS,
  flowModelOf,
  hasBasis,
  type FlowModel,
} from '../src/ml/flow'
import type { ProjectFile } from '../src/project/format'
import { DATA_TYPES, TASK_TYPES } from '../src/project/schema'
import { NO_FACTS } from '../src/router/steps'
import {
  edit,
  failed,
  metricsOnly,
  modelOf,
  photos,
  TWO_CATEGORIES,
  withRuns,
  withTask,
} from './fixtures/flow-cases'
import {
  emptyProjectFile,
  experiment,
  projectFile,
  projectFileWithPredictDataset,
  projectFileWithTestDataset,
  run,
} from './fixtures/project'

// ------------------------------------------------------------------ 경우를 짓는 손

/** 읽기 쉬운 한 줄 요약. 노드는 차례대로, 간선은 모델이 낸 차례대로다. */
function sketch(model: FlowModel | null): string[] | null {
  if (model === null) return null
  return [
    `nodes ${model.nodes.map((node) => `${node.id}${node.state === 'done' ? '+' : '-'}`).join(' ')}`,
    `edges ${model.edges.map((edge) => `${edge.from}>${edge.to}${edge.state === 'done' ? '' : '~'}`).join(' ')}`,
    `cards ${model.cards.map((card) => `${card.id}:${card.target}:${card.fileName ?? '-'}`).join(' ')}`,
    `splits ${model.splits} provided ${model.provided} prep ${model.prep} exps ${model.experimentCount}`,
  ]
}

const TWO = TWO_CATEGORIES

// ------------------------------------------------------------------ 열여섯 경우

/** 한 일의 앞쪽 — 학습 전에도 이만큼은 진하다. */
const FRONT = 'file+ train+ test+ new- p1+ p2+ p3- learn+ exp- eval- pred-'

describe('열여섯 경우', () => {
  it('1. 표 · 분류 · holdout · 학습 후', () => {
    expect(sketch(modelOf(projectFile()))).toEqual([
      'nodes file+ train+ test+ new+ p1+ p2+ p3+ learn+ exp+ eval+ pred+',
      'edges file>train file>test train>p1 test>p2 new>p3 p1>learn learn>exp p2>eval exp>eval exp>pred p3>pred',
      'cards whole:chosen:iris_data_final(1).csv new:none:-',
      'splits true provided false prep unknown exps 1',
    ])
  })

  it('2. 표 · 회귀 · 학습 전', () => {
    const file = withRuns(withTask(projectFile(), 'regression'), [])
    expect(sketch(modelOf(file))).toEqual([
      `nodes ${FRONT}`,
      // 실험이 없으니 학습 뒤의 선이 전부 윤곽이다. 앞쪽 선은 진하다.
      'edges file>train file>test train>p1 test>p2 new>p3~ p1>learn learn>exp~ p2>eval~ exp>eval~ exp>pred~ p3>pred~',
      'cards whole:chosen:iris_data_final(1).csv new:none:-',
      'splits true provided false prep unknown exps 0',
    ])
  })

  it('3. 표 · 분류 · provided — 테스트 카드가 서고 파일에서 테스트로 가는 선이 없다', () => {
    expect(sketch(modelOf(projectFileWithTestDataset()))).toEqual([
      'nodes file+ train+ test+ new+ p1+ p2+ p3+ learn+ exp+ eval+ pred+',
      'edges file>train train>p1 test>p2 new>p3 p1>learn learn>exp p2>eval exp>eval exp>pred p3>pred',
      'cards whole:chosen:iris_data_final(1).csv testFile:chosen:iris_test.csv new:none:-',
      'splits false provided true prep unknown exps 1',
    ])
  })

  it('4. 표 · 군집 · holdout — 테스트 줄도 두 번째 전처리도 없다', () => {
    const file = withTask(projectFile(), 'clustering')
    expect(sketch(modelOf(file))).toEqual([
      'nodes file+ train+ new+ p1+ p3+ learn+ exp+ eval+ pred+',
      'edges file>train train>p1 new>p3 p1>learn learn>exp p1>eval exp>eval exp>pred p3>pred',
      'cards whole:none:iris_data_final(1).csv new:none:-',
      'splits false provided false prep unknown exps 1',
    ])
  })

  it('5. 표 · 군집 · provided — 4와 같다 (테스트 카드를 안 그린다)', () => {
    const provided = withTask(projectFileWithTestDataset(), 'clustering')
    const holdout = withTask(projectFile(), 'clustering')
    expect(sketch(modelOf(provided))).toEqual(sketch(modelOf(holdout)))
    expect(modelOf(provided)?.cards.map((card) => card.id)).toEqual(['whole', 'new'])
  })

  it('6. 표 · 유형 미정 — 학습 상자와 그 뒤가 윤곽이다', () => {
    const file = withRuns(withTask(projectFile(), undefined), [])
    const model = modelOf(file)
    expect(sketch(model)?.[0]).toBe(
      'nodes file+ train+ test+ new- p1+ p2+ p3- learn- exp- eval- pred-',
    )
    expect(model?.taskLabelKey).toBe('flow.task.unset')
    // 유형을 모르면 나누는 것으로 그린다 — 안 골랐는데 안 나눈다고 단정하지 않는다.
    expect(model?.splitsData).toBe(true)
  })

  it('7. 표 · 실행이 전부 실패 — 실험 원만 진하고 결과도 예측도 윤곽이다', () => {
    const file = withRuns(projectFile(), [[failed('r1')], [failed('r2')]])
    expect(sketch(modelOf(file))).toEqual([
      'nodes file+ train+ test+ new- p1+ p2+ p3- learn+ exp+ eval- pred-',
      'edges file>train file>test train>p1 test>p2 new>p3~ p1>learn learn>exp p2>eval~ exp>eval~ exp>pred~ p3>pred~',
      'cards whole:chosen:iris_data_final(1).csv new:none:-',
      'splits true provided false prep unknown exps 2',
    ])
  })

  it('8. 표 · 모델 없이 지표만 — 결과는 진하고 예측과 새 데이터 쪽은 윤곽이다', () => {
    const file = withRuns(projectFile(), [[metricsOnly('r1')]])
    expect(sketch(modelOf(file))).toEqual([
      'nodes file+ train+ test+ new- p1+ p2+ p3- learn+ exp+ eval+ pred-',
      'edges file>train file>test train>p1 test>p2 new>p3~ p1>learn learn>exp p2>eval exp>eval exp>pred~ p3>pred~',
      'cards whole:chosen:iris_data_final(1).csv new:none:-',
      'splits true provided false prep unknown exps 1',
    ])
  })

  it('9. 표 · 타깃 미선택 — 타깃 칩이 비고 전처리부터 윤곽이다', () => {
    const file = withRuns(
      edit(projectFile(), (target) => {
        Object.assign(target.document.settings.data, { target: undefined })
      }),
      [],
    )
    const model = modelOf(file)
    expect(sketch(model)?.[0]).toBe(
      'nodes file+ train+ test+ new- p1- p2- p3- learn+ exp- eval- pred-',
    )
    expect(model?.cards[0]?.target).toBe('empty')
  })

  it('10. 표 · 특성 미선택 — 전처리부터 윤곽이다', () => {
    const file = withRuns(
      edit(projectFile(), (target) => {
        Object.assign(target.document.settings.data, { features: [] })
      }),
      [],
    )
    expect(sketch(modelOf(file))?.[0]).toBe(
      'nodes file+ train+ test+ new- p1- p2- p3- learn+ exp- eval- pred-',
    )
  })

  it('11. 이미지 · 분류 · holdout — 전처리 자리가 백본이고 파일 이름이 없다', () => {
    const model = modelOf(
      photos(TWO, (file) => {
        file.document.runs.experiments = [experiment('experiment-1', [run('r1')])]
      }),
    )
    expect(sketch(model)).toEqual([
      'nodes file+ train+ test+ new+ p1+ p2+ p3+ learn+ exp+ eval+ pred+',
      'edges file>train file>test train>p1 test>p2 new>p3 p1>learn learn>exp p2>eval exp>eval exp>pred p3>pred',
      'cards whole:chosen:- new:none:-',
      'splits true provided false prep backbone exps 1',
    ])
    expect(
      model?.nodes.filter((node) => node.prep !== undefined).map((node) => node.labelKey),
    ).toEqual(['meta.image.backbone', 'meta.image.backbone', 'meta.image.backbone'])
  })

  it('12. 이미지 · provided — 테스트 카드가 선다', () => {
    const model = modelOf(
      photos(TWO, (file) => {
        file.document.settings.split.method = 'provided'
      }),
    )
    expect(model?.cards.map((card) => card.id)).toEqual(['whole', 'testFile', 'new'])
    expect(model?.splits).toBe(false)
    expect(model?.provided).toBe(true)
  })

  it('13. 이미지 · 군집 — 타깃 칩도 테스트 줄도 없다', () => {
    const model = modelOf(
      photos(['개'], (file) => {
        file.document.manifest.taskType = 'clustering'
      }),
    )
    expect(model?.nodes.map((node) => node.id)).not.toContain('test')
    expect(model?.nodes.map((node) => node.id)).not.toContain('p2')
    expect(model?.cards.map((card) => card.target)).toEqual(['none', 'none'])
  })

  it('14. 이미지 · 유형 미정', () => {
    const model = modelOf(
      photos(TWO, (file) => {
        file.document.manifest.taskType = undefined
      }),
    )
    expect(sketch(model)?.[0]).toBe(
      'nodes file+ train+ test+ new- p1+ p2+ p3- learn- exp- eval- pred-',
    )
    expect(model?.taskLabelKey).toBe('flow.task.unset')
  })

  it('15. 데이터 없음 — 모델이 없다', () => {
    expect(modelOf(emptyProjectFile())).toBeNull()
    expect(modelOf(null)).toBeNull()
    expect(flowModelOf(projectFile(), NO_FACTS)).toBeNull()
  })

  it('16. 예측 파일이 있다 — 새 데이터 카드에 이름이 붙는다', () => {
    const model = modelOf(projectFileWithPredictDataset())
    expect(model?.cards.at(-1)).toEqual({
      id: 'new',
      node: 'new',
      fileName: 'iris_predict.csv',
      target: 'none',
    })
  })
})

// ------------------------------------------------------------------ 규칙

describe('전처리 자리의 모양', () => {
  it('표는 계획이 알려 주기 전에는 unknown이고 기준 간선이 없다', () => {
    const model = modelOf(projectFile())
    expect(model?.prep).toBe('unknown')
    expect(model?.edges.some((edge) => edge.flow === 'basis')).toBe(false)
  })

  it('preprocess이면 기준 간선이 훈련 쪽 상자에서 둘로 갈라진다', () => {
    const model = modelOf(projectFile(), 'preprocess')
    const basis = model?.edges
      .filter((edge) => edge.flow === 'basis')
      .map((e) => `${e.from}>${e.to}`)
    expect(basis).toEqual(['p1>p2', 'p1>p3'])
    expect(model?.parents.p2).toEqual(['test', 'p1'])
    expect(model?.parents.p3).toEqual(['new', 'p1'])
  })

  it('preprocessOff이면 점선 상자이고 기준 간선이 없다', () => {
    const model = modelOf(projectFile(), 'preprocessOff')
    expect(model?.prep).toBe('preprocessOff')
    expect(model?.edges.some((edge) => edge.flow === 'basis')).toBe(false)
    expect(model?.nodes.filter((node) => node.prep === 'preprocessOff')).toHaveLength(3)
  })

  it('군집에서는 기준 간선이 하나뿐이다 (p1에서 p3)', () => {
    const model = modelOf(withTask(projectFile(), 'clustering'), 'preprocess')
    expect(
      model?.edges.filter((edge) => edge.flow === 'basis').map((e) => `${e.from}>${e.to}`),
    ).toEqual(['p1>p3'])
  })

  it('이미지는 알려 준 것과 무관하게 백본이고 기준 간선이 없다', () => {
    const model = modelOf(photos(TWO), 'preprocess')
    expect(model?.prep).toBe('backbone')
    expect(model?.edges.some((edge) => edge.flow === 'basis')).toBe(false)
  })

  it('표는 backbone을 받아도 unknown이다 — 그 낱말은 표의 말이 아니다', () => {
    expect(modelOf(projectFile(), 'backbone')?.prep).toBe('unknown')
  })

  it('기준 간선은 양 끝이 진할 때만 진하다', () => {
    const before = withRuns(projectFile(), [])
    const model = modelOf(before, 'preprocess')
    const basis = model?.edges.filter((edge) => edge.flow === 'basis')
    // p3은 모델이 있어야 진하다. p2는 앞단 사실만 있으면 된다.
    expect(basis?.map((edge) => `${edge.from}>${edge.to}:${edge.state}`)).toEqual([
      'p1>p2:done',
      'p1>p3:pending',
    ])
  })

  it('hasBasis는 preprocess만 참이다', () => {
    expect(
      (['preprocess', 'preprocessOff', 'backbone', 'unknown'] as const).filter(hasBasis),
    ).toEqual(['preprocess'])
  })
})

describe('모델의 불변식', () => {
  const FILES: [string, ProjectFile][] = [
    ['표', projectFile()],
    ['표 provided', projectFileWithTestDataset()],
    ['표 군집', withTask(projectFile(), 'clustering')],
    ['사진', photos(TWO)],
  ]

  it.each(FILES)('%s: 간선의 양 끝은 모두 모델의 노드다', (_name, file) => {
    for (const prep of [undefined, 'preprocess', 'preprocessOff'] as const) {
      const model = modelOf(file, prep)
      const ids = new Set(model?.nodes.map((node) => node.id))
      for (const edge of model?.edges ?? []) {
        expect(ids.has(edge.from), `${edge.from}>${edge.to}`).toBe(true)
        expect(ids.has(edge.to), `${edge.from}>${edge.to}`).toBe(true)
      }
    }
  })

  it.each(FILES)('%s: parents가 간선과 같다', (_name, file) => {
    const model = modelOf(file, 'preprocess')
    for (const node of model?.nodes ?? []) {
      const incoming = model?.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from)
      expect(model?.parents[node.id], node.id).toEqual(incoming)
    }
    expect(Object.keys(model?.parents ?? {}).sort()).toEqual(
      (model?.nodes.map((node) => node.id) ?? []).sort(),
    )
  })

  it.each(FILES)('%s: 노드 차례는 FLOW_NODE_IDS를 따른다', (_name, file) => {
    const ids = modelOf(file)?.nodes.map((node) => node.id) ?? []
    expect(ids).toEqual(FLOW_NODE_IDS.filter((id) => ids.includes(id)))
  })

  it('모든 유형에서 모든 노드가 라벨 키와 흐르는 것을 가진다', () => {
    for (const taskType of TASK_TYPES) {
      const model = modelOf(withTask(projectFile(), taskType), 'preprocess')
      for (const node of model?.nodes ?? []) {
        expect(node.labelKey, `${taskType} ${node.id}`).toMatch(/^[a-z]+(\.[A-Za-z]+)+$/)
        expect(FLOW_FLOWS).toContain(node.flow)
      }
    }
  })

  it('군집에서는 훈련 몫의 이름이 달라지고 결과가 훈련의 색이다', () => {
    const model = modelOf(withTask(projectFile(), 'clustering'))
    expect(model?.nodes.find((node) => node.id === 'train')?.labelKey).toBe(
      FLOW_LABEL_KEYS.trainAll,
    )
    expect(model?.nodes.find((node) => node.id === 'eval')?.flow).toBe('train')
    const split = modelOf(projectFile())
    expect(split?.nodes.find((node) => node.id === 'train')?.labelKey).toBe(FLOW_LABEL_KEYS.train)
    expect(split?.nodes.find((node) => node.id === 'eval')?.flow).toBe('test')
  })

  it('분할 막대는 나누는 유형이고 holdout일 때만 두 조각이다', () => {
    expect(modelOf(projectFile())?.splits).toBe(true)
    expect(modelOf(projectFileWithTestDataset())?.splits).toBe(false)
    expect(modelOf(withTask(projectFile(), 'clustering'))?.splits).toBe(false)
    expect(modelOf(withTask(projectFile(), undefined))?.splits).toBe(true)
  })

  it('종류마다 등록부의 칸이 있다', () => {
    expect(Object.keys(FLOW_KINDS).sort()).toEqual([...DATA_TYPES].sort())
  })

  it('이름표 키는 유형마다 하나씩이고 미정까지 넷이다', () => {
    expect(Object.keys(FLOW_TASK_LABEL_KEYS).sort()).toEqual([...TASK_TYPES, 'unset'].sort())
  })
})

describe('이 모듈은 흐름도 밖을 들이지 않는다', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'ml', 'flow.ts'), 'utf-8')
  const imports = [...source.matchAll(/^import[^;]*?from\s+['"]([^'"]+)['"]/gms)].map((m) => m[1])

  it.each([
    ['Vue', /^vue(\/|$)|\.vue$/],
    ['스토어', /stores\//],
    ['계획', /ml\/plan/],
    ['실험', /ml\/experiment/],
    ['학습 입력', /ml\/training-source/],
    ['수 구하기', /ml\/flow-counts/],
  ])('%s를 들이지 않는다', (_name, pattern) => {
    expect(imports.filter((path) => pattern.test(path ?? ''))).toEqual([])
  })

  it('임포트를 실제로 읽었다 — 빈 목록이면 위 검사가 아무것도 못 문다', () => {
    expect(imports.length).toBeGreaterThanOrEqual(3)
  })
})

describe('로케일', () => {
  // C13에서 `flow.*` 문구가 세 로케일에 들어오면 켠다. 지금 켜면 아직 없는 키 때문에 빨갛다.
  it.todo('FLOW_LABEL_KEYS와 FLOW_TASK_LABEL_KEYS의 값이 세 로케일에 모두 있다')
})
