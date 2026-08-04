/**
 * 격자 -> 정본(canonical) CSV 바이트.
 *
 * **업로드 형식이 무엇이든 정본은 항상 UTF-8 CSV다.** xlsx도, CP949 CSV도 여기를
 * 거쳐 같은 모양이 된다. 그래서 아래가 전부 한 가지만 알면 된다.
 *
 *   - .mlpx의 dataset/data.csv (mlpx-spec.md 1.1)
 *   - datasetHash 계산 대상 (mlpx-spec.md 7)
 *   - 서버로 보내는 바이트 (서버는 xlsx도 cp949도 모른다)
 *
 * **정규화는 import 시점에 딱 한 번 일어난다.** 여기서 나온 바이트가 그 프로젝트의
 * 원본이며, 이후로는 누구도 손대지 않는다 - 다시 인코딩하거나 줄바꿈을 바꾸면
 * datasetHash가 달라져 무결성 검증 전체가 무너진다(mlpx-spec.md 7).
 */

/** 정본 CSV의 구분자. 읽는 쪽도 이 값을 안다. */
export const CANONICAL_DELIMITER = ','

/** 정본 CSV의 줄바꿈. CRLF를 쓰지 않는다 - 바이트가 늘고 얻는 게 없다. */
export const CANONICAL_LINE_BREAK = '\n'

/**
 * 정본 CSV는 UTF-8 BOM으로 시작한다.
 *
 * BOM이 없는 UTF-8 CSV를 한국 윈도우 엑셀에서 열면 CP949로 읽혀 한글이 전부 깨진다.
 * 교사가 .mlpx를 풀어 data.csv를 엑셀로 열어보는 건 충분히 일어나는 일이고,
 * 그 자리에서 깨져 보이면 도구를 믿지 않게 된다.
 *
 * 대가는 서버가 utf-8-sig로 읽어야 한다는 것 하나뿐이며, 서버는 우리 것이다.
 */
const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf])

/** 따옴표로 감싸야 하는 문자. 구분자·따옴표·줄바꿈이 들어 있으면 감싼다. */
const NEEDS_QUOTING = new RegExp(`[${CANONICAL_DELIMITER}"\\r\\n]`)

function quoteField(field: string): string {
  if (!NEEDS_QUOTING.test(field)) return field
  return `"${field.replace(/"/g, '""')}"`
}

/** 격자를 RFC 4180 규칙의 CSV 문자열로 만든다. */
export function toCsvText(grid: readonly (readonly string[])[]): string {
  return grid.map((row) => row.map(quoteField).join(CANONICAL_DELIMITER)).join(CANONICAL_LINE_BREAK)
}

/**
 * 격자를 정본 바이트로 만든다.
 *
 * 이 결과를 parseCsv에 다시 넣으면 같은 격자가 나와야 한다(왕복 무손실).
 * tests/serialize.spec.ts가 그것을 강제한다.
 */
export function toCanonicalCsv(grid: readonly (readonly string[])[]): Uint8Array {
  const body = new TextEncoder().encode(toCsvText(grid))
  const bytes = new Uint8Array(UTF8_BOM.length + body.length)
  bytes.set(UTF8_BOM)
  bytes.set(body, UTF8_BOM.length)
  return bytes
}
