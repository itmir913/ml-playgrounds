/**
 * [학습] 한 번의 수명. **화면은 상태만 읽는다.**
 *
 * **학습은 언제나 백그라운드다** (open-decisions.md). 워커가 도는 동안 화면이 살아 있어야
 * 하고, 그래서 진행과 취소가 여기 있다 — 메인 스레드에서 돌리면 진행률도 [멈추기]도 같이
 * 죽고 남는 것은 "응답 없음"뿐이다.
 *
 * **진행은 모델 단위다** (mlpx-spec.md §0.3). 워커가 백분율을 만들지 않는다 — 서버 학습이
 * 붙었을 때 계산이 두 벌이 되고 반드시 어긋난다. 여기서 "5개 중 3개째"를 센다.
 *
 * **취소는 워커 terminate 하나다.** 동기 루프를 밖에서 멈출 다른 방법이 없다.
 * 45분 수업에서 잘못 누른 학습을 못 멈추는 것은 그 자체로 실패다.
 *
 * 워커 생성기를 **주입받는다.** 진짜 Worker를 여기서 만들면 이 파일을 부르는 테스트마다
 * 번들러가 워커 청크를 만들려 든다 (ml/worker/spawn.ts와 같은 이유다).
 */

import { computed, readonly, ref } from 'vue'

import { isClientError } from '../errors'
import type { ExperimentResult } from '../ml/experiment'
import { train, type TrainWorker } from '../ml/worker/client'
import type { TrainRequest } from '../ml/worker/protocol'

export interface TrainingProgress {
  /** 끝난 모델 수. */
  readonly completed: number
  /** 이 실험에서 돌릴 모델 수. */
  readonly total: number
}

export function useTraining(createWorker: () => TrainWorker) {
  const progress = ref<TrainingProgress | null>(null)
  const running = computed(() => progress.value !== null)

  /** 지금 도는 학습을 멈추는 손잡이. 안 돌면 null이다. */
  let handle: { cancel: () => void } | null = null

  /**
   * 실험 하나를 돌린다. **끝날 때까지 기다린다** — 부르는 쪽이 `AppButton`의 `action`으로
   * 주므로 버튼이 도는 동안 스스로 꺼진다.
   *
   * 취소는 결과가 아니라 **아무 일도 없었던 것**으로 돌려준다(null). 학생이 스스로 누른
   * 것이라 알릴 실패가 없다. 나머지 실패는 그대로 던져서 부르는 쪽이 알림으로 만든다.
   */
  async function run(request: TrainRequest): Promise<ExperimentResult | null> {
    // 두 번 눌려도 두 개가 돌지 않는다. 버튼이 이미 막지만 여기가 마지막 관문이다.
    if (running.value) return null

    progress.value = { completed: 0, total: request.input.settings.selectedAlgorithms.length }

    const started = train(request, {
      createWorker,
      onProgress: (_run, completed, total) => {
        progress.value = { completed, total }
      },
    })
    handle = started

    try {
      return await started.result
    } catch (error) {
      if (isClientError(error) && error.code === 'JOB_CANCELLED') return null
      throw error
    } finally {
      handle = null
      progress.value = null
    }
  }

  /** 학습을 멈춘다. 안 돌고 있으면 아무 일도 일어나지 않는다. */
  function cancel(): void {
    handle?.cancel()
  }

  return { progress: readonly(progress), running, run, cancel }
}
