/**
 * 메인 스레드 쪽. 워커를 띄우고 진행을 흘리고 결과를 Promise로 준다.
 *
 * **학습은 언제나 백그라운드다** (open-decisions.md). 저사양 학교 PC나 휴대폰에서 화면이
 * 몇 초 얼면 학생은 고장으로 보고 새로고침을 누르고, 그러면 진행 중이던 것이 통째로
 * 날아간다. 스피너로는 부족하다 - 메인 스레드가 막히면 진행률도 취소 버튼도 같이 죽는다.
 *
 * **취소는 terminate 하나다.** 동기 루프를 밖에서 멈출 다른 방법이 없고, 45분 수업에서
 * 잘못 누른 학습을 못 멈추는 것은 그 자체로 실패다. 그래서 abort 신호 같은 것을 두지
 * 않는다 - 있으면 멈출 수 있는 것처럼 보이지만 실제로는 안 멈춘다.
 *
 * 워커를 **주입받는다.** 진짜 Worker를 여기서 만들면 테스트가 번들러와 실행 환경을
 * 검사하게 된다. 앱이 쓰는 진짜 생성기는 ml/worker/spawn.ts에 있다.
 */

import { ClientError, toClientErrorCode } from '../../errors'
import type { Run } from '../../project/schema'
import type { BatchResult } from '../batch'
import type { TrainRequest, WorkerMessage } from './protocol'

/**
 * 우리가 워커에게 요구하는 것 전부. **`Worker`보다 좁다** - 테스트가 흉내낼 수 있어야
 * 하고, 넓게 잡으면 흉내내기 위한 코드가 진짜 워커보다 커진다.
 */
export interface TrainWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: TrainRequest): void
  terminate(): void
}

export interface TrainOptions {
  /** 워커를 만든다. 앱은 spawnTrainingWorker를, 테스트는 가짜를 넣는다. */
  createWorker: () => TrainWorker
  /** 모델 하나가 끝날 때마다. 묶음 전체 진행률은 여기서 센다 (mlpx-spec.md 0.3). */
  onProgress?: (run: Run, completed: number, total: number) => void
}

export interface TrainHandle {
  /** 성공하면 묶음, 실패·취소면 ClientError로 거절된다. */
  result: Promise<BatchResult>
  /** 학습을 멈춘다. 이미 끝났으면 아무 일도 일어나지 않는다. */
  cancel: () => void
}

/**
 * 워커에서 묶음을 돌린다.
 *
 * 어떤 경로로 끝나든 워커는 반드시 종료된다 - 성공·실패·취소·워커 자체의 오류.
 * 남겨 두면 학생이 설정을 바꿔가며 열 번 돌리는 사이에 워커가 열 개 쌓인다.
 */
export function train(request: TrainRequest, options: TrainOptions): TrainHandle {
  const worker = options.createWorker()

  // Promise 생성자는 동기로 실행되므로 아래 두 개는 반드시 채워진다.
  // Promise.withResolvers는 ES2024라 여기서는 못 쓴다.
  let resolve!: (value: BatchResult) => void
  let reject!: (reason: ClientError) => void
  const result = new Promise<BatchResult>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })

  let finished = false
  const settle = (act: () => void): void => {
    if (finished) return
    finished = true
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    act()
  }

  worker.onmessage = (event) => {
    const message = event.data
    if (message.type === 'progress') {
      // 취소한 뒤에 도착한 보고는 버린다. terminate가 즉시 조용해지지는 않는다.
      if (!finished) options.onProgress?.(message.run, message.completed, message.total)
      return
    }
    if (message.type === 'done') {
      settle(() => resolve({ batch: message.batch, preprocessor: message.preprocessor }))
      return
    }
    settle(() => reject(new ClientError(toClientErrorCode(message.code), message.params)))
  }

  // 워커 자체가 죽은 것이다(로드 실패, 메모리). 사유를 알 수 없으므로 JOB_FAILED다.
  worker.onerror = () => settle(() => reject(new ClientError('JOB_FAILED')))

  worker.postMessage(request)

  return {
    result,
    cancel: () => settle(() => reject(new ClientError('JOB_CANCELLED'))),
  }
}
