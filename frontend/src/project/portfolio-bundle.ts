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
 * **담는 것은 읽은 것뿐이다** — 포트폴리오 글과 그 글이 가리키는 사진, 그리고 맨 위의 `index.csv`.
 *
 * **묶음은 평평하다** (open-decisions.md 114). 제출물마다 폴더 하나(`10213 홍길동 - 붓꽃 분류/`)에
 * `document.md`와 `attachments/`다. 무는 검사: `portfolio-bundle.spec.ts`의 *"결정 114"* 묶음.
 */

import { zipSync } from 'fflate'

import { toCanonicalCsv } from '../data/serialize'
import {
  CONTROL_CHARACTERS,
  escapeWindowsReserved,
  FORBIDDEN_IN_NAME,
  stripInvisibleFormatting,
} from '../data/file-name-rules'
import { ClientError } from '../errors'
import { escapesArchive } from './entry-path'
import {
  DIR,
  ENTRY,
  fitsInArchive,
  fitStem,
  type ProjectFile,
  withoutProjectExtension,
  zipModifiedTime,
} from './format'
import { isAppAttachmentPath, renderPortfolioMarkdown } from './portfolio'
import { portfolioMarkdownText, type Translate } from './portfolio-text'

/**
 * 묶음 맨 위에서 폴더와 원본 파일을 잇는 표. **이름도 열 머리도 번역하지 않는다** — 스크립트와 엑셀 수식이
 * 언어와 상관없이 같은 열을 가리켜야 한다(`i18n.md`). 열 이름은 manifest의 이름을 따른다.
 */
export const BUNDLE_INDEX = 'index.csv'
export const BUNDLE_INDEX_COLUMNS = [
  'folder',
  'studentId',
  'studentName',
  'projectName',
  'source',
] as const

/** 묶음 안의 글 이름. **`.mlpx` 안의 이름과 같다** — 폴더 이름을 되풀이하면 경로가 두 배가 된다(결정 114). */
const BUNDLE_MARKDOWN = ENTRY.portfolioMarkdown.slice(DIR.portfolio.length)

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
 *
 * **못 읽은 제출물은 `file`이 없다** — 폴더는 안 서고 `index.csv`에 폴더 칸이 빈 줄만 선다(결정 114).
 */
export interface BundleEntry {
  /** 명렬의 이름표. 폴더째 골랐으면 상대 경로다. */
  readonly label: string
  /** **교사가 고친 값을 얹은** 학번·이름(`roster.ts`의 `withEdit`). 빈 값은 없는 것이다. */
  readonly studentId?: string
  readonly studentName?: string
  readonly file?: Pick<ProjectFile, 'document' | 'attachments'>
}

/** 폴더 이름을 짓는 재료. 제목은 학생이 붙인 프로젝트 이름(`manifest.name`)이다. */
export interface FolderSource {
  readonly label: string
  readonly studentId?: string
  readonly studentName?: string
  readonly title?: string
}

/**
 * 이름 없는 제출물의 순번 앞에 붙는 표지(`folderFor`). **`#`이 아니라 `_`다**(2026-09-29, 코드 소유자) —
 * `'file://' + 경로`로 주소를 짓는 뷰어는 `#`에서 주소를 잘라 `document.md`의 상대 링크가 깨지고,
 * 셸은 단어 맨 앞의 `#`을 주석으로 읽는다(`cd #2`). `_`는 주소에도 셸에도 뜻이 없다.
 */
const UNNAMED_FOLDER_MARK = '_'

/** 학번과 이름 사이, 그리고 사람과 제목 사이 (결정 114). 가운뎃점은 쓰지 않는다. */
const WHO_SEPARATOR = ' '
const TITLE_SEPARATOR = ' - '

/**
 * 묶음 안에서 이 제출물이 차지할 폴더 이름. **한 단계다** — 경로 구분자는 폴더를 안 만든다.
 *
 * **학번·이름·제목에서 만든다** (open-decisions.md 114). `[학번, 이름]`의 빈 것을 빼고 공백으로, 그것과 제목을
 * 빈 것을 빼고 ` - `로 잇는다(`10213 홍길동 - 붓꽃 분류`, `10213 - 붓꽃`, `감귤`). 셋 다 없으면 이름표의
 * **파일 이름**이다 — 상위 폴더(`1반/`)는 버리고, 원래 경로는 `index.csv`의 `source`가 말한다.
 *
 * **빈 이름을 내지 않는다.** 그대로 두면 엔트리가 `/document.md`라는 **절대 경로**가 된다(2026-09-28 감사 D
 * C-5). 그때는 명렬의 순번(`position`, 1부터)에 표지를 붙인 것이 폴더 이름이다(`_2`) — 숫자라 번역할 말이
 * 없고, 겹치면 `folderNames`가 갈라 준다. `portfolio-bundle.spec.ts`의 *"남는 이름이 없으면 순번"*이 문다.
 *
 * **맨 순번이 아니라 표지를 단다** (architecture.md §8.21, 코드 소유자 결정 12). 맨 순번이면 이름 없는 제출물이
 * 폴더 `2`를 먼저 차지해 이름이 `2`인 학생이 `2 (2)`로 밀렸다.
 */
export function folderFor(source: FolderSource, position: number): string {
  const who = [source.studentId, source.studentName]
    .map(folderSegment)
    .filter((part) => part !== '')
    .join(WHO_SEPARATOR)
  const named = [who, folderSegment(source.title)]
    .filter((part) => part !== '')
    .join(TITLE_SEPARATOR)
  // 확장자는 떼고 쓴다 - 폴더 이름에 `.mlpx`가 붙어 있으면 푸는 쪽에서 파일로 보인다. **사파리가 붙인
  // `.mlpx.zip`도 같은 폴더가 된다** (결정문 48).
  const base =
    named !== '' ? named : folderSegment(withoutProjectExtension(lastSegment(source.label)))
  const fitted = fitFolder(base, '')
  return fitted !== '' ? fitted : `${UNNAMED_FOLDER_MARK}${String(position)}`
}

/** 이름표의 마지막 조각. 탐색기가 주는 상대 경로는 역슬래시일 수 있다. */
function lastSegment(label: string): string {
  return label.split(/[\\/]+/).pop() ?? ''
}

/**
 * 폴더 이름 한 조각을 **세 운영체제가 다 푸는 이름**으로 고친다 (0.35.2 경계 감사 C C-1). 이름표·학번·이름·제목은 리눅스·맥·아이패드에서
 * 지은 것이라 윈도가 못 쓰는 글자가 올 수 있다 — `a:b.mlpx` 하나가 든 묶음을 윈도 `Expand-Archive`는 **통째로 안 풀었고**,
 * 파이썬·bsdtar는 말없이 글자를 바꿔 `q?`와 `q*`를 한 폴더로 합쳐 뒤엣것이 앞엣것을 덮었다(감사자 실측, Windows 11).
 * `/`도 걷는다 — 제목의 `/`가 폴더를 만들면 안 된다.
 *
 * **거부하지 않고 걷는다** — 반출 경로라 묶음은 늘 나가야 한다(`data/file-name-rules.ts`). 무엇을 못 쓰는지는 그 파일과 한 벌이고,
 * 걷는 방식은 내려받는 `.mlpx`의 이름(`project/format.ts`의 `sanitizeSegment`)과 같다 — 다만 **공백은 남긴다**(`1반 홍길동`은
 * 교사가 읽는 폴더 이름이다). 걸은 뒤의 겹침은 `folderNames`가 가른다. 무는 검사: `portfolio-bundle.spec.ts`의
 * *"윈도가 못 푸는 글자를 걷는다"*.
 */
function folderSegment(part: string | undefined): string {
  if (part === undefined) return ''
  return tidyEnds(
    [...stripInvisibleFormatting(part)]
      .filter(
        (character) =>
          !CONTROL_CHARACTERS.test(character) && !FORBIDDEN_IN_NAME.includes(character),
      )
      .join(''),
  )
}

/** 앞의 점은 숨김 폴더를 만들고, 끝의 점·공백은 윈도가 떼어 다른 폴더와 합친다. 앞의 공백은 읽는 눈에 안 보인다. */
function tidyEnds(name: string): string {
  return name.replace(/^[. ]+/, '').replace(/[. ]+$/, '')
}

/**
 * 폴더 이름을 한 토막의 한계 안으로 자른다 — 꼬리(`tail`, 겹침 번호)까지 합쳐 `MAX_FILE_NAME_BYTES`(`format.ts`의 `fitStem`).
 *
 * **자른 뒤에 다시 걷고 다시 피한다.** 자른 자리가 `홍길동 -` 뒤의 공백이면 윈도가 그 공백을 떼고, 자른 결과가 `CON`이면 예약
 * 이름이다. 두 번 피하기는 `projectFileName`과 같은 까닭이다 — 둘째 피하기가 더한 `_`가 한계를 넘으면 둘째 자르기가 덜어 낸다.
 * 무는 검사: `portfolio-bundle.spec.ts`의 *"긴 제목은 한 토막의 한계 안으로 자른다"*.
 */
function fitFolder(base: string, tail: string): string {
  const once = tidyEnds(fitStem(escapeWindowsReserved(tidyEnds(base)), tail))
  return tidyEnds(fitStem(escapeWindowsReserved(once), tail))
}

/**
 * 제출물들이 차지할 **서로 다른** 폴더 이름들. 순서는 받은 그대로다 — **번호는 뒤엣것이 받는다.** 부르는 쪽이
 * 화면에 보이는 정렬로 넘긴다(`InspectView.vue`의 `downloadPortfolios`).
 *
 * **겹치면 뒤엣것이 조용히 덮인다** (2026-09-18 R28 C-20). 같은 학생이 같은 제목으로 두 번 냈거나, 이름표만 남은 두
 * 제출물이 다른 반의 같은 파일 이름이면 그렇다. 그때 zip은 스물아홉 폴더로 나가고 **한 학생의 글이 남의 글로 바뀌어
 * 있다** — 교사는 그 사실을 알 길이 없다.
 *
 * **던지지 않고 갈라 준다.** 내보내기는 무조건 성공해야 하는 자리라(교사가 여기서 막히면 할 수 있는 일이 없다), 뒤엣것에
 * 번호를 붙여 서로 다른 폴더로 만든다. **원래 있는 이름을 먼저 잡아 둔다** — `kim (2)`라는 제목이 뒤에 오면 그 자리를
 * 붙인 번호가 뺏으면 안 된다(`roster.ts`의 `distinctLabels`와 같은 꼴). 맨 위의 `index.csv`도 미리 잡힌 이름이다.
 *
 * **겹침은 대소문자를 안 가리고 센다.** 교사가 푸는 윈도 탐색기는 `Kim`과 `kim`을 한 폴더로 합친다 — 대소문자를 가리면
 * zip 안에서는 둘이어도 풀면 하나가 된다. 대문자로 견주는 것은 NTFS가 대문자 표로 견주기 때문이다(`σ`·`ς`가 한 폴더가 된다는
 * 것은 추론이고 탐색기로 재지 않았다). 무는 검사: `portfolio-bundle.spec.ts`의 *"폴더 이름은 서로 다르다"* 묶음.
 */
export function folderNames(sources: readonly FolderSource[]): string[] {
  const bases = sources.map((source, order) => folderFor(source, order + 1))
  const taken = new Set([BUNDLE_INDEX, ...bases].map((name) => name.toUpperCase()))
  const seen = new Set([BUNDLE_INDEX.toUpperCase()])
  // **이름마다 다음에 시도할 번호를 기억한다** (R43-1 감사 C-1의 이웃) — 매번 2부터 세면 같은 이름 N개가 N²이다.
  // 열쇠는 대문자다: 대소문자만 다른 두 이름은 같은 번호 줄을 나눠 쓴다.
  const nextIndex = new Map<string, number>()
  return bases.map((base) => {
    const key = base.toUpperCase()
    if (!seen.has(key)) {
      seen.add(key)
      return base
    }
    let index = nextIndex.get(key) ?? 2
    let name = numbered(base, index)
    while (taken.has(name.toUpperCase())) {
      index += 1
      name = numbered(base, index)
    }
    nextIndex.set(key, index + 1)
    taken.add(name.toUpperCase())
    seen.add(name.toUpperCase())
    return name
  })
}

/** 겹침 번호를 붙인 이름. **번호까지 합쳐 한계 안이다** — 번호의 자리를 지어낸 숫자로 비워 두지 않고 다시 자른다. */
function numbered(base: string, index: number): string {
  const tail = ` (${String(index)})`
  return `${fitFolder(base, tail)}${tail}`
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
  file: Pick<ProjectFile, 'document' | 'attachments'>,
  folder: string,
  translate: Translate,
  locale: string,
): Record<string, Uint8Array> {
  const { document, attachments } = file
  const markdown = renderPortfolioMarkdown(
    portfolioMarkdownText(document.manifest, translate, locale),
    document.portfolio,
  )

  const files: Record<string, Uint8Array> = {
    [`${folder}/${BUNDLE_MARKDOWN}`]: new TextEncoder().encode(markdown),
  }
  // **글과 사진의 자리 관계는 `.mlpx` 안과 같다** — 글이 사진을 `attachments/3.webp`이라는 상대 경로로
  // 가리키므로(`renderPortfolioMarkdown`), 둘 다 `portfolio/`를 떼고 폴더 바로 아래에 둔다.
  //
  // **글이 링크하는 사진만 담는다** — 고르는 판정이 글을 그리는 쪽과 같다(`isAppAttachmentPath`, 결정 93). 뗀
  // 사진의 바이트가 파일에 남아 있을 수 있고, 그것까지 담으면 `writeProject`가 버리는 것을 여기서 되살리는 셈이다.
  //
  // **푸는 자리 밖으로 새는 경로는 안 싣는다** (2026-09-28 감사 D A-2). 앱이 지은 모양이면 새지 않지만, 판정을 한
  // 겹 더 둔다 — 이 zip은 **우리가 지어 교사에게 주는 것**이다. `portfolio-bundle.spec.ts`의 *"푸는 자리 밖으로
  // 새는 첨부는 안 싣는다"*가 문다.
  const wanted = new Set(Object.values(document.portfolio.attachments).flat())
  for (const [path, bytes] of attachments) {
    if (wanted.has(path) && isAppAttachmentPath(path) && !escapesArchive(path)) {
      files[`${folder}/${path.slice(DIR.portfolio.length)}`] = bytes
    }
  }
  return files
}

/**
 * 맨 위의 `index.csv`. **줄은 받은 순서이고, 못 읽은 제출물도 폴더 칸을 비운 채 한 줄이다** — 교사가 누가 빠졌는지
 * 이 표 하나로 안다(결정 114). 값은 걷기 전의 것이다 — 폴더 이름은 윈도가 못 쓰는 글자를 걷었지만 여기는 학생이 적은
 * 그대로다. **수식 머리는 가리지 않는다** — 학생 데이터를 싣는 다른 CSV와 같다(open-decisions.md 110).
 */
function indexOf(
  entries: readonly BundleEntry[],
  folders: readonly (string | undefined)[],
): Uint8Array {
  return toCanonicalCsv([
    [...BUNDLE_INDEX_COLUMNS],
    ...entries.map((entry, index) => [
      folders[index] ?? '',
      entry.studentId?.trim() ?? '',
      entry.studentName?.trim() ?? '',
      entry.file?.document.manifest.name.trim() ?? '',
      entry.label,
    ]),
  ])
}

/**
 * 묶음을 굽는다. **이름은 부르는 쪽이 짓는다** — 내려받기는 화면의 일이다. **순서도 부르는 쪽이 정한다** —
 * 겹침 번호를 누가 받는지와 `index.csv`의 줄 순서가 그것이다.
 *
 * **동기로 굽는다.** 포트폴리오 글과 첨부만 들어가므로 정본 표와 사진이 든 `.mlpx`와는
 * 자릿수가 다르다 — 그 큰 것을 굽는 자리는 `writeProject`의 흐름 쓰기(`zipToBlob`)다. 둘 다 누르지 않는다.
 */
export function bundleOf(
  entries: readonly BundleEntry[],
  translate: Translate,
  locale: string,
): Blob {
  const read = entries.filter((entry) => entry.file !== undefined)
  const names = folderNames(
    read.map((entry) => ({
      label: entry.label,
      ...(entry.studentId === undefined ? {} : { studentId: entry.studentId }),
      ...(entry.studentName === undefined ? {} : { studentName: entry.studentName }),
      ...(entry.file === undefined ? {} : { title: entry.file.document.manifest.name }),
    })),
  )
  const folderOf = new Map(read.map((entry, index) => [entry, names[index]]))
  const folders = entries.map((entry) => folderOf.get(entry))

  const files: Record<string, Uint8Array> = { [BUNDLE_INDEX]: indexOf(entries, folders) }
  for (const [index, entry] of entries.entries()) {
    const folder = folders[index]
    if (entry.file && folder !== undefined) {
      Object.assign(files, entriesOf(entry.file, folder, translate, locale))
    }
  }
  // **엔트리 수 한계 안에서만 쓴다** (open-decisions.md ".mlpx 한 파일의 엔트리 수는 ZIP64 없이 쓸
  // 수 있는 만큼이다"의 코드 소유자 후속). fflate는 이 zip에도 ZIP64를 안 쓰고 끝 레코드의 칸에 아래
  // 16비트만 적는다 — 넘은 채로 내보내면 푸는 쪽이 제출물을 말없이 빠뜨린다. 던지면 점검 화면이
  // 알린다(`InspectView.vue`의 `downloadPortfolios`). `index.csv`도 엔트리 하나로 센다.
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
