/**
 * 화소를 백본이 먹는 숫자로 옮긴다. **순수 함수라 여기만 테스트로 덮인다** — 나머지
 * 임베딩 경로는 TF.js와 워커 전역이 필요해서 안 덮인다.
 *
 * **틀려도 예외가 안 난다.** 범위를 잘못 옮기면 학습은 멀쩡히 돌고 성적만 조용히
 * 나빠진다. 그래서 백본마다 `inputRange`를 등록부에 적어 두고(ml/backbones.ts) 여기서
 * 그 값만 본다.
 */

/** RGBA 한 화소가 차지하는 칸 수. `getImageData`가 알파까지 준다. */
const RGBA = 4

/**
 * `getImageData`의 RGBA 바이트를 NHWC float으로 옮긴다.
 *
 * - 알파는 버린다. 정본은 흰 배경으로 이미 합성돼 있어 투명한 화소가 없다.
 * - `out`에 이어 쓴다. 사진마다 배열을 새로 만들면 200장에 200개가 생긴다.
 *
 * @param rgba `size × size × 4` 바이트
 * @param size 정본 한 변
 * @param range 백본이 기대하는 범위 (예: `[-1, 1]`)
 * @param out 받는 배열
 * @param offset `out`에서 쓰기 시작할 자리
 */
export function packPixels(
  rgba: Uint8ClampedArray,
  size: number,
  range: readonly [number, number],
  out: Float32Array,
  offset = 0,
): void {
  const pixels = size * size
  if (rgba.length < pixels * RGBA) {
    throw new Error(`not enough pixels: ${rgba.length} < ${pixels * RGBA}`)
  }
  if (out.length < offset + pixels * 3) {
    throw new Error(`output too small: ${out.length} < ${offset + pixels * 3}`)
  }

  const [low, high] = range
  const scale = (high - low) / 255
  let write = offset
  for (let read = 0; read < pixels * RGBA; read += RGBA) {
    out[write] = rgba[read]! * scale + low
    out[write + 1] = rgba[read + 1]! * scale + low
    out[write + 2] = rgba[read + 2]! * scale + low
    write += 3
  }
}
