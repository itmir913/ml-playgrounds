import { describe, expect, it } from 'vitest'

import { decodeText, detectEncoding } from '../src/data/encoding'
import { isClientError } from '../src/errors'

/** '이름,나이\n가나다,10'을 CP949로 인코딩한 바이트 (Python cp949 codec으로 생성). */
const CP949_SAMPLE = new Uint8Array([
  192, 204, 184, 167, 44, 179, 170, 192, 204, 10, 176, 161, 179, 170, 180, 217, 44, 49, 48,
])

function utf16le(text: string, withBom = true): Uint8Array {
  const bytes: number[] = withBom ? [0xff, 0xfe] : []
  for (const character of text) {
    const code = character.charCodeAt(0)
    bytes.push(code & 0xff, code >> 8)
  }
  return new Uint8Array(bytes)
}

/** 바이트 순서만 반대다. BOM도 반대로 선다. */
function utf16be(text: string, withBom = true): Uint8Array {
  const bytes: number[] = withBom ? [0xfe, 0xff] : []
  for (const character of text) {
    const code = character.charCodeAt(0)
    bytes.push(code >> 8, code & 0xff)
  }
  return new Uint8Array(bytes)
}

describe('detectEncoding', () => {
  it('BOM이 있으면 utf-8로 판정한다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')])
    expect(detectEncoding(bytes)).toBe('utf-8')
  })

  it('유효한 UTF-8이면 utf-8로 판정한다', () => {
    expect(detectEncoding(new TextEncoder().encode('이름,나이\n가나다,10'))).toBe('utf-8')
  })

  it('UTF-8로 해석되지 않으면 cp949로 판정한다', () => {
    expect(detectEncoding(CP949_SAMPLE)).toBe('cp949')
  })

  it('UTF-16 BOM을 알아본다', () => {
    expect(detectEncoding(utf16le('이름,나이'))).toBe('utf-16le')
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]))).toBe('utf-16be')
  })

  it('빈 파일은 utf-8로 본다', () => {
    expect(detectEncoding(new Uint8Array([]))).toBe('utf-8')
  })

  it('다룰 수 없는 BOM(UTF-32)은 조용히 넘기지 않고 실패한다', () => {
    // UTF-32LE의 BOM은 UTF-16LE의 BOM으로 시작한다. 짧은 것을 먼저 보면
    // 여기서 utf-16le로 잘못 판정되고 학생은 깨진 표를 보게 된다.
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00])
    try {
      detectEncoding(bytes)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.code).toBe('DATASET_ENCODING_UNSUPPORTED')
        expect(error.params.encoding).toBe('utf-32le')
      }
    }
  })

  /**
   * **NUL이 섞인 UTF-8은 전처럼 utf-8이다** — 회귀 방지 (2026-09-28 감사 E C2 되돌림).
   *
   * BOM 없는 UTF-16을 NUL의 자리로 알아보는 판정을 한 번 넣었다가 뺐다. 정상 UTF-8 한글 CSV에
   * NUL 하나가 홀수 자리에 끼면 `utf-16le`로 읽혀 **오류 없이 한자로 깨진 표**가 됐고, 끝의 NUL
   * 채움이나 ASCII 속 NUL 하나는 멀쩡히 읽히던 파일을 거부했다. BOM 없는 UTF-16을 어떻게
   * 알아볼지는 코드 소유자의 결정으로 올렸다. **그 판정이 다시 들어오더라도 아래 셋은 지금처럼
   * 읽혀야 한다.**
   */
  describe('NUL이 섞인 UTF-8', () => {
    const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text)
    const withNul = (bytes: Uint8Array, at: number): Uint8Array =>
      new Uint8Array([...bytes.slice(0, at), 0, ...bytes.slice(at)])

    it('한글 CSV의 홀수 자리에 NUL 하나 — utf-8로 읽고 한글이 그대로다', () => {
      const plain = utf8('이름,키\n김철수,170\n')
      const odd = withNul(plain, 11)
      expect(odd.indexOf(0) % 2, 'fixture must put the NUL at an odd index').toBe(1)
      expect(detectEncoding(odd)).toBe('utf-8')
      expect(decodeText(odd, 'utf-8')).toContain('김철수')
    })

    it('끝에 NUL 채움 — utf-8로 읽는다', () => {
      const padded = new Uint8Array([...utf8('이름,키\n김,170\n'), 0, 0, 0, 0])
      expect(detectEncoding(padded)).toBe('utf-8')
    })

    it('ASCII CSV에 NUL 하나 — utf-8로 읽는다', () => {
      expect(detectEncoding(withNul(utf8('a,b\n1,2\n'), 4))).toBe('utf-8')
    })
  })
})

describe('decodeText', () => {
  it('utf-8 바이트를 원문으로 되돌린다', () => {
    const original = '이름,나이\n가나다,10'
    expect(decodeText(new TextEncoder().encode(original), 'utf-8')).toBe(original)
  })

  it('utf-8 BOM을 제거한다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')])
    expect(decodeText(bytes, 'utf-8')).toBe('a,b')
  })

  it('cp949 바이트를 원문으로 되돌린다', () => {
    expect(decodeText(CP949_SAMPLE, 'cp949')).toBe('이름,나이\n가나다,10')
  })

  it('utf-16le 바이트를 원문으로 되돌린다', () => {
    expect(decodeText(utf16le('이름,나이'), 'utf-16le')).toBe('이름,나이')
  })

  /**
   * **`SOURCE_ENCODINGS`에 넣어 둔 것은 받겠다는 뜻이다.** `detectEncoding` 쪽은 넷을
   * 다 보는데 이쪽은 셋만 봐서, `utf-16be`를 `utf-16le`로 디코드하게 바꿔도 저장소
   * 전체가 초록이었다 (R9 감사 B-6).
   *
   * **에러가 안 난다는 것이 나쁜 점이다.** 판정은 옳게 되므로 깨진 열 이름과 값이
   * 그대로 정본 CSV로 구워지고 해시가 그 위에 잡힌다 — 되돌릴 방법이 없다.
   */
  it('utf-16be 바이트를 원문으로 되돌린다', () => {
    expect(decodeText(utf16be('이름,나이'), 'utf-16be')).toBe('이름,나이')
  })
})
