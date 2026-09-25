/**
 * 격자 -> 정본(canonical) CSV 바이트.
 *
 * **업로드 형식이 무엇이든 정본은 항상 UTF-8 CSV다.** xlsx도, CP949 CSV도 여기를
 * 거쳐 같은 모양이 된다. 그래서 아래가 전부 한 가지만 알면 된다.
 *
 *   - .mlpx의 dataset/data.csv (mlpx-spec.md 1.1)
 *   - 무결성 해시(hashes.json)의 대상 (mlpx-spec.md 7)
 *   - 서버로 보내는 바이트 (서버는 xlsx도 cp949도 모른다)
 *
 * **정규화는 import 시점에 딱 한 번 일어난다.** 여기서 나온 바이트가 그 프로젝트의
 * 원본이며, 이후로는 누구도 손대지 않는다 - 다시 인코딩하거나 줄바꿈을 바꾸면
 * 해시가 달라져 무결성 검증 전체가 무너진다(mlpx-spec.md 7).
 */

/**
 * 정본 CSV의 구분자. **읽는 쪽도 이 값으로 읽는다** — `data/csv.ts`의 `parseCanonicalCsv`가
 * 추정하지 않고 이것을 넘긴다 (2026-09-26 R41 B-3). 검사: serialize.spec.ts
 * "다른 구분자 후보(…)가 든 칸"·"정본을 다시 읽는 세 입구".
 */
export const CANONICAL_DELIMITER = ','

/**
 * **천 단위로 묶인 수.** `1,650` · `1,234,567` · `-1,650` · `1,650.5`.
 *
 * **쉼표를 지우는 규칙이 아니라 묶음을 알아보는 규칙이다.** 첫 묶음은 한 자리에서 세
 * 자리, 그 뒤는 정확히 세 자리씩이어야 한다. 그래서 `1,65`는 안 걸린다 — 묶음이 셋이
 * 아니면 **유럽식 소수점일 수 있고**, 우리는 묻지 않고 바꾸므로 애매하면 안 건드린다
 *
 * **첫 묶음이 `0`으로 시작하는 것도 뺀다** (2026-09-21 델타 감사 C). 천 단위 표기는
 * `0,123`처럼 안 적는다 — 그렇게 적힌 것은 유럽식 `0.123`일 가능성이 높고, 실제로
 * 세미콜론 구분 CSV로 들어오는 길이 있다
 * (`open-decisions.md` "천 단위 쉼표는 정본을 만들 때 숫자로 읽는다").
 */
const THOUSANDS_GROUPED = /^[+-]?[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/

/**
 * 칸 하나를 정본 표기로. **천 단위 묶음만 푼다.**
 *
 * `pandas`의 `thousands=','`는 쉼표를 그냥 지우지만 **저쪽은 사람이 켜서 지우는 것이고
 * 우리는 묻지 않고 한다.** 묻지 않는 쪽이 더 엄격해야 해서 모양을 확인하고 푼다.
 */
export function canonicalCell(cell: string): string {
  // **바꾸는 칸도 공백은 안 건드린다.** 모양을 알아볼 때만 다듬은 값을 보고, 돌려주는
  // 것은 쉼표만 뺀 원본이다 — 전에는 통과하는 칸만 트림돼서 `"  1,650  "`는 공백이
  // 사라지고 `"  150  "`는 남았다. **같은 열의 두 칸이 다른 대접을 받았다**
  // (2026-09-21 델타 감사 C). 공백은 `toNumber`가 어차피 다듬는다.
  return THOUSANDS_GROUPED.test(cell.trim()) ? cell.replaceAll(',', '') : cell
}

/**
 * 격자의 모든 칸에 `canonicalCell`을 적용한다. **`importTable`이 딱 한 번 부른다.**
 *
 * **머리글 줄도 함께 지난다.** 머리글이 있는지는 여기서 아직 모르고(학생이 뒤에서
 * 고른다), 무엇보다 **세 표가 같은 규칙을 지나야 열 이름이 서로 맞는다** — 학습 표만
 * 바꾸고 예측 표를 안 바꾸면 그 둘의 열 이름이 갈린다.
 */
export function canonicalGrid(grid: readonly (readonly string[])[]): string[][] {
  return grid.map((row) => row.map(canonicalCell))
}

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
 * 이 결과를 `parseCanonicalCsv`(data/csv.ts)에 다시 넣으면 같은 격자가 나와야 한다(왕복
 * 무손실). tests/serialize.spec.ts "왕복 무손실"이 그것을 강제한다. **업로드용
 * `parseCsvText`로 읽으면 무손실이 아니다** — 구분자를 추정해서 `;`·탭·`|`가 많은 칸을
 * 잘못 가른다 (R41 B-3).
 */
export function toCanonicalCsv(grid: readonly (readonly string[])[]): Uint8Array {
  const body = new TextEncoder().encode(toCsvText(grid))
  const bytes = new Uint8Array(UTF8_BOM.length + body.length)
  bytes.set(UTF8_BOM)
  bytes.set(body, UTF8_BOM.length)
  return bytes
}
