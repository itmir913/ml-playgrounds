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
export function padGrid(grid: TableGrid, maxWidth = Infinity): TableGrid {
  const width = grid.reduce((widest, row) => Math.max(widest, row.length), 0)
  // **상한을 넘는 폭이면 채우지 않는다** (R43-2 감사 C-3). 그 표는 곧 열 상한으로 거절되는데, 채우는 데 행 × 폭이
  // 든다 — 한 행만 넓은 10만 행 CSV가 거절되기까지 2.6초였다. 거절 판정은 가장 넓은 행을 센다(`table.ts`의
  // `checkLimits`). 무는 검사: `table.spec.ts`의 *"열 상한을 넘는 표는 채우기 전에 거절한다"*.
  if (width > maxWidth) return grid
  for (const row of grid) {
    while (row.length < width) row.push('')
  }
  return grid
}
