/**
 * 학습 워커의 계약.
 *
 * **진짜 Worker를 띄우지 않는다.** jsdom에 Worker가 없고, 있어도 번들러가 워커 청크를
 * 만들게 되어 테스트가 우리 로직 대신 빌드 설정을 검사한다. 대신 client가 워커를
 * 주입받게 해 두었으므로(ml/worker/client.ts) 가짜를 넣고 **프로토콜 왕복·진행 순서·
 * 취소·오류 전달**을 본다. 그게 이 층이 실제로 하는 일의 전부다.
 *
 * 워커 파일(train.worker.ts)은 handler를 부르는 세 줄뿐이라 덮지 않는다 -
 * 덮이지 않는 곳에 틀릴 수 있는 것을 두지 않는 것이 그 파일의 설계였다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import type { ExperimentInput } from '../src/ml/experiment'
import { train, type TrainWorker } from '../src/ml/worker/client'
import { handleTrain } from '../src/ml/worker/handler'
import type { TrainRequest, WorkerMessage } from '../src/ml/worker/protocol'
import type { RunsFile, Settings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'

const models = (...names: string[]) => names.map((algorithm) => ({ algorithm }))

function settingsFor(overrides: Partial<Settings> = {}): Settings {
  return {
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
    selectedAlgorithms: models('decision_tree', 'knn'),
    hyperparameters: {},
    ...overrides,
  }
}

function inputFor(settings: Settings = settingsFor()): ExperimentInput {
  return {
    dataset: irisDataset(),
    taskType: 'classification',
    dataType: 'tabular',
    settings,
    context: { serverStatus: 'unavailable', rowCount: 30 },
  }
}

function requestFor(settings?: Settings): TrainRequest {
  return { type: 'train', input: inputFor(settings) }
}

/** 메시지를 손으로 밀어 넣는 가짜 워커. */
class FakeWorker implements TrainWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly posted: TrainRequest[] = []
  terminated = 0

  postMessage(message: TrainRequest): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated += 1
  }

  emit(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }

  crash(): void {
    this.onerror?.(new ErrorEvent('error'))
  }
}

/** 진짜 handler를 뒤에 붙인 가짜 워커. 프로토콜 왕복 전체를 본다. */
class HandlerWorker extends FakeWorker {
  override postMessage(message: TrainRequest): void {
    super.postMessage(message)
    // 진짜 워커도 비동기로 답한다. 동기로 답하면 client가 못 잡는 순서를 놓친다.
    queueMicrotask(() => handleTrain(message, (outgoing) => this.emit(outgoing)))
  }
}

/** 거절 사유를 코드로 꺼낸다. 통과해 버리면 그것도 실패로 드러나야 한다. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return 'RESOLVED'
  } catch (error) {
    return isClientError(error) ? error.code : 'NOT_A_CLIENT_ERROR'
  }
}

describe('워커 안의 처리', () => {
  function collect(request: TrainRequest): WorkerMessage[] {
    const messages: WorkerMessage[] = []
    handleTrain(request, (message) => messages.push(message))
    return messages
  }

  it('모델마다 진행을 보내고 마지막에 결과를 보낸다', () => {
    const messages = collect(requestFor())
    expect(messages.map((message) => message.type)).toEqual(['progress', 'progress', 'done'])
  })

  it('진행은 모델 단위다 - 백분율을 만들지 않는다', () => {
    const [first] = collect(requestFor())
    expect(first?.type).toBe('progress')
    if (first?.type === 'progress') {
      expect(first.completed).toBe(1)
      expect(first.total).toBe(2)
      expect(first.run.algorithm).toBe('decision_tree')
    }
  })

  it('던지지 않는다 - 실패도 메시지다', () => {
    const broken = settingsFor()
    delete broken.target

    const messages = collect(requestFor(broken))
    expect(messages).toEqual([{ type: 'failed', code: 'TARGET_NOT_SELECTED', params: {} }])
  })

  it('알고리즘 하나가 실패해도 실험은 성공이다', () => {
    const messages = collect(requestFor(settingsFor({ selectedAlgorithms: models('svm', 'knn') })))
    expect(messages[messages.length - 1]?.type).toBe('done')
  })

  it('history를 넘기면 id가 이어진다', () => {
    const first = collect(requestFor()).at(-1)
    if (first?.type !== 'done') return expect.unreachable()

    const history: RunsFile = { experiments: [first.experiment] }
    const messages: WorkerMessage[] = []
    handleTrain({ ...requestFor(), history }, (message) => messages.push(message))

    const second = messages.at(-1)
    expect(second?.type === 'done' && second.experiment.id).toBe('experiment-2')
  })
})

describe('메인 스레드 쪽', () => {
  it('요청을 그대로 워커에 넘긴다', () => {
    const worker = new FakeWorker()
    const request = requestFor()
    train(request, { createWorker: () => worker })
    expect(worker.posted).toEqual([request])
  })

  it('done을 받으면 결과가 나오고 워커가 종료된다', async () => {
    const worker = new HandlerWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })

    const { experiment, preprocessor } = await result
    expect(experiment.runs.map((run) => run.status)).toEqual(['done', 'done'])
    expect(preprocessor.format).toBe('mlpx-preprocess-v1')
    expect(worker.terminated).toBe(1)
  })

  it('진행이 순서대로 흘러나온다', async () => {
    const worker = new HandlerWorker()
    const seen: [string, number, number][] = []
    const { result } = train(
      { type: 'train', input: inputFor(settingsFor({ selectedAlgorithms: models('knn', 'svm') })) },
      {
        createWorker: () => worker,
        onProgress: (run, completed, total) => seen.push([run.algorithm, completed, total]),
      },
    )

    await result
    expect(seen).toEqual([
      ['knn', 1, 2],
      ['svm', 2, 2],
    ])
  })

  it('failed는 ClientError로 다시 세워진다', async () => {
    const worker = new FakeWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })
    worker.emit({ type: 'failed', code: 'SPLIT_TOO_FEW_ROWS', params: { minRows: 2 } })

    await expect(rejectionCode(result)).resolves.toBe('SPLIT_TOO_FEW_ROWS')
    expect(worker.terminated).toBe(1)
  })

  it('모르는 코드는 JOB_FAILED로 좁혀진다 - 로케일에 없는 키를 화면에 흘리지 않는다', async () => {
    const worker = new FakeWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })
    worker.emit({ type: 'failed', code: 'WHAT_IS_THIS', params: {} })

    await expect(rejectionCode(result)).resolves.toBe('JOB_FAILED')
  })

  it('워커 자체가 죽으면 JOB_FAILED다', async () => {
    const worker = new FakeWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })
    worker.crash()

    await expect(rejectionCode(result)).resolves.toBe('JOB_FAILED')
    expect(worker.terminated).toBe(1)
  })
})

describe('취소', () => {
  it('terminate하고 JOB_CANCELLED로 거절한다', async () => {
    const worker = new FakeWorker()
    const { result, cancel } = train(requestFor(), { createWorker: () => worker })
    cancel()

    await expect(rejectionCode(result)).resolves.toBe('JOB_CANCELLED')
    expect(worker.terminated).toBe(1)
  })

  it('취소한 뒤 도착한 진행은 버린다', async () => {
    const worker = new FakeWorker()
    let progress = 0
    const { result, cancel } = train(requestFor(), {
      createWorker: () => worker,
      onProgress: () => {
        progress += 1
      },
    })

    cancel()
    // terminate가 즉시 조용해지지는 않는다. 이미 큐에 있던 것이 도착할 수 있다.
    worker.emit({ type: 'failed', code: 'JOB_FAILED', params: {} })

    await expect(rejectionCode(result)).resolves.toBe('JOB_CANCELLED')
    expect(progress).toBe(0)
  })

  it('끝난 뒤의 취소는 결과를 뒤집지 않는다', async () => {
    const worker = new HandlerWorker()
    const { result, cancel } = train(requestFor(), { createWorker: () => worker })

    await result
    cancel()

    await expect(result).resolves.toBeDefined()
    // 두 번 종료하지 않는다. 학생이 열 번 돌리는 사이에 워커가 쌓이면 안 된다.
    expect(worker.terminated).toBe(1)
  })
})
