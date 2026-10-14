/**
 * `digestBytes`는 길이 둘이고 값은 하나다 (open-decisions.md 112).
 *
 * **Node에는 `crypto.subtle`이 있다.** 그냥 두면 noble 폴백이 한 번도 안 돈다 — http로 띄운
 * 학교가 타는 길이 그것이다. 그래서 없는 경우와 던지는 경우를 `stubGlobal`로 만든다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { digestBytes, hashBytes } from '../src/hash'

/** 'abc'의 SHA-256 (FIPS 180-2 부록 B.1). */
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

function filled(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) & 255
  return bytes
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('digestBytes', () => {
  it('SHA-256이다', async () => {
    expect(await digestBytes(new TextEncoder().encode('abc'))).toBe(ABC)
  })

  it('subtle이 있으면 subtle이 한다', async () => {
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest')
    await digestBytes(filled(10))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  const cases: readonly (readonly [string, Uint8Array])[] = [
    ['빈 입력', new Uint8Array(0)],
    ['1MB를 넘는 입력', filled(1024 * 1024 + 3)],
    // 앞뒤를 잘라 낸 뷰 — 버퍼 전체를 해싱하면 값이 갈린다.
    ['비정렬 오프셋의 subarray', filled(4099).subarray(3, 4000)],
  ]

  for (const [name, bytes] of cases) {
    it(`noble과 같은 값이다: ${name}`, async () => {
      expect(await digestBytes(bytes)).toBe(hashBytes(bytes))
    })
  }

  it('crypto가 없으면 noble로 같은 값을 낸다', async () => {
    vi.stubGlobal('crypto', undefined)
    expect(globalThis.crypto).toBeUndefined()
    expect(await digestBytes(new TextEncoder().encode('abc'))).toBe(ABC)
  })

  it('subtle이 없으면(보안 컨텍스트 밖) noble로 같은 값을 낸다', async () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues })
    const bytes = filled(5000)
    expect(await digestBytes(bytes)).toBe(hashBytes(bytes))
  })

  it('subtle이 던지면 noble로 같은 값을 낸다', async () => {
    const digest = vi.fn(() => Promise.reject(new TypeError('refused')))
    vi.stubGlobal('crypto', { subtle: { digest } })
    const bytes = filled(5000)
    expect(await digestBytes(bytes)).toBe(hashBytes(bytes))
    expect(digest).toHaveBeenCalledTimes(1)
  })

  it('SharedArrayBuffer 뒤의 뷰도 해싱한다', async () => {
    const shared = new Uint8Array(new SharedArrayBuffer(300))
    shared.set(filled(300))
    expect(await digestBytes(shared)).toBe(hashBytes(shared))
  })
})
