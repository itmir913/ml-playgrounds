/**
 * 실험 사이의 변경 서술.
 *
 * **여기가 지키는 것은 "경로와 값이 한 곳에서 나온다"이다.** `experiment.changed`는
 * 학습 시점에 `comparablePair`가 만든 경로 목록이고, 화면이 보여줄 전후 값도 같은
 * 객체에서 나와야 한다. 그래서 이 테스트는 값을 손으로 짓지 않고 **실제로 실험을 두 번
 * 돌려서** `changed`에 적힌 경로를 그대로 먹인다 - 규칙이 갈리면 여기서 빈 값이 나온다.
 */

import { describe, expect, it } from 'vitest'

import { describeChanges } from '../src/ml/changes'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import type { RuntimeContext } from '../src/ml/backend'
import type { Experiment, Settings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

const BROWSER_ONLY: RuntimeContext = { serverStatus: 'unavailable', rowCount: 30 }

function settingsFor(overrides: Partial<Settings> = {}): Settings {
  return {
    features: [...IRIS_FEATURE_COLUMNS],
    target: IRIS_TARGET_COLUMN,
    preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'decision_tree' }],
    hyperparameters: {},
    ...overrides,
  }
}

function inputFor(settings: Settings): ExperimentInput {
  return {
    dataset: irisDataset(),
    // provided를 골랐을 때만 쓰인다 - holdout이면 splitRows가 아예 보지 않는다
    // (ml/split.ts). 매번 넣어 두면 이 파일에서 무엇을 바꾸든 신경 쓸 게 하나 준다.
    testDataset: irisDataset(),
    taskType: 'classification',
    dataType: 'tabular',
    settings,
    context: BROWSER_ONLY,
  }
}

/** 설정을 바꿔 두 번 학습한다. 두 번째 실험의 changed가 이 테스트의 입력이다. */
function twice(second: Partial<Settings>): { first: Experiment; second: Experiment } {
  const first = runExperiment(inputFor(settingsFor())).experiment
  const next = runExperiment(inputFor(settingsFor(second)), {
    history: { experiments: [first] },
  }).experiment
  return { first, second: next }
}

/** 실험 둘과 그 사이의 변경들. 경로는 파일에 적힌 것을 그대로 쓴다. */
function changesOf(second: Partial<Settings>) {
  const { first, second: next } = twice(second)
  return describeChanges(first, next, next.changed ?? [])
}

describe('바뀐 값을 전후로 보여준다', () => {
  it('어휘는 로케일 키로 온다 - 화면이 문장을 만든다', () => {
    const changes = changesOf({
      preprocessing: { missing: 'mean', scaling: 'standard', categoricalEncoding: 'onehot' },
    })

    expect(changes).toEqual([
      {
        path: 'preprocessing.scaling',
        labelKey: 'preprocess.scaling',
        from: { kind: 'locale', key: 'scalingMethod.none' },
        to: { kind: 'locale', key: 'scalingMethod.standard' },
      },
    ])
  })

  it('수치는 그대로 온다', () => {
    const changes = changesOf({
      split: { method: 'holdout', testSize: 0.5, stratify: true, randomState: 42 },
    })

    expect(changes).toEqual([
      {
        path: 'split.testSize',
        labelKey: 'preprocess.testSize',
        from: { kind: 'literal', text: '0.3' },
        to: { kind: 'literal', text: '0.5' },
      },
    ])
  })

  it('참·거짓은 켬과 끔이다', () => {
    const changes = changesOf({
      split: { method: 'holdout', testSize: 0.3, stratify: false, randomState: 42 },
    })

    expect(changes[0]?.from).toEqual({ kind: 'locale', key: 'common.on' })
    expect(changes[0]?.to).toEqual({ kind: 'locale', key: 'common.off' })
  })

  it('목록은 개수만 말한다 - 이름을 늘어놓으면 그 줄이 화면을 덮는다', () => {
    const changes = changesOf({ features: [IRIS_FEATURE_COLUMNS[0] ?? ''] })
    const features = changes.find((change) => change.path === 'features')

    expect(features?.from).toEqual({ kind: 'count', count: 4 })
    expect(features?.to).toEqual({ kind: 'count', count: 1 })
  })

  it('분할 방식이 바뀌면 잡힌다', () => {
    const changes = changesOf({
      split: { method: 'provided', testSize: 0.3, stratify: false, randomState: 42 },
    })
    const method = changes.find((change) => change.path === 'split.method')

    expect(method?.labelKey).toBe('preprocess.testDataTitle')
    expect(method?.to).toEqual({ kind: 'locale', key: 'splitMethod.provided' })
  })
})

describe('하이퍼파라미터는 어느 모델의 것인지를 함께 준다', () => {
  it('모델과 실행 방법이 문장 밖으로 나온다', () => {
    const changes = changesOf({ hyperparameters: { decision_tree: { mljs: { maxDepth: 3 } } } })
    const depth = changes.find((change) => change.path.startsWith('hyperparameters.'))

    expect(depth?.labelKey).toBe('hyperparams.maxDepth')
    expect(depth?.model).toEqual({ algorithm: 'decision_tree', runtime: 'mljs' })
    expect(depth?.to).toEqual({ kind: 'literal', text: '3' })
  })

  it('경로가 파일에 적힌 그대로다 - 우리가 다시 계산하지 않는다', () => {
    const { second } = twice({ hyperparameters: { decision_tree: { mljs: { maxDepth: 3 } } } })
    expect(second.changed).toContain('hyperparameters.decision_tree:mljs.maxDepth')
  })
})

describe('모르는 경로도 버리지 않는다', () => {
  it('등록부에 없으면 라벨이 null이고 값은 그대로 온다', () => {
    const { first, second } = twice({})
    const changes = describeChanges(first, second, ['algorithms'])
    expect(changes[0]?.labelKey).toBe('train.chosenTitle')

    const unknown = describeChanges(first, second, ['somethingWeDoNotKnow'])
    expect(unknown[0]).toEqual({
      path: 'somethingWeDoNotKnow',
      labelKey: null,
      from: { kind: 'absent' },
      to: { kind: 'absent' },
    })
  })

  it('경로 목록이 비면 아무것도 안 만든다', () => {
    const { first, second } = twice({})
    expect(describeChanges(first, second, [])).toEqual([])
  })
})
