/**
 * 업로드된 표 파일의 인코딩 자동 판정 (docs/open-decisions.md #15 "결정됨").
 *
 * 학생에게 먼저 묻지 않는다. 한국 윈도우 엑셀의 "CSV로 저장"은 CP949이고,
 * 이걸 UTF-8로 읽으면 한글 컬럼명이 전부 깨진다.
 *
 * 판정 순서: BOM 확인 -> UTF-8 유효성 검사 -> UI 언어의 코드 페이지 하나를 엄격하게 -> 그 언어의
 * 마지막 대체(영어만 있다) -> **그래도 안 되면 판정하지 못한다**(`null`, 여는 쪽이 오류로 멈춘다).
 * 언어마다 무엇을 보는지와 그 이유는 `CODE_PAGE_BY_LOCALE`이 말한다 (open-decisions.md 102).
 *
 * **여기서 판정한 인코딩은 정본(canonical)이 아니다.** 정본 바이트는 언제나
 * UTF-8 CSV로 정규화되며(serialize.ts), settings.data.dataset.encoding에 기록되는 값도
 * 항상 'utf-8'이다. 이 모듈의 결과는 "업로드된 파일을 어떻게 읽을 것인가"에만 쓴다.
 */

import { ClientError } from '../errors'

/**
 * 업로드 파일에서 읽어낼 수 있는 인코딩.
 *
 * 배열이 유일한 출처다. 여기 없는 것은 지원하지 않는 인코딩이다.
 * TextDecoder가 처리할 수 있는 라벨만 넣는다.
 *
 * **이 배열은 .mlpx의 어휘이기도 하다** - settings.data.dataset.sourceEncoding이 z.enum으로
 * 이걸 쓴다. 값을 늘리면 파일 포맷이 바뀌는 것이므로 formatVersion을 올려야 한다.
 * 인코딩 판정만 고치는 줄 알고 파일 어휘를 늘리는 일이 없도록 tests/schema.spec.ts가
 * 이 배열을 고정해 두었다 (ml/backend.ts의 TRAINING_LOCATIONS도 같다).
 *
 * **'cp1252'는 영어 화면의 마지막 대체다** (open-decisions.md 102, mlpx-spec.md §9.4). 영어 윈도
 * 엑셀의 CSV 코드 페이지이고, 어휘는 0.33.0의 v4에 먼저 들였다 — 형식 버전을 두 번 올리지 않으려는
 * 것이었다. 영어 화면만 그것을 낸다는 것은 encoding.spec.ts "영어 화면만 cp1252로 떨어진다"가 문다.
 */
export const SOURCE_ENCODINGS = [
  'utf-8',
  'cp949',
  'utf-16le',
  'utf-16be',
  'cp932',
  'cp1252',
] as const

export type SourceEncoding = (typeof SOURCE_ENCODINGS)[number]

/**
 * 인코딩 이름 -> TextDecoder 라벨.
 *
 * 'cp949'는 파일에 기록되는 이름이자 백엔드(Python)가 그대로 받는 이름이다.
 * 브라우저 TextDecoder에는 'cp949' 라벨이 없다 - WHATWG 스펙이 'euc-kr' 라벨의
 * 디코더를 실제로는 windows-949(=CP949) 매핑으로 정의해 두었기 때문에
 * 'euc-kr'로 디코딩해도 CP949 바이트가 정확히 풀린다.
 *
 * 'cp932'도 같은 결이다. 기록 이름은 윈도 코드 페이지 이름이고 pandas가 그대로 받는다.
 * 브라우저에는 그 라벨이 없지만 WHATWG가 'shift_jis' 디코더를 windows-31j(=CP932) 확장
 * (NEC·IBM 확장 문자)까지 정의해 두어 그것으로 풀린다.
 *
 * 'cp1252'는 'windows-1252' 디코더로 푼다. **이 디코더는 어떤 바이트에서도 실패하지 않는다** —
 * 그래서 엄격하게 시험하는 자리(`CODE_PAGE_BY_LOCALE`의 `strict`)에 올 수 없고 마지막 대체
 * (`fallback`)로만 쓴다. 무는 검사: encoding.spec.ts "마지막 대체는 어떤 바이트에서도 실패하지 않는다".
 */
const DECODER_LABEL: Record<SourceEncoding, string> = {
  'utf-8': 'utf-8',
  cp949: 'euc-kr',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  cp932: 'shift_jis',
  cp1252: 'windows-1252',
}

/** 어떤 바이트에서도 실패하지 않는 디코더를 쓰는 인코딩. 엄격하게 시험할 수 없다. */
type LastResortEncoding = Extract<SourceEncoding, 'cp1252'>

/**
 * 언어 하나가 UTF-8 다음에 보는 것.
 *
 * - `strict` — 그 언어의 윈도 엑셀이 CSV에 쓰는 코드 페이지. **엄격하게**(`fatal`) 시험하고
 *   풀리면 그것이다. 느슨하게 시험하면 무엇이든 "풀린다".
 * - `fallback` — 실패하지 않는 마지막 대체. 시험하지 않고 내준다. **이것이 없는 언어는
 *   `strict`로도 안 풀리면 판정하지 못한다**(`detectEncoding`이 `null`).
 *
 * 둘을 나눈 이유는 **성질이 반대이기 때문이다** — 엄격한 자리는 "아니다"라고 말할 수 있어야 하고,
 * 대체는 말할 수 없다. 타입이 그것을 막는다: 실패하지 않는 디코더는 `strict`에 올 수 없다.
 */
interface LocaleCodePages {
  readonly strict: Exclude<SourceEncoding, LastResortEncoding> | null
  readonly fallback: LastResortEncoding | null
}

/**
 * **UTF-8이 아닐 때 언어마다 무엇을 보는가** (open-decisions.md 102). 로케일마다 한 줄.
 *
 * **바이트만으로는 CP949와 CP932를 못 가른다** — 둘 다 2바이트 체계이고, 같은 바이트열이
 * 양쪽에서 오류 없이 풀리는 일이 흔하다. 그래서 **UI 언어가 고른다**: 일본어 화면이면 그 학생의
 * 엑셀은 CP932로 저장했을 것이다.
 *
 * **다른 언어의 코드 페이지는 시험하지 않는다.** 한국어 화면에서 CP932 파일을 열면 엄격한 cp949로
 * 안 풀리는 것은 오류이고, 엑셀에서 "CSV UTF-8"로 다시 저장하면 열린다 — 판정이 틀렸을 때 왜
 * 틀렸는지 설명할 수 있는 쪽을 골랐다. **브라우저의 euc-kr은 UHC라서 흔한 일본어 CSV의 대부분이
 * 오류 없이 풀려 깨진 표가 된다**(0.33.3 최종 감사, 받아들인 대가 — 결정 102의 뒤따른 결정). 검사가
 * 도는 Node의 euc-kr은 KS X 1001만 알아 이 차이를 못 본다(`tests/fixtures/cp932.ts`). 서유럽어 낱말을 Latin-1 바이트로 엄격하게 풀어 보면 20개 중 shift_jis가 13개,
 * euc-kr이 1개를 오류 없이 받았다(결정 102의 실측) — 영어 화면에 CJK를 두면 그렇게 깨진다.
 *
 * **영어만 `fallback`이 있다.** 영어 윈도 엑셀의 CSV는 Windows-1252이고 그 디코더는 실패하지
 * 않으므로 `strict`가 될 수 없다. **대가**: 영어 화면에서는 판정이 실패하지 않아서, CP949·CP932
 * 파일도 `cp1252`로 들어와 글자가 깨진다(`encoding.spec.ts` "영어 화면만 cp1252로 떨어진다").
 * `fallback`이 없는 언어는 대가가 반대다 — 전에 끝의 느슨한 cp949가 받아 주던 파일(몇 글자 깨진
 * 채였거나, 다른 언어 화면에서 연 CP949 CSV처럼 바르게 읽히던 것)이 오류가 된다.
 *
 * **`@/i18n`을 import하지 않는다** — 이유는 `zip-names.ts`의 `LEGACY_CHARSETS`와 같다. 키를 이
 * 표에서 뽑고(`EncodingLocale`), 부르는 화면이 `Locale`을 넘기며, `encoding.spec.ts`
 * "언어마다 한 줄씩 있다"가 키를 `SUPPORTED_LOCALES`와 대조한다.
 *
 * 경위: `open-decisions.md` "인코딩 판정과 지원 목록"과 102.
 */
export const CODE_PAGE_BY_LOCALE = {
  en: { strict: null, fallback: 'cp1252' },
  ko: { strict: 'cp949', fallback: null },
  ja: { strict: 'cp932', fallback: null },
} as const satisfies Record<string, LocaleCodePages>

/** 이 표가 아는 언어. **`SUPPORTED_LOCALES`와 같아야 하고 검사가 그것을 본다.** */
export type EncodingLocale = keyof typeof CODE_PAGE_BY_LOCALE

/**
 * BOM 표. 긴 것을 먼저 본다 - UTF-32LE(FF FE 00 00)의 앞 두 바이트가
 * UTF-16LE(FF FE)와 같아서, 짧은 것을 먼저 보면 영영 UTF-32를 못 알아본다.
 */
const BOMS = [
  { bytes: [0x00, 0x00, 0xfe, 0xff], encoding: 'utf-32be' },
  { bytes: [0xff, 0xfe, 0x00, 0x00], encoding: 'utf-32le' },
  { bytes: [0xef, 0xbb, 0xbf], encoding: 'utf-8' },
  { bytes: [0xfe, 0xff], encoding: 'utf-16be' },
  { bytes: [0xff, 0xfe], encoding: 'utf-16le' },
] as const

function isSourceEncoding(value: string): value is SourceEncoding {
  return (SOURCE_ENCODINGS as readonly string[]).includes(value)
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

/**
 * 그 인코딩으로 오류 없이 풀리는가 (`fatal`).
 *
 * **검사가 도는 Node와 브라우저는 `euc-kr`이 다르다.** 브라우저는 WHATWG의 windows-949(UHC 확장
 * 한글 포함)로 풀고, 검사가 도는 Node(ICU)의 `euc-kr`은 UHC를 모른다 — 실측(Node v24.15.0·ICU 78.2,
 * 사람 확인): `8C 63`(`똠`)을 오류 없이 U+008C·`c`로 풀고, `C6 52`(`힣`)에서는 던진다. 그래서
 * 검사의 CP949 표본은 KS X 1001 글자로 한정한다(`encoding.spec.ts` "CP949 표본은 KS X 1001 안에 있다").
 */
function decodesCleanly(bytes: Uint8Array, encoding: SourceEncoding): boolean {
  try {
    new TextDecoder(DECODER_LABEL[encoding], { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * 바이트만 보고 인코딩을 고른다.
 *
 * BOM이 있으면 그 말을 믿는다. TextDecoder가 다루지 못하는 BOM(UTF-32)이면
 * 조용히 깨진 표를 만드는 대신 DATASET_ENCODING_UNSUPPORTED로 실패한다 -
 * 깨진 한글을 보고 학생이 할 수 있는 일은 없다.
 *
 * `locale`은 지금 UI 언어이고 **반드시 넘긴다** — 빠지면 컴파일이 깨진다. 0.33.0까지는 선택이라
 * 화면이 언어를 안 넘겨도 검사가 초록이었다(0.33.0 감사). 화면이 **엉뚱한** 언어를 넘기는 것은
 * 타입이 못 보고 `csv-encoding-screens.spec.ts`가 문다.
 *
 * **`null`은 "이 언어로는 판정하지 못했다"다** (open-decisions.md 102). 오류는 파일 이름을 아는
 * 여는 쪽(`table.ts`의 `openTable`)이 `DATASET_ENCODING_UNKNOWN`으로 낸다. 여기서 아무 코드
 * 페이지로나 느슨하게 풀어 내주면 **오류 없이 깨진 표**가 된다 — 이 판정이 처음부터 피하려던 모양이다.
 */
export function detectEncoding(bytes: Uint8Array, locale: EncodingLocale): SourceEncoding | null {
  const bom = BOMS.find((candidate) => startsWith(bytes, candidate.bytes))
  if (bom) {
    if (isSourceEncoding(bom.encoding)) return bom.encoding
    throw new ClientError('DATASET_ENCODING_UNSUPPORTED', { encoding: bom.encoding })
  }

  // BOM이 없다. UTF-8로 온전히 읽히면 UTF-8이다 — 언어보다 먼저 본다(결정 102의 실측).
  if (decodesCleanly(bytes, 'utf-8')) return 'utf-8'

  const { strict, fallback }: LocaleCodePages = CODE_PAGE_BY_LOCALE[locale]
  if (strict !== null && decodesCleanly(bytes, strict)) return strict
  return fallback
}

/** 판정된 인코딩으로 텍스트를 만든다. 선행 BOM은 TextDecoder가 스스로 제거한다. */
export function decodeText(bytes: Uint8Array, encoding: SourceEncoding): string {
  return new TextDecoder(DECODER_LABEL[encoding]).decode(bytes)
}
