/**
 * **zip 안의 경로가 푸는 자리 밖으로 새는가** — 판정은 여기 하나다.
 *
 * 우리는 경로를 `Map` 키로만 쓰므로 우리를 위한 검사가 아니다. **파일을 푸는 사람**을
 * 위한 것이다 — 학생이 `.mlpx`를, 교사가 포트폴리오 묶음을 풀 때 `..`·역슬래시·절대
 * 경로를 그대로 따르는 도구가 있다. 읽기 검증(`format.ts`의 `requirePathUnder`)과 교사
 * 묶음(`portfolio-bundle.ts`의 `entriesOf`)이 같은 식을 쓴다 — 두 벌이면 한쪽만 고쳐진다.
 *
 * - `..` 조각: 위로 올라간다.
 * - 역슬래시: 윈도 도구가 구분자로 읽는다(`a\..\..\b`).
 * - `/`로 시작하거나 드라이브 문자(`C:`)로 시작: 푸는 자리와 무관한 절대 경로다.
 *
 * `portfolio-bundle.spec.ts`의 *"푸는 자리 밖으로 새는 첨부는 안 싣는다"*가 문다.
 */
export function escapesArchive(path: string): boolean {
  return (
    path.split('/').includes('..') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[A-Za-z]:/.test(path)
  )
}
