/**
 * 학습 한 번 동안 **담은 모델마다의 상태** (architecture.md §8.17).
 *
 * **화면 밖에 두는 이유는 전부 테스트할 수 있어서다.** 어느 줄이 도는 중인지는 눈으로
 * 확인하기 어렵고 조용히 틀린다 - 한 칸 밀린 상태는 화면에 멀쩡히 그려지고, 그 순간
 * 학생은 **엉뚱한 모델을 범인으로 지목한다.** 그 지목이 이 기능을 만든 이유 그 자체라,
 * 여기가 틀리면 없느니만 못하다.
 *
 * **워커가 말한 것만 쓴다. 여기서 추측하지 않는다.** "앞의 것이 끝났으니 다음 것이 돌
 * 것이다"는 순차 실행일 때만 맞는 추론이고, 서버 학습이나 병렬 실행이 붙는 날 조용히
 * 틀린다. 그래서 시작도 끝도 자리(index)를 함께 받는다 (`ml/worker/protocol.ts`).
 */

import type { Run } from '../project/schema'

/**
 * 담은 모델 한 줄의 상태.
 *
 * `failed`는 **그 모델 하나만 실패한 것**이다 - 실험 하나가 통째로 실패하는 일은 없다
 * (mlpx-spec.md §4.1). 실험 자체가 터지면 학습이 끝난 것이라 이 목록은 사라진다.
 */
export type ModelStatus = 'waiting' | 'running' | 'done' | 'failed'

/** 아직 아무 보고도 안 왔다. 전부 대기다. */
export function waitingStatuses(count: number): ModelStatus[] {
  return Array.from({ length: count }, () => 'waiting')
}

/**
 * 자리 하나를 바꾼 새 배열. **제자리에서 안 바꾼다** - 화면이 이 배열을 그대로 들고
 * 있으므로(shallowRef) 같은 배열을 고치면 다시 그려지지 않는다.
 *
 * **모르는 자리는 조용히 무시한다.** 워커가 보낸 index가 목록 밖이면 화면과 요청이
 * 어긋난 것인데, 그때 배열을 늘리면 **없는 모델에 상태가 생긴다.** 학습이 도는 중에
 * 이 목록을 다시 만드는 경로가 지금은 없지만, 있다고 가정하고 막아 둔다.
 */
function replaced(
  statuses: readonly ModelStatus[],
  index: number,
  status: ModelStatus,
): ModelStatus[] {
  if (index < 0 || index >= statuses.length) return [...statuses]
  const next = [...statuses]
  next[index] = status
  return next
}

/** 워커가 이 자리를 시작했다고 말했다. */
export function withStarted(statuses: readonly ModelStatus[], index: number): ModelStatus[] {
  return replaced(statuses, index, 'running')
}

/**
 * 워커가 이 자리를 끝냈다고 말했다. **성공과 실패를 run이 정한다** - 여기서 다시
 * 판정하면 결과 화면과 두 벌이 된다 (`ml/results.ts`의 `doneRuns`와 같은 기준이다).
 */
export function withFinished(
  statuses: readonly ModelStatus[],
  index: number,
  run: Run,
): ModelStatus[] {
  return replaced(statuses, index, run.status === 'done' ? 'done' : 'failed')
}
