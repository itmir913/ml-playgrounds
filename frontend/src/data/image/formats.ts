/**
 * 정본을 무엇으로 굽는가. **`canonical.ts`에서 떼어 놓았다** — `project/schema.ts`가 이
 * 어휘를 쓰는데, `canonical.ts`는 `project/format.ts`를 부르고 그쪽이 다시 스키마를
 * 부른다. 그 고리 안에 두면 **enum 어휘가 평가 시점에 `undefined`가 된다**(실제로 그렇게
 * 깨졌다). 여기는 `limits.ts` 말고 아무것도 안 부른다.
 */

import {
  IMAGE_JPEG_ESTIMATED_BYTES,
  IMAGE_JPEG_QUALITY,
  IMAGE_WEBP_ESTIMATED_BYTES,
  IMAGE_WEBP_QUALITY,
} from '@/limits'

/**
 * 정본을 구울 수 있는 형식. **순서가 곧 우선순위다** — 앞의 것부터 시도한다
 * (open-decisions.md "정본은 WebP로 굽는다").
 *
 * **jpeg는 폴백이지 선택지가 아니다.** 학생에게 고르게 하지 않는다 — 형식은 그 브라우저가
 * 무엇을 할 수 있느냐의 문제이지 학생이 판단할 것이 아니다.
 */
export const CANONICAL_FORMAT_IDS = ['webp', 'jpeg'] as const

export type CanonicalFormatId = (typeof CANONICAL_FORMAT_IDS)[number]

/**
 * 형식 하나. **확장자·MIME·품질이 한 줄에 있다** — 셋이 흩어지면 `.webp` 이름을 단 jpeg가
 * 담기는 것을 아무도 못 막는다.
 */
export interface CanonicalFormat {
  readonly id: CanonicalFormatId
  /** zip 안에서 갖는 확장자 (mlpx-spec.md §1.2). */
  readonly extension: string
  /** `convertToBlob`에 넘기고, 화면·임베딩이 Blob을 만들 때 쓴다. */
  readonly mime: string
  /** 구울 때 쓰는 품질. 값의 출처는 limits.ts다. */
  readonly quality: number
  /**
   * 이 형식으로 구운 정본 한 장의 예상 바이트. **굽기 전에 자리를 묻는 데 쓴다**
   * (open-decisions.md "이미지가 들어갈 자리는 굽기 전에 묻는다").
   *
   * **여기 있는 이유는 형식마다 다르기 때문이다** — `quality`와 같은 자리다. 셋째
   * 형식이 생기면 그 줄이 자기 값을 들고 온다. 값의 출처는 limits.ts다.
   */
  readonly estimatedBytes: number
}

/**
 * 형식 등록부. **`if (format === 'webp')`를 만들지 마라** — 셋째 형식이 생기면 여기 한 줄만
 * 는다 (CLAUDE.md §2, architecture.md §9).
 */
export const CANONICAL_FORMATS: Readonly<Record<CanonicalFormatId, CanonicalFormat>> = {
  webp: {
    id: 'webp',
    extension: '.webp',
    mime: 'image/webp',
    quality: IMAGE_WEBP_QUALITY,
    estimatedBytes: IMAGE_WEBP_ESTIMATED_BYTES,
  },
  jpeg: {
    id: 'jpeg',
    extension: '.jpg',
    mime: 'image/jpeg',
    quality: IMAGE_JPEG_QUALITY,
    estimatedBytes: IMAGE_JPEG_ESTIMATED_BYTES,
  },
}

/** 될 때 쓰는 형식. 이것으로 못 구우면 뒤의 것으로 내려간다. */
export const PREFERRED_CANONICAL_FORMAT = CANONICAL_FORMATS.webp

/**
 * 이 경로의 정본은 무슨 형식인가. 우리가 쓴 확장자가 아니면 `null`이다.
 *
 * **형식의 진실은 여기다** (mlpx-spec.md §1.2). `settings.data`의 `format`은 그 자리를
 * 마지막으로 구운 조건이라, 학교에서 webp로 올리고 집 아이폰에서 jpg로 올린 프로젝트에서
 * 그 값을 믿으면 절반이 틀린다.
 */
export function canonicalFormatOfPath(path: string): CanonicalFormat | null {
  for (const id of CANONICAL_FORMAT_IDS) {
    const format = CANONICAL_FORMATS[id]
    if (path.endsWith(format.extension)) return format
  }
  return null
}
