/**
 * 메인 스레드와 표 요약 워커가 주고받는 것. **양쪽의 유일한 계약이다** (open-decisions.md 122).
 */

import type { ClientErrorParams } from '@/errors'
import type { ColumnSummary } from '../columns'

/**
 * 정본 CSV 하나를 요약해 달라는 것. **바이트는 복제로 넘긴다** — 소유권을 넘기면 같은 읽기를 화면에
 * 앉힌 제출물의 정본이 빈다.
 */
export interface SummarizeRequest {
  readonly bytes: Uint8Array
  readonly hasHeader: boolean
}

/** 숫자 열의 분포. **이상치는 개수만이다** — 값의 목록은 길이에 한이 없다. */
export interface ColumnDistribution {
  readonly min: number
  readonly q1: number
  readonly median: number
  readonly q3: number
  readonly max: number
  readonly outlierCount: number
}

export interface SummarizedColumn extends ColumnSummary {
  /** 범주 열이면 `null`이다. */
  readonly distribution: ColumnDistribution | null
}

/** 표 하나의 요약. 열 종류는 **파일 전체**로 판정한 것이다. */
export interface TableSummary {
  readonly rowCount: number
  readonly columnCount: number
  readonly columns: readonly SummarizedColumn[]
}

export type SummarizeMessage =
  | { readonly type: 'done'; readonly summary: TableSummary }
  | { readonly type: 'failed'; readonly code: string; readonly params: ClientErrorParams }
