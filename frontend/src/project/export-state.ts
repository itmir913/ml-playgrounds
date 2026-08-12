/**
 * 파일로 저장한 것이 지금 작업과 얼마나 어긋나 있는가.
 *
 * **화면에서 뺀 이유가 둘이다.** 판정이 화면 안의 computed였는데, 그 상태로는
 * 단위 테스트가 못 닿고 **로케일과 짝지어 보는 검사도 값 목록을 못 읽는다** —
 * 상태 표시줄이 `save.${state}`로 문구 키를 조립하기 때문이다 (docs/i18n.md).
 */

export const EXPORT_STATES = ['notExported', 'exported', 'stale'] as const

export type ExportState = (typeof EXPORT_STATES)[number]

/**
 * **가운데가 중요하다.** "저장함"만 보여주면 그 뒤에 한 시간을 더 작업한 학생이
 * 안심한 채로 컴퓨터를 끈다.
 *
 * @param savedAt    마지막으로 브라우저에 쓴 시각. 아직 없으면 null이다.
 * @param exportedAt 마지막으로 파일로 저장한 시각. 한 번도 안 했으면 null이다.
 */
export function exportStateOf(savedAt: string | null, exportedAt: string | null): ExportState {
  if (exportedAt === null) return 'notExported'
  if (savedAt !== null && savedAt > exportedAt) return 'stale'
  return 'exported'
}
