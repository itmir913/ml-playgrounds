/**
 * 메인 스레드 쪽. 정본 변환 워커를 띄우고 진행을 흘리고 결과를 Promise로 준다.
 *
 * **업로드 처리는 언제나 백그라운드다.** 휴대폰 사진 100장이면 원본이 80MB이고 굽는 데
 * 8.3초다 (2026-08-12 실측). 그동안 메인이 막히면 학생은 고장으로 보고 새로고침을 누른다.
 *
 * 워커를 **주입받는다** — 진짜 Worker를 여기서 만들면 테스트가 번들러를 검사하게 된다.
 */

import { ClientError, failureDetail, toClientErrorCode } from '@/errors'
import type { CanonicalFormatId } from './formats'
import type {
  CanonicalImage,
  CanonicalizeMessage,
  CanonicalizeRequest,
  SkippedImage,
} from './protocol'

export interface CanonicalizeWorker {
  onmessage: ((event: MessageEvent<CanonicalizeMessage>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null
  postMessage(message: CanonicalizeRequest): void
  terminate(): void
}

export interface CanonicalizeOptions {
  createWorker: () => CanonicalizeWorker
  /** 정본 한 변. 백본 등록부가 준다. */
  size: number
  /** 파일 하나가 끝날 때마다. 백분율은 받는 쪽이 만든다. */
  onProgress?: (completed: number, total: number) => void
}

export interface CanonicalizeResult {
  /**
   * 무엇으로 구웠는가. **부르는 쪽이 이 값을 `addImages`에 넘긴다** — 파일에 적히는
   * `format`이 여기서 온다 (open-decisions.md "정본은 WebP로 굽는다").
   */
  readonly format: CanonicalFormatId
  readonly images: readonly CanonicalImage[]
  readonly skipped: readonly SkippedImage[]
}

export interface CanonicalizeHandle {
  result: Promise<CanonicalizeResult>
  cancel: () => void
}

/**
 * 올린 파일들을 정본으로 굽는다.
 *
 * 어떤 경로로 끝나든 워커는 반드시 종료된다 — 성공·실패·취소·워커 자체의 오류.
 * **워커가 죽는 것도 정상 경로다** (open-decisions.md "백본을 붙이는 방법") — 사진을
 * 아주 많이 넣으면 메모리로 죽고, 그건 예외로 오지 않는다.
 */
export function canonicalizeImages(
  files: readonly File[],
  options: CanonicalizeOptions,
): CanonicalizeHandle {
  const worker = options.createWorker()

  let resolve!: (value: CanonicalizeResult) => void
  let reject!: (reason: ClientError) => void
  const result = new Promise<CanonicalizeResult>((onResolve, onReject) => {
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
    if (message.type === 'progress') {
      if (!finished) options.onProgress?.(message.completed, message.total)
      return
    }
    if (message.type === 'done') {
      settle(() =>
        resolve({ format: message.format, images: message.images, skipped: message.skipped }),
      )
      return
    }
    settle(() => reject(new ClientError(toClientErrorCode(message.code), message.params)))
  }

  worker.onerror = (event) => {
    const where = event.filename ? `${event.filename}:${event.lineno}` : ''
    settle(() =>
      reject(
        new ClientError('UNEXPECTED_ERROR', failureDetail(`${event.message} ${where}`.trim())),
      ),
    )
  }

  worker.onmessageerror = () =>
    settle(() => reject(new ClientError('UNEXPECTED_ERROR', failureDetail('messageerror'))))

  worker.postMessage({ type: 'canonicalize', files, size: options.size })

  return {
    result,
    cancel: () => settle(() => reject(new ClientError('JOB_CANCELLED'))),
  }
}
