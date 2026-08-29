/**
 * 메인 스레드와 임베딩 워커가 주고받는 것. **양쪽의 유일한 계약이다.**
 *
 * 학습 워커의 프로토콜과 같은 모양을 지킨다 (ml/worker/protocol.ts) — 진행 이벤트가
 * 흐르고 결과나 실패로 끝난다. 화면은 어느 워커가 도는지 몰라도 같은 방식으로 읽는다.
 *
 * 구조화 복제로 넘어갈 수 있는 값만 있어야 한다. 그래서 실패는 예외가 아니라
 * `{ code, params }`로 가고 받는 쪽이 다시 세운다.
 */

import type { ClientErrorParams } from '../../errors'
import type { EngineState } from '../backend'
import type { BackboneId } from '../backbones'

/**
 * 메인 → 워커. 사진 더미의 임베딩을 뽑아 달라는 것.
 *
 * **`modelUrl`을 메인이 풀어서 넘긴다.** 등록부가 갖는 것은 상대 경로이고
 * (`ml/backbones.ts`), 워커 안에서 그걸 풀면 워커 스크립트가 있는 `assets/` 기준이
 * 되어 엉뚱한 곳을 가리킨다. 배포 주소가 하위 경로일 수도 루트일 수도 있으므로
 * (`base`가 `'./'`다) 문서 기준으로 푸는 쪽은 메인이어야 한다.
 */
export interface EmbedRequest {
  type: 'embed'
  backboneId: BackboneId
  /** 문서 기준으로 푼 `model.json`의 절대 주소. */
  modelUrl: string
  /**
   * 정본 jpg 바이트. **디코드는 워커가 한다** — 메인에서 하면 화면이 멈춘다.
   *
   * `Uint8Array<ArrayBuffer>`로 좁혀 둔다. 그냥 `Uint8Array`는 `SharedArrayBuffer`
   * 위에 있을 수도 있는 타입이라 `Blob`에 못 넣는다 — 그리고 우리는 공유 메모리를
   * 안 쓴다(COOP/COEP 헤더가 없다).
   */
  images: readonly Uint8Array<ArrayBuffer>[]
}

/**
 * 워커 → 메인.
 *
 * **준비와 진행을 나눠 보낸다.** 백본은 12.4MB를 받고 백엔드를 띄우는 동안 아무 사진도
 * 안 지나가는데, 그 시간을 진행률 0%로 보여주면 학생은 멈춘 줄 안다.
 */
export type EmbedMessage =
  /** 준비 단계가 넘어갔다. `absent → downloading → downloaded → ready` (ml/backend.ts). */
  | {
      type: 'preparing'
      state: EngineState
      /**
       * 내려받은 비율(0~1). **`downloading`에서만 오고, 그때도 올 때만 온다** —
       * TF.js가 `onProgress`를 부르기 전에는 아직 아무것도 모른다.
       */
      fraction?: number
    }
  /** 사진 하나가 끝났다. 백분율은 받는 쪽이 만든다 — 학습 워커와 같은 규칙이다. */
  | { type: 'progress'; completed: number; total: number }
  /**
   * 다 끝났다. **벡터는 사진 순서대로 이어 붙은 하나의 배열이다** — 사진 하나가
   * `dim`개씩 차지한다. 배열의 배열로 주면 사진 200장에 객체가 200개 생긴다.
   */
  | { type: 'done'; vectors: Float32Array; dim: number }
  | { type: 'failed'; code: string; params: ClientErrorParams }
