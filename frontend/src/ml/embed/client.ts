/**
 * 메인 스레드 쪽. 임베딩 워커를 띄우고 진행을 흘리고 결과를 Promise로 준다.
 *
 * **사진 처리는 언제나 백그라운드다.** 사진 100장을 메인에서 디코드하면 화면이 멈추고,
 * 학생은 고장으로 보고 새로고침을 누른다.
 *
 * **워커가 죽는 것은 정상 경로다** (open-decisions.md "백본을 붙이는 방법"). 메모리
 * 초과는 예외로 안 오고 워커가 통째로 죽는다 — 실측에서 배치 256은 통과하고 512에서
 * 죽었다. `try/catch`로는 못 잡으므로 띄운 쪽이 `onerror`로 받아 실패로 바꾼다.
 *
 * 워커를 **주입받는다.** 진짜 Worker를 여기서 만들면 테스트가 번들러를 검사하게 된다
 * (ml/worker/client.ts와 같은 이유).
 */

import { ClientError, failureDetail, toClientErrorCode } from '../../errors'
import type { EngineState } from '../backend'
import { backboneFor, type BackboneId } from '../backbones'
import type { EmbedMessage, EmbedRequest } from './protocol'

export interface EmbedWorker {
  onmessage: ((event: MessageEvent<EmbedMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: EmbedRequest): void
  terminate(): void
}

export interface EmbedOptions {
  createWorker: () => EmbedWorker
  /** 준비 단계가 넘어갈 때마다. 12.4MB를 받는 동안 화면이 할 말이 여기서 나온다. */
  onState?: (state: EngineState, fraction?: number) => void
  /** 사진 하나가 끝날 때마다. 백분율은 받는 쪽이 만든다. */
  onProgress?: (completed: number, total: number) => void
}

export interface EmbedResult {
  /** 사진 순서대로 이어 붙은 벡터. 사진 하나가 `dim`개씩 차지한다. */
  readonly vectors: Float32Array
  readonly dim: number
}

export interface EmbedHandle {
  result: Promise<EmbedResult>
  /** 멈춘다. 이미 끝났으면 아무 일도 일어나지 않는다. */
  cancel: () => void
}

/**
 * 워커에서 임베딩을 뽑는다.
 *
 * 어떤 경로로 끝나든 워커는 반드시 종료된다 — 성공·실패·취소·워커 자체의 오류.
 * 남겨 두면 학생이 설정을 바꿔가며 열 번 돌리는 사이에 워커가 열 개 쌓인다.
 */
export function embedImages(
  backboneId: BackboneId,
  images: readonly Uint8Array<ArrayBuffer>[],
  options: EmbedOptions,
): EmbedHandle {
  const worker = options.createWorker()

  let resolve!: (value: EmbedResult) => void
  let reject!: (reason: ClientError) => void
  const result = new Promise<EmbedResult>((onResolve, onReject) => {
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

  worker.onmessage = (event) => {
    const message = event.data
    if (message.type === 'preparing') {
      if (!finished) options.onState?.(message.state, message.fraction)
      return
    }
    if (message.type === 'progress') {
      if (!finished) options.onProgress?.(message.completed, message.total)
      return
    }
    if (message.type === 'done') {
      settle(() => resolve({ vectors: message.vectors, dim: message.dim }))
      return
    }
    settle(() => reject(new ClientError(toClientErrorCode(message.code), message.params)))
  }

  /**
   * 워커 자체가 죽은 것이다 — 로드 실패, 메모리, 핸들러 밖에서 터진 예외.
   *
   * 어디서 터졌는지까지 싣는다. 메시지만으로는 워커를 못 띄운 것인지 사진을 돌리다
   * 터진 것인지 갈리지 않는데, 둘은 대처가 완전히 다르다.
   */
  worker.onerror = (event) => {
    const where = event.filename ? `${event.filename}:${event.lineno}` : ''
    settle(() =>
      reject(
        new ClientError('BACKBONE_UNAVAILABLE', failureDetail(`${event.message} ${where}`.trim())),
      ),
    )
  }

  worker.onmessageerror = () =>
    settle(() => reject(new ClientError('BACKBONE_UNAVAILABLE', failureDetail('messageerror'))))

  const spec = backboneFor(backboneId)
  if (!spec) {
    // **우리 문장을 failureDetail에 싣지 않는다** (CLAUDE.md 1.4). 그 통로는 남의
    // 라이브러리가 던진 영어를 기술 정보로 붙이는 자리라 번역되지 않는다 - 우리가 쓴
    // 한국어를 거기 실으면 영어 로케일 학생에게 한국어가 그대로 뜬다. id는 파라미터다.
    settle(() => reject(new ClientError('BACKBONE_UNAVAILABLE', { backboneId })))
    return { result, cancel: () => {} }
  }

  worker.postMessage({
    type: 'embed',
    backboneId,
    modelUrl: spec.modelUrl,
    images,
  })

  return {
    result,
    cancel: () => settle(() => reject(new ClientError('JOB_CANCELLED'))),
  }
}
