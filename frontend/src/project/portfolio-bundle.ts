/**
 * **명렬의 포트폴리오를 한 묶음으로 굽는다** (architecture.md §8.21).
 *
 * 서른 명의 글을 읽는 일은 화면을 서른 번 여는 일이 아니라 **한 번에 받아 두고 읽는
 * 일**이다. 그래서 점검이 묶음을 내놓는다.
 *
 * **나가는 것은 우리가 새로 지은 zip이다** (open-decisions.md "점검은 읽기 전용
 * 열람기다"의 "내보내기는 열려 있다"). 학생의 `.mlpx` 바이트는 여기 안 실린다 — 그건
 * 교사가 이미 가진 것이고, 점검이 파일 배포처가 될 이유가 없다. **원본은 어느 경로로도
 * 다시 쓰이지 않는다.**
 *
 * **담는 것은 읽은 것뿐이다** — 포트폴리오 글과 그 글이 가리키는 사진.
 */

import { zipSync } from 'fflate'

import { ENTRY, MLPX_EXTENSION, type ProjectFile } from './format'
import { renderPortfolioMarkdown } from './portfolio'
import { portfolioMarkdownText, type Translate } from './portfolio-text'

/** 묶음에 들어가는 제출물 하나. */
export interface BundleEntry {
  /** 명렬의 이름표. 폴더째 골랐으면 상대 경로다. */
  readonly label: string
  readonly file: ProjectFile
}

/**
 * 묶음 안에서 이 제출물이 차지할 폴더 이름.
 *
 * **이름표에서 만든다.** 학번·이름은 안 적은 학생이 있고(선택 입력이다), 그때 남는 것이
 * 파일 이름뿐이다. 경로 구분자는 폴더가 되게 두되 `..`는 걷어낸다 — 우리가 만드는
 * zip이지만, 푸는 쪽이 그 이름을 그대로 쓴다.
 */
export function folderFor(label: string): string {
  const cleaned = label
    .split(/[\\/]+/)
    .filter((part) => part !== '' && part !== '.' && part !== '..')
    .join('/')
  // 확장자는 뗀다 - 폴더 이름에 `.mlpx`가 붙어 있으면 푸는 쪽에서 파일로 보인다.
  return cleaned.toLowerCase().endsWith(MLPX_EXTENSION)
    ? cleaned.slice(0, -MLPX_EXTENSION.length)
    : cleaned
}

/**
 * 제출물 하나가 묶음에 넣을 엔트리들.
 *
 * **글은 파일에 담긴 것을 다시 그리지 않고 지금 문서에서 그린다** — 학생이 마지막으로
 * 저장할 때 담긴 `document.md`와 같은 함수(`renderPortfolioMarkdown`)를 쓰므로 내용은
 * 같고, **머리글의 언어만 교사의 것이 된다.** 교사가 읽을 묶음이라 그쪽이 맞다.
 */
export function entriesOf(
  entry: BundleEntry,
  translate: Translate,
  locale: string,
): Record<string, Uint8Array> {
  const { document, attachments } = entry.file
  const folder = folderFor(entry.label)
  const markdown = renderPortfolioMarkdown(
    portfolioMarkdownText(document.manifest, translate, locale),
    document.portfolio,
  )

  const files: Record<string, Uint8Array> = {
    [`${folder}/${ENTRY.portfolioMarkdown}`]: new TextEncoder().encode(markdown),
  }
  // **`.mlpx` 안의 경로를 그대로 쓴다.** 글이 사진을 `attachments/3.webp`이라는 상대
  // 경로로 가리키므로(`renderPortfolioMarkdown`), 글과 사진이 파일에서와 같은 자리에
  // 있어야 푼 뒤에도 사진이 보인다.
  //
  // **글이 가리키는 사진만 담는다** — 뗀 사진의 바이트가 파일에 남아 있을 수 있고,
  // 그것까지 담으면 `writeProject`가 버리는 것을 여기서 되살리는 셈이다.
  const wanted = new Set(Object.values(document.portfolio.attachments).flat())
  for (const [path, bytes] of attachments) {
    if (wanted.has(path)) files[`${folder}/${path}`] = bytes
  }
  return files
}

/**
 * 묶음을 굽는다. **이름은 부르는 쪽이 짓는다** — 내려받기는 화면의 일이다.
 *
 * **동기로 굽는다.** 포트폴리오 글과 첨부만 들어가므로 정본 표와 사진이 든 `.mlpx`와는
 * 자릿수가 다르다 — 그 큰 것을 굽는 자리는 `writeProject`의 흐름 압축이다.
 */
export function bundleOf(
  entries: readonly BundleEntry[],
  translate: Translate,
  locale: string,
): Blob {
  const files: Record<string, Uint8Array> = {}
  for (const entry of entries) Object.assign(files, entriesOf(entry, translate, locale))
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
}
