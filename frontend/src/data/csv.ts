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
 */
export function parseCsvText(text: string, maxRows?: number, delimiter?: string): TableGrid {
  const grid: TableGrid = []
  let quotesBroken = false

  Papa.parse<string[]>(text, {
    // 안 주면 옵션 자체를 안 넘긴다 — 업로드 경로는 papaparse의 구분자 추정을 그대로 쓴다.
    ...(delimiter !== undefined ? { delimiter } : {}),
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
  return padGrid(grid)
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
