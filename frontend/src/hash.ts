/**
 * SHA-256. 프런트엔드에서 해시가 필요한 곳은 전부 여기를 지난다.
 *
 * **큰 바이트는 `digestBytes`로, 보안 컨텍스트면 `crypto.subtle`이 한다**
 * (open-decisions.md 112, 2026-10-14). Edge의 보안 강화는 자주 안 가는 사이트에서 JIT를
 * 끄고, 그러면 순수 JS SHA-256이 수십 배 느려진다 — 사진 6,008장 파일의 해시가 0.6초에서
 * 35초가 됐다. subtle은 네이티브라 JIT와 상관없다.
 *
 * **subtle이 없거나 던지면 `@noble/hashes`로 간다.** 자가호스팅 학교는 대개
 * `http://192.168.x.x`라 subtle이 없다. 어느 길이든 같은 SHA-256 값이라 "어떤 학교에서는
 * 해시가 없다"는 상태는 안 생기고 빠르기만 다르다. **subtle은 이 파일에만 산다** —
 * `secure-context-rules.spec.ts`가 그 밖을 막는다. 무는 검사: `hash.spec.ts`.
 *
 * 동기 `hashBytes`·`hashText`는 noble 그대로다. 시드와 행 키는 짧고 동기여야 한다.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/** 파일에 기록되는 알고리즘 이름. 이 문자열을 코드에 흩뿌리지 마라. */
export const HASH_ALGORITHM = 'sha256'

/** 바이트의 SHA-256을 소문자 16진수로 돌려준다. */
export function hashBytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes))
}

/** 문자열을 UTF-8로 인코딩해 해싱한다. */
export function hashText(text: string): string {
  return hashBytes(new TextEncoder().encode(text))
}

/**
 * `hashBytes`와 같은 값을 비동기로 낸다. **큰 바이트는 이것을 쓴다.**
 *
 * subtle은 `SharedArrayBuffer` 뒤의 뷰를 거절하는 등 던질 수 있다 — 그때도 noble이 받는다.
 */
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      return bytesToHex(new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource)))
    } catch {
      // 아래 noble로 간다.
    }
  }
  return hashBytes(bytes)
}
