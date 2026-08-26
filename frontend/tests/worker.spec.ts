// @vitest-environment jsdom
// 가짜 Worker가 `new ErrorEvent`를 쓰는데 node에는 그 전역이 없다.
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
import type { RunsFile, Settings, TabularSettings } from '../src/project/schema'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN, irisDataset } from './fixtures/iris'
import { dataSnapshot } from '../src/project/schema'

const models = (...names: string[]) => names.map((algorithm) => ({ algorithm }))

/**
 * **표의 설정은 `settings.data` 안이지만 여기서는 평평하게 받는다** (mlpx-spec.md §3).
 *
 * 검사가 실제로 넘기는 것은 아래에서 조립한 진짜 `Settings`다. 평평하게 받는 이유는
 * `Settings`가 looseObject라 **`Partial<Settings>`에 `features`를 얹어도 타입이 안
 * 울고 조용히 무시되기 때문이다** — 스키마를 가르던 날 실제로 그렇게 통과했다.
 * 여기서 갈라 넣으면 그 자리가 컴파일에 걸린다.
 */
type SettingsOverrides = Partial<Omit<Settings, 'data'>> & Partial<TabularSettings>

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

const baseData: TabularSettings = {
  dataset: {
    path: 'dataset/data.csv',
    originalFileName: 'iris.csv',
    hasHeader: true,
    encoding: 'utf-8',
  },
  features: [...IRIS_FEATURE_COLUMNS],
  target: IRIS_TARGET_COLUMN,
  preprocessing: { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' },
}

function settingsFor(overrides: SettingsOverrides = {}): Settings {
  return {
    split: { method: 'holdout', testSize: 0.3, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: models('decision_tree', 'knn'),
    hyperparameters: {},
    ...splitOverrides(overrides).common,
    data: { ...baseData, ...splitOverrides(overrides).data },
  }
}

function inputFor(settings: Settings = settingsFor()): ExperimentInput {
  return {
    dataset: irisDataset(),
    testDataset: null,
    taskType: 'classification',
    dataType: 'tabular',
    settings,
    context: { serverStatus: 'unavailable', rowCount: 30, dataType: 'tabular' },
    // 표에서는 설정에서 그대로 나온다. 갈리는 것은 이미지뿐이고 그건 어댑터가 짓는다.
    snapshot: dataSnapshot('tabular', settings),
  }
}

function requestFor(settings?: Settings): TrainRequest {
  return { type: 'train', input: inputFor(settings) }
}

/** 메시지를 손으로 밀어 넣는 가짜 워커. */
class FakeWorker implements TrainWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
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

  crash(message = '', filename = '', lineno = 0): void {
    this.onerror?.(new ErrorEvent('error', { message, filename, lineno }))
  }

  garble(): void {
    this.onmessageerror?.({} as MessageEvent<unknown>)
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

  it('모델마다 시작과 끝을 보내고 마지막에 결과를 보낸다', () => {
    const messages = collect(requestFor())
    expect(messages.map((message) => message.type)).toEqual([
      // **첫 모델보다 먼저다.** 취소가 조립할 재료이므로 루프 안에 있으면 늦다
      // (open-decisions.md "멈추기가 끝난 것을 남긴다" §3).
      'prelude',
      'started',
      'progress',
      'started',
      'progress',
      'done',
    ])
  })

  it('머리말이 runs 말고 전부 들고 온다 - 취소가 이것으로 조립한다', () => {
    const first = collect(requestFor())[0]
    expect(first?.type).toBe('prelude')
    if (first?.type === 'prelude') {
      expect(first.prelude.id).toBe('experiment-1')
      expect(first.prelude.settings.selectedAlgorithms).toHaveLength(2)
      expect(first.prelude.preprocessor).toBeDefined()
    }
  })

  it('끝 보고가 방금 담은 모델을 싣는다 - 취소하면 워커와 함께 사라진다', () => {
    const finished = collect(requestFor()).filter((message) => message.type === 'progress')
    expect(finished).not.toHaveLength(0)
    // 담기는 알고리즘이 하나라도 있으면 그 자리에 모델이 실린다. 직렬화기가 없는
    // 알고리즘은 지표만 남는 것이 정상이다 (mlpx-spec.md §4.2).
    const carried = finished.filter(
      (message) => message.type === 'progress' && message.model !== undefined,
    )
    expect(carried.length).toBeGreaterThan(0)
  })

  it('시작 보고가 무엇이 도는지 말한다 - 끝난 개수로는 알 수 없다', () => {
    const started = collect(requestFor()).find((message) => message.type === 'started')
    const first = started
    expect(first?.type).toBe('started')
    if (first?.type === 'started') {
      expect(first.index).toBe(0)
      expect(first.algorithm).toBe('decision_tree')
      // 학생이 고른 것이 아니라 **실제로 도는** 실행 방법이다.
      expect(first.runtime).toBe('mljs')
      expect(first.total).toBe(2)
    }
  })

  it('끝 보고도 자리를 싣는다 - 받는 쪽이 "끝난 개수 - 1"로 되짚지 않는다', () => {
    const messages = collect(requestFor())
    const finished = messages.filter((message) => message.type === 'progress')
    expect(finished.map((message) => (message.type === 'progress' ? message.index : -1))).toEqual([
      0, 1,
    ])
  })

  it('진행은 모델 단위다 - 백분율을 만들지 않는다', () => {
    const first = collect(requestFor()).find((message) => message.type === 'progress')
    expect(first?.type).toBe('progress')
    if (first?.type === 'progress') {
      expect(first.completed).toBe(1)
      expect(first.total).toBe(2)
      expect(first.run.algorithm).toBe('decision_tree')
    }
  })

  it('던지지 않는다 - 실패도 메시지다', () => {
    const broken = settingsFor()
    delete broken.data.target

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

  it('시작도 순서대로 흘러나온다 - 화면이 지금 도는 것을 안다', async () => {
    const worker = new HandlerWorker()
    const seen: [number, string, string][] = []
    const { result } = train(
      { type: 'train', input: inputFor(settingsFor({ selectedAlgorithms: models('knn', 'svm') })) },
      {
        createWorker: () => worker,
        onStarted: ({ index, algorithm, runtime }) => seen.push([index, algorithm, runtime]),
      },
    )

    await result
    expect(seen).toEqual([
      [0, 'knn', 'mljs'],
      [1, 'svm', 'mljs'],
    ])
  })

  it('취소한 뒤 도착한 시작 보고는 버린다', async () => {
    const worker = new FakeWorker()
    const seen: number[] = []
    const { result, cancel } = train(requestFor(), {
      createWorker: () => worker,
      onStarted: ({ index }) => seen.push(index),
    })

    cancel()
    worker.emit({ type: 'started', index: 0, algorithm: 'knn', runtime: 'mljs', total: 2 })

    await expect(rejectionCode(result)).resolves.toBe('JOB_CANCELLED')
    expect(seen).toEqual([])
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

  /**
   * **이 경로만 원문이 통째로 비어 있었다.** 그래서 화면에는 "학습에 실패했습니다."
   * 한 줄만 뜨고 교사가 손쓸 단서가 하나도 없었다
   * (open-decisions.md "학습 실패는 교사가 읽을 수 있게 전달한다").
   */
  it('죽은 사유와 자리를 기술 정보로 싣는다', async () => {
    const worker = new FakeWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })
    worker.crash('ml-cart is not a function', 'http://localhost/train.worker.js', 42)

    const error = await result.catch((thrown: unknown) => thrown)
    expect(isClientError(error) && error.params.detail).toBe(
      'ml-cart is not a function http://localhost/train.worker.js:42',
    )
  })

  it('사유가 없어도 코드는 남는다 - 빈 문자열을 기술 정보라고 붙이지 않는다', async () => {
    const worker = new FakeWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })
    worker.crash()

    const error = await result.catch((thrown: unknown) => thrown)
    expect(isClientError(error) && error.params.detail).toBeUndefined()
  })

  /**
   * 여기서 안 끊으면 **아무 일도 안 일어난 것처럼 보인다** - 결과도 실패도 안 오고
   * Promise가 영영 안 풀려 [학습] 버튼이 꺼진 채로 남는다.
   */
  it('복원하지 못한 메시지도 실패로 끊는다', async () => {
    const worker = new FakeWorker()
    const { result } = train(requestFor(), { createWorker: () => worker })
    worker.garble()

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
