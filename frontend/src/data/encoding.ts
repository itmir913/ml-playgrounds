/**
 * 업로드된 표 파일의 인코딩 자동 판정 (docs/open-decisions.md #15 "결정됨").
 *
 * 학생에게 먼저 묻지 않는다. 한국 윈도우 엑셀의 "CSV로 저장"은 CP949이고,
 * 이걸 UTF-8로 읽으면 한글 컬럼명이 전부 깨진다.
 *
 * 판정 순서: BOM 확인 -> UTF-8 유효성 검사 -> UI 언어의 후보를 엄격하게 차례로 -> 끝은 CP949.
 * 언어별 후보가 왜 있는지는 `CANDIDATES_BY_LOCALE`이 말한다.
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
 * **'cp1252'는 아직 아무 판정도 내지 않는다** (코드 소유자 결정, mlpx-spec.md §9.4). 영어 윈도
 * 엑셀의 CSV 코드 페이지이고, 영어 화면의 대체 후보로 다음 판(0.33.1)에서 쓴다. 어휘만 v4에 먼저
 * 들인 것은 형식 버전을 두 번 올리지 않으려는 것이다. 지금 판정이 그것을 안 낸다는 것은
 * encoding.spec.ts "지금은 어느 언어로도 cp1252를 내지 않는다"가 문다.
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
 * 그래서 엄격 판정의 후보(`CANDIDATES_BY_LOCALE`)가 될 수 없고, 쓴다면 마지막 대체로만 쓴다.
 */
const DECODER_LABEL: Record<SourceEncoding, string> = {
  'utf-8': 'utf-8',
  cp949: 'euc-kr',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be',
  cp932: 'shift_jis',
  cp1252: 'windows-1252',
}

/**
 * **UTF-8이 아닐 때 CP949보다 먼저 시험할 인코딩.** 로케일마다 한 줄.
 *
 * **바이트만으로는 CP949와 CP932를 못 가른다** — 둘 다 2바이트 체계이고, 같은 바이트열이
 * 양쪽에서 오류 없이 풀리는 일이 흔하다. 그래서 **UI 언어가 고른다**: 일본어 화면이면 그 학생의
 * 엑셀은 CP932로 저장했을 것이다. 후보는 **엄격하게** 시험하고, 안 풀리면 다음으로 넘어간다.
 * 마지막은 언제나 CP949이고 그것은 이 표에 안 적는다 — 한국어·영어 화면의 판정이 전과 같다.
 * **`cp1252`는 이 표에 오지 않는다** — 엄격하게 시험해도 실패하지 않으므로 후보가 아니라 대체다.
 *
 * **`@/i18n`을 import하지 않는다** — 이유는 `zip-names.ts`의 `LEGACY_CHARSETS`와 같다. 키를 이
 * 표에서 뽑고(`EncodingLocale`), 부르는 화면이 `Locale`을 넘기며, `encoding.spec.ts`
 * "언어마다 한 줄씩 있다"가 키를 `SUPPORTED_LOCALES`와 대조한다.
 *
 * 경위: `open-decisions.md` "인코딩 판정과 지원 목록".
 */
export const CANDIDATES_BY_LOCALE = {
  en: [],
  ko: [],
  ja: ['cp932'],
} as const satisfies Record<string, readonly SourceEncoding[]>

/** 이 표가 아는 언어. **`SUPPORTED_LOCALES`와 같아야 하고 검사가 그것을 본다.** */
export type EncodingLocale = keyof typeof CANDIDATES_BY_LOCALE

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
 * `locale`은 지금 UI 언어다. **없으면 후보가 없다** — 판정이 언어별 후보가 생기기 전과 같다.
 */
export function detectEncoding(bytes: Uint8Array, locale?: EncodingLocale): SourceEncoding {
  const bom = BOMS.find((candidate) => startsWith(bytes, candidate.bytes))
  if (bom) {
    if (isSourceEncoding(bom.encoding)) return bom.encoding
    throw new ClientError('DATASET_ENCODING_UNSUPPORTED', { encoding: bom.encoding })
  }

  // BOM이 없다. UTF-8로 온전히 읽히면 UTF-8이다.
  if (decodesCleanly(bytes, 'utf-8')) return 'utf-8'

  // 그 언어의 후보가 엄격하게 풀리면 그것이다. 느슨하게 시험하면 무엇이든 "풀린다".
  const candidates: readonly SourceEncoding[] = locale ? CANDIDATES_BY_LOCALE[locale] : []
  const local = candidates.find((candidate) => decodesCleanly(bytes, candidate))
  if (local) return local

  // 아니면 CP949다. euc-kr 디코더는 non-fatal이라 절대 실패하지 않으므로
  // 여기가 항상 종점이다 - 판정 함수는 BOM 경우를 빼면 실패하지 않는다.
  return 'cp949'
}

/** 판정된 인코딩으로 텍스트를 만든다. 선행 BOM은 TextDecoder가 스스로 제거한다. */
export function decodeText(bytes: Uint8Array, encoding: SourceEncoding): string {
  return new TextDecoder(DECODER_LABEL[encoding]).decode(bytes)
}
