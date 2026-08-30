/**
 * 실제로 굽는 자리. **정본은 워커 안에서만 굽는다** — `createImageBitmap`과
 * `OffscreenCanvas`가 필요하고, 둘 다 메인 스레드에서 쓰면 사진 100장에 화면이 멈춘다.
 *
 * **포트폴리오 첨부(`bakeAttachment`)는 예외다.** 한 번에 몇 장이고 학생이 누른 직후이며,
 * 무엇보다 정본과 계약이 다르다 — 정사각형도 아니고 이름이 해시도 아니다. 그 한 장을
 * 위해 워커 프로토콜을 갈래지게 만들지 않는다 (mlpx-spec.md §8.6.1).
 *
 * 개발 PC의 워커에서 셋 다 동작하는 것을 확인했다 (2026-08-12 실측). **아이패드와 학교
 * PC는 안 쟀다** — 도달하지 않는 경로를 미리 만들지 않는다 (open-decisions.md #25).
 *
 * **형식 폴백 하나는 예외이고, 그 예외가 실제로 도는 것을 확인했다** (2026-08-14,
 * iPhone 11 Pro · iOS 18.7.1 — 그 시점의 최신 iOS다). 사파리는 WebP를 인코딩하지
 * 못해서 그 학생의 정본은 `.jpg`로 담긴다 — 재서
 * 내려가지 않았으면 아이폰에서 사진 올리기가 통째로 막혔다
 * (open-decisions.md "정본은 WebP로 굽는다").
 */

import { fitBox, fitLongEdge } from './canonical'
import { CANONICAL_FORMAT_IDS, CANONICAL_FORMATS, type CanonicalFormat } from './formats'

/**
 * 이 브라우저가 정본으로 쓸 형식. **등록부 순서대로 시도하고 처음 되는 것을 쓴다**
 * (open-decisions.md "정본은 WebP로 굽는다").
 *
 * **`convertToBlob`은 못 하는 타입을 받아도 던지지 않는다** — 조용히 png를 준다. 그래서
 * 요청한 타입이 실제로 돌아왔는지 `blob.type`으로 확인하는 것이 이 함수의 전부다.
 * 확인을 안 하면 `.webp` 이름을 단 png가 학생 파일에 담긴다.
 *
 * 1×1이면 인코더가 있느냐만 묻는 데 충분하고, 요청마다 한 번만 부른다.
 */
export async function detectCanonicalFormat(): Promise<CanonicalFormat> {
  const probe = new OffscreenCanvas(1, 1)
  // **컨텍스트를 먼저 잡는다.** 컨텍스트가 없는 `OffscreenCanvas`는 그릴 비트맵이 없어서
  // `convertToBlob`이 형식과 무관하게 `InvalidStateError`로 거절한다 — 그러면 이 함수가
  // "구울 수 있는 형식이 하나도 없다"고 말하고, 실제로 그렇게 나갔다 (2026-08-14).
  const context = probe.getContext('2d')
  if (!context) throw new Error('OffscreenCanvas 2d context unavailable')
  // 화소 하나를 실제로 칠한다. 인코더에 따라 빈 비트맵을 거절할 수 있다.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 1, 1)

  const failures: string[] = []
  for (const id of CANONICAL_FORMAT_IDS) {
    const format = CANONICAL_FORMATS[id]
    try {
      const blob = await probe.convertToBlob({ type: format.mime, quality: format.quality })
      if (blob.type === format.mime) return format
      failures.push(`${format.mime} -> ${blob.type || '(빈 타입)'}`)
    } catch (error) {
      // 이 형식은 안 된다. 다음 것으로 내려간다.
      failures.push(`${format.mime} -> ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // 등록부의 마지막(jpeg)까지 못 굽는 브라우저는 캔버스 인코딩 자체가 없는 것이다.
  // **무엇이 어떻게 거절했는지 함께 남긴다** — 이 문장만으로는 다음 사람이 브라우저를
  // 의심할지 우리 코드를 의심할지 고를 수 없다.
  throw new Error(`no canonical format could be encoded: ${failures.join(' · ')}`)
}

/**
 * 파일 하나를 정본 바이트로 굽는다. **못 읽는 파일이면 `null`이다.**
 *
 * 학생이 사진 폴더를 통째로 끌어다 놓으면 `.txt`나 깨진 파일이 섞여 온다. 거기서
 * 던지면 나머지 사진까지 통째로 못 받는다 — 부르는 쪽이 몇 장이 빠졌는지 말한다.
 *
 * **형식은 받는다. 여기서 고르지 않는다** — 고르는 것은 요청마다 한 번이고
 * (`detectCanonicalFormat`), 한 요청 안의 사진들은 같은 형식이어야 한다.
 *
 * **여백은 흰색이다.** 투명을 두면 jpg에서 검게 나온다.
 */
export async function bakeCanonical(
  file: File,
  size: number,
  format: CanonicalFormat,
): Promise<Uint8Array<ArrayBuffer> | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    const canvas = new OffscreenCanvas(size, size)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('OffscreenCanvas 2d context unavailable')

    const box = fitBox(bitmap.width, bitmap.height, size)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.drawImage(bitmap, box.x, box.y, box.width, box.height)

    const blob = await canvas.convertToBlob({ type: format.mime, quality: format.quality })
    // **재 보고 골랐어도 여기서 다시 본다.** 형식 판정은 1×1이었고, 이건 실제 정본이다 —
    // 어긋난 채로 통과하면 확장자와 내용이 다른 파일이 학생 파일에 담긴다.
    if (blob.type !== format.mime) {
      throw new Error(`canonical format mismatch: asked ${format.mime}, got ${blob.type}`)
    }
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/**
 * 첨부 한 장을 굽는다. **긴 변만 줄이고 비율을 지킨다. 여백을 안 붙인다**
 * (mlpx-spec.md §8.6.1). 못 읽는 파일이면 `null`이다.
 *
 * **형식과 품질은 정본과 같은 상수를 쓴다** — 갈리는 것은 크기 규칙뿐이다.
 */
export async function bakeAttachment(
  file: File,
  maxEdge: number,
  format: CanonicalFormat,
): Promise<Uint8Array<ArrayBuffer> | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    const box = fitLongEdge(bitmap.width, bitmap.height, maxEdge)
    const canvas = new OffscreenCanvas(box.width, box.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('OffscreenCanvas 2d context unavailable')

    // **흰 바탕을 먼저 깐다.** 투명한 png를 jpg로 구우면 그 자리가 검게 나온다.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, box.width, box.height)
    context.drawImage(bitmap, 0, 0, box.width, box.height)

    const blob = await canvas.convertToBlob({ type: format.mime, quality: format.quality })
    if (blob.type !== format.mime) {
      throw new Error(`attachment format mismatch: asked ${format.mime}, got ${blob.type}`)
    }
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
