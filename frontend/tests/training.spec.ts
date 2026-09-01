/**
 * [학습] 한 번의 수명 (src/composables/useTraining.ts).
 *
 * **화면 없이 테스트한다.** 여기서 지키는 것은 다섯이다 — 진행이 모델 단위로 세어지는가,
 * 취소가 실패가 아닌가, 나머지 실패는 그대로 올라가는가, 두 번 눌러도 하나만 도는가,
 * 그리고 **스토어에서 온 값이 실제로 워커에 넘어가는가.**
 *
 * 넷째는 학생이 만드는 고장이다 — **느리다고 생각하면 한 번 더 누르고**, 그러면 같은
 * 설정의 실험이 둘 생긴다. 다섯째는 우리가 만든 고장이다 — Vue의 반응형 프록시는 구조화
 * 복제가 안 되고, 그걸 모르는 가짜 워커를 두면 **테스트만 초록인 상태**가 된다.
 *
 * 진짜 Worker는 안 띄운다 (tests/worker.spec.ts와 같은 이유다).
 */

import { describe, expect, it } from 'vitest'
import { ref } from 'vue'

import { useTraining, type TrainingOptions } from '../src/composables/useTraining'
import { ClientError } from '../src/errors'
import type { TrainWorker } from '../src/ml/worker/client'
import type { TrainRequest, WorkerMessage } from '../src/ml/worker/protocol'
import type { Run } from '../src/project/schema'

/**
 * 메시지를 손으로 밀어 넣는 가짜 워커.
 *
 * **postMessage가 진짜처럼 구조화 복제를 한다.** 이게 이 파일에서 제일 중요한 한 줄이다 -
 * 스토어에서 온 Vue 프록시는 복제가 안 되고(DataCloneError), 그걸 안 하는 가짜를 두면
 * 테스트는 초록인데 실제 브라우저에서만 [학습]이 죽는다.
 */
class FakeWorker implements TrainWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = 0

  postMessage(message: TrainRequest): void {
    structuredClone(message)
  }

  terminate(): void {
    this.terminated += 1
  }

  emit(message: WorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<WorkerMessage>)
  }
}

const RUN: Run = {
  id: 'run-1',
  algorithm: 'decision_tree',
  hyperparameters: {},
  trainedAt: '2026-08-05T09:00:00Z',
  computedBy: 'browser',
  status: 'done',
  metrics: { accuracy: 1 },
}

/** 실패한 run. 상태 배열이 성공과 실패를 가르는지 보려고 둔다. */
const FAILED_RUN: Run = {
  ...RUN,
  id: 'run-2',
  status: 'failed',
  metrics: undefined,
  failure: { code: 'JOB_FAILED' },
}

/** 실험 내용은 여기서 안 본다. 이 층이 하는 일은 상태와 수명이다. */
const DONE = {
  type: 'done',
  experiment: { id: 'experiment-1', startedAt: '2026-08-05T09:00:00Z', runs: [RUN] },
  preprocessor: { format: 'x' },
  models: new Map(),
} as unknown as WorkerMessage

/**
 * 모델 루프에 들어가기 전에 오는 머리말. **취소가 이것으로 조립한다**
 * (open-decisions.md "멈추기가 끝난 것을 남긴다" §3).
 */
const PRELUDE = {
  type: 'prelude',
  prelude: {
    id: 'experiment-7',
    startedAt: '2026-08-05T09:00:00Z',
    settings: { selectedAlgorithms: [{ algorithm: 'decision_tree', runtime: 'mljs' }] },
    preprocessor: { format: 'x' },
  },
} as unknown as WorkerMessage

/** 담긴 모델 하나를 실은 끝 보고. */
const PROGRESS_WITH_MODEL = {
  type: 'progress',
  run: RUN,
  index: 0,
  completed: 1,
  total: 3,
  model: { format: 'y' },
} as unknown as WorkerMessage

function requestFor(count: number): TrainRequest {
  const selectedAlgorithms = Array.from({ length: count }, () => ({ algorithm: 'decision_tree' }))
  return { type: 'train', input: { settings: { selectedAlgorithms } } } as unknown as TrainRequest
}

function harness(options?: TrainingOptions) {
  const workers: FakeWorker[] = []
  const training = useTraining(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  }, options)
  return { training, workers, latest: () => workers[workers.length - 1] }
}

describe('학습이 도는 동안', () => {
  it('진행을 모델 단위로 센다 - 시작하자마자 총 개수를 안다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(3))

    expect(training.running.value).toBe(true)
    expect(training.progress.value).toEqual({ completed: 0, total: 3 })

    latest()?.emit({ type: 'progress', run: RUN, index: 1, completed: 2, total: 3 })
    expect(training.progress.value).toEqual({ completed: 2, total: 3 })

    latest()?.emit(DONE)
    await done
    expect(training.running.value).toBe(false)
    expect(training.progress.value).toBeNull()
  })

  it('추가한 모델마다 상태를 들고 있다 - 끝난 개수로는 누가 오래 걸리는지 모른다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(3))

    // 누른 직후에는 아직 아무 보고도 안 왔다.
    expect(training.statuses.value).toEqual(['waiting', 'waiting', 'waiting'])

    latest()?.emit({ type: 'started', index: 0, algorithm: 'knn', runtime: 'mljs', total: 3 })
    expect(training.statuses.value).toEqual(['running', 'waiting', 'waiting'])

    latest()?.emit({ type: 'progress', run: RUN, index: 0, completed: 1, total: 3 })
    latest()?.emit({ type: 'started', index: 1, algorithm: 'svm', runtime: 'mljs', total: 3 })
    latest()?.emit({ type: 'progress', run: FAILED_RUN, index: 1, completed: 2, total: 3 })
    latest()?.emit({ type: 'started', index: 2, algorithm: 'knn', runtime: 'mljs', total: 3 })

    // **여기가 실제로 겪은 장면이다** - 둘은 끝났고 하나만 몇 분씩 돈다.
    expect(training.statuses.value).toEqual(['done', 'failed', 'running'])

    latest()?.emit(DONE)
    await done
    // 끝나면 비운다 - 결과는 결과 화면이 말한다.
    expect(training.statuses.value).toEqual([])
  })

  /**
   * **실패한 학습은 배수를 갱신하면 안 된다** (2026-09-01, 코드 소유자).
   *
   * 실패한 실행도 시간을 갖는다 — 다만 그것은 **학습에 걸린 시간이 아니라 튕기는 데
   * 걸린 시간**이다. 데이터가 상한을 넘어 곧바로 거절된 실행의 몇 밀리초가 그대로 그
   * 알고리즘의 기기 배수가 되어, **다음 예상이 `약 1초`**로 떴다. 예상이 없는 것보다
   * 나쁘다 — 학생은 그 수를 믿는다.
   */
  it('성공한 모델만 시계를 내놓는다', async () => {
    const timed: string[] = []
    const { training, latest } = harness({ onModelTimed: ({ algorithm }) => timed.push(algorithm) })

    const done = training.run(requestFor(2))
    latest()?.emit({
      type: 'started',
      index: 0,
      algorithm: 'decision_tree',
      runtime: 'mljs',
      total: 2,
    })
    latest()?.emit({ type: 'progress', run: FAILED_RUN, index: 0, completed: 1, total: 2 })
    latest()?.emit({ type: 'started', index: 1, algorithm: 'knn', runtime: 'mljs', total: 2 })
    latest()?.emit({ type: 'progress', run: RUN, index: 1, completed: 2, total: 2 })

    // 실패한 자리는 안 내놓고, 성공한 자리만 내놓는다.
    expect(timed).toEqual(['knn'])

    latest()?.emit(DONE)
    await done
  })

  it('두 번 눌러도 워커는 하나다', async () => {
    const { training, workers, latest } = harness()
    const first = training.run(requestFor(1))

    expect(await training.run(requestFor(1))).toBeNull()
    expect(workers).toHaveLength(1)

    latest()?.emit(DONE)
    await first
  })
})

describe('스토어에서 온 값을 워커에 넘긴다', () => {
  /**
   * **Vue의 반응형 프록시는 구조화 복제가 안 된다.** 스토어의 `ref` 아래는 전부 프록시라
   * 화면이 `project.file.document.settings`를 그대로 넘기면 postMessage가 그 자리에서
   * DataCloneError를 던진다. 겪은 고장이라 테스트로 박아 둔다.
   */
  it('반응형 상태로 만든 요청도 넘어간다', async () => {
    // **여섯 조각을 다 반응형으로 만든다.** 예전에는 `settings`와 `runs`만 `ref` 아래였고
    // `dataset`·`context`·`testDataset`·`input` 자신은 평범한 객체 리터럴이라, `plain()`에서
    // 그 넷의 `toRaw`를 빼도 아무도 안 울었다 (2026-08-30, R12 감사 C-4). 그 파일 머리말이
    // *"조각마다 한 번씩 벗기면 거기서 끝난다"*고 여섯을 세어 두었는데 둘만 시험했다.
    const store = ref({
      settings: { selectedAlgorithms: [{ algorithm: 'decision_tree' }], features: ['a'] },
      runs: { experiments: [] },
      dataset: { columns: ['a'], rows: [['1']] },
      testDataset: { columns: ['a'], rows: [['2']] },
      context: { limitsOff: false, serverStatus: 'unavailable', rowCount: 1, dataType: 'tabular' },
    })
    const request = ref({
      type: 'train',
      input: {
        settings: store.value.settings,
        dataset: store.value.dataset,
        testDataset: store.value.testDataset,
        context: store.value.context,
      },
      history: store.value.runs,
    })
    const { training, latest } = harness()

    const done = training.run(request.value as unknown as TrainRequest)

    latest()?.emit(DONE)
    await expect(done).resolves.not.toBeNull()
  })

  it('postMessage가 던져도 갇히지 않는다 - 다시 누를 수 있어야 한다', async () => {
    const training = useTraining(() => {
      const worker = new FakeWorker()
      worker.postMessage = () => {
        throw new Error('DataCloneError')
      }
      return worker
    })

    await expect(training.run(requestFor(1))).rejects.toThrow()
    expect(training.running.value).toBe(false)
    expect(training.progress.value).toBeNull()
  })
})

describe('끝나는 길', () => {
  it('결과를 그대로 돌려준다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(1))
    latest()?.emit(DONE)

    expect((await done)?.experiment.id).toBe('experiment-1')
  })

  it('취소는 실패가 아니다 - 학생이 스스로 누른 것이다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(1))

    training.cancel()
    expect(await done).toBeNull()
    expect(latest()?.terminated).toBe(1)
    // 다음 학습을 바로 시작할 수 있어야 한다.
    expect(training.running.value).toBe(false)
  })

  it('멈추면 끝난 것이 남는다 - 담은 다섯 중 셋이 끝났으면 셋을 건넨다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(3))

    latest()?.emit(PRELUDE)
    latest()?.emit(PROGRESS_WITH_MODEL)
    training.cancel()

    const result = await done
    // **null이 아니다.** 이 한 줄이 이 변경의 전부다.
    expect(result?.experiment.id).toBe('experiment-7')
    expect(result?.experiment.runs).toHaveLength(1)
    // 지표만 건지면 소용이 없다 - 모델이 없으면 예측도 재현도 못 한다.
    expect(result?.models.get('run-1')).toBeDefined()
    expect(latest()?.terminated).toBe(1)
    expect(training.running.value).toBe(false)
  })

  it('끝난 것이 없으면 아무것도 안 남긴다 - 잘못 누른 흔적을 쌓지 않는다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(3))

    // 머리말은 왔지만 첫 모델이 아직 안 끝났다.
    latest()?.emit(PRELUDE)
    training.cancel()

    expect(await done).toBeNull()
  })

  it('취소한 뒤에 도착한 보고는 안 쌓인다 - terminate가 즉시 조용해지지 않는다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(3))

    latest()?.emit(PRELUDE)
    latest()?.emit(PROGRESS_WITH_MODEL)
    training.cancel()
    // 이미 정해진 뒤다. 여기서 쌓이면 결과가 나중에 바뀐다.
    latest()?.emit(PROGRESS_WITH_MODEL)

    expect((await done)?.experiment.runs).toHaveLength(1)
  })

  it('나머지 실패는 그대로 올라간다 - 알림은 화면이 띄운다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(1))
    latest()?.emit({ type: 'failed', code: 'TARGET_NOT_SELECTED', params: {} })

    await expect(done).rejects.toBeInstanceOf(ClientError)
    expect(training.running.value).toBe(false)
  })
})
