/**
 * 워커가 요청 하나를 처리하는 방법. **워커 파일에서 이것을 분리해 둔 이유가 있다.**
 *
 * jsdom에는 Worker가 없고, 진짜 워커를 띄우면 테스트가 우리 로직이 아니라 번들러와
 * 실행 환경을 검사하게 된다. 그래서 워커 파일은 이 함수를 부르는 세 줄만 남기고
 * (ml/worker/train.worker.ts) 판단은 전부 여기 둔다 - 여기는 순수 함수라 테스트로 덮인다.
 */

import { failureDetail, isClientError } from '../../errors'
import { runCalibration } from '../calibration'
import { runExperiment } from '../experiment'
import { forestPoolFactory } from './forest-pool'
import { knnPoolFactory } from './knn-pool'
import { neuralPoolFactory } from './neural-pool'
import type { TrainRequest, WorkerMessage, WorkerRequest } from './protocol'

/**
 * 실험을 돌리고 메시지를 내보낸다. **던지지 않는다.**
 *
 * 워커 안에서 예외가 새면 메인 스레드는 `error` 이벤트 하나만 받고 무엇이 왜 실패했는지
 * 알 수 없다. 사유를 코드로 바꿔 보내야 화면이 로케일 문장을 고를 수 있다 (CLAUDE.md 1.4).
 */
export async function handleTrain(
  request: TrainRequest,
  emit: (message: WorkerMessage) => void,
): Promise<void> {
  try {
    const { experiment, preprocessor, models } = await runExperiment(request.input, {
      ...(request.history ? { history: request.history } : {}),
      // 오래 걸리는 학습을 코어로 가를 수 있게 손들을 준다. **여기가 유일한 실물
      // 주입 자리다** — 검사와 재실행 대조는 안 줘서 직렬로 돌고, 결과는 같다
      // (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
      pools: { neural: neuralPoolFactory, forest: forestPoolFactory, knn: knnPoolFactory },
      onRunStart: ({ index, algorithm, runtime }, total) =>
        emit({ type: 'started', index, algorithm, runtime, total }),
      // 모델을 함께 싣는다. 이것이 없으면 취소가 지표만 건지고 모델은 워커와 함께
      // 사라진다 (open-decisions.md "멈추기가 끝난 것을 남긴다" §2).
      onRun: (run, completed, total, index, model) =>
        emit({ type: 'progress', run, index, completed, total, ...(model ? { model } : {}) }),
      onPrelude: (prelude) => emit({ type: 'prelude', prelude }),
    })
    emit({ type: 'done', experiment, preprocessor, models })
  } catch (error) {
    emit(
      isClientError(error)
        ? { type: 'failed', code: error.code, params: error.params }
        : { type: 'failed', code: 'JOB_FAILED', params: failureDetail(error) },
    )
  }
}

/**
 * 요청 하나를 처리한다. **워커 파일이 아는 것은 이 함수 하나다.**
 *
 * 교정도 여기로 온다 — 학습과 같은 워커에서 돌아야 **학습이 실제로 도는 환경**을
 * 재는 것이 된다 (open-decisions.md "언제 재는가").
 */
export async function handleRequest(
  request: WorkerRequest,
  emit: (message: WorkerMessage) => void,
): Promise<void> {
  if (request.type === 'calibrate') {
    try {
      emit({ type: 'calibrated', elapsedMs: await runCalibration() })
    } catch (error) {
      // **예상 시간 하나 때문에 학습 화면이 죽으면 안 된다.** 못 재면 못 재는 것이다.
      emit({ type: 'failed', code: 'JOB_FAILED', params: failureDetail(error) })
    }
    return
  }
  await handleTrain(request, emit)
}
