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

import { ENTRY, type ProjectFile, withoutProjectExtension } from './format'
import { renderPortfolioMarkdown } from './portfolio'
import { portfolioMarkdownText, type Translate } from './portfolio-text'

/**
 * 묶음에 들어가는 제출물 하나.
 *
 * **파일 전체가 아니라 나갈 것 둘만 든다** (2026-09-18 R28-V N-1). `ProjectFile`을 통째로
 * 받던 때는 굽기가 끝날 때까지 **서른 개의 통째 파싱 결과가 동시에 살았다** — 정본 표도,
 * 모델도, 사진 바이트도 전부. zip에 실리는 것은 글과 그 글의 첨부뿐인데도 그랬다.
 *
 * **`useRoster`의 "메모리에 사는 파싱 결과가 언제나 하나다"가 이 경로에서 거짓이었다.**
 * 타입을 좁히면 컴파일이 나머지를 막는다 — 다음 사람이 `entry.file.dataset`을 읽으려는
 * 순간 선다.
 */
export interface BundleEntry {
  /** 명렬의 이름표. 폴더째 골랐으면 상대 경로다. */
  readonly label: string
  readonly file: Pick<ProjectFile, 'document' | 'attachments'>
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
  // 확장자는 제거한다 - 폴더 이름에 `.mlpx`가 붙어 있으면 푸는 쪽에서 파일로 보인다.
  // **사파리가 붙인 `.mlpx.zip`도 같은 폴더가 된다** (결정문 48) - 같은 프로젝트를
  // 두 기기에서 내보낸 것이 폴더 둘로 갈리면 교사가 같은 학생을 두 번 본다.
  return withoutProjectExtension(cleaned)
}

/**
 * 이름표들이 차지할 **서로 다른** 폴더 이름들. 순서는 받은 그대로다.
 *
 * **겹치면 뒤엣것이 조용히 덮인다** (2026-09-18 R28 C-20). `folderFor`는 확장자만 떼므로
 * 한 폴더의 `a.mlpx`와 `a.MLPX`가 같은 이름이 되는데, 그것은 리눅스에서 만들 수 있다.
 * 그때 zip은 스물아홉 폴더로 나가고 **한 학생의 글이 남의 글로 바뀌어 있다** — 교사는
 * 그 사실을 알 길이 없다.
 *
 * **던지지 않고 갈라 준다.** 내보내기는 무조건 성공해야 하는 자리라(교사가 여기서 막히면
 * 할 수 있는 일이 없다), 뒤엣것에 번호를 붙여 서로 다른 폴더로 만든다.
 *
 * **겹침은 대소문자를 안 가리고 센다.** 교사가 푸는 윈도 탐색기는 `Kim`과 `kim`을 한 폴더로
 * 합친다 — 대소문자를 가리면 zip 안에서는 둘이어도 풀면 하나가 된다. `portfolio-bundle.spec.ts`의
 * "대소문자만 다른 이름도 가른다"가 문다.
 */
export function folderNames(labels: readonly string[]): string[] {
  const used = new Set<string>()
  return labels.map((label) => {
    const base = folderFor(label)
    let name = base
    for (let index = 2; used.has(name.toLowerCase()); index += 1) name = `${base} (${index})`
    used.add(name.toLowerCase())
    return name
  })
}

/**
 * 제출물 하나가 묶음에 넣을 엔트리들.
 *
 * **글은 파일에 담긴 것을 다시 그리지 않고 지금 문서에서 그린다** — 학생이 마지막으로
 * 저장할 때 담긴 `document.md`와 같은 함수(`renderPortfolioMarkdown`)를 쓰므로 내용은
 * 같고, **머리글의 언어만 교사의 것이 된다.** 교사가 읽을 묶음이라 그쪽이 맞다.
 *
 * **폴더 이름은 받아서 쓴다.** 겹침을 가르는 일은 묶음 전체를 봐야 할 수 있으므로
 * `folderNames`가 하고, 여기는 한 제출물만 안다.
 */
export function entriesOf(
  entry: BundleEntry,
  folder: string,
  translate: Translate,
  locale: string,
): Record<string, Uint8Array> {
  const { document, attachments } = entry.file
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
  const folders = folderNames(entries.map((entry) => entry.label))
  for (const [index, entry] of entries.entries()) {
    Object.assign(
      files,
      entriesOf(entry, folders[index] ?? folderFor(entry.label), translate, locale),
    )
  }
  const zipped = zipSync(files, { level: 6 })
  return new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
}
