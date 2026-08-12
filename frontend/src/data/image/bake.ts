/**
 * 실제로 굽는 자리. **워커 안에서만 산다** — `createImageBitmap`과 `OffscreenCanvas`가
 * 필요하고, 둘 다 메인 스레드에서 쓰면 사진 100장에 화면이 멈춘다.
 *
 * 개발 PC의 워커에서 셋 다 동작하는 것을 확인했다 (2026-08-12 실측). **아이패드와 학교
 * PC는 안 쟀고, 폴백도 안 만든다** — 도달하지 않는 경로를 미리 만들지 않는다
 * (open-decisions.md #25).
 */

import { fitBox } from './canonical'

/**
 * 파일 하나를 정본 jpg 바이트로 굽는다. **못 읽는 파일이면 `null`이다.**
 *
 * 학생이 사진 폴더를 통째로 끌어다 놓으면 `.txt`나 깨진 파일이 섞여 온다. 거기서
 * 던지면 나머지 사진까지 통째로 못 받는다 — 부르는 쪽이 몇 장이 빠졌는지 말한다.
 *
 * **여백은 흰색이다.** 투명을 두면 jpg에서 검게 나온다.
 */
export async function bakeCanonical(
  file: File,
  size: number,
  quality: number,
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

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    bitmap.close()
  }
}
