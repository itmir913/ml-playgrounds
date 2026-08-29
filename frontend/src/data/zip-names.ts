/**
 * **압축 파일이 인코딩을 안 적었을 때 항목 이름을 되살린다.**
 *
 * 규칙은 `open-decisions.md` "압축 파일의 폴더 이름은 UTF-8이 아닐 수 있다"가 갖는다.
 * 여기 있는 것은 그 결정을 **화면 밖 순수 함수**로 옮긴 것뿐이다.
 *
 * **왜 되살릴 수 있는가.** zip의 general purpose flag bit 11이 안 서 있으면 `fflate`가
 * 이름을 Latin-1로 읽는데, **Latin-1은 바이트를 그대로 글자 하나에 담는다.** 그래서 그
 * 문자열은 깨진 글자가 아니라 **원 바이트를 들고 있는 그릇**이다.
 *
 * **이미지 밑이 아니라 `data/` 바로 아래 있는 이유**는 `.mlpx`를 읽는 자리도 같은
 * `unzip`을 쓰기 때문이다. 지금 부르는 곳은 사진 압축 파일 하나뿐이고, 포맷 경로를 열
 * 때는 부르는 자리만 늘면 된다.
 */

/** 그 언어권의 윈도가 zip 이름에 쓰는 코드 페이지와, 그것으로 읽었다고 인정할 근거. */
export interface LegacyCharset {
  /** `TextDecoder`가 아는 이름. */
  readonly charset: string
  /**
   * **이 문자셋으로 읽었다는 증거.** 엄격 디코딩만으로는 못 가른다 — 독일어 `Größe`의
   * 바이트도 `euc-kr`로 성공하고(한자가 나온다), 그러면 **오늘 잘 읽히던 이름이 깨진다.**
   * 그 언어의 글자가 실제로 나왔을 때만 인정한다.
   */
  readonly script: RegExp
}

/**
 * 로케일마다 하나.
 *
 * **`@/i18n`을 import하지 않는다.** 타입 하나를 빌리자고 `data/`가 i18n 모듈에 매달리면
 * 안 되고, `ui-rules.spec.ts`의 DOM 가드 추적도 `import type`을 간선으로 센다 — 그러면
 * 이 모듈에 닿는 스펙 전부가 jsdom을 요구받는다. 대신 **키를 이 표에서 뽑아**
 * (`ZipLocale`) 부르는 쪽이 `Locale`을 넘긴다.
 *
 * **언어를 늘리면 부르는 자리가 컴파일에서 깨진다** (`architecture.md` §9.3) — 새 언어가
 * `ZipLocale`에 없으니 화면 셋이 통째로 안 넘어간다. `legal.ts`가 로케일마다 처리방침
 * 경로를 갖는 것과 같은 자리이고, 검사도 그쪽처럼 `SUPPORTED_LOCALES`와 대조한다.
 *
 * **`null`은 "필요 없다"이지 "안 정했다"가 아니다.** 영어권 윈도의 CP1252는 0xA0~0xFF에서
 * Latin-1과 같아서, `Café`는 지금도 그대로 읽힌다. 갈리는 것은 0x80~0x9F(둥근 따옴표
 * 같은 것)뿐이라 그 자리를 위해 표를 하나 더 두지 않는다.
 *
 * ja가 들어오면 `{ charset: 'shift_jis', script: /[぀-ヿ一-鿿]/u }`가
 * 붙는다 — **후보가 그 로케일의 문자셋 하나뿐이라 한자를 넣어도 안전하다.**
 */
export const LEGACY_CHARSETS = {
  en: null,
  ko: { charset: 'euc-kr', script: /[가-힣]/u },
} as const satisfies Record<string, LegacyCharset | null>

/** 이 표가 아는 언어. **`SUPPORTED_LOCALES`와 같아야 하고 검사가 그것을 본다.** */
export type ZipLocale = keyof typeof LEGACY_CHARSETS

export interface ZipNameOptions {
  /** 지금 UI 언어. 모르면 코드 페이지 추정을 아예 안 한다. */
  readonly locale?: ZipLocale
  /**
   * 대조할 이름들. 프로젝트가 이미 가진 범주가 여기 온다.
   *
   * **이게 있으면 추측이 0이 된다** — 읽은 이름이 이 집합과 겹치면 그 인코딩이 답이라는
   * 것이 증명된다. 두 인코딩이 같은 이름을 내놓으면 그건 같은 글자이기 때문이다.
   */
  readonly expect?: readonly string[]
}

/** 한 글자가 한 바이트를 담고 있는가. 아니면 이미 UTF-8로 읽힌 이름이다. */
const BYTE_MAX = 0xff

/** ASCII 위. 이게 하나도 없으면 어느 인코딩으로 읽어도 같은 글자다. */
const ASCII_MAX = 0x7f

function bytesOf(name: string): Uint8Array | null {
  const bytes = new Uint8Array(name.length)
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index)
    if (code > BYTE_MAX) return null
    bytes[index] = code
  }
  return bytes
}

/** 엄격 디코딩. 못 읽으면 `null`이다 — **관용적으로 읽으면 대체 문자가 섞여 들어온다.** */
function decodeStrict(bytes: Uint8Array, charset: string): string | null {
  try {
    return new TextDecoder(charset, { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * 한 문자셋으로 **전부** 읽는다. 하나라도 못 읽으면 그 문자셋은 후보가 아니다 —
 * 한 압축 파일 안의 이름들은 같은 인코딩으로 적힌다.
 *
 * 되살릴 수 없는 이름(이미 UTF-8로 읽힌 것)은 그대로 둔다. 플래그가 항목마다 다른
 * 압축 파일이 있을 수 있다.
 */
function readAll(
  names: readonly string[],
  recovered: readonly (Uint8Array | null)[],
  charset: string,
): readonly string[] | null {
  const texts: string[] = []
  for (let index = 0; index < names.length; index += 1) {
    const bytes = recovered[index]
    if (!bytes) {
      texts.push(names[index]!)
      continue
    }
    const text = decodeStrict(bytes, charset)
    if (text === null) return null
    texts.push(text)
  }
  return texts
}

/**
 * 경로를 이름 조각으로 가른다. **첫 조각만 보지 않는다** — 한 겹 감싸진 압축 파일
 * (`사진/개/1.jpg`)에서는 범주가 둘째 조각이다.
 *
 * 맥이 만든 zip은 한글을 NFD로 넣으므로 맞대기 전에 NFC로 모은다 (`upload.ts`의
 * `normalizePath`와 같은 이유이고, 그쪽은 이 함수가 정한 뒤에 돈다).
 */
function segmentsOf(names: readonly string[]): ReadonlySet<string> {
  const segments = new Set<string>()
  for (const name of names) {
    for (const segment of name.split(/[\\/]/)) {
      if (segment !== '') segments.add(segment.normalize('NFC'))
    }
  }
  return segments
}

/**
 * 압축 파일이 준 이름들을 우리가 읽을 수 있는 글자로 되돌린다.
 *
 * **순서가 뜻을 갖는다.**
 *
 * 1. **UTF-8로 전부 읽히면 그것이다.** 플래그만 빠뜨린 압축 파일이 여기서 끝난다.
 * 2. **대조할 이름이 있으면 그것으로 정한다.** 여기서는 문자셋을 언어로 안 좁힌다 —
 *    맞는지 아닌지가 증명되므로 **아는 문자셋을 전부 시험해도 틀릴 수 없다.** 한국어
 *    압축 파일을 영어 화면에서 올려도 여기서 풀린다.
 * 3. **그래도 안 정해지면 UI 언어의 코드 페이지로 읽는다.** 이때만 추정이고, 그래서
 *    위 `script`가 함께 선다.
 *
 * 셋 다 아니면 **받은 그대로 돌려준다.** 진짜 Latin-1인 이름(`café`)이 그 길로 간다.
 */
export function decodeZipNames(
  names: readonly string[],
  options: ZipNameOptions = {},
): readonly string[] {
  const recovered = names.map(bytesOf)
  const hasHighByte = recovered.some(
    (bytes) => bytes !== null && bytes.some((byte) => byte > ASCII_MAX),
  )
  if (!hasHighByte) return names

  const utf8 = readAll(names, recovered, 'utf-8')

  // 2. 대조가 되면 그것이 답이다. UTF-8보다 먼저 본다 — 증명된 것이 순서보다 세다.
  if (options.expect && options.expect.length > 0) {
    const expected = new Set(options.expect.map((name) => name.normalize('NFC')))
    const charsets = new Set(
      Object.values(LEGACY_CHARSETS).flatMap((legacy) => (legacy ? [legacy.charset] : [])),
    )
    for (const texts of [utf8, ...[...charsets].map((cs) => readAll(names, recovered, cs))]) {
      if (!texts) continue
      const segments = segmentsOf(texts)
      if ([...expected].some((name) => segments.has(name))) return texts
    }
  }

  // 1. 플래그만 빠진 UTF-8.
  if (utf8) return utf8

  // 3. 이 언어권의 코드 페이지. 그 언어의 글자가 나왔을 때만 인정한다.
  const legacy = options.locale ? LEGACY_CHARSETS[options.locale] : null
  if (legacy) {
    const texts = readAll(names, recovered, legacy.charset)
    if (texts && texts.some((text) => legacy.script.test(text))) return texts
  }

  return names
}
