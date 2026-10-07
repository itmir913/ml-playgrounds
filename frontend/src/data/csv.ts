/**
 * CSV 파싱. papaparse에 맡긴다.
 *
 * **학생이 올린 파일은** 구분자를 추정하게 둔다. 한국 윈도우 엑셀은 콤마로 저장하지만
 * 세미콜론으로 저장하는 환경·도구가 실재하고, 그런 파일이 조용히 한 컬럼짜리 표가 되면
 * 학생은 이유를 알 수 없다. 추정 실패는 오류가 아니라 콤마로 되돌아가는 것뿐이다.
 *
 * **우리가 쓴 정본은 추정하지 않는다** (2026-09-26 R41 B-3) — `parseCanonicalCsv`.
 */

import Papa from 'papaparse'

import { ClientError } from '../errors'
import { isEmptyRow, padGrid, type TableGrid } from './grid'
import { CANONICAL_DELIMITER } from './serialize'

/**
 * 텍스트를 격자로 만든다.
 *
 * 빈 줄은 버린다 - 엑셀의 빈 행과 같은 취급이다(grid.ts).
 * 짧은 행은 가장 긴 행에 맞춰 채운다.
 *
 * `delimiter`를 안 주면 papaparse가 추정한다(업로드). 주면 그것만 쓴다(정본).
 * `newline`도 같다 — 안 주면 papaparse가 **한 가지로** 추정한다(`openCsvText` 머리말). 업로드 경로는
 * `openCsvText`가 줄 끝을 맞춘 뒤 `\n`을 준다. **이것은 이중 방어라 무는 검사가 없다** — 맞춘
 * 텍스트에는 `\n`만 있어 추정도 같은 답을 낸다(2026-09-28 돌연변이에서 살아남았다). 막는 것은
 * 맞추기(`openCsvText`)이고 그쪽은 csv.spec.ts가 문다.
 */
export function parseCsvText(
  text: string,
  maxRows?: number,
  delimiter?: string,
  newline?: '\n',
  maxColumns?: number,
): TableGrid {
  const grid: TableGrid = []
  let quotesBroken = false

  Papa.parse<string[]>(text, {
    // 안 주면 옵션 자체를 안 넘긴다 — 업로드 경로는 papaparse의 구분자 추정을 그대로 쓴다.
    ...(delimiter !== undefined ? { delimiter } : {}),
    ...(newline !== undefined ? { newline } : {}),
    skipEmptyLines: true,
    step: (result, parser) => {
      // 따옴표가 끝까지 닫히지 않은 파일은 무엇을 읽어도 틀린 표가 된다.
      // 나머지(구분자 추정 실패, 필드 수 불일치)는 관대하게 넘긴다.
      if (result.errors.some((error) => error.type === 'Quotes')) {
        quotesBroken = true
        parser.abort()
        return
      }
      if (!isEmptyRow(result.data)) grid.push(result.data)
      if (maxRows !== undefined && grid.length >= maxRows) parser.abort()
    },
  })

  if (quotesBroken) throw new ClientError('DATASET_PARSE_FAILED')
  return padGrid(grid, maxColumns)
}

/**
 * **학생이 올린 CSV 텍스트를 한 번 다듬어 읽을 손잡이를 준다.** 업로드의 입구다
 * (`data/table.ts`의 `openTable`).
 *
 * **줄 끝을 `\n` 하나로 맞춘다** (2026-09-28 감사 E A2). papaparse는 줄 끝을 **한 가지로**
 * 정하고 나머지는 칸 안의 글자로 둔다. 정하는 법(papaparse 5.7.0 `guessLineEndings`)은 이렇다 —
 * 앞 1MB에서 따옴표 속을 지우고, `\r`이 없거나 첫 `\n`이 첫 `\r`보다 앞이면 `\n`이다. 아니면
 * `\r`로 자른 조각 중 `\n`으로 시작하는 것이 절반 이상이면 `\r\n`, 아니면 `\r`이다
 * (`return numWithN >= r.length / 2 ? '\r\n' : '\r'`). 그래서 `\r\n`이 많고 `\n`·`\r`만 쓴 줄이
 * 섞이면 그 줄바꿈이 칸 안의 글자가 된다 — 네 줄짜리 파일이 머리글 + 한 줄이 되고 칸에
 * `170\n이`가 앉았다. 파일을 이어
 * 붙이거나 다른 편집기로 고친 CSV가 그 모양이다. pandas `read_csv`는 셋을 모두 줄 끝으로
 * 읽는다. 무는 검사: csv.spec.ts "줄 끝이 섞인 파일".
 *
 * **대가 하나** — 따옴표로 감싼 칸 안의 `\r\n`·`\r`도 `\n`이 된다. 정본은 어차피 우리가 새로
 * 쓰고(`serialize.ts`는 `\n`으로 쓴다) 칸 안의 줄바꿈이 무엇으로 적혔는지는 값의 뜻이 아니라서
 * 받아들인다.
 *
 * **정본 읽기(`parseCanonicalCsv`)는 이것을 안 지난다** — 정본은 `\n`만 쓰고, 손으로 고친
 * 파일의 칸 값을 여기서 바꾸면 무결성 해시가 보는 바이트와 표가 갈린다.
 *
 * 맞추는 일은 **한 번만** 한다. 미리보기가 시트마다·줄 수마다 다시 읽어도 텍스트는 그대로다.
 */
export function openCsvText(text: string): (maxRows?: number, maxColumns?: number) => TableGrid {
  // `\r`이 없으면 맞출 것도 없다 — LF 파일은 사본을 안 만든다. 맞추는 비용은 개발 PC에서
  // 6.4MB·10만 행 CRLF 파일 하나로 재어 약 11ms였다(2026-09-28, node).
  const normalized = text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
  return (maxRows, maxColumns) => parseCsvText(normalized, maxRows, undefined, '\n', maxColumns)
}

/**
 * **정본 바이트를 격자로 다시 읽는다** (2026-09-26 R41 B-3). 정본을 읽는 자리는 전부
 * 이것을 쓴다(`project/dataset.ts`의 셋).
 *
 * 정본은 `CANONICAL_DELIMITER`로 쓰고 그 구분자·따옴표·줄바꿈이 든 칸만 감싼다
 * (`serialize.ts`) — `;`·탭·`|`는 안 감싼다. 그래서 추정에 맡기면 그런 칸이 많은 표가
 * 다른 구분자로 읽혀 **조용히 틀린 표**가 되고, 이미 내보낸 파일도 같다. 쓰는 쪽에서
 * 더 감싸는 것으로는 나간 파일을 못 구하므로 읽는 쪽에서 구분자를 고정한다.
 * 검사: serialize.spec.ts "다른 구분자 후보(…)가 든 칸"·"정본을 다시 읽는 세 입구".
 *
 * BOM은 `TextDecoder`가 기본으로 떼어 준다.
 */
export function parseCanonicalCsv(bytes: Uint8Array): TableGrid {
  return parseCsvText(new TextDecoder().decode(bytes), undefined, CANONICAL_DELIMITER)
}
