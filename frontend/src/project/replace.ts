/**
 * **`.mlpx`를 가져올 때 이 컴퓨터의 판을 묻지 않고 덮어도 되는가** (open-decisions.md 75).
 *
 * 같은 `projectId`의 판이 이 컴퓨터에 있으면 가져오기는 덮어쓰기다. 전에는 묻지 않았다 — 집에서
 * 이어 한 학생이 학교에서 저번 차시의 파일을 열면 집의 작업이 사라졌다(2026-09-28 감사 C/A-3 ·
 * B/A-1). **판정만 여기 있고** 읽기는 저장소(`readLocalVersion`), 묻기는 화면(`WelcomeView.vue`)이다.
 */

/**
 * 이 컴퓨터에 있는 판의 요약. **창에 보이는 것은 이름과 수정 시각뿐이다** — 학번·이름은 싣지
 * 않는다(코드 소유자 결정).
 */
export interface LocalVersion {
  readonly name: string
  readonly updatedAt: string
  /** 파일로 안 나간 편집이 있는가. 레코드의 표지(`unexportedEdits`)이고, 없던 옛 레코드는 대신 잰 값이다. */
  readonly unexportedEdits: boolean
}

/**
 * 덮기 전에 물을 것인가. **(A) 이 컴퓨터의 판이 더 새거나 (B) 파일로 안 나간 편집이 있으면** 묻는다.
 *
 * - **판을 못 읽었으면(`null`) 묻지 않는다.** 못 읽는 레코드를 파일로 바꾸는 것이 그 프로젝트의
 *   복구 길이다(architecture.md §8.10.2).
 * - (A)는 `Date.parse`로 잰다 — 사전순은 `+09:00` 같은 표기에서 실제 시각과 어긋난다
 *   (`export-state.ts`와 같은 이유). **한쪽이라도 못 읽으면 (A)는 거짓이고 (B)만 본다.**
 * - `contentHash`는 비교하지 않는다(결정문).
 *
 * 무는 검사: `open-older-file.spec.ts`.
 */
export function asksBeforeReplacing(local: LocalVersion | null, fileUpdatedAt: string): boolean {
  if (local === null) return false
  const mine = Date.parse(local.updatedAt)
  const theirs = Date.parse(fileUpdatedAt)
  const newerHere = !Number.isNaN(mine) && !Number.isNaN(theirs) && mine > theirs
  return newerHere || local.unexportedEdits
}
