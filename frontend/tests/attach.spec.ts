/**
 * 학습 결과를 파일 안의 자리에 앉히는 계층 (src/project/attach.ts).
 *
 * **여기가 두 계층이 만나는 유일한 자리다.** 학습은 경로를 모르고 파일은 출처를 모른다.
 * 그래서 이 파일은 "실험이 만든 것을 그대로 담았다가 다시 꺼내 예측할 수 있는가"를 본다 -
 * 중간에 한 군데만 어긋나도 학생이 낸 `.mlpx`는 열리는데 예측이 안 되는 파일이 된다.
 */

import { describe, expect, it } from 'vitest'

import type { RuntimeContext } from '../src/ml/backend'
import { runExperiment, type ExperimentInput } from '../src/ml/experiment'
import { loadModel, TREE_FORMAT, type ModelFile } from '../src/ml/models'
import { applyExperiment, attachExperimentFiles } from '../src/project/attach'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { experimentSchema, type Experiment, type Run } from '../src/project/schema'
import {
  IRIS_FEATURE_COLUMNS,
  IRIS_FEATURES,
  IRIS_TARGET_COLUMN,
  irisDataset,
} from './fixtures/iris'

const BROWSER_ONLY: RuntimeContext = { serverStatus: 'unavailable', rowCount: 30 }

function inputFor(algorithms: string[]): ExperimentInput {
  return {
    dataset: irisDataset(),
    testDataset: null,
    taskType: 'classification',
    dataType: 'tabular',
    settings: {
      dataset: {
        path: 'dataset/data.csv',
        originalFileName: 'iris.csv',
        hasHeader: true,
        encoding: 'utf-8',
      },
      features: [...IRIS_FEATURE_COLUMNS],
      target: IRIS_TARGET_COLUMN,
      preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
      split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
      runtime: 'mljs',
      selectedAlgorithms: algorithms.map((algorithm) => ({ algorithm })),
      hyperparameters: {},
    },
    context: BROWSER_ONLY,
  }
}

function decode(bytes: Uint8Array | undefined): unknown {
  expect(bytes).toBeDefined()
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown
}

/** 손으로 세운 실험. 경로가 붙기 전의 모양이다. */
function bareExperiment(runs: Run[]): Experiment {
  return {
    id: 'experiment-7',
    startedAt: '2026-08-05T09:00:00Z',
    settings: {
      taskType: 'classification',
      runtime: 'mljs',
      selectedAlgorithms: runs.map((run) => ({ algorithm: run.algorithm, runtime: 'mljs' })),
      features: ['a'],
      target: 'b',
      preprocessing: { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' },
      split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
      trainIndices: [0],
      testIndices: [1],
    },
    runs,
  }
}

function doneRun(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    algorithm: 'decision_tree',
    hyperparameters: {},
    computedBy: 'browser',
    trainedAt: '2026-08-05T09:00:01Z',
    status: 'done',
    metrics: { accuracy: 0.9 },
    ...overrides,
  }
}

const treeFile: ModelFile = { format: TREE_FORMAT }
const PREPROCESSOR = { format: 'mlpx-preprocess-v1' }

describe('학습 → 담기 → 다시 꺼내 예측', () => {
  it('담은 바이트에서 꺼낸 모델이 학습 직후와 같은 예측을 한다', () => {
    const result = runExperiment(inputFor(['decision_tree', 'random_forest']))
    const attached = attachExperimentFiles(result.experiment, result.preprocessor, result.models)

    for (const run of attached.experiment.runs) {
      expect(run.model).toBeDefined()
      const model = decode(attached.entries.get(run.model?.path ?? ''))
      // 여기까지 온 것은 zip에 들어갈 바이트 그대로다. 객체를 들고 다니면
      // 직렬화가 빠진 채로 통과한다.
      expect(loadModel(model)(IRIS_FEATURES)).toHaveLength(IRIS_FEATURES.length)
    }
  })

  it('붙인 실험이 스키마를 통과한다 — 이 층의 산출물이 곧 runs.json이다', () => {
    const result = runExperiment(inputFor(['decision_tree']))
    const attached = attachExperimentFiles(result.experiment, result.preprocessor, result.models)
    expect(experimentSchema.safeParse(attached.experiment).success).toBe(true)
  })

  it('참조형도 담긴다 - 행 번호만 담으므로 데이터를 중복 저장하지 않는다', () => {
    const result = runExperiment(inputFor(['knn']))
    expect(result.models.size).toBe(1)
    expect(result.experiment.runs[0]?.modelOmitted).toBeUndefined()
  })

  it('회귀도 담긴다 - 이제 이 엔진에 못 담는 알고리즘이 없다', () => {
    // 회귀에는 수치 타깃이 필요하다. 특성 하나를 타깃으로 돌려 쓴다 - 붓꽃 열은 전부 수치다.
    const base = inputFor(['linear_regression'])
    const [first, ...rest] = IRIS_FEATURE_COLUMNS
    const result = runExperiment({
      ...base,
      taskType: 'regression',
      settings: {
        ...base.settings,
        features: rest,
        target: first ?? '',
        // 층화는 분류의 것이다. 회귀에 켜 두면 split이 시끄럽게 실패한다 (ml/split.ts).
        split: { ...base.settings.split, stratify: false },
      },
    })
    expect(result.models.size).toBe(1)
    expect(result.experiment.runs[0]?.status).toBe('done')
    expect(result.experiment.runs[0]?.modelOmitted).toBeUndefined()
  })
})

describe('경로와 크기는 이 층이 정한다', () => {
  it('전처리기는 실험마다 하나이고 경로가 실험 id를 따른다', () => {
    const attached = attachExperimentFiles(bareExperiment([]), PREPROCESSOR, new Map())
    expect(attached.experiment.preprocessor?.path).toBe('model/preprocessor-experiment-7.json')
    expect(decode(attached.entries.get('model/preprocessor-experiment-7.json'))).toEqual(
      PREPROCESSOR,
    )
  })

  it('모델 경로는 run id를 따르고 크기는 실제 바이트다', () => {
    const attached = attachExperimentFiles(
      bareExperiment([doneRun('run-3')]),
      PREPROCESSOR,
      new Map([['run-3', treeFile]]),
    )
    const model = attached.experiment.runs[0]?.model
    expect(model?.path).toBe('model/run-3.json')
    expect(model?.sizeBytes).toBe(attached.entries.get('model/run-3.json')?.length)
  })

  it('전처리기가 필요한지는 등록부가 말한다 — 형식 이름을 보고 가르지 않는다', () => {
    const attached = attachExperimentFiles(
      bareExperiment([doneRun('run-3')]),
      PREPROCESSOR,
      new Map([['run-3', treeFile]]),
    )
    expect(attached.experiment.runs[0]?.model?.includesPreprocessing).toBe(false)
  })

  it('모델과 전처리기는 들여쓰기 없이 담는다 — 그 크기가 곧 예산에 부딪힌다', () => {
    const attached = attachExperimentFiles(
      bareExperiment([doneRun('run-3')]),
      PREPROCESSOR,
      new Map([['run-3', treeFile]]),
    )
    for (const bytes of attached.entries.values()) {
      expect(new TextDecoder().decode(bytes)).not.toContain('\n')
    }
  })
})

describe('모델이 없는 이유를 적는다', () => {
  it('done인데 모델이 없으면 engineUnsupported다', () => {
    const attached = attachExperimentFiles(
      bareExperiment([doneRun('run-1')]),
      PREPROCESSOR,
      new Map(),
    )
    expect(attached.experiment.runs[0]?.modelOmitted).toBe('engineUnsupported')
  })

  it('실패한 run에는 안 적는다 — 모델이 없는 이유가 이미 failure에 있다', () => {
    const failed = doneRun('run-1', {
      status: 'failed',
      failure: { code: 'JOB_FAILED', params: {} },
    })
    const attached = attachExperimentFiles(bareExperiment([failed]), PREPROCESSOR, new Map())
    expect(attached.experiment.runs[0]?.modelOmitted).toBeUndefined()
  })

  it('이미 적힌 사유를 덮어쓰지 않는다', () => {
    const run = doneRun('run-1', { modelOmitted: 'tooLarge' })
    const attached = attachExperimentFiles(bareExperiment([run]), PREPROCESSOR, new Map())
    expect(attached.experiment.runs[0]?.modelOmitted).toBe('tooLarge')
  })

  it('모델이 붙으면 옛 사유를 지운다', () => {
    const run = doneRun('run-1', { modelOmitted: 'overBudget' })
    const attached = attachExperimentFiles(
      bareExperiment([run]),
      PREPROCESSOR,
      new Map([['run-1', treeFile]]),
    )
    expect(attached.experiment.runs[0]?.modelOmitted).toBeUndefined()
    expect(attached.experiment.runs[0]?.model).toBeDefined()
  })

  it('해석기가 없는 형식은 담지 않는다 — 열어도 예측 못 할 무게만 남는다', () => {
    const attached = attachExperimentFiles(
      bareExperiment([doneRun('run-1')]),
      PREPROCESSOR,
      new Map([['run-1', { format: 'onnx-v1' }]]),
    )
    expect(attached.experiment.runs[0]?.model).toBeUndefined()
    expect(attached.experiment.runs[0]?.modelOmitted).toBe('engineUnsupported')
    expect(attached.entries.has('model/run-1.json')).toBe(false)
  })
})

describe('끝난 실험을 프로젝트에 앉힌다', () => {
  function emptyProject(): ProjectFile {
    const document = newProjectDocument(
      { name: '붓꽃', locale: 'ko' },
      { projectId: 'p-1', createdAt: '2026-08-05T09:00:00Z', randomState: 42 },
    )
    return { document, models: new Map() }
  }

  it('실험이 뒤에 붙고 모델 엔트리가 합쳐진다', () => {
    const result = runExperiment(inputFor(['decision_tree']))
    const next = applyExperiment(emptyProject(), result, '2026-08-05T10:00:00Z')

    expect(next.document.runs.experiments).toHaveLength(1)
    const experiment = next.document.runs.experiments[0]
    expect(experiment?.preprocessor?.path).toBeDefined()

    // 참조가 가리키는 자리에 실제 바이트가 있어야 한다. 하나만 어긋나도 학생이 낸
    // .mlpx는 열리는데 예측이 안 되는 파일이 된다.
    for (const path of [experiment?.preprocessor?.path, experiment?.runs[0]?.model?.path]) {
      expect(path).toBeDefined()
      expect(next.models.has(path ?? '')).toBe(true)
    }
    expect(next.document.manifest.updatedAt).toBe('2026-08-05T10:00:00Z')
  })

  it('지난 실험을 지우지 않는다 - 결과 화면이 변경 이력이다', () => {
    const first = runExperiment(inputFor(['decision_tree']))
    const started = applyExperiment(emptyProject(), first, '2026-08-05T10:00:00Z')

    const second = runExperiment(inputFor(['knn']), { history: started.document.runs })
    const next = applyExperiment(started, second, '2026-08-05T10:05:00Z')

    expect(next.document.runs.experiments.map((one) => one.id)).toEqual([
      'experiment-1',
      'experiment-2',
    ])
    // 먼저 담은 모델이 그대로 있다. 새 엔트리가 옛것을 밀어내지 않는다.
    expect(next.models.size).toBeGreaterThan(started.models.size)
    for (const path of started.models.keys()) expect(next.models.has(path)).toBe(true)
  })

  it('원본을 고치지 않는다 - 스토어가 새 값으로 갈아 끼운다', () => {
    const before = emptyProject()
    applyExperiment(before, runExperiment(inputFor(['decision_tree'])), '2026-08-05T10:00:00Z')
    expect(before.document.runs.experiments).toHaveLength(0)
    expect(before.models.size).toBe(0)
  })
})
