/**
 * **일본어 엑셀·탐색기가 쓰는 CP932(Shift_JIS) 표본.** 판정 검사(`encoding.spec.ts`·`table.spec.ts`),
 * 화면 검사(`csv-encoding-screens.spec.ts`), zip 이름 검사(`zip-names.spec.ts`)가 같은 바이트를 쓴다.
 *
 * **브라우저의 euc-kr로도 안 풀려야 한다** (0.33.3 최종 감사 A-1). 검사가 도는 Node의 `euc-kr`은
 * KS X 1001만 알고, 브라우저(WHATWG)의 `euc-kr`은 windows-949(UHC)다. 옛 표본
 * `身長,名前,クラス`는 Node에서만 던지고 크롬에서는 `릆뮮,뼹멟,긏깋긚`으로 오류 없이 풀렸다 —
 * "한국어 화면은 CP932를 판정하지 못한다"는 검사가 제품에서 안 일어나는 일을 재며 초록이었다.
 * 그래서 표본에 **UHC가 뒷바이트로 안 쓰는 자리**의 글자를 넣는다: `点` = `93 5F`. 아래
 * `uhcRejectedPairs`가 그것을 문다(`encoding.spec.ts` "CP932 표본은 브라우저의 euc-kr로도 안 풀린다").
 * 사람 확인(크롬, 2026-10-06): 두 표본 모두 `new TextDecoder('euc-kr', { fatal: true })`가 던졌다.
 */

/** `'点数,身長,クラス\n10,150,A\n'.encode('cp932')` (Python). */
export const CP932_SAMPLE = new Uint8Array([
  0x93, 0x5f, 0x90, 0x94, 0x2c, 0x90, 0x67, 0x92, 0xb7, 0x2c, 0x83, 0x4e, 0x83, 0x89, 0x83, 0x58,
  0x0a, 0x31, 0x30, 0x2c, 0x31, 0x35, 0x30, 0x2c, 0x41, 0x0a,
])
export const CP932_TEXT = '点数,身長,クラス\n10,150,A\n'

/** `'赤い点/a.png'.encode('shift_jis')` (Python) — 일본어 윈도 탐색기가 zip에 적는 이름. */
export const SHIFT_JIS_NAME = [0x90, 0xd4, 0x82, 0xa2, 0x93, 0x5f, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore
export const SHIFT_JIS_NAME_TEXT = '赤い点/a.png'

/**
 * Shift_JIS의 2바이트 글자 중 **UHC가 뒷바이트로 안 쓰는 자리**(41–5A·61–7A·81–FE 밖)에 있는 것의
 * 위치. WHATWG `euc-kr`은 그 쌍에서 오류를 낸다. **반각 가나(A1–DF 한 바이트)가 없을 때만 맞는다** —
 * 있으면 두 디코더가 바이트를 다르게 짝지어 셈이 어긋난다. 위 표본에는 없다.
 */
export function uhcRejectedPairs(bytes: ArrayLike<number>): number[] {
  const found: number[] = []
  const uhcTrail = (byte: number): boolean =>
    (byte >= 0x41 && byte <= 0x5a) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    (byte >= 0x81 && byte <= 0xfe)
  for (let index = 0; index < bytes.length; index++) {
    const lead = bytes[index] ?? 0
    if (lead < 0x81) continue
    if (!uhcTrail(bytes[index + 1] ?? 0)) found.push(index)
    index++
  }
  return found
}
