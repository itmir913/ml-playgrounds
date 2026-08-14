/**
 * 실제로 굽는 자리. **워커 안에서만 산다** — `createImageBitmap`과 `OffscreenCanvas`가
 * 필요하고, 둘 다 메인 스레드에서 쓰면 사진 100장에 화면이 멈춘다.
 *
 * 개발 PC의 워커에서 셋 다 동작하는 것을 확인했다 (2026-08-12 실측). **아이패드와 학교
 * PC는 안 쟀다** — 도달하지 않는 경로를 미리 만들지 않는다 (open-decisions.md #25).
 *
 * **형식 폴백 하나는 예외다.** 사파리가 WebP를 인코딩하는지 확인하지 못했고, 못 하면
 * 아이폰에서 사진 올리기가 통째로 막힌다 — 도달할지 모르는 경로가 아니라 **도달하면
 * 학생이 아무것도 못 하는 경로**라 재서 내려간다 (open-decisions.md "정본은 WebP로 굽는다").
 */

import { fitBox } from './canonical'
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
  for (const id of CANONICAL_FORMAT_IDS) {
    const format = CANONICAL_FORMATS[id]
    try {
      const blob = await probe.convertToBlob({ type: format.mime, quality: format.quality })
      if (blob.type === format.mime) return format
    } catch {
      // 이 형식은 안 된다. 다음 것으로 내려간다.
    }
  }
  // 등록부의 마지막(jpeg)까지 못 굽는 브라우저는 캔버스 인코딩 자체가 없는 것이다.
  throw new Error('정본으로 구울 수 있는 형식이 하나도 없다')
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
    if (!context) throw new Error('OffscreenCanvas의 2d 컨텍스트를 못 얻었다')

    const box = fitBox(bitmap.width, bitmap.height, size)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.drawImage(bitmap, box.x, box.y, box.width, box.height)

    const blob = await canvas.convertToBlob({ type: format.mime, quality: format.quality })
    // **재 보고 골랐어도 여기서 다시 본다.** 형식 판정은 1×1이었고, 이건 실제 정본이다 —
    // 어긋난 채로 통과하면 확장자와 내용이 다른 파일이 학생 파일에 담긴다.
    if (blob.type !== format.mime) {
      throw new Error(`정본 형식이 어긋났다: ${format.mime}를 요청했는데 ${blob.type}이 왔다`)
    }
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
