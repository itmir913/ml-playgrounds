/**
 * 표 파일이 받아들이는 확장자. `<input accept>`에 그대로 들어간다.
 *
 * **두 자리가 이 값을 쓴다** — 데이터 화면의 정본 받기(`data/kinds.ts`의 `accept`)와
 * 전처리 화면의 테스트 데이터 받기다. 베껴 두면 한쪽만 늘어나고, 그러면 학생은 같은 앱에서
 * 어떤 파일은 되고 어떤 파일은 안 되는 자리를 만난다.
 *
 * **표를 읽는 코드(`data/table.ts`)와 갈라 둔 이유** — 등록부(`data/kinds.ts`)는 첫 화면에
 * 실리는데, 이 상수 하나 때문에 `table.ts`를 들이면 CSV 파서(`papaparse`)까지 첫 화면에
 * 실렸다. `table.ts`는 이 값을 다시 내보내므로 부르는 쪽은 그대로다. 무는 검사:
 * `entry-chunks.spec.ts`, `entry-names.spec.ts` "파일 고르기의 accept".
 */
export const TABULAR_ACCEPT = '.csv,.xlsx'
