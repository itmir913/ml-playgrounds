/**
 * 추가한 모델마다의 상태 (architecture.md §8.17).
 *
 * **한 칸 밀린 상태는 화면에 멀쩡히 그려진다.** 그리고 그 순간 학생은 엉뚱한 모델을
 * 오래 걸리는 범인으로 지목한다 — 이 기능을 만든 이유가 바로 그 지목이라, 자리가
 * 틀리면 없느니만 못하다. 그래서 자리를 눈이 아니라 여기서 확인한다.
 */

import { describe, expect, it } from 'vitest'

import {
  waitingStatuses,
  withFinished,
  withStarted,
  type ModelStatus,
} from '../src/ml/training-status'
import type { Run } from '../src/project/schema'

function run(status: Run['status']): Run {
  const base = {
    id: 'run-1',
    algorithm: 'knn',
    hyperparameters: {},
    computedBy: 'browser' as const,
    trainedAt: '2026-08-07T00:00:00.000Z',
  }
  return status === 'done'
    ? { ...base, status, metrics: { accuracy: 1 } }
    : { ...base, status, failure: { code: 'JOB_FAILED' } }
}

describe('학습 중 모델 상태', () => {
  it('시작 전에는 전부 대기다', () => {
    expect(waitingStatuses(3)).toEqual<ModelStatus[]>(['waiting', 'waiting', 'waiting'])
  })

  it('워커가 말한 자리만 학습 중이 된다 - 앞의 것이 끝났다고 다음을 켜지 않는다', () => {
    const started = withStarted(waitingStatuses(3), 1)
    expect(started).toEqual<ModelStatus[]>(['waiting', 'running', 'waiting'])
  })

  it('성공과 실패를 run이 정한다 - 여기서 다시 판정하지 않는다', () => {
    const statuses = withStarted(waitingStatuses(2), 0)
    expect(withFinished(statuses, 0, run('done'))[0]).toBe('done')
    expect(withFinished(statuses, 0, run('failed'))[0]).toBe('failed')
  })

  it('끝난 자리 하나가 나머지를 안 건드린다 - 오래 걸리는 줄이 그대로 학습 중이다', () => {
    // 실제로 겪은 장면이다: 셋 중 둘은 즉시 끝나고 하나만 몇 분씩 돈다.
    let statuses = waitingStatuses(3)
    statuses = withStarted(statuses, 0)
    statuses = withFinished(statuses, 0, run('done'))
    statuses = withStarted(statuses, 1)
    statuses = withFinished(statuses, 1, run('done'))
    statuses = withStarted(statuses, 2)

    expect(statuses).toEqual<ModelStatus[]>(['done', 'done', 'running'])
  })

  it('제자리에서 안 바꾼다 - 같은 배열을 고치면 화면이 다시 안 그려진다', () => {
    const before = waitingStatuses(2)
    const after = withStarted(before, 0)

    expect(after).not.toBe(before)
    expect(before).toEqual<ModelStatus[]>(['waiting', 'waiting'])
  })

  it('목록 밖의 자리는 조용히 무시한다 - 없는 모델에 상태를 만들지 않는다', () => {
    expect(withStarted(waitingStatuses(2), 5)).toHaveLength(2)
    expect(withStarted(waitingStatuses(2), -1)).toEqual<ModelStatus[]>(['waiting', 'waiting'])
    expect(withFinished(waitingStatuses(2), 9, run('done'))).toHaveLength(2)
  })
})
