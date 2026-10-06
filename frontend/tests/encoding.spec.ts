// @vitest-environment jsdom
/**
 * 업로드 표의 인코딩 판정 (`data/encoding.ts`).
 *
 * 첫 줄이 jsdom인 것은 **`SUPPORTED_LOCALES`를 값으로 들여오기 때문이다** — `zip-names.spec.ts`와
 * 같은 사정이다. `i18n.ts`가 DOM 부재를 분기하므로, 밝히지 않으면 대체 경로를 검사하게 된다.
 */

import { describe, expect, it } from 'vitest'

import { CANDIDATES_BY_LOCALE, decodeText, detectEncoding } from '../src/data/encoding'
import { isClientError } from '../src/errors'
import { SUPPORTED_LOCALES } from '../src/i18n'

/** '이름,나이\n가나다,10'을 CP949로 인코딩한 바이트 (Python cp949 codec으로 생성). */
const CP949_SAMPLE = new Uint8Array([
  192, 204, 184, 167, 44, 179, 170, 192, 204, 10, 176, 161, 179, 170, 180, 217, 44, 49, 48,
])

/**
 * '身長,名前,クラス\n150,太郎,A\n'을 CP932로 인코딩한 바이트. Python
 * `'身長,名前,クラス\n150,太郎,A\n'.encode('cp932')`가 낸 그대로다 — 일본 윈도 엑셀의
 * "CSV(コンマ区切り)"가 쓰는 인코딩이다. 이것을 `euc-kr`로 읽으면 `身長`이 `g�`가 된다.
 */
const CP932_SAMPLE = new Uint8Array([
  144, 103, 146, 183, 44, 150, 188, 145, 79, 44, 131, 78, 131, 137, 131, 88, 10, 49, 53, 48, 44,
  145, 190, 152, 89, 44, 65, 10,
])
const CP932_TEXT = '身長,名前,クラス\n150,太郎,A\n'

/**
 * '이름,키\n김수,150\n'을 CP949로 인코딩한 바이트 (Python cp949 codec으로 생성).
 *
 * **엄격한 Shift_JIS로는 안 풀린다** — `수`(`BC F6`)의 둘째 바이트가 Shift_JIS의 첫 바이트
 * 자리이고 그 뒤가 쉼표라서다. 위 `CP949_SAMPLE`은 이 일에 못 쓴다: CP949 한글의 바이트가
 * 전부 Shift_JIS의 반각 가나 자리라 **오류 없이 반각 가나로 풀린다**(경계는
 * `open-decisions.md` "인코딩 판정과 지원 목록").
 */
const CP949_NOT_SJIS = new Uint8Array([
  192, 204, 184, 167, 44, 197, 176, 10, 177, 232, 188, 246, 44, 49, 53, 48, 10,
])

/**
 * 'Name,City\nCafé,Zürich\n'을 Windows-1252로 인코딩한 바이트 (Python cp1252 codec으로 생성).
 * 영어 윈도 엑셀의 CSV가 쓰는 코드 페이지다. `é`(`E9`)·`ü`(`FC`)가 UTF-8로는 안 풀린다.
 */
const CP1252_SAMPLE = new Uint8Array([
  78, 97, 109, 101, 44, 67, 105, 116, 121, 10, 67, 97, 102, 233, 44, 90, 252, 114, 105, 99, 104, 10,
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

/**
 * **UI 언어가 CP949 앞의 후보를 고른다** (`CANDIDATES_BY_LOCALE`). 바이트만으로는 CP949와
 * CP932를 못 가르므로 언어가 정한다. 경위: `open-decisions.md` "인코딩 판정과 지원 목록".
 */
describe('detectEncoding - 언어별 후보', () => {
  it('일본어 화면은 CP932 CSV를 cp932로 읽고 글자가 맞다', () => {
    expect(detectEncoding(CP932_SAMPLE, 'ja')).toBe('cp932')
    expect(decodeText(CP932_SAMPLE, 'cp932')).toBe(CP932_TEXT)
  })

  it('한국어·영어 화면과 언어 없음은 같은 바이트를 전처럼 cp949로 본다', () => {
    expect(detectEncoding(CP932_SAMPLE, 'ko')).toBe('cp949')
    expect(detectEncoding(CP932_SAMPLE, 'en')).toBe('cp949')
    expect(detectEncoding(CP932_SAMPLE)).toBe('cp949')
  })

  it('일본어 화면에서도 엄격한 Shift_JIS로 안 풀리는 CP949 CSV는 cp949로 떨어진다', () => {
    expect(detectEncoding(CP949_NOT_SJIS, 'ja')).toBe('cp949')
    expect(decodeText(CP949_NOT_SJIS, 'cp949')).toBe('이름,키\n김수,150\n')
  })

  it('BOM과 UTF-8 판정은 언어와 무관하다', () => {
    const utf8 = new TextEncoder().encode('身長,名前\n150,太郎\n')
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
    for (const locale of SUPPORTED_LOCALES) {
      expect(detectEncoding(utf8, locale), locale).toBe('utf-8')
      expect(detectEncoding(withBom, locale), locale).toBe('utf-8')
      expect(detectEncoding(utf16le('身長'), locale), locale).toBe('utf-16le')
    }
  })
})

/**
 * **`cp1252`는 어휘에만 있다** (mlpx-spec.md §9.4). 영어 화면의 대체 후보로 다음 판(0.33.1)에서
 * 쓰려고 v4에 먼저 들였고, **지금 판정은 그것을 안 낸다.** 0.33.1에서 영어 화면의 판정을 고치면
 * 이 검사의 `en` 줄이 바뀔 자리다 — 그때는 고치는 쪽이 이 검사를 함께 고친다.
 */
describe('cp1252는 아직 판정에 안 쓴다', () => {
  it('지금은 어느 언어로도 cp1252를 내지 않는다', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(detectEncoding(CP1252_SAMPLE, locale), locale).toBe('cp949')
    }
    expect(detectEncoding(CP1252_SAMPLE)).toBe('cp949')
  })

  it('그래도 받아 둔 값이라 풀 줄은 안다', () => {
    expect(decodeText(CP1252_SAMPLE, 'cp1252')).toBe('Name,City\nCafé,Zürich\n')
  })
})

describe('언어별 후보 표는 지원 언어를 다 덮는다', () => {
  it('언어마다 한 줄씩 있다', () => {
    expect(Object.keys(CANDIDATES_BY_LOCALE).sort()).toEqual([...SUPPORTED_LOCALES].sort())
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
