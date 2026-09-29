/**
 * **압축 파일이 준 엔트리 이름을 읽는 규칙** — 사진 zip 업로드(`data/image/upload.ts`)와
 * `.mlpx` 읽기(`project/format.ts`)가 이 한 벌을 쓴다. 두 입구 모두 **OS의 압축 도구가 만든
 * zip**을 받으므로 표기와 부스러기가 같고, 두 벌이면 한쪽만 고쳐진다 — 실제로 업로드에만
 * `desktop.ini`가 빠져 있었다(2026-09-28 감사 G G-2). 이름을 되살리는 `data/zip-names.ts`도
 * 맞대기 전에 같은 `normalizeEntryName`을 지난다.
 *
 * **여기 없는 것은 일부러 입구마다 다르다** — 빈 파일과 한 겹 벗기기의 증인. 이유는 각 입구의
 * 주석에 있다(`upload.ts`의 `readImageZip`·`unwrapOnce`, `format.ts`의 `isArchiveNoise`·`isWrapped`).
 *
 * 무는 검사: `tests/archive-entries.spec.ts` — 두 입구가 같은 잡음 표로 돈다.
 */

/**
 * 압축 도구와 OS가 넣는 부스러기의 이름 (mlpx-spec.md §7.2.1). 맥은 `.DS_Store`를, 윈도는
 * 폴더를 들여다본 자리에 `Thumbs.db`·`desktop.ini`를 남긴다. `._*`와 `__MACOSX/`는 아래
 * 판정이 따로 본다.
 */
export const ARCHIVE_NOISE_NAMES: ReadonlySet<string> = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
])

/** 맥이 `__MACOSX/` 아래에 따로 적는 자원 포크 폴더. */
const MAC_RESOURCE_DIR = '__MACOSX'

/** 맥이 자원 포크를 담는 `._이름` 파일의 머리. */
const MAC_RESOURCE_PREFIX = '._'

/**
 * 엔트리 이름을 **우리 규칙 하나로** 맞춘다 — 구분자 `\`는 `/`로(zip 규격은 `/`를 요구하지만
 * Windows PowerShell 5.1의 `Compress-Archive`는 `\`로 적는다), 글자는 NFC로(맥이 한글을 NFD로
 * 넣는다). NFC는 파일 이름의 표준 형태이고 파이썬의 `ImageFolder`가 읽는 것도 디스크에 앉은
 * 그 이름이다.
 */
export function normalizeEntryName(name: string): string {
  return name.replaceAll('\\', '/').normalize('NFC')
}

/**
 * **이름만 보고** 부스러기인가. 판정이 ASCII 글자뿐이라 이름을 되살리기 전후로 답이 같다 —
 * 그래서 `.mlpx` 메타 읽기가 엔트리를 풀기 전에 같은 판정을 할 수 있다.
 *
 * 디렉터리 엔트리(`/`로 끝나는 것)는 여기서 안 본다. 크기를 함께 봐야 하고, 그 기준이
 * 입구마다 다르다.
 */
export function isNoiseName(name: string): boolean {
  const segments = normalizeEntryName(name).split('/')
  if (segments.includes(MAC_RESOURCE_DIR)) return true
  const base = segments[segments.length - 1] ?? ''
  return ARCHIVE_NOISE_NAMES.has(base) || base.startsWith(MAC_RESOURCE_PREFIX)
}
