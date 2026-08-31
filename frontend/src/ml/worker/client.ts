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

import { ClientError, failureDetail, toClientErrorCode } from '../../errors'
import type { Run } from '../../project/schema'
import { assembleExperiment, type ExperimentPrelude, type ExperimentResult } from '../experiment'
import type { ModelFile } from '../models'
import type { WorkerMessage, WorkerRequest } from './protocol'

/**
 * 우리가 워커에게 요구하는 것 전부. **`Worker`보다 좁다** - 테스트가 흉내낼 수 있어야
 * 하고, 넓게 잡으면 흉내내기 위한 코드가 진짜 워커보다 커진다.
 */
export interface TrainWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  /**
   * 워커가 보낸 것을 이쪽이 **복원하지 못했을 때** 온다.
   *
   * 없으면 아무 일도 안 일어난 것처럼 보인다 - 결과도 실패도 안 오고 Promise가 영영
   * 안 풀려서 [학습하기] 버튼이 꺼진 채로 남는다.
   */
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: WorkerRequest): void
  terminate(): void
}

/** 워커가 "이걸 시작했다"고 말한 것. `selectedAlgorithms`의 `index` 자리다. */
export interface StartedModel {
  readonly index: number
  readonly algorithm: string
  /** **실제로 도는** 실행 방법. 자동으로 넘어갔으면 학생이 고른 것과 다르다. */
  readonly runtime: string
}

export interface TrainOptions {
  /** 워커를 만든다. 앱은 spawnTrainingWorker를, 테스트는 가짜를 넣는다. */
  createWorker: () => TrainWorker
  /** 모델 하나를 시작할 때마다 (mlpx-spec.md 0.3). 화면이 "지금 무엇이 도는가"를 안다. */
  onStarted?: (started: StartedModel, total: number) => void
  /**
   * 모델 하나가 끝날 때마다. 실험 전체 진행률은 여기서 센다 (mlpx-spec.md 0.3).
   *
   * `index`는 `onStarted`와 같은 자리다 - 화면이 "끝난 개수 - 1"로 되짚지 않는다.
   */
  onProgress?: (run: Run, completed: number, total: number, index: number) => void
}

export interface TrainHandle {
  /** 성공하면 실험, 실패·취소면 ClientError로 거절된다. */
  result: Promise<ExperimentResult>
  /** 학습을 멈춘다. 이미 끝났으면 아무 일도 일어나지 않는다. */
  cancel: () => void
}

/**
 * 워커에서 실험을 돌린다.
 *
 * 어떤 경로로 끝나든 워커는 반드시 종료된다 - 성공·실패·취소·워커 자체의 오류.
 * 남겨 두면 학생이 설정을 바꿔가며 열 번 돌리는 사이에 워커가 열 개 쌓인다.
 */
export function train(
  request: WorkerRequest & { type: 'train' },
  options: TrainOptions,
): TrainHandle {
  const worker = options.createWorker()

  // Promise 생성자는 동기로 실행되므로 아래 두 개는 반드시 채워진다.
  // Promise.withResolvers는 ES2024라 여기서는 못 쓴다.
  let resolve!: (value: ExperimentResult) => void
  let reject!: (reason: ClientError) => void
  const result = new Promise<ExperimentResult>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })

  let finished = false
  const settle = (act: () => void): void => {
    if (finished) return
    finished = true
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    act()
  }

  /**
   * 취소가 조립할 재료. **모으는 이유는 끝을 못 보는 경로 하나뿐이다**
   * (open-decisions.md "멈추기가 끝난 것을 남긴다" §3). 성공하면 `done`이 완성품을
   * 싣고 오므로 아래 셋은 쓰이지 않는다.
   */
  let prelude: ExperimentPrelude | null = null
  const runs: Run[] = []
  const models = new Map<string, ModelFile>()

  worker.onmessage = (event) => {
    const message = event.data
    if (message.type === 'prelude') {
      if (!finished) prelude = message.prelude
      return
    }
    if (message.type === 'started') {
      // 취소한 뒤에 도착한 보고는 버린다 - progress와 같은 이유다.
      if (!finished) {
        const { index, algorithm, runtime } = message
        options.onStarted?.({ index, algorithm, runtime }, message.total)
      }
      return
    }
    if (message.type === 'progress') {
      // 취소한 뒤에 도착한 보고는 버린다. terminate가 즉시 조용해지지는 않는다.
      if (!finished) {
        runs.push(message.run)
        if (message.model) models.set(message.run.id, message.model)
        options.onProgress?.(message.run, message.completed, message.total, message.index)
      }
      return
    }
    if (message.type === 'done') {
      settle(() =>
        resolve({
          experiment: message.experiment,
          preprocessor: message.preprocessor,
          models: message.models,
        }),
      )
      return
    }
    // **`calibrated`는 학습 경로로 안 온다.** 그래도 남겨 두는 것이 조용히 무시하는 것보다
    // 낫다 - 오면 프로토콜이 어긋난 것이고, 그때 Promise가 안 풀리면 [학습하기]가 꺼진
    // 채로 남는다.
    if (message.type === 'calibrated') {
      settle(() => reject(new ClientError('JOB_FAILED', {})))
      return
    }
    settle(() => reject(new ClientError(toClientErrorCode(message.code), message.params)))
  }

  /**
   * 워커 자체가 죽은 것이다 - 로드 실패, 메모리, 핸들러 밖에서 터진 예외.
   *
   * 코드는 JOB_FAILED다. 사유를 우리 어휘로 옮길 수 없어서다. **그러나 원문까지
   * 버리면 화면에 "학습에 실패했습니다." 한 줄만 남고 교사도 손쓸 것이 없어진다**
   * (open-decisions.md "학습 실패는 교사가 읽을 수 있게 전달한다"). 실제로 그 상태였다 -
   * 이 경로만 params가 통째로 비어 있었고, 그래서 알림에 붙는 기술 정보도 없었다.
   *
   * 어디서 터졌는지까지 싣는다. 메시지만으로는 워커를 못 띄운 것인지 학습 중에 터진
   * 것인지 갈리지 않는데, 둘은 대처가 완전히 다르다.
   */
  worker.onerror = (event) => {
    const where = event.filename ? `${event.filename}:${event.lineno}` : ''
    settle(() =>
      reject(new ClientError('JOB_FAILED', failureDetail(`${event.message} ${where}`.trim()))),
    )
  }

  // 복원하지 못한 메시지. 여기서 안 끊으면 Promise가 영영 안 풀린다.
  worker.onmessageerror = () =>
    settle(() => reject(new ClientError('JOB_FAILED', failureDetail('messageerror'))))

  worker.postMessage(request)

  return {
    result,
    /**
     * 멈춘다. **끝난 모델이 하나라도 있으면 그것을 실험으로 돌려준다**
     * (open-decisions.md "멈추기가 끝난 것을 남긴다" §4).
     *
     * **0개면 지금까지처럼 JOB_CANCELLED다.** 남길 것이 없는데 빈 실험을 만들면 학생이
     * 잘못 누른 흔적만 목록에 쌓인다. 그 규칙이 "잘못 눌러서"와 "오래 걸려서 그만"을
     * 자동으로 가른다.
     *
     * `prelude`가 없으면 첫 모델도 시작하기 전이므로 runs도 비어 있다 — 둘을 함께
     * 보는 것은 타입을 위한 것이지 다른 경우를 위한 것이 아니다.
     */
    cancel: () =>
      settle(() => {
        if (prelude === null || runs.length === 0) {
          reject(new ClientError('JOB_CANCELLED'))
          return
        }
        resolve({
          experiment: assembleExperiment({
            prelude,
            // 직전 실험. 워커가 성공 경로에서 보는 것과 같은 자리다.
            previous: request.history?.experiments?.at(-1),
            runs,
          }),
          preprocessor: prelude.preprocessor,
          models,
        })
      }),
  }
}

/**
 * **이 기기가 개발 PC보다 몇 배 느린지 잰다** (open-decisions.md "학습 예상 시간은
 * 실측표에 기기 배수를 곱해 낸다").
 *
 * **학습과 같은 워커 모듈에서 돈다.** 학습이 실제로 도는 환경을 재는 것이 되고, 청크도
 * 이미 필요한 그것 하나뿐이다.
 *
 * **못 재면 `null`이다.** 예상 시간 하나 때문에 학습 화면이 죽으면 안 되고, 못 잰 것을
 * 배수 1로 미는 것은 "길게 틀린다"의 반대편이다 — 화면은 그 자리에 `알 수 없음`을 적는다.
 */
export function calibrateDevice(createWorker: () => TrainWorker): Promise<number | null> {
  return new Promise((resolve) => {
    let worker: TrainWorker
    try {
      worker = createWorker()
    } catch {
      resolve(null)
      return
    }

    let settled = false
    const settle = (value: number | null): void => {
      if (settled) return
      settled = true
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      resolve(value)
    }

    worker.onmessage = (event) => {
      const message = event.data
      settle(message.type === 'calibrated' ? message.elapsedMs : null)
    }
    // 워커가 죽거나 못 알아들은 것을 보내도 끝난다 - 안 그러면 Promise가 영영 안 풀린다.
    worker.onerror = () => settle(null)
    worker.onmessageerror = () => settle(null)
    worker.postMessage({ type: 'calibrate' })
  })
}
