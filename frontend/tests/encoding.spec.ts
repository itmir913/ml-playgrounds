// @vitest-environment jsdom
/**
 * 업로드 표의 인코딩 판정 (`data/encoding.ts`).
 *
 * 첫 줄이 jsdom인 것은 **`SUPPORTED_LOCALES`를 값으로 들여오기 때문이다** — `zip-names.spec.ts`와
 * 같은 사정이다. `i18n.ts`가 DOM 부재를 분기하므로, 밝히지 않으면 대체 경로를 검사하게 된다.
 */

import { describe, expect, it } from 'vitest'

import { CODE_PAGE_BY_LOCALE, decodeText, detectEncoding } from '../src/data/encoding'
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

/**
 * `00`~`FF`를 한 번씩. UTF-8로도, 엄격한 euc-kr(`80`은 첫 바이트가 못 된다)로도, 엄격한
 * shift_jis(`A0`·`FD`~`FF`는 어느 자리에도 못 온다)로도 안 풀린다.
 */
const EVERY_BYTE = Uint8Array.from({ length: 256 }, (_, index) => index)

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

/**
 * 이 묶음의 표본은 한국어 CSV라 **한국어 화면**으로 판정한다. 언어는 필수다 — 빠지면 컴파일이
 * 깨진다(open-decisions.md 97). BOM·UTF-8이 언어와 무관하다는 것은 아래 "언어별 판정"이 모든
 * 언어로 돈다.
 */
describe('detectEncoding', () => {
  it('BOM이 있으면 utf-8로 판정한다', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('a,b')])
    expect(detectEncoding(bytes, 'ko')).toBe('utf-8')
  })

  it('유효한 UTF-8이면 utf-8로 판정한다', () => {
    expect(detectEncoding(new TextEncoder().encode('이름,나이\n가나다,10'), 'ko')).toBe('utf-8')
  })

  it('한국어 화면은 UTF-8로 해석되지 않는 CP949를 cp949로 판정한다', () => {
    expect(detectEncoding(CP949_SAMPLE, 'ko')).toBe('cp949')
  })

  it('UTF-16 BOM을 알아본다', () => {
    expect(detectEncoding(utf16le('이름,나이'), 'ko')).toBe('utf-16le')
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0x00, 0x61]), 'ko')).toBe('utf-16be')
  })

  it('빈 파일은 utf-8로 본다', () => {
    expect(detectEncoding(new Uint8Array([]), 'ko')).toBe('utf-8')
  })

  it('다룰 수 없는 BOM(UTF-32)은 조용히 넘기지 않고 실패한다', () => {
    // UTF-32LE의 BOM은 UTF-16LE의 BOM으로 시작한다. 짧은 것을 먼저 보면
    // 여기서 utf-16le로 잘못 판정되고 학생은 깨진 표를 보게 된다.
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00])
    try {
      detectEncoding(bytes, 'ko')
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
      expect(detectEncoding(odd, 'ko')).toBe('utf-8')
      expect(decodeText(odd, 'utf-8')).toContain('김철수')
    })

    it('끝에 NUL 채움 — utf-8로 읽는다', () => {
      const padded = new Uint8Array([...utf8('이름,키\n김,170\n'), 0, 0, 0, 0])
      expect(detectEncoding(padded, 'ko')).toBe('utf-8')
    })

    it('ASCII CSV에 NUL 하나 — utf-8로 읽는다', () => {
      expect(detectEncoding(withNul(utf8('a,b\n1,2\n'), 4), 'ko')).toBe('utf-8')
    })
  })
})

/**
 * **UI 언어가 자기 코드 페이지 하나만 엄격하게 본다** (`CODE_PAGE_BY_LOCALE`, open-decisions.md 97).
 * 바이트만으로는 CP949와 CP932를 못 가르므로 언어가 정하고, **다른 언어의 코드 페이지는 시험하지
 * 않는다** — 안 풀리면 `null`이고 여는 쪽이 `DATASET_ENCODING_UNKNOWN`으로 멈춘다(table.spec.ts).
 *
 * 0.33.0까지는 끝이 언제나 느슨한 cp949라 아래의 `null`이 전부 `cp949`(깨진 표)였다.
 */
describe('detectEncoding - 언어별 판정', () => {
  it('일본어 화면은 CP932 CSV를 cp932로 읽고 글자가 맞다', () => {
    expect(detectEncoding(CP932_SAMPLE, 'ja')).toBe('cp932')
    expect(decodeText(CP932_SAMPLE, 'cp932')).toBe(CP932_TEXT)
  })

  it('한국어 화면은 엄격한 cp949로 안 풀리는 CP932를 판정하지 못한다', () => {
    expect(detectEncoding(CP932_SAMPLE, 'ko')).toBeNull()
  })

  it('한국어 화면은 Windows-1252의 Café도 판정하지 못한다', () => {
    expect(detectEncoding(CP1252_SAMPLE, 'ko')).toBeNull()
  })

  it('일본어 화면은 엄격한 Shift_JIS로 안 풀리는 CP949를 판정하지 못한다', () => {
    expect(detectEncoding(CP949_NOT_SJIS, 'ja')).toBeNull()
    expect(detectEncoding(CP1252_SAMPLE, 'ja')).toBeNull()
  })

  it('영어 화면은 Windows-1252를 cp1252로 읽고 글자가 맞다', () => {
    expect(detectEncoding(CP1252_SAMPLE, 'en')).toBe('cp1252')
    expect(decodeText(CP1252_SAMPLE, 'cp1252')).toBe('Name,City\nCafé,Zürich\n')
  })

  /**
   * **결정 97의 대가다.** 영어 화면의 끝은 실패하지 않는 `cp1252`라, 한국어·일본어 엑셀의 CSV도
   * 오류 없이 깨진 글자로 들어온다. 영어 화면에 CJK를 두지 않은 것은 서유럽어 바이트가 엄격한
   * shift_jis·euc-kr로 오류 없이 풀리기 때문이다(결정 97의 실측). 이 줄이 `cp949`·`cp932`가 되면
   * 영어 화면에 다른 언어의 코드 페이지가 들어온 것이다.
   */
  it('영어 화면은 CP949·CP932도 cp1252로 본다 — 다른 언어의 코드 페이지를 시험하지 않는다', () => {
    expect(detectEncoding(CP949_SAMPLE, 'en')).toBe('cp1252')
    expect(detectEncoding(CP949_NOT_SJIS, 'en')).toBe('cp1252')
    expect(detectEncoding(CP932_SAMPLE, 'en')).toBe('cp1252')
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
 * **`cp1252`는 영어 화면의 마지막 대체다** (open-decisions.md 97, mlpx-spec.md §9.4).
 *
 * 0.33.0에는 이 자리에 *"지금은 어느 언어로도 cp1252를 내지 않는다"*가 있었다 — 어휘만 v4에 먼저
 * 들이고 판정은 다음 판에 고친다는 뜻이었다. **결정 97이 그 판정을 정했으므로 검사가 반대로 섰다.**
 * 언어를 하나 더하면 아래 표에 그 언어의 답을 적어야 운다 — 새 언어의 끝을 고르는 것은 결정이다.
 */
describe('cp1252는 영어 화면만 낸다', () => {
  it('영어 화면만 cp1252로 떨어진다', () => {
    const verdicts = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, detectEncoding(CP1252_SAMPLE, locale)]),
    )
    expect(verdicts).toEqual({ en: 'cp1252', ko: null, ja: null })
  })

  /**
   * **대체는 시험하지 않고 내주므로 실패하지 않는 디코더여야 한다** — `windows-1252`가 `00`~`FF`
   * 전부를 받는다. 엄격한 자리는 거꾸로 "아니다"라고 말할 수 있어야 하므로 같은 바이트에서 `null`이다.
   */
  it('마지막 대체는 어떤 바이트에서도 실패하지 않는다', () => {
    const verdicts = Object.fromEntries(
      SUPPORTED_LOCALES.map((locale) => [locale, detectEncoding(EVERY_BYTE, locale)]),
    )
    expect(verdicts).toEqual({ en: 'cp1252', ko: null, ja: null })
    expect(() => new TextDecoder('windows-1252', { fatal: true }).decode(EVERY_BYTE)).not.toThrow()
  })
})

describe('언어별 표는 지원 언어를 다 덮는다', () => {
  it('언어마다 한 줄씩 있다', () => {
    expect(Object.keys(CODE_PAGE_BY_LOCALE).sort()).toEqual([...SUPPORTED_LOCALES].sort())
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
