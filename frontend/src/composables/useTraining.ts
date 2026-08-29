/**
 * [학습하기] 한 번의 수명. **화면은 상태만 읽는다.**
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

import { computed, readonly, ref, shallowRef, toRaw } from 'vue'

import { isClientError } from '../errors'
import type { ExperimentResult } from '../ml/experiment'
import { waitingStatuses, withFinished, withStarted, type ModelStatus } from '../ml/training-status'
import { train, type TrainWorker } from '../ml/worker/client'
import type { TrainRequest } from '../ml/worker/protocol'

export interface TrainingProgress {
  /** 끝난 모델 수. */
  readonly completed: number
  /** 이 실험에서 돌릴 모델 수. */
  readonly total: number
}

/**
 * 워커로 넘어갈 수 있는 모양으로 되돌린다. **이 파일이 있는 이유의 절반이 이것이다.**
 *
 * 요청은 스토어에서 온다. 스토어의 `ref` 아래는 전부 Vue의 반응형 **프록시**이고,
 * **프록시는 구조화 복제가 안 된다** — `postMessage`가 그 자리에서 `DataCloneError`를
 * 던진다. 화면이 무심코 `project.file.document.settings`를 넘기면 그렇게 된다.
 *
 * 한 겹만 벗기면 안 된다. 프록시에서 꺼낸 값은 다시 프록시라(중첩 접근마다 새로 씌운다)
 * 요청이 손으로 조립된 객체면 안쪽 조각들이 여전히 프록시다. 반대로 `toRaw`가 돌려준
 * 원본의 **안쪽은 원본 그대로**이므로, 조각마다 한 번씩 벗기면 거기서 끝난다.
 *
 * `ml/worker/client.ts`에 두지 않는다 - 그 층은 Vue를 몰라야 워커와 서버 학습 양쪽에
 * 그대로 쓰인다. 프레임워크를 아는 이음매가 여기다.
 */
function plain(request: TrainRequest): TrainRequest {
  const input = toRaw(request.input)
  return {
    type: 'train',
    input: {
      ...input,
      dataset: toRaw(input.dataset),
      // 테스트 데이터도 벗긴다. 프록시인 채로 postMessage에 태우면 구조화 복제가 거부한다.
      testDataset: input.testDataset === null ? null : toRaw(input.testDataset),
      settings: toRaw(input.settings),
      context: toRaw(input.context),
    },
    ...(request.history ? { history: toRaw(request.history) } : {}),
  }
}

export function useTraining(createWorker: () => TrainWorker) {
  const progress = ref<TrainingProgress | null>(null)
  const running = computed(() => progress.value !== null)

  /**
   * 담은 모델마다의 상태 (architecture.md §8.17). **자리는 `selectedAlgorithms`와 같다.**
   *
   * **학습이 끝나면 비운다.** 결과는 결과 화면이 말하는 것이고, 학습 화면에 남겨 두면
   * 같은 사실을 두 화면이 각자 들고 있게 된다. 이 목록이 말하는 것은 지금 도는 학습이다.
   */
  const statuses = shallowRef<readonly ModelStatus[]>([])

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

    const total = request.input.settings.selectedAlgorithms.length
    progress.value = { completed: 0, total }
    statuses.value = waitingStatuses(total)

    // **train은 반드시 try 안에 있어야 한다.** postMessage는 동기로 던질 수 있고
    // (아래 plain 참조), 밖에 두면 그때 finally가 안 돌아 progress가 남는다.
    // 그러면 화면이 "학습 중"에 영구히 갇히고 [학습하기] 버튼은 그 가지에 없다.
    try {
      const started = train(plain(request), {
        createWorker,
        onStarted: ({ index }) => {
          statuses.value = withStarted(statuses.value, index)
        },
        onProgress: (run, completed, count, index) => {
          progress.value = { completed, total: count }
          statuses.value = withFinished(statuses.value, index, run)
        },
      })
      handle = started
      return await started.result
    } catch (error) {
      if (isClientError(error) && error.code === 'JOB_CANCELLED') return null
      throw error
    } finally {
      handle = null
      progress.value = null
      statuses.value = []
    }
  }

  /** 학습을 멈춘다. 안 돌고 있으면 아무 일도 일어나지 않는다. */
  function cancel(): void {
    handle?.cancel()
  }

  return { progress: readonly(progress), statuses: readonly(statuses), running, run, cancel }
}
