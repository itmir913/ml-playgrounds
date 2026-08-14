/**
 * 포트폴리오에 붙일 사진을 굽는다 (mlpx-spec.md §8.6.1).
 *
 * **정본과 형식·품질은 같고 크기 규칙만 다르다** — 저쪽은 백본이 요구하는 정사각형이라
 * 레터박스로 여백을 채우는데, 여기는 사람이 보는 그림이라 긴 변만 줄이고 비율을 지킨다.
 *
 * **메인 스레드에서 돈다.** 학생이 누른 직후의 몇 장이고, 정본처럼 수백 장이 한꺼번에
 * 오지 않는다. 그 한 장을 위해 워커 프로토콜을 갈래지게 만들지 않는다 (`bake.ts`).
 *
 * **형식은 요청마다 한 번 고른다.** 브라우저가 WebP를 인코딩하지 못하면 jpg로 내려가고
 * (사파리가 그렇다), 그 사실이 파일 이름의 확장자로 남는다.
 */

import { bakeAttachment, detectCanonicalFormat } from '@/data/image/bake'
import { MAX_ATTACHMENT_EDGE } from '@/limits'

export interface BakedAttachment {
  readonly bytes: Uint8Array<ArrayBuffer>
  /** zip 엔트리가 가질 확장자. 무엇으로 구웠는지가 여기 남는다. */
  readonly extension: string
  /** 화면이 미리보기를 만들 때 쓴다. */
  readonly mime: string
}

/**
 * 파일들을 첨부용으로 굽는다. **못 읽는 파일은 조용히 빠진다** — 부르는 쪽이 몇 장이
 * 빠졌는지 말한다. 사진 폴더를 통째로 끌어다 놓으면 `.txt`가 섞여 오는 것과 같은 사정이다.
 */
export async function bakeAttachments(files: readonly File[]): Promise<BakedAttachment[]> {
  if (files.length === 0) return []

  const format = await detectCanonicalFormat()
  const baked: BakedAttachment[] = []
  for (const file of files) {
    const bytes = await bakeAttachment(file, MAX_ATTACHMENT_EDGE, format)
    if (bytes !== null) baked.push({ bytes, extension: format.extension, mime: format.mime })
  }
  return baked
}

/**
 * 붙여넣기에서 사진을 골라낸다.
 *
 * **캡처를 붙이는 것이 실제로 필요한 전부다** (`open-decisions.md` "포트폴리오 — 양식은
 * 마크다운, 답은 글이다"). 글을 붙여넣을 때는 아무 일도 일어나면 안 되므로 이미지
 * 항목만 본다.
 */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (data === null) return []
  return [...data.files].filter((file) => file.type.startsWith('image/'))
}
