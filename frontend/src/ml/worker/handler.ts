/**
 * 워커가 요청 하나를 처리하는 방법. **워커 파일에서 이것을 분리해 둔 이유가 있다.**
 *
 * jsdom에는 Worker가 없고, 진짜 워커를 띄우면 테스트가 우리 로직이 아니라 번들러와
 * 실행 환경을 검사하게 된다. 그래서 워커 파일은 이 함수를 부르는 세 줄만 남기고
 * (ml/worker/train.worker.ts) 판단은 전부 여기 둔다 - 여기는 순수 함수라 테스트로 덮인다.
 */

import { failureDetail, isClientError } from '../../errors'
import { runExperiment } from '../experiment'
import type { TrainRequest, WorkerMessage } from './protocol'

/**
 * 실험을 돌리고 메시지를 내보낸다. **던지지 않는다.**
 *
 * 워커 안에서 예외가 새면 메인 스레드는 `error` 이벤트 하나만 받고 무엇이 왜 실패했는지
 * 알 수 없다. 사유를 코드로 바꿔 보내야 화면이 로케일 문장을 고를 수 있다 (CLAUDE.md 1.4).
 */
export function handleTrain(request: TrainRequest, emit: (message: WorkerMessage) => void): void {
  try {
    const { experiment, preprocessor, models } = runExperiment(request.input, {
      ...(request.history ? { history: request.history } : {}),
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
