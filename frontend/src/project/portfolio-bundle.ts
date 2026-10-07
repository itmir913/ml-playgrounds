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

import { ClientError } from '../errors'
import { escapesArchive } from './entry-path'
import {
  ENTRY,
  fitsInArchive,
  type ProjectFile,
  withoutProjectExtension,
  zipModifiedTime,
} from './format'
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
 * 이름 없는 제출물의 순번 앞에 붙는 표지(`folderFor`). **`#`이 아니라 `_`다**(2026-09-29, 코드 소유자) —
 * `'file://' + 경로`로 주소를 짓는 뷰어는 `#`에서 주소를 잘라 `document.md`의 상대 링크가 깨지고,
 * 셸은 단어 맨 앞의 `#`을 주석으로 읽는다(`cd #2`). `_`는 주소에도 셸에도 뜻이 없다.
 */
const UNNAMED_FOLDER_MARK = '_'

/**
 * 묶음 안에서 이 제출물이 차지할 폴더 이름.
 *
 * **이름표에서 만든다.** 학번·이름은 안 적은 학생이 있고(선택 입력이다), 그때 남는 것이
 * 파일 이름뿐이다. 경로 구분자는 폴더가 되게 두되 `..`는 걷어낸다 — 우리가 만드는
 * zip이지만, 푸는 쪽이 그 이름을 그대로 쓴다.
 *
 * **빈 이름을 내지 않는다.** 이름표가 `.mlpx`뿐이거나 `..`뿐이면 걷어내고 남는 것이 없는데,
 * 그대로 두면 엔트리가 `/portfolio/document.md`라는 **절대 경로**가 된다(2026-09-28 감사 D
 * C-5). 그때는 명렬의 순번(`position`, 1부터)에 표지를 붙인 것이 폴더 이름이다(`_2`) — 숫자라
 * 번역할 말이 없고, 겹치면 `folderNames`가 갈라 준다. `portfolio-bundle.spec.ts`의 *"남는 이름이
 * 없으면 순번"*이 문다.
 *
 * **맨 순번이 아니라 표지를 단다** (architecture.md §8.21, 코드 소유자 결정 12). 맨 순번이면 이름
 * 없는 제출물이 폴더 `2`를 먼저 차지해 이름표가 `2.mlpx`인 학생이 `2 (2)`로 밀렸다. 표지 붙은
 * 이름이 이름표에서 나오려면 파일 이름이 `_2.mlpx`여야 한다 — 막을 수는 없고(`_`은 세 운영체제가
 * 다 받는 글자다, `data/file-name-rules.ts`) 겹치면 여전히 번호로 갈린다.
 */
export function folderFor(label: string, position: number): string {
  const parts = label.split(/[\\/]+/).filter((part) => part !== '' && part !== '.' && part !== '..')
  // 확장자는 마지막 조각에서 제거한다 - 폴더 이름에 `.mlpx`가 붙어 있으면 푸는 쪽에서 파일로
  // 보인다. **사파리가 붙인 `.mlpx.zip`도 같은 폴더가 된다** (결정문 48) - 같은 프로젝트를
  // 두 기기에서 내보낸 것이 폴더 둘로 갈리면 교사가 같은 학생을 두 번 본다. 떼고 나서 빈
  // 조각이나 `.`·`..`가 되면(`1반/.mlpx`, `..mlpx`) 그 조각은 버린다.
  const last = parts.pop()
  const stem = last === undefined ? '' : withoutProjectExtension(last)
  if (stem !== '' && stem !== '.' && stem !== '..') parts.push(stem)
  return parts.length > 0 ? parts.join('/') : `${UNNAMED_FOLDER_MARK}${position}`
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
 * "대소문자만 다른 이름도 가른다"가 문다. 대문자로 견주는 것은 NTFS가 대문자 표로 견주기
 * 때문이다(`σ`·`ς`가 한 폴더가 된다는 것은 추론이고 탐색기로 재지 않았다).
 */
export function folderNames(labels: readonly string[]): string[] {
  const used = new Set<string>()
  // **이름마다 다음에 시도할 번호를 기억한다** (R43-1 감사 C-1의 이웃) — `distinctLabels`(`roster.ts`)와 같다.
  // 열쇠는 대문자다: 대소문자만 다른 두 이름은 같은 번호 줄을 나눠 쓴다.
  const nextIndex = new Map<string, number>()
  return labels.map((label, order) => {
    const base = folderFor(label, order + 1)
    const key = base.toUpperCase()
    let name = base
    let index = nextIndex.get(key) ?? 2
    if (used.has(name.toUpperCase())) {
      name = `${base} (${index})`
      while (used.has(name.toUpperCase())) {
        index += 1
        name = `${base} (${index})`
      }
      nextIndex.set(key, index + 1)
    }
    used.add(name.toUpperCase())
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
  //
  // **푸는 자리 밖으로 새는 경로는 안 싣는다** (2026-09-28 감사 D A-2). 학생 파일은 읽을 때
  // 첨부 경로를 안 거르므로 `portfolio/attachments/../../x.cmd`가 여기까지 오고, 이 zip은
  // **우리가 지어 교사에게 주는 것**이다. 판정은 `requirePathUnder`와 같은 함수다.
  // `portfolio-bundle.spec.ts`의 *"푸는 자리 밖으로 새는 첨부는 안 싣는다"*가 문다.
  const wanted = new Set(Object.values(document.portfolio.attachments).flat())
  for (const [path, bytes] of attachments) {
    if (wanted.has(path) && !escapesArchive(path)) files[`${folder}/${path}`] = bytes
  }
  return files
}

/**
 * 묶음을 굽는다. **이름은 부르는 쪽이 짓는다** — 내려받기는 화면의 일이다.
 *
 * **동기로 굽는다.** 포트폴리오 글과 첨부만 들어가므로 정본 표와 사진이 든 `.mlpx`와는
 * 자릿수가 다르다 — 그 큰 것을 굽는 자리는 `writeProject`의 흐름 쓰기(`zipToBlob`)다. 둘 다 누르지 않는다.
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
      entriesOf(entry, folders[index] ?? folderFor(entry.label, index + 1), translate, locale),
    )
  }
  // **엔트리 수 한계 안에서만 쓴다** (open-decisions.md ".mlpx 한 파일의 엔트리 수는 ZIP64 없이 쓸
  // 수 있는 만큼이다"의 코드 소유자 후속). fflate는 이 zip에도 ZIP64를 안 쓰고 끝 레코드의 칸에 아래
  // 16비트만 적는다 — 넘은 채로 내보내면 푸는 쪽이 제출물을 말없이 빠뜨린다. 던지면 점검 화면이
  // 알린다(`InspectView.vue`의 `downloadPortfolios`). 한계 안의 묶음은 이 줄 전과 바이트가 같다(한 번
  // 재었다 — 무는 검사 없음, 사람 확인).
  // 무는 검사: `portfolio-bundle.spec.ts`의 *"묶음 엔트리 수"*.
  if (!fitsInArchive(Object.keys(files).length)) {
    throw new ClientError('PORTFOLIO_BUNDLE_TOO_MANY_ENTRIES')
  }
  // 시각은 zip이 담을 수 있는 해로 당긴다 — 밖이면 fflate가 던진다 (`format.ts`의
  // `zipModifiedTime`). 무는 검사: `portfolio-bundle.spec.ts`의 *"기기 시계가 …여도 묶는다"*.
  //
  // **아무것도 누르지 않는다 — `level: 0`은 무압축(STORE)이다** (open-decisions.md 107). 첨부는 이미 구운
  // webp·jpeg라 줄지 않고, 누르면 메인 스레드가 그만큼 멈춘다 — 30명 × 5MB에 7,717ms였다(R43-1 감사 B-1).
  // `.mlpx`가 같은 이유로 누르지 않는다(결정 68). 무는 검사: `portfolio-bundle.spec.ts`의
  // *"묶음은 아무것도 누르지 않는다"*.
  const zipped = zipSync(files, { level: 0, mtime: zipModifiedTime() })
  return new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
}
