/**
 * 실험 사이의 변경 서술.
 *
 * **여기가 지키는 것은 "경로와 값이 한 곳에서 나온다"이다.** `experiment.changed`는
 * 학습 시점에 `comparablePair`가 만든 경로 목록이고, 화면이 보여줄 전후 값도 같은
 * 객체에서 나와야 한다. 그래서 이 테스트는 값을 손으로 짓지 않고 **실제로 실험을 두 번
 * 돌려서** `changed`에 적힌 경로를 그대로 먹인다 - 규칙이 갈리면 여기서 빈 값이 나온다.
 */

import { describe, expect, it } from 'vitest'

import { describeChanges, memberDiff } from '../src/ml/changes'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import type { RuntimeContext } from '../src/ml/backend'
import type { Experiment, Settings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

const BROWSER_ONLY: RuntimeContext = { serverStatus: 'unavailable', rowCount: 30 }

/**
 * **표의 설정은 `settings.data` 안이지만 여기서는 평평하게 받는다** (mlpx-spec.md §3).
 *
 * 검사가 실제로 넘기는 것은 아래에서 조립한 진짜 `Settings`다. 평평하게 받는 이유는
 * `Settings`가 looseObject라 **`Partial<Settings>`에 `features`를 얹어도 타입이 안
 * 울고 조용히 무시되기 때문이다** — 스키마를 가르던 날 실제로 그렇게 통과했다.
 * 여기서 갈라 넣으면 그 자리가 컴파일에 걸린다.
 */
type SettingsOverrides = Partial<Omit<Settings, 'data'>> & Partial<Settings['data']>

function splitOverrides(overrides: SettingsOverrides) {
  const { dataset, testDataset, predictDataset, features, target, preprocessing, ...common } =
    overrides
  const data = {
    ...(dataset === undefined ? {} : { dataset }),
    ...(testDataset === undefined ? {} : { testDataset }),
    ...(predictDataset === undefined ? {} : { predictDataset }),
    ...(features === undefined ? {} : { features }),
    ...('target' in overrides ? { target } : {}),
    ...(preprocessing === undefined ? {} : { preprocessing }),
  }
  return { data, common }
}

const baseData: Settings['data'] = {
  features: [...IRIS_FEATURE_COLUMNS],
  target: IRIS_TARGET_COLUMN,
  preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
}

function settingsFor(overrides: SettingsOverrides = {}): Settings {
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'decision_tree' }],
    hyperparameters: {},
    ...splitOverrides(overrides).common,
    data: { ...baseData, ...splitOverrides(overrides).data },
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

    // **줄에 쓰는 것은 개수다.** 이름은 아래 `items`에 실려 있고 화면이 눌러야 연다.
    expect(features?.from.kind).toBe('count')
    expect(features?.to.kind).toBe('count')
    expect(features?.from).toMatchObject({ count: 4 })
    expect(features?.to).toMatchObject({ count: 1 })
  })

  it('특성은 무엇이었는지까지 들고 있다 - 개수만으로는 무엇을 뺐는지 모른다', () => {
    const changes = changesOf({ features: [IRIS_FEATURE_COLUMNS[0] ?? ''] })
    const features = changes.find((change) => change.path === 'features')

    expect(features?.from).toMatchObject({ items: [...IRIS_FEATURE_COLUMNS] })
    expect(features?.to).toMatchObject({ items: [IRIS_FEATURE_COLUMNS[0]] })
  })

  it('모델 목록은 이름을 안 들고 있다 - 식별자라 화면이 로케일을 찾아야 한다', () => {
    const changes = changesOf({ selectedAlgorithms: [{ algorithm: 'knn' }] })
    const algorithms = changes.find((change) => change.path === 'algorithms')

    expect(algorithms?.from.kind).toBe('count')
    expect(algorithms?.from).not.toHaveProperty('items')
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

/**
 * 목록에서 무엇이 들고 났는가 (2026-08-12).
 *
 * **화면이 아니라 여기서 센다.** `.vue`의 computed는 아무도 테스트하지 않아서, 나중에
 * "단순화"가 규칙을 되돌려도 초록색이 유지된다.
 */
describe('목록의 들고 남', () => {
  const list = (...items: string[]) => ({ kind: 'count' as const, count: items.length, items })

  it('들어온 것과 빠진 것을 가른다', () => {
    expect(memberDiff(list('키', '몸무게', '나이'), list('키', '성별'))).toEqual({
      added: ['성별'],
      removed: ['몸무게', '나이'],
    })
  })

  it('원본 순서를 지킨다 - 학생이 고른 순서가 곧 표의 순서다', () => {
    expect(memberDiff(list('a', 'b', 'c'), list('c', 'z', 'a', 'y'))).toEqual({
      added: ['z', 'y'],
      removed: ['b'],
    })
  })

  it('개수만 같고 구성이 다른 것도 잡는다 - 줄에는 아무 변화가 없어 보인다', () => {
    expect(memberDiff(list('키', '몸무게'), list('키', '나이'))).toEqual({
      added: ['나이'],
      removed: ['몸무게'],
    })
  })

  it('이름을 안 든 목록에는 답하지 않는다', () => {
    expect(memberDiff({ kind: 'count', count: 2 }, list('a'))).toBeNull()
    expect(memberDiff(list('a'), { kind: 'count', count: 2 })).toBeNull()
  })

  it('목록이 아닌 값에는 답하지 않는다', () => {
    expect(memberDiff({ kind: 'literal', text: '3' }, list('a'))).toBeNull()
    expect(memberDiff(list('a'), { kind: 'absent' })).toBeNull()
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
