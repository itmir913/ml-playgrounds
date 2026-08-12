/**
 * 정본 변환 워커가 요청 하나를 처리하는 방법. **던지지 않는다.**
 *
 * 굽는 일 자체(`createImageBitmap` · `OffscreenCanvas`)는 `bake`로 주입받는다 — 그래야
 * 순서·건너뛰기·실패 전달이 캔버스 없는 곳에서 검사된다 (`ml/embed/handler.ts`와 같은 짜임).
 *
 * **개발 PC 실측(2026-08-12): 내려받은 데이터셋 100장 0.48초, 휴대폰 사진 100장 8.3초.**
 * 원본 화소 수가 시간을 지배하므로 진행 보고가 장마다 필요하다.
 */

import { failureDetail, isClientError } from '@/errors'
import { hashBytes } from '@/hash'
import { bakeCanonical } from './bake'
import type {
  CanonicalImage,
  CanonicalizeMessage,
  CanonicalizeRequest,
  SkippedImage,
} from './protocol'

/** 파일 하나를 정본 바이트로 굽는다. 못 읽는 파일이면 `null`이다. */
export type Bake = (
  file: File,
  size: number,
  quality: number,
) => Promise<Uint8Array<ArrayBuffer> | null>

export async function handleCanonicalize(
  request: CanonicalizeRequest,
  emit: (message: CanonicalizeMessage) => void,
  bake: Bake = bakeCanonical,
): Promise<void> {
  const images: CanonicalImage[] = []
  const skipped: SkippedImage[] = []

  try {
    for (const [index, file] of request.files.entries()) {
      const bytes = await bake(file, request.size, request.quality)
      if (bytes === null) {
        skipped.push({ sourceName: file.name })
      } else {
        // **해시는 정본 바이트로 낸다. 원본이 아니다** (mlpx-spec.md §1.2).
        // "이름 = 내용"이 성립해야 같은 사진을 두 번 올려도 저절로 한 장이 된다.
        images.push({ sourceName: file.name, hash: hashBytes(bytes), bytes })
      }
      emit({ type: 'progress', completed: index + 1, total: request.files.length })
    }
    emit({ type: 'done', images, skipped })
  } catch (error) {
    emit(
      isClientError(error)
        ? { type: 'failed', code: error.code, params: error.params }
        : { type: 'failed', code: 'UNEXPECTED_ERROR', params: failureDetail(error) },
    )
  }
}
