/**
 * **zip 안의 경로가 푸는 자리 밖으로 새는가** — 판정은 여기 하나다.
 *
 * 우리는 경로를 `Map` 키로만 쓰므로 우리를 위한 검사가 아니다. **파일을 푸는 사람**을
 * 위한 것이다 — 학생이 `.mlpx`를, 교사가 포트폴리오 묶음을 풀 때 `..`·역슬래시·절대
 * 경로를 그대로 따르는 도구가 있다. 읽기 검증(`format.ts`의 `requirePathUnder`), 사진·첨부·
 * 임베딩 수집(`format.ts`의 `insideArchive` — 대조 **뒤**에 버린다, mlpx-spec.md §7.2.1),
 * 브라우저 저장소(`storage.ts`의 `loadProject`)와 교사 묶음(`portfolio-bundle.ts`의
 * `entriesOf`)이 같은 식을 쓴다 — 두 벌이면 한쪽만 고쳐진다.
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

/**
 * **이 이름이 경로 조각 하나로 서는가** — 범주 이름이 폴더 한 겹이 될 수 있는지다.
 *
 * `..`은 위로 새고, `.`은 푸는 도구가 지워 사진이 한 겹 위에 앉고, 빈 이름은 겹이 없고,
 * 구분자가 든 이름은 겹이 둘이 된다. 파일에서 온 범주 이름(`settings.data.categories`와 폴더
 * 조각)을 이것으로 가린다(mlpx-spec.md §10).
 *
 * **범주 이름 규칙(`isValidCategoryName`)을 쓰지 않는 이유** — 그 규칙은 학생이 새로 짓는
 * 이름의 것이고 시간이 지나며 조여졌다. 끝의 마침표는 2026-08-15에야 막혔으므로 그 전에
 * 저장된 `PC에서 또 추가함.` 같은 범주가 실제로 있고, 그 규칙으로 가리면 **옛 파일의 사진이
 * 학습에서 조용히 빠진다.** 여기서 막는 것은 경로가 새거나 겹이 바뀌는 것뿐이다.
 *
 * `image-format.spec.ts`의 *"푸는 자리 밖으로 새는 엔트리"* 묶음이 문다.
 */
export function standsAsFolder(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}
