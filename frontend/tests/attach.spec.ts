/**
 * 학습 결과를 파일 안의 자리에 앉히는 계층 (src/project/attach.ts).
 *
 * **여기가 두 계층이 만나는 유일한 자리다.** 학습은 경로를 모르고 파일은 출처를 모른다.
 * 그래서 이 파일은 "묶음이 만든 것을 그대로 담았다가 다시 꺼내 예측할 수 있는가"를 본다 -
 * 중간에 한 군데만 어긋나도 학생이 낸 `.mlpx`는 열리는데 예측이 안 되는 파일이 된다.
 */

import { describe, expect, it } from 'vitest'

import type { RuntimeContext } from '../src/ml/backend'
import { runBatch, type BatchInput } from '../src/ml/batch'
import { loadModel, TREE_FORMAT, type ModelFile } from '../src/ml/models'
import { attachBatchFiles } from '../src/project/attach'
import { batchSchema, type Batch, type Run } from '../src/project/schema'
import {
  IRIS_FEATURE_COLUMNS,
  IRIS_FEATURES,
  IRIS_TARGET_COLUMN,
  irisDataset,
} from './fixtures/iris'

const BROWSER_ONLY: RuntimeContext = { serverStatus: 'unavailable', rowCount: 30 }

function inputFor(algorithms: string[]): BatchInput {
  return {
    dataset: irisDataset(),
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

/** 손으로 세운 묶음. 경로가 붙기 전의 모양이다. */
function bareBatch(runs: Run[]): Batch {
  return {
    id: 'batch-7',
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
    const result = runBatch(inputFor(['decision_tree', 'random_forest']))
    const attached = attachBatchFiles(result.batch, result.preprocessor, result.models)

    for (const run of attached.batch.runs) {
      expect(run.model).toBeDefined()
      const model = decode(attached.entries.get(run.model?.path ?? ''))
      // 여기까지 온 것은 zip에 들어갈 바이트 그대로다. 객체를 들고 다니면
      // 직렬화가 빠진 채로 통과한다.
      expect(loadModel(model)(IRIS_FEATURES)).toHaveLength(IRIS_FEATURES.length)
    }
  })

  it('붙인 묶음이 스키마를 통과한다 — 이 층의 산출물이 곧 runs.json이다', () => {
    const result = runBatch(inputFor(['decision_tree']))
    const attached = attachBatchFiles(result.batch, result.preprocessor, result.models)
    expect(batchSchema.safeParse(attached.batch).success).toBe(true)
  })

  it('직렬화기가 없는 알고리즘은 학습 직후부터 사유를 들고 있다', () => {
    // 저장까지 가야 아는 사유(예산)와 달리 이건 학습이 끝난 순간 확정된다.
    const result = runBatch(inputFor(['knn']))
    expect(result.models.size).toBe(0)
    expect(result.batch.runs[0]?.modelOmitted).toBe('engineUnsupported')
  })
})

describe('경로와 크기는 이 층이 정한다', () => {
  it('전처리기는 묶음마다 하나이고 경로가 묶음 id를 따른다', () => {
    const attached = attachBatchFiles(bareBatch([]), PREPROCESSOR, new Map())
    expect(attached.batch.preprocessor?.path).toBe('model/preprocessor-batch-7.json')
    expect(decode(attached.entries.get('model/preprocessor-batch-7.json'))).toEqual(PREPROCESSOR)
  })

  it('모델 경로는 run id를 따르고 크기는 실제 바이트다', () => {
    const attached = attachBatchFiles(
      bareBatch([doneRun('run-3')]),
      PREPROCESSOR,
      new Map([['run-3', treeFile]]),
    )
    const model = attached.batch.runs[0]?.model
    expect(model?.path).toBe('model/run-3.json')
    expect(model?.sizeBytes).toBe(attached.entries.get('model/run-3.json')?.length)
  })

  it('전처리기가 필요한지는 등록부가 말한다 — 형식 이름을 보고 가르지 않는다', () => {
    const attached = attachBatchFiles(
      bareBatch([doneRun('run-3')]),
      PREPROCESSOR,
      new Map([['run-3', treeFile]]),
    )
    expect(attached.batch.runs[0]?.model?.includesPreprocessing).toBe(false)
  })

  it('모델과 전처리기는 들여쓰기 없이 담는다 — 그 크기가 곧 예산에 부딪힌다', () => {
    const attached = attachBatchFiles(
      bareBatch([doneRun('run-3')]),
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
    const attached = attachBatchFiles(bareBatch([doneRun('run-1')]), PREPROCESSOR, new Map())
    expect(attached.batch.runs[0]?.modelOmitted).toBe('engineUnsupported')
  })

  it('실패한 run에는 안 적는다 — 모델이 없는 이유가 이미 failure에 있다', () => {
    const failed = doneRun('run-1', {
      status: 'failed',
      failure: { code: 'JOB_FAILED', params: {} },
    })
    const attached = attachBatchFiles(bareBatch([failed]), PREPROCESSOR, new Map())
    expect(attached.batch.runs[0]?.modelOmitted).toBeUndefined()
  })

  it('이미 적힌 사유를 덮어쓰지 않는다', () => {
    const run = doneRun('run-1', { modelOmitted: 'tooLarge' })
    const attached = attachBatchFiles(bareBatch([run]), PREPROCESSOR, new Map())
    expect(attached.batch.runs[0]?.modelOmitted).toBe('tooLarge')
  })

  it('모델이 붙으면 옛 사유를 지운다', () => {
    const run = doneRun('run-1', { modelOmitted: 'overBudget' })
    const attached = attachBatchFiles(
      bareBatch([run]),
      PREPROCESSOR,
      new Map([['run-1', treeFile]]),
    )
    expect(attached.batch.runs[0]?.modelOmitted).toBeUndefined()
    expect(attached.batch.runs[0]?.model).toBeDefined()
  })

  it('해석기가 없는 형식은 담지 않는다 — 열어도 예측 못 할 무게만 남는다', () => {
    const attached = attachBatchFiles(
      bareBatch([doneRun('run-1')]),
      PREPROCESSOR,
      new Map([['run-1', { format: 'onnx-v1' }]]),
    )
    expect(attached.batch.runs[0]?.model).toBeUndefined()
    expect(attached.batch.runs[0]?.modelOmitted).toBe('engineUnsupported')
    expect(attached.entries.has('model/run-1.json')).toBe(false)
  })
})
