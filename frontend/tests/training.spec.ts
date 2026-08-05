/**
 * [학습] 한 번의 수명 (src/composables/useTraining.ts).
 *
 * **화면 없이 테스트한다.** 여기서 지키는 것은 넷이다 — 진행이 모델 단위로 세어지는가,
 * 취소가 실패가 아닌가, 나머지 실패는 그대로 올라가는가, 두 번 눌러도 하나만 도는가.
 * 마지막 것이 이 파일에서 제일 중요하다: **학생은 느리다고 생각하면 한 번 더 누르고**,
 * 그러면 같은 설정의 실험이 둘 생긴다.
 *
 * 진짜 Worker는 안 띄운다 (tests/worker.spec.ts와 같은 이유다).
 */

import { describe, expect, it } from 'vitest'

import { useTraining } from '../src/composables/useTraining'
import { ClientError } from '../src/errors'
import type { TrainWorker } from '../src/ml/worker/client'
import type { TrainRequest, WorkerMessage } from '../src/ml/worker/protocol'
import type { Run } from '../src/project/schema'

/** 메시지를 손으로 밀어 넣는 가짜 워커. */
class FakeWorker implements TrainWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = 0

  postMessage(): void {}

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

    latest()?.emit({ type: 'progress', run: RUN, completed: 2, total: 3 })
    expect(training.progress.value).toEqual({ completed: 2, total: 3 })

    latest()?.emit(DONE)
    await done
    expect(training.running.value).toBe(false)
    expect(training.progress.value).toBeNull()
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
