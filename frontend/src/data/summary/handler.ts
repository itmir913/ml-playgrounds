/**
 * 표 요약 워커가 요청 하나를 처리하는 방법. **던지지 않는다.**
 *
 * 열의 종류·결측·고유값은 데이터 화면과 같은 `summarizeColumns`이고 분포는 박스 플롯과 같은 `boxSummary`다 —
 * 옮겨 적으면 화면과 내보낸 값이 갈린다.
 */

import { failureDetail, isClientError } from '@/errors'
import { summarizeColumns, toDataset } from '../columns'
import { parseCanonicalCsv } from '../csv'
import { boxSummary, columnCells, numericValues } from '../stats'
import type {
  ColumnDistribution,
  SummarizeMessage,
  SummarizeRequest,
  TableSummary,
} from './protocol'

export function summarizeCanonical(request: SummarizeRequest): TableSummary {
  const dataset = toDataset(parseCanonicalCsv(request.bytes), request.hasHeader)
  return {
    rowCount: dataset.rows.length,
    columnCount: dataset.columns.length,
    columns: summarizeColumns(dataset).map((column) => ({
      ...column,
      distribution:
        column.kind === 'numeric' ? distributionOf(columnCells(dataset, column.name)) : null,
    })),
  }
}

function distributionOf(cells: readonly string[]): ColumnDistribution | null {
  const box = boxSummary(numericValues(cells).values)
  if (box === null) return null
  const { min, q1, median, q3, max } = box
  return { min, q1, median, q3, max, outlierCount: box.outliers.length }
}

export function handleSummarize(
  request: SummarizeRequest,
  emit: (message: SummarizeMessage) => void,
): void {
  try {
    emit({ type: 'done', summary: summarizeCanonical(request) })
  } catch (error) {
    emit(
      isClientError(error)
        ? { type: 'failed', code: error.code, params: error.params }
        : { type: 'failed', code: 'UNEXPECTED_ERROR', params: failureDetail(error) },
    )
  }
}
