/**
 * 메인 스레드와 정본 변환 워커가 주고받는 것. **양쪽의 유일한 계약이다.**
 *
 * 학습·임베딩 워커와 같은 모양을 지킨다 — 진행이 흐르고 결과나 실패로 끝난다.
 */

import type { ClientErrorParams } from '@/errors'
import type { CanonicalFormatId } from './formats'

/**
 * 메인 → 워커. 학생이 올린 파일들을 정본으로 구워 달라는 것.
 *
 * `File`은 구조화 복제로 그대로 넘어간다 — 바이트를 메인에서 미리 읽지 않는다.
 * **읽는 것부터가 워커의 일이다.** 휴대폰 사진 100장이면 80MB이고, 그걸 메인에서
 * 읽는 동안 화면이 멈춘다.
 */
export interface CanonicalizeRequest {
  type: 'canonicalize'
  files: readonly File[]
  /** 정본 한 변. 백본 등록부가 준다 (`ml/backbones.ts`). */
  size: number
}

/** 정본 한 장. **이름은 아직 안 붙는다** — 어느 범주에 넣을지는 부르는 쪽이 정한다. */
export interface CanonicalImage {
  /** 학생이 올린 파일 이름. 화면이 "무엇이 들어왔는지" 말할 때만 쓴다. */
  readonly sourceName: string
  /** 정본 바이트의 SHA-256. 이것이 곧 파일 이름이 된다 (mlpx-spec.md §1.2). */
  readonly hash: string
  readonly bytes: Uint8Array<ArrayBuffer>
}

/**
 * 굽지 못한 파일. **한 장이 실패해도 나머지는 굽는다.**
 *
 * 학생이 사진 폴더를 통째로 끌어다 놓으면 그 안에 `.txt`나 깨진 파일이 섞여 있다.
 * 거기서 전부를 거부하면 학생이 할 수 있는 일은 파일을 하나씩 찾아 지우는 것뿐이다.
 * **조용히 버리지도 않는다** — 화면이 몇 장이 빠졌는지 말한다.
 */
export interface SkippedImage {
  readonly sourceName: string
}

export type CanonicalizeMessage =
  | { type: 'progress'; completed: number; total: number }
  | {
      type: 'done'
      /**
       * 무엇으로 구웠는가. **워커가 정하고 결과와 함께 돌려준다** — 브라우저가 WebP를
       * 인코딩하지 못하면 jpg로 내려가고(open-decisions.md "정본은 WebP로 굽는다"),
       * 그 사실이 `settings.data`에 적혀야 한다.
       */
      format: CanonicalFormatId
      images: readonly CanonicalImage[]
      skipped: readonly SkippedImage[]
    }
  | { type: 'failed'; code: string; params: ClientErrorParams }
