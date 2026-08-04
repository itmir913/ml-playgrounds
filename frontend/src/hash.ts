/**
 * SHA-256. 프런트엔드에서 해시가 필요한 곳은 전부 여기를 지난다.
 *
 * **crypto.subtle을 쓰지 않는다.** 그쪽은 보안 컨텍스트(https, localhost)에서만 존재하는데
 * 자가호스팅 서버는 대개 http://192.168.x.x 로 접속한다. 분기와 폴백을 두면 "어떤 학교에서는
 * 해시가 없다"는 상태가 생기고, 그 상태를 화면과 테스트가 모두 알아야 한다.
 * 단일 경로로 가는 대신 라이브러리를 번들에 넣는다
 * (open-decisions.md "무결성은 해시와 재실행 대조로 한다").
 *
 * 동기 함수다. 실측 - 1MB 16ms, 10MB 55ms, 50MB 265ms. 데이터셋은 가져오기 시점에
 * 한 번만 해싱하므로(project/integrity.ts) 이 비용을 반복해서 내지 않는다.
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
