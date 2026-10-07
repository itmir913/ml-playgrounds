// @vitest-environment jsdom
/**
 * **압축 파일이 인코딩을 안 적었을 때 이름을 되살리는 규칙** (`data/zip-names.ts`).
 *
 * 첫 줄이 jsdom인 것은 **`SUPPORTED_LOCALES`를 값으로 들여오기 때문이다** — `i18n.ts`가
 * DOM 부재를 분기하므로, 밝히지 않으면 죽는 대신 대체 경로를 검사하게 된다.
 *
 * 근거는 `open-decisions.md` "압축 파일의 폴더 이름은 UTF-8이 아닐 수 있다"이고,
 * 이 파일이 그 결정문의 표를 그대로 문다.
 *
 * **여기가 틀리면 사진이 깨진 이름의 범주로 들어간다** — 화면에는 `»¡°£³×¸ð`가 뜨고,
 * 학생이 누르면 그 이름의 범주가 만들어진다. `isValidCategoryName`은 저 글자들을
 * 막지 않는다(라틴 문자다).
 */

import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { zipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'

import { SHIFT_JIS_NAME, SHIFT_JIS_NAME_TEXT } from './fixtures/cp932'
import { sourceFiles, withoutComments } from './fixtures/source'

import { readImageZip } from '../src/data/image/upload'
import { SUPPORTED_LOCALES } from '../src/i18n'
import { decodeZipNames, LEGACY_CHARSETS } from '../src/data/zip-names'

/**
 * `fflate`가 UTF-8 플래그 없는 항목을 읽어 준 모양. **Latin-1은 바이트를 그대로
 * 글자 하나에 담으므로** 검사에서도 같은 방식으로 만든다.
 */
function asFflateWouldRead(bytes: readonly number[]): string {
  return String.fromCharCode(...bytes)
}

/** 윈도 탐색기가 CP949로 적은 `빨간네모/a.png`. 2026-08-29에 실측한 바이트다. */
const CP949_RED = [0xbb, 0xa1, 0xb0, 0xa3, 0xb3, 0xd7, 0xb8, 0xf0, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

/** 같은 이름을 UTF-8로 적고 **플래그만 빠뜨린** 압축 파일. 리눅스 `zip`이 이렇게 만든다. */
const UTF8_RED = [0xeb, 0xb9, 0xa8, 0xea, 0xb0, 0x84, 0xeb, 0x84, 0xa4, 0xeb, 0xaa, 0xa8, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

/**
 * 일본어 윈도 탐색기가 Shift_JIS로 적은 `赤い点/a.png` (`fixtures/cp932.ts`). 첫 바이트 `0x90`이
 * UTF-8의 시작 바이트가 아니라 UTF-8로는 안 읽히고, `点`(`93 5F`) 때문에 브라우저의 euc-kr로도
 * 안 읽힌다 — 옛 표본 `赤い四角`은 Node에서만 던지고 크롬에서는 한글로 풀렸다(0.33.3 최종 감사 A-1).
 */
const SHIFT_JIS_RED = SHIFT_JIS_NAME

/** 독일어 `Größe/a.png`. **진짜 Latin-1이라 지금도 잘 읽힌다** — 이게 안 깨져야 한다. */
const LATIN1_GROESSE = [0x47, 0x72, 0xf6, 0xdf, 0x65, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

/** 프랑스어 `café/a.png`. */
const LATIN1_CAFE = [0x63, 0x61, 0x66, 0xe9, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

/**
 * **UTF-8로도 읽히는 CP949 이름** (2026-09-23, R37 C-8).
 *
 * *"대조가 되면 그것이 답이다. UTF-8보다 먼저 본다"*에 **그물이 0이었다** — 두 갈래를
 * 맞바꿔도 조용했다. 갈림이 서려면 **같은 바이트가 두 인코딩에서 다 유효**해야 하는데,
 * 감사자는 *"그 우연이 실재하는지 안 쟀다"*고 적었다.
 *
 * **재 보니 실재한다** — CP949의 앞바이트가 `C2`~`DF`, 뒷바이트가 `A1`~`BF`면 그 두 바이트가
 * **그대로 유효한 UTF-8 2바이트 수열**이다. 그런 짝이 899개 있고(python `cp949` 기준, 사람
 * 확인 — node의 `euc-kr`은 사용자 정의 영역까지 읽어 더 많이 센다), `C2A5 C2A6`은 CP949로
 * `짜짝`이고 UTF-8로는 `¥¦`다. 즉 **순서를 뒤집으면 교사의 범주 폴더가 `¥¦`로 들어온다.**
 */
describe('두 인코딩에서 다 읽히는 이름', () => {
  /** CP949 `짜짝/a.png`. 같은 바이트가 UTF-8로는 `¥¦/a.png`다. */
  const BOTH_WAYS = [0xc2, 0xa5, 0xc2, 0xa6, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

  /**
   * **CP949 바이트가 그대로 유효한 UTF-8인 한글 음절이 있고, 검사 표본이 그 안에 있다.**
   * 이 파일과 `image-format.spec.ts`의 "ASCII 이름은 증거가 아니다" 검사들이 기대는 성질이
   * 이것이다 — 표본이 그 집합 밖이면 그 검사들은 아무것도 재지 않는다.
   *
   * **못 보는 것:** node의 `TextDecoder('euc-kr')`는 확장 완성형(뒷바이트 0x81–0xA0)을 못
   * 읽어서, 그 구간의 음절은 이 집합에 안 들어온다. 그래서 뒷바이트를 `A1`~`BF`로 좁혔다.
   */
  it('CP949 바이트가 그대로 유효한 UTF-8인 한글 음절이 있고 표본이 그 안에 있다', () => {
    const decoder = new TextDecoder('euc-kr', { fatal: true })
    const syllables = new Set<string>()
    for (let lead = 0xc2; lead <= 0xdf; lead += 1) {
      for (let trail = 0xa1; trail <= 0xbf; trail += 1) {
        const bytes = new Uint8Array([lead, trail])
        let text: string
        try {
          text = decoder.decode(bytes)
        } catch {
          continue
        }
        // 같은 두 바이트가 UTF-8로도 한 글자로 읽혀야 "두 인코딩에서 다 읽힌다"다.
        expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toHaveLength(1)
        if (/^[가-힣]$/u.test(text)) syllables.add(text)
      }
    }
    expect(syllables.size).toBeGreaterThan(0)
    const samples = ['짜', '짝', '치', '타', '화', '창']
    expect(samples.filter((name) => !syllables.has(name))).toEqual([])
  })

  it('대조되는 것이 UTF-8보다 세다', () => {
    expect(decodeZipNames([asFflateWouldRead(BOTH_WAYS)], { expect: ['짜짝'] })).toEqual([
      '짜짝/a.png',
    ])
  })

  /**
   * **대조할 것이 없으면 UTF-8이 이긴다.** 둘 다 유효할 때 우리가 아는 것이 없으면
   * 플래그만 빠진 UTF-8로 보는 것이 맞다 — 순서의 나머지 절반이다.
   */
  it('대조할 것이 없으면 UTF-8로 읽는다', () => {
    expect(decodeZipNames([asFflateWouldRead(BOTH_WAYS)])).toEqual(['¥¦/a.png'])
  })

  /** 엉뚱한 것을 대조해도 CP949로 넘어가지 않는다 — 대조는 증명이지 추측이 아니다. */
  it('안 맞는 대조는 UTF-8을 안 밀어낸다', () => {
    expect(decodeZipNames([asFflateWouldRead(BOTH_WAYS)], { expect: ['고양이'] })).toEqual([
      '¥¦/a.png',
    ])
  })

  /**
   * **ASCII 이름은 증명이 아니다** (2026-09-26 R41 B-4). `cat`은 어느 인코딩으로 읽어도
   * `cat`이라 대조에 들어가면 **첫 후보(UTF-8)가 늘 맞는다** — 그러면 옆의 `짜짝`이
   * `¥¦`로 들어온다. 범주 하나가 영어 이름인 교실이면 이것이다.
   */
  it('ASCII 범주가 맞는 것으로는 정하지 않는다', () => {
    const names = ['cat/1.png', asFflateWouldRead(BOTH_WAYS)]
    expect(decodeZipNames(names, { expect: ['cat', '짜짝'] })).toEqual(['cat/1.png', '짜짝/a.png'])
  })

  /**
   * **ASCII만 대조하면 대조는 서지 않는다** (R41 B-4). `cat`을 증거로 세면 UTF-8을 못
   * 읽는 진짜 Latin-1 `Größe`가 다음 후보 `euc-kr`로 읽혀 `Gr秤e`가 된다. 증거가 없으면
   * 영어 화면에서는 받은 그대로 남는다. 같은 규칙의 다른 얼굴(영어 화면에서 CP949 폴더가
   * 풀리지 않고 남는 것)은 `open-decisions.md` "압축 파일의 폴더 이름은 UTF-8이 아닐 수
   * 있다" 2번에 있다.
   */
  it('ASCII 범주만 대조하면 Latin-1 이름을 한자로 바꾸지 않는다', () => {
    const names = ['cat/1.png', asFflateWouldRead(LATIN1_GROESSE)]
    expect(decodeZipNames(names, { locale: 'en', expect: ['cat'] })).toEqual([
      'cat/1.png',
      'Größe/a.png',
    ])
  })

  /**
   * **같은 것을 진짜 업로드 입구로.** 이름을 Latin-1 글자로 넣어 두면 `fflate`가 그 글자를
   * 그대로 돌려준다 — 플래그 없는 CP949 압축 파일을 `fflate`가 읽어 준 모양과 같다
   * (`image-format.spec.ts` "탐색기로 다시 압축한 .mlpx"도 같은 방식이다).
   */
  it('ASCII 범주가 섞인 압축 파일을 올려도 범주가 돌아온다', async () => {
    const photo = new Uint8Array([1])
    const zip = zipSync({ 'cat/1.png': photo, [asFflateWouldRead(BOTH_WAYS)]: photo })
    const items = await readImageZip(zip, { labels: 'inferred' }, { expect: ['cat', '짜짝'] })
    expect(items.map((item) => item.category)).toEqual(['cat', '짜짝'])
  })
})

describe('압축 파일 이름 되살리기', () => {
  it('UTF-8로 읽히면 그것이다 — 플래그만 빠진 압축 파일', () => {
    // 언어를 몰라도 풀린다. 코드 페이지 추정이 아니기 때문이다.
    expect(decodeZipNames([asFflateWouldRead(UTF8_RED)])).toEqual(['빨간네모/a.png'])
  })

  it('그 언어의 코드 페이지로 읽는다 — 탐색기가 만든 압축 파일', () => {
    expect(decodeZipNames([asFflateWouldRead(CP949_RED)], { locale: 'ko' })).toEqual([
      '빨간네모/a.png',
    ])
  })

  it('일본어 화면에서는 Shift_JIS로 읽는다', () => {
    expect(decodeZipNames([asFflateWouldRead(SHIFT_JIS_RED)], { locale: 'ja' })).toEqual([
      SHIFT_JIS_NAME_TEXT,
    ])
  })

  /**
   * **반각 가타카나만으로 된 이름도 일본어다.** Shift_JIS는 `ｱ`(0xB1) 같은 반각 가나를 한
   * 바이트로 적는다. `script`가 그 범위(U+FF61~FF9F)를 몰랐던 동안 이 이름은 Latin-1로 남았다.
   */
  it('반각 가타카나만으로 된 이름도 Shift_JIS로 읽는다', () => {
    const halfwidth = [0xb1, 0xb2, 0xb3, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore
    expect(decodeZipNames([asFflateWouldRead(halfwidth)], { locale: 'ja' })).toEqual(['ｱｲｳ/a.png'])
  })

  it('다른 언어의 코드 페이지로는 추정하지 않는다', () => {
    // 한국어 화면에서는 `euc-kr` 하나만 후보이고, 이 바이트는 그것으로 엄격하게 안 읽힌다 —
    // Node와 브라우저 모두(`encoding.spec.ts` "CP932 표본은 브라우저의 euc-kr로도 안 풀린다").
    const given = asFflateWouldRead(SHIFT_JIS_RED)
    expect(decodeZipNames([given], { locale: 'ko' })).toEqual([given])
  })

  /**
   * **ja의 `script`는 한자까지 인정하므로** `Größe`를 Shift_JIS로 읽었을 때 한자가 나오면
   * 진짜 Latin-1 이름이 깨진다. 나오지 않는다는 것을 여기서 못 박는다.
   */
  it('가나·한자가 안 나오면 안 바꾼다 — 일본어 화면의 진짜 Latin-1인 이름', () => {
    for (const bytes of [LATIN1_GROESSE, LATIN1_CAFE]) {
      const given = asFflateWouldRead(bytes)
      expect(decodeZipNames([given], { locale: 'ja' })).toEqual([given])
    }
  })

  /**
   * **대문자 악센트 하나로는 바꾸지 않는다** (2026-10-06 감사). 반각 가나의 바이트(0xA1~0xDF)는
   * Latin-1의 `À`~`ß`와 같은 자리라, 한 글자를 증거로 삼던 동안 `Über`가 `ﾜber`로 읽혔다.
   * 반각 가나는 두 글자 이상 이어질 때만 증거다(`zip-names.ts`의 `LEGACY_CHARSETS` 주석).
   */
  it('대문자 악센트 하나로는 바꾸지 않는다 — 일본어 화면의 Latin-1 이름', () => {
    const uber = [0xdc, 0x62, 0x65, 0x72, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore
    const given = asFflateWouldRead(uber)
    expect(given).toBe('Über/a.png')
    expect(decodeZipNames([given], { locale: 'ja' })).toEqual([given])
  })

  /** **경계 양쪽** — 반각 가나는 정확히 두 글자부터 증거이고, 떨어진 둘은 증거가 아니다. */
  it('반각 가나가 정확히 두 글자 이어지면 Shift_JIS로 읽는다', () => {
    const two = [0xb1, 0xb2, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore
    expect(decodeZipNames([asFflateWouldRead(two)], { locale: 'ja' })).toEqual(['ｱｲ/a.png'])
  })

  it('떨어진 두 대문자 악센트로는 바꾸지 않는다 — 일본어 화면의 Latin-1 이름', () => {
    const apart = [0xdc, 0x62, 0x65, 0x72, 0xd6, 0x6c, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore
    const given = asFflateWouldRead(apart)
    expect(given).toBe('ÜberÖl/a.png')
    expect(decodeZipNames([given], { locale: 'ja' })).toEqual([given])
  })

  it('언어를 모르면 코드 페이지를 추정하지 않는다', () => {
    const given = asFflateWouldRead(CP949_RED)
    expect(decodeZipNames([given])).toEqual([given])
  })

  /**
   * **엄격 디코딩만으로는 못 가른다.** `Größe`의 바이트는 `euc-kr`로도 성공하고
   * (`Gr秤e`가 나온다), 그래서 결정문이 "그 언어의 글자가 나왔을 때만"을 함께 세웠다.
   * 이 줄이 무너지면 **오늘 잘 읽히던 이름이 깨진다.**
   */
  it('한글이 안 나오면 안 바꾼다 — 진짜 Latin-1인 이름', () => {
    const given = asFflateWouldRead(LATIN1_GROESSE)
    expect(given).toBe('Größe/a.png')
    expect(decodeZipNames([given], { locale: 'ko' })).toEqual([given])
  })

  it('어느 후보로도 못 읽으면 받은 그대로 둔다', () => {
    const given = asFflateWouldRead(LATIN1_CAFE)
    expect(given).toBe('café/a.png')
    expect(decodeZipNames([given], { locale: 'ko' })).toEqual([given])
  })

  it('ASCII만 있으면 손대지 않는다', () => {
    const names = ['dog/1.jpg', 'cat/2.jpg']
    expect(decodeZipNames(names, { locale: 'ko' })).toBe(names)
  })

  it('한 항목이라도 못 읽는 문자셋은 후보가 아니다', () => {
    // 앞은 CP949, 뒤는 진짜 Latin-1. 하나의 인코딩으로 둘 다 설명되지 않는다.
    const names = [asFflateWouldRead(CP949_RED), asFflateWouldRead(LATIN1_CAFE)]
    expect(decodeZipNames(names, { locale: 'ko' })).toEqual(names)
  })
})

describe('대조할 범주가 있으면 추측하지 않는다', () => {
  it('언어를 몰라도 풀린다 — 한국어 압축 파일을 영어 화면에서 올린 경우', () => {
    expect(
      decodeZipNames([asFflateWouldRead(CP949_RED)], { locale: 'en', expect: ['빨간네모'] }),
    ).toEqual(['빨간네모/a.png'])
  })

  it('한 겹 감싸인 압축 파일에서도 맞댄다', () => {
    const wrapped = asFflateWouldRead([0x73, 0x2f, ...CP949_RED]) // `s/빨간네모/a.png`
    expect(decodeZipNames([wrapped], { expect: ['빨간네모'] })).toEqual(['s/빨간네모/a.png'])
  })

  it('겹치는 이름이 없으면 대조로 정하지 않는다', () => {
    const given = asFflateWouldRead(CP949_RED)
    expect(decodeZipNames([given], { expect: ['고양이'] })).toEqual([given])
  })
})

describe('코드 페이지 표는 지원 언어를 다 덮는다', () => {
  it('언어마다 한 줄씩 있다', () => {
    expect(Object.keys(LEGACY_CHARSETS).sort()).toEqual([...SUPPORTED_LOCALES].sort())
  })

  it('적어 둔 문자셋을 브라우저가 안다', () => {
    for (const legacy of Object.values(LEGACY_CHARSETS)) {
      if (!legacy) continue
      expect(() => new TextDecoder(legacy.charset), legacy.charset).not.toThrow()
    }
  })
})

/**
 * **UTF-8로도 읽히는 탐색기 이름 — 첫 업로드에서도 되찾는다** (이슈 #43, 결정 "압축 파일의 폴더 이름은 UTF-8이 아닐 수 있다"
 * 2026-10-08 개정). 대조할 범주가 없으면 규칙 1이 CP949 `치킨`(`C4 A1 C5 B2`)을 UTF-8 `ġŲ`로 읽었다. 예외는 ko만 쓰고(표의
 * `lookalike`), (가) UTF-8 풀이에 U+00FF 위의 남의 글자가 있고 (나) 코드 페이지 풀이가 완성형 바이트로 전부 한글일 때만이다.
 */
describe('UTF-8로도 읽히는 탐색기 이름', () => {
  const ko = (bytes: readonly number[]) =>
    decodeZipNames([asFflateWouldRead([...bytes, 0x2f, 0x61])], { locale: 'ko' })[0]!.split('/')[0]

  const CHICKEN = [0xc4, 0xa1, 0xc5, 0xb2] // CP949 치킨, UTF-8로는 ġŲ

  it('진짜 입구 — 첫 업로드(대조 없음)의 치킨이 돌아온다, ASCII 범주가 섞여도', async () => {
    const photo = new Uint8Array([1])
    const alone = zipSync({
      [asFflateWouldRead([...CHICKEN, 0x2f, 0x31])]: photo,
      [asFflateWouldRead([...CHICKEN, 0x2f, 0x32])]: photo,
    })
    const read = await readImageZip(alone, { labels: 'inferred' }, { locale: 'ko', expect: [] })
    expect(read.map((item) => item.category)).toEqual(['치킨', '치킨'])

    const mixed = zipSync({
      [asFflateWouldRead([...CHICKEN, 0x2f, 0x31])]: photo,
      'pizza/2.png': photo,
    })
    const both = await readImageZip(mixed, { labels: 'inferred' }, { locale: 'ko', expect: [] })
    expect(both.map((item) => item.category).sort()).toEqual(['pizza', '치킨'])
  })

  it('이슈의 표본 넷이 돌아온다 — 앞바이트 C4~C8', () => {
    expect(ko([0xc4, 0xa1, 0xc5, 0xb8])).toBe('치타')
    expect(ko([0xc8, 0xad, 0xc3, 0xa2])).toBe('화창')
    expect(ko([0xc7, 0xa5])).toBe('표')
  })

  /** **대가 ①** — 앞바이트 C2·C3은 UTF-8로 Latin-1 보충이라 진짜 `café`와 가를 수 없다. 두 번째 업로드부터는 대조가 푼다. */
  it('앞바이트 C2·C3인 이름은 그대로다 — 같은 자리의 진짜 UTF-8 café를 지킨다', () => {
    expect(ko([0xc3, 0xa5])).toBe('å') // CP949 책
    expect(ko([0xc2, 0xa5, 0xc2, 0xa6])).toBe('¥¦') // CP949 짜짝
    expect(ko([0x63, 0x61, 0x66, 0xc3, 0xa9])).toBe('café') // 플래그 없는 UTF-8
  })

  it('한글 아닌 글자가 섞여 읽히면 바꾸지 않는다 — 전부 한글이어야 한다', () => {
    expect(ko([0xc4, 0xa1, 0xd0, 0xb4])).toBe('ġд') // CP949로는 치畇
  })

  /**
   * **완성형 밖 바이트가 있으면 바꾸지 않는다.** node의 `euc-kr`은 확장 완성형(뒷바이트 `81`~`A0`)을 못 읽어 여기 오기 전에
   * 떨어지므로, 브라우저처럼 그 구간을 읽는 디코더를 흉내 낸다 — 크롬은 UTF-8 `Łódź`를 `흟처d탄`으로 읽는다(감사 실측, 파이썬
   * `cp949` 대용). 그래야 완성형 하한(`minByte`)을 무는 검사가 node에서 선다.
   */
  it('완성형 밖 바이트가 있으면 바꾸지 않는다 — 브라우저의 확장 완성형을 흉내 내도', () => {
    const bytes = [0xc5, 0x81, 0xc3, 0xb3, 0x64, 0xc5, 0xba]
    expect(ko(bytes)).toBe('Łódź')
    const Real = globalThis.TextDecoder
    class BrowserLike extends Real {
      private readonly uhc: boolean
      constructor(label?: string, options?: TextDecoderOptions) {
        super(label, options)
        this.uhc = label === 'euc-kr'
      }
      override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
        const view = input instanceof Uint8Array ? input : null
        if (this.uhc && view && view.length === 9 && view[1] === 0x81) return '흟처d탄/a'
        return super.decode(input, options)
      }
    }
    vi.stubGlobal('TextDecoder', BrowserLike)
    try {
      expect(ko(bytes)).toBe('Łódź')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  /** **대가 ②** — 플래그 없는 UTF-8 라틴 확장 이름이 완성형 한글로도 읽히면 한글이 된다(언어 소개 낱말 67개 중 18개). */
  it('대가 — 플래그 없는 UTF-8 žaba는 한글로 읽힌다', () => {
    expect(ko([0xc5, 0xbe, 0x61, 0x62, 0x61])).toBe('탑aba')
  })

  it('예외는 표에 lookalike가 있는 언어만 쓴다 — 일본어·영어 화면은 그대로다', () => {
    const name = asFflateWouldRead([...CHICKEN, 0x2f, 0x61])
    expect(decodeZipNames([name], { locale: 'ja' })).toEqual(['ġŲ/a'])
    expect(decodeZipNames([name], { locale: 'en' })).toEqual(['ġŲ/a'])
  })
})

/**
 * **진짜 입구로 태운다.** 위 검사들은 `fflate`가 무엇을 줄지 우리가 흉내 낸 것이고,
 * 이 검사만이 **실제 압축 파일**을 지난다.
 *
 * 바이트의 출처: 윈도 11(ANSI 949)에서 `빨간네모`·`파란동그라미` 폴더를 탐색기의
 * `보내기 > 압축(ZIP) 폴더`로 압축한 파일 그대로다 (2026-08-29). general purpose
 * flag가 `0x0000`이고 이름이 CP949로 적혀 있다.
 */
const EXPLORER_ZIP_BASE64 =
  'UEsDBBQAAAAIALx7HV0mpJUHPwAAAEYAAAAOAAAAu6Gwo7PXuPAvYS5wbmfrDPBz5+WS4mJgYOD1' +
  '9HAJAtKMIMzBBiTlRY90giVcHEMqbiX/OX8ggJ+BpZWxoWVljyJQgsHT1c9lnVNCEwBQSwMEFAAA' +
  'AAgAvHsdXSaklQc/AAAARgAAABIAAADGxLb1tb+x17bzucwvYS5wbmfrDPBz5+WS4mJgYOD19HAJ' +
  'AtKMIMzBBiTlRY90giVcHEMqbiX/OX8ggJ+BpZWxoWVljyJQgsHT1c9lnVNCEwBQSwECFAAUAAAA' +
  'CAC8ex1dJqSVBz8AAABGAAAADgAAAAAAAAAAACAAAAAAAAAAu6Gwo7PXuPAvYS5wbmdQSwECFAAU' +
  'AAAACAC8ex1dJqSVBz8AAABGAAAAEgAAAAAAAAAAACAAAABrAAAAxsS29bW/sde287nML2EucG5n' +
  'UEsFBgAAAAACAAIAfAAAANoAAAAAAA=='

function explorerZip(): Uint8Array {
  return Uint8Array.from(atob(EXPLORER_ZIP_BASE64), (char) => char.charCodeAt(0))
}

describe('탐색기가 만든 압축 파일이 실제로 열린다', () => {
  it('언어로 읽는다', async () => {
    const items = await readImageZip(explorerZip(), { labels: 'inferred' }, { locale: 'ko' })
    expect(items.map((item) => item.category)).toEqual(['빨간네모', '파란동그라미'])
  })

  /** **라벨을 안 읽어도 이름은 되살린다** (#38 결정 7) — 예측 화면에서는 `path`가 열쇠다. */
  it('라벨을 읽지 않아도 경로는 같이 되살린다', async () => {
    const inferred = await readImageZip(explorerZip(), { labels: 'inferred' }, { locale: 'ko' })
    const none = await readImageZip(explorerZip(), { labels: 'none' }, { locale: 'ko' })
    expect(none.map((item) => item.path)).toEqual(inferred.map((item) => item.path))
    expect(none.map((item) => item.path.split('/')[0])).toEqual(['빨간네모', '파란동그라미'])
    expect(new Set(none.map((item) => item.category))).toEqual(new Set(['_unlabeled']))
  })

  it('범주와 대조해서 읽는다 — 언어를 몰라도 된다', async () => {
    const items = await readImageZip(
      explorerZip(),
      { labels: 'inferred' },
      {
        expect: ['파란동그라미', '빨간네모'],
      },
    )
    expect(items.map((item) => item.category)).toEqual(['빨간네모', '파란동그라미'])
  })

  /**
   * **고치기 전에 무슨 일이 벌어졌는지 못으로 박아 둔다.** 이 줄이 깨지면 되살리기가
   * 통째로 꺼진 것이다 — 그때 범주 이름은 라틴 글자가 되고 화면은 아무 말도 안 한다.
   */
  it('되살리지 않으면 깨진 이름이 범주가 된다', async () => {
    const items = await readImageZip(explorerZip(), { labels: 'inferred' })
    expect(items.map((item) => item.category)).toEqual(['»¡°£³×¸ð', 'ÆÄ¶õµ¿±×¶ó¹Ì'])
  })
})

describe('부르는 자리가 언어를 넘긴다', () => {
  /**
   * **넘기는 것을 잊으면 그 화면만 조용히 안 고쳐진다.** 타입은 세 번째 인자를
   * 선택으로 두므로(검사들이 구조만 볼 때 필요하다) 여기서 화면 쪽을 본다.
   */
  it('src의 모든 readImageZip 호출에 locale이 붙어 있다', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src'))
      // 선언한 파일은 뺀다. 거기는 그 이름이 있어야 할 자리다.
      .filter((path) => !path.endsWith(join('data', 'image', 'upload.ts')))
      .flatMap((path) => {
        const lines = withoutComments(readFileSync(path, 'utf-8'))
        return lines
          .map((line, index) => ({ line, index }))
          .filter((row) => row.line.includes('readImageZip('))
          .filter(
            (row) =>
              !lines
                .slice(row.index, row.index + 6)
                .join('\n')
                .includes('locale:'),
          )
          .map((row) => `${relative(process.cwd(), path)}:${row.index + 1}`)
      })
    expect(offenders, 'calls readImageZip without passing locale').toEqual([])
  })
})
