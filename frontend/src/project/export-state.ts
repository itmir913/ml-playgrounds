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
 * **문자열 사전순으로 비교하지 않는다.** `savedAt`은 파일을 열었을 때
 * `manifest.updatedAt`에서 오는데(stores/project.ts의 `open`), 스키마가 받는 것은
 * `z.iso.datetime({ offset: true })`라 `+09:00` 같은 표기가 들어올 수 있다. 우리가 쓴
 * 파일은 언제나 `Z`지만 다른 도구가 만든 파일이 이 문을 지나고, 거기서는 **사전순과 실제
 * 시각의 순서가 어긋난다** — `2026-09-23T00:30:00+09:00`은 `2026-09-22T16:00:00Z`보다
 * 사전순으로 뒤지만 실제로는 30분 **앞**이다. 아래 검사가 그 한 쌍을 못 박는다.
 *
 * **사전순 폴백은 오늘 닿지 않는다** (2026-09-23 R37 C-7. 전에는 이 주석이 *"남이 손으로
 * 고친 파일이 이 문을 지난다"*고 **닿는 것처럼** 적었다). `savedAt`은 스키마가
 * `z.iso.datetime`으로 받은 값이고 `exportedAt`은 우리가 `toISOString()`으로 쓴 값이라
 * **둘 다 반드시 파스된다.** 그래도 두는 이유는 여기서 던지면 상태 표시줄 하나 때문에
 * 화면이 서기 때문이다 — **죽은 가지가 아니라 안전망이고, 닿는 입력은 아직 없다.**
 *
 * **아직 안 쓴 편집이 있으면 시각을 안 본다** (2026-09-28 감사 C, A-2). 시각은 브라우저에
 * **쓴** 때만 오르므로, 내보낸 뒤 고친 것이 저장에 실패하면(쿼터) `savedAt`이 그대로라 판정이
 * "파일로 저장함"에 멈춰 있었다 — 그 편집은 파일에도 브라우저에도 없는데 줄은 초록이었다.
 * 미뤄 둔 저장을 기다리는 짧은 사이도 같다: 그 편집은 아직 어느 파일에도 없다.
 * `autosave.spec.ts`의 *"안 쓴 편집이 있으면 시각과 무관하게 stale이다"*와
 * `status-bar-export.spec.ts`가 문다.
 *
 * **대가 하나** — 내보내기 직전의 저장이 실패하면 파일에는 지금 작업이 다 들어갔는데도(내보내기는
 * 메모리의 파일로 만든다) `stale`이 선다. 초록 거짓말보다 주의색의 과잉이 낫다고 골랐다.
 *
 * @param savedAt    마지막으로 브라우저에 쓴 시각. 아직 없으면 null이다.
 * @param exportedAt 마지막으로 파일로 저장한 시각. 한 번도 안 했으면 null이다.
 * @param dirty      화면에는 있는데 아직 브라우저에 안 쓴 편집이 있는가 (스토어의 `dirty`).
 */
export function exportStateOf(
  savedAt: string | null,
  exportedAt: string | null,
  dirty: boolean,
): ExportState {
  if (exportedAt === null) return 'notExported'
  if (dirty) return 'stale'
  if (savedAt === null) return 'exported'
  const saved = Date.parse(savedAt)
  const exported = Date.parse(exportedAt)
  const later =
    Number.isNaN(saved) || Number.isNaN(exported) ? savedAt > exportedAt : saved > exported
  return later ? 'stale' : 'exported'
}
