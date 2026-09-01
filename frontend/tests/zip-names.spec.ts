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

import { describe, expect, it } from 'vitest'

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

/** 독일어 `Größe/a.png`. **진짜 Latin-1이라 지금도 잘 읽힌다** — 이게 안 깨져야 한다. */
const LATIN1_GROESSE = [0x47, 0x72, 0xf6, 0xdf, 0x65, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

/** 프랑스어 `café/a.png`. */
const LATIN1_CAFE = [0x63, 0x61, 0x66, 0xe9, 0x2f, 0x61, 0x2e, 0x70, 0x6e, 0x67] // prettier-ignore

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
    const items = await readImageZip(explorerZip(), undefined, { locale: 'ko' })
    expect(items.map((item) => item.category)).toEqual(['빨간네모', '파란동그라미'])
  })

  it('범주와 대조해서 읽는다 — 언어를 몰라도 된다', async () => {
    const items = await readImageZip(explorerZip(), undefined, {
      expect: ['파란동그라미', '빨간네모'],
    })
    expect(items.map((item) => item.category)).toEqual(['빨간네모', '파란동그라미'])
  })

  /**
   * **고치기 전에 무슨 일이 벌어졌는지 못으로 박아 둔다.** 이 줄이 깨지면 되살리기가
   * 통째로 꺼진 것이다 — 그때 범주 이름은 라틴 글자가 되고 화면은 아무 말도 안 한다.
   */
  it('되살리지 않으면 깨진 이름이 범주가 된다', async () => {
    const items = await readImageZip(explorerZip())
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
