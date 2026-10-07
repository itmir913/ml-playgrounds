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

/**
 * 그리기가 내보내는 형식 (`data/image/sketch.ts`). **정본이 아니다** — 그린 그림도 파일로 고른
 * 사진처럼 굽는 워커가 정본으로 굽는다(open-decisions.md 67 "그리기는 굽지 않는다").
 *
 * **위 등록부에 넣지 않는다.** `CANONICAL_FORMAT_IDS`에 들면 `canonicalFormatOfPath`가 `.png`를
 * 우리가 구운 정본으로 읽는다. 검사: `sketch.spec.ts` "그리기 형식은 정본 형식이 아니다".
 *
 * PNG는 손실이 없어 굽기 전에 획 가장자리를 한 번 더 누르지 않는다. 여기 사는 이유는 MIME
 * 리터럴을 이 파일 밖에 쓰면 `limits-rules.spec.ts`가 울기 때문이다.
 */
export const SKETCH_EXPORT_FORMAT: Readonly<Pick<CanonicalFormat, 'extension' | 'mime'>> = {
  extension: '.png',
  mime: 'image/png',
}

/**
 * **사진으로 받는 원본 파일의 확장자** (open-decisions.md 108). 굽는 워커(`bake.ts`의 `createImageBitmap`)가
 * 읽을 수 있는 래스터 형식이다 — HEIC·TIFF는 사파리만 읽지만 넣는다. 못 읽으면 워커가 한 장씩 돌려주고
 * 화면이 "읽을 수 없는 파일"로 센다. 목록 밖(라벨 `txt`·`csv`, `svg`)은 장수·자리를 세기 전에 건너뛴다 —
 * 데이터셋 폴더의 라벨 파일이 사진 장수 상한을 채워 맞는 업로드가 거절되었다(R43-5 B-2).
 * `image-upload-zip.spec.ts`의 *"사진이 아닌 파일은 세기 전에 건너뛴다"*가 문다.
 */
export const IMAGE_SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.jpg',
  '.jpeg',
  '.jpe',
  '.jfif',
  '.png',
  '.apng',
  '.gif',
  '.webp',
  '.bmp',
  '.dib',
  '.avif',
  '.ico',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
])

/** 이 경로의 파일을 사진으로 받는가 — 확장자만 본다(대소문자 무시). */
export function isImageSourcePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_SOURCE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}
