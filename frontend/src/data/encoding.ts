/**
 * 데이터셋 인코딩 자동 판정 (docs/open-decisions.md #15 "결정됨").
 *
 * 학생에게 먼저 묻지 않는다. 한국 윈도우 엑셀의 "CSV로 저장"은 CP949이고,
 * 이걸 UTF-8로 읽으면 한글 컬럼명이 전부 깨진다.
 *
 * 판정 순서: BOM 확인 -> UTF-8 유효성 검사 -> 실패하면 CP949.
 */

/** settings.dataset.encoding에 기록되는 값. .mlpx에 그대로 남는다. */
export const DATASET_ENCODINGS = ['utf-8', 'cp949'] as const

export type DatasetEncoding = (typeof DATASET_ENCODINGS)[number]

const UTF8_BOM = [0xef, 0xbb, 0xbf]

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte)
}

function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

/**
 * 바이트만 보고 인코딩을 고른다. 실패하지 않는다 - 둘 중 하나로 항상 떨어진다.
 */
export function detectEncoding(bytes: Uint8Array): DatasetEncoding {
  if (hasUtf8Bom(bytes) || isValidUtf8(bytes)) return 'utf-8'
  return 'cp949'
}

/**
 * 판정된(혹은 학생이 되돌린) 인코딩으로 텍스트를 만든다.
 *
 * 'cp949' 값은 파일에 기록되는 이름이자 백엔드(Python)가 그대로 받는 이름이다.
 * 브라우저 TextDecoder에는 'cp949' 라벨이 없다 - WHATWG 스펙은 'euc-kr' 라벨의 디코더를
 * 실제로는 windows-949(=CP949) 매핑으로 정의해 두었고, 이는 레거시 콘텐츠 호환을 위한
 * 의도된 스펙 선택이다. 그래서 'euc-kr' 라벨로 디코딩해도 CP949 바이트가 정확히 풀린다.
 */
export function decodeDataset(bytes: Uint8Array, encoding: DatasetEncoding): string {
  // TextDecoder('utf-8')는 기본값(ignoreBOM: false)에서 선행 BOM을 스스로 제거한다.
  if (encoding === 'utf-8') return new TextDecoder('utf-8').decode(bytes)
  return new TextDecoder('euc-kr').decode(bytes)
}
