/**
 * 표 격자의 공통 타입과 정리 규칙.
 *
 * CSV와 엑셀이 **같은 규칙으로** 격자를 만들도록 여기 모아 둔다.
 * 형식마다 빈 행이나 짧은 행의 의미가 달라지면 화면과 전처리가 형식별로 갈라진다.
 */

/** 셀 값은 전부 문자열이다. 자료형 판정은 다운스트림(전처리)의 일이다. */
export type TableGrid = string[][]

/** 값이 하나도 없는 행. 엑셀의 빈 행과 CSV의 빈 줄을 같은 것으로 본다. */
export function isEmptyRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}

/**
 * 모든 행의 길이를 가장 긴 행에 맞춰 빈 문자열로 채운다.
 *
 * **엑셀은 후행 빈 셀을 파일에 저장하지 않는다.** 마지막 컬럼이 비어 있는 행은
 * 짧은 배열로 들어오고, 그대로 두면 컬럼 인덱스가 행마다 어긋나 전처리가
 * 조용히 다른 컬럼을 읽는다. CSV도 마지막 필드가 없는 줄에서 같은 일이 생긴다.
 *
 * 자르지 않고 채우기만 한다 - 파일 파싱은 관대하게(mlpx-spec.md 10).
 */
export function padGrid(grid: TableGrid): TableGrid {
  const width = grid.reduce((widest, row) => Math.max(widest, row.length), 0)
  for (const row of grid) {
    while (row.length < width) row.push('')
  }
  return grid
}
