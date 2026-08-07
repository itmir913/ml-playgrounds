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

import { useTraining } from '../src/composables/useTraining'
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

function requestFor(count: number): TrainRequest {
  const selectedAlgorithms = Array.from({ length: count }, () => ({ algorithm: 'decision_tree' }))
  return { type: 'train', input: { settings: { selectedAlgorithms } } } as unknown as TrainRequest
}

function harness() {
  const workers: FakeWorker[] = []
  const training = useTraining(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
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

  it('담은 모델마다 상태를 들고 있다 - 끝난 개수로는 누가 오래 걸리는지 모른다', async () => {
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
    const store = ref({
      settings: { selectedAlgorithms: [{ algorithm: 'decision_tree' }], features: ['a'] },
      runs: { experiments: [] },
    })
    const { training, latest } = harness()

    const done = training.run({
      type: 'train',
      input: {
        settings: store.value.settings,
        dataset: { columns: ['a'], rows: [['1']] },
        context: { serverStatus: 'unavailable', rowCount: 1 },
      },
      history: store.value.runs,
    } as unknown as TrainRequest)

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

  it('나머지 실패는 그대로 올라간다 - 알림은 화면이 띄운다', async () => {
    const { training, latest } = harness()
    const done = training.run(requestFor(1))
    latest()?.emit({ type: 'failed', code: 'TARGET_NOT_SELECTED', params: {} })

    await expect(done).rejects.toBeInstanceOf(ClientError)
    expect(training.running.value).toBe(false)
  })
})
