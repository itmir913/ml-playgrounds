/**
 * 학생이 올린 것을 **"어느 범주의 사진 몇 장"으로 읽는 자리.** 굽지는 않는다 —
 * 굽는 것은 워커이고(`client.ts`), 여기는 무엇을 구울지만 정한다.
 *
 * **라벨은 폴더가 갖는다** (open-decisions.md "이미지 프로젝트의 데이터 화면"). 매핑
 * 테이블이 없으므로 zip의 구조가 유일한 출처이고, 그 구조를 읽는 규칙이 전부 여기 있다.
 *
 * **여기서 조용히 틀리면 사진이 다른 라벨로 학습된다.** 화면에는 아무것도 안 보이고
 * 정확도만 낮게 나온다 — 학생이 원인을 찾을 방법이 없는 종류다. 그래서 순수 함수로
 * 두고 검사가 규칙 하나하나를 본다.
 */

import { unzip, type Unzipped } from 'fflate'

import { ClientError } from '@/errors'
import { IMAGE_UNLABELED } from '@/project/format'
import { isValidCategoryName } from './canonical'

/** 구울 후보 한 장. 아직 사진인지 아닌지는 모른다 — 그건 구워 봐야 안다. */
export interface UploadItem {
  /**
   * 꾸러미 안에서의 경로. **유일하다.**
   *
   * 굽는 워커에 넘기는 `File`의 이름이 이 값이고, 구워져 돌아온 결과를 다시 범주에
   * 잇는 열쇠다 (`CanonicalImage.sourceName`). 파일 이름만 쓰면 `개/1.jpg`와
   * `고양이/1.jpg`가 같은 열쇠가 되어 **한쪽 라벨이 다른 쪽을 덮는다.**
   */
  readonly path: string
  /**
   * 굽는 워커에 넘길 것. **`file.name`이 위 `path`와 같다** — 워커는 그 이름을
   * `sourceName`으로 되돌려 주고, 부르는 쪽은 그것으로 다시 범주를 찾는다.
   * 파일 이름(`1.jpg`)을 그대로 두면 그 열쇠가 범주 사이에서 겹친다.
   */
  readonly file: File
  /** 이 사진이 들어갈 범주. `_unlabeled`면 아직 안 정한 상태다. */
  readonly category: string
}

/**
 * 압축 프로그램이 넣는 부스러기. **조용히 버린다.**
 *
 * 맥에서 압축하면 `__MACOSX/`가 반드시 생기고, 그걸 폴더로 읽으면 뜻 모를 범주가 하나
 * 뜬다. 학생은 자기가 만들지 않은 이름을 보고 무엇을 잘못했는지 찾게 된다.
 */
/**
 * 꾸러미가 준 경로를 **우리 규칙 하나로** 맞춘다. **입구에서 한 번만 한다** —
 * 아래 함수들이 각자 다듬으면 반드시 한쪽만 고쳐진다.
 *
 * 둘을 맞춘다 (V11 R1 감사 B-6·B-8).
 *
 * - **구분자.** zip 규격은 `/`를 요구하지만 그렇게 안 만드는 도구가 있다. `\`가 오면
 *   경로에 폴더가 없는 것으로 읽혀 **범주가 통째로 사라지고 사진이 전부 라벨 없음으로
 *   떨어졌다.**
 * - **유니코드 정규화.** 맥이 만든 zip은 한글 이름을 NFD(자모 분해)로 넣는다. 그러면
 *   **화면에 똑같이 보이는 범주가 둘** 생기고, `.mlpx` 안에 `dataset/data/강아지/`가 두 벌
 *   담긴다 — 윈도우 탐색기에서 풀면 하나로 합쳐지며 `hashes.json`이 디스크와 어긋난다.
 *   2026-08-15에 실물 파일이 물어 온 "끝이 마침표인 범주"와 **같은 실패 가족**이다.
 *   길이 상한도 NFD로는 같은 이름이 두 배로 세어져 51자 이상의 한글 범주가 통째로 거부됐다.
 *
 * **NFC를 고르는 이유는 그것이 파일 이름의 표준 형태이기 때문이다** — 윈도우·리눅스가
 * 그렇게 쓰고, 파이썬의 `ImageFolder`가 읽는 것도 디스크에 앉은 그 이름이다.
 */
function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').normalize('NFC')
}

function isJunk(path: string): boolean {
  const segments = path.split('/')
  if (segments.includes('__MACOSX')) return true
  const name = segments[segments.length - 1] ?? ''
  return name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._')
}

/**
 * 한 겹 감싸진 꾸러미를 벗긴다. **한 번만이다.**
 *
 * **윈도우 탐색기에서 폴더를 우클릭해 압축하면 반드시 이 모양이 나온다** — 거부하면
 * 교실에서 가장 흔한 zip이 통째로 막히고, 학생은 자기가 늘 하던 방법이 왜 안 되는지
 * 알 수 없다.
 *
 * 벗기는 조건이 둘인 이유는 **감싼 폴더와 범주 폴더가 겉보기에 같기** 때문이다.
 * `개/`만 든 zip은 범주가 하나인 정상적인 꾸러미이지 감싸진 것이 아니다 — 그래서
 * 벗긴 뒤에도 폴더가 남아 있을 때만 벗긴다.
 */
function unwrapOnce(paths: readonly string[]): readonly string[] {
  const roots = new Set<string>()
  for (const path of paths) {
    const slash = path.indexOf('/')
    // 루트에 파일이 있으면 감싼 것이 아니다. 벗기면 그 파일이 갈 곳이 없어진다.
    if (slash < 0) return paths
    roots.add(path.slice(0, slash))
  }
  const [only] = [...roots]
  if (roots.size !== 1 || only === undefined) return paths
  const stripped = paths.map((path) => path.slice(only.length + 1))
  return stripped.some((path) => path.includes('/')) ? stripped : paths
}

/**
 * 경로 하나가 어느 범주인가.
 *
 * **더 깊은 중첩은 최상위 폴더로 흡수한다** — `개/산책/1.jpg`는 범주 "개"다.
 * `ImageFolder`와 `image_dataset_from_directory`가 실제로 재귀로 훑고 최상위를
 * 클래스로 삼으므로, 여기서 거부하면 **우리가 파이썬보다 까다로워진다.**
 *
 * 폴더 없이 놓인 파일은 `fallback`으로 간다. 군집만 하려는 학생의 자연스러운 zip이고,
 * 그 자리는 사진을 끌어다 떨어뜨린 범주 칸이다.
 */
function categoryOf(path: string, fallback: string): string {
  const slash = path.indexOf('/')
  return slash < 0 ? fallback : path.slice(0, slash)
}

/**
 * 범주로 쓸 수 있는 이름인지 전부 확인한다. **하나라도 안 되면 통째로 거부한다.**
 *
 * 다듬어서 받지 않는 이유는, 다듬으면 서로 다른 폴더 둘이 한 범주로 합쳐질 수 있고
 * 그건 **라벨이 조용히 바뀌는 것**이기 때문이다. 학생이 할 일은 폴더 이름을 고쳐
 * 다시 압축하는 것이고, 그건 화면이 이름을 대 주면 할 수 있는 일이다.
 */
function requireValidCategories(categories: Iterable<string>): void {
  for (const category of categories) {
    if (category === IMAGE_UNLABELED || isValidCategoryName(category)) continue
    throw new ClientError('IMAGE_CATEGORY_NAME_INVALID', { name: category })
  }
}

function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, unzipped) => {
      // zip이 아니거나 깨졌다. 어느 쪽이든 학생이 할 일은 다시 압축하는 것이다.
      if (error) reject(new ClientError('IMAGE_ZIP_INVALID'))
      else resolve(unzipped)
    })
  })
}

/**
 * 사진 꾸러미(zip)를 읽는다. **굽기 전에 학생에게 보여줄 것이 여기서 나온다.**
 *
 * 규칙은 open-decisions.md "zip 읽기 규칙 다섯"이고 순서가 뜻을 갖는다 — 부스러기를
 * 먼저 버려야 `__MACOSX/`가 "루트의 폴더"로 세어지지 않는다.
 *
 * **여기서 사진인지는 안 가린다.** 확장자로 거르면 확장자가 틀린 사진을 버리게 되고,
 * 굽는 워커가 어차피 한 장씩 판정해 못 읽은 것을 돌려준다 — 화면은 그걸로 "몇 장이
 * 빠졌는지"를 말한다.
 */
export async function readImageZip(
  bytes: Uint8Array,
  fallbackCategory: string = IMAGE_UNLABELED,
): Promise<readonly UploadItem[]> {
  const unzipped = await unzipAsync(bytes)
  const entries = Object.entries(unzipped)
    // **경로를 먼저 우리 규칙으로 맞춘다.** 부스러기 판정도 정규화된 경로로 해야
    // `__MACOSX\`처럼 구분자가 다른 것을 놓치지 않는다.
    .map(([path, content]) => [normalizePath(path), content] as const)
    .filter(
      // 디렉터리 엔트리는 내용이 없다. 빈 폴더는 범주가 되지 않는다 - 범주 목록은
      // settings가 따로 갖는다 (open-decisions.md "범주는 폴더가 갖고").
      ([path, content]) => !path.endsWith('/') && content.length > 0 && !isJunk(path),
    )
  if (entries.length === 0) throw new ClientError('IMAGE_ZIP_NO_IMAGES')

  const paths = unwrapOnce(entries.map(([path]) => path))
  const items = paths.map((path, index) => {
    const content = entries[index]?.[1] ?? new Uint8Array()
    return {
      path,
      category: categoryOf(path, fallbackCategory),
      // 바이트를 여기서 한 번 감싼다. 실제로 읽는 것은 워커다.
      file: new File([content], path),
    }
  })

  requireValidCategories(new Set(items.map((item) => item.category)))
  return items
}

/**
 * 파일 고르기·끌어다 놓기로 들어온 것들을 읽는다. zip이 아닌 쪽의 입구다.
 *
 * **폴더를 통째로 고르면 `webkitRelativePath`에 구조가 들어 있다** — 그러면 zip과 같은
 * 규칙으로 라벨이 나온다. 파일 몇 장만 고른 경우에는 구조가 없고, 그건 떨어뜨린 자리로
 * 간다.
 */
export function readImageFiles(
  files: readonly File[],
  fallbackCategory: string = IMAGE_UNLABELED,
): readonly UploadItem[] {
  // 폴더로 안 고른 파일에는 이 값이 빈 문자열이고, 브라우저 밖(검사)에서는 아예 없다.
  // **zip과 같은 규칙으로 맞춘다** — 맥에서 폴더를 끌어다 놓으면 여기도 NFD로 온다.
  const relative = (file: File): string => normalizePath(file.webkitRelativePath || file.name)
  const paths = unwrapOnce(files.map(relative).filter((path) => !isJunk(path)))
  const kept = files.filter((file) => !isJunk(relative(file)))

  const items = kept.map((file, index) => {
    const path = paths[index] ?? file.name
    return {
      path,
      category: categoryOf(path, fallbackCategory),
      // **이름을 경로로 바꿔 단다.** 바이트는 안 읽는다 - 같은 데이터를 가리키는 새
      // 껍데기일 뿐이다.
      file: file.name === path ? file : new File([file], path),
    }
  })

  requireValidCategories(new Set(items.map((item) => item.category)))
  return items
}

/**
 * 압축 파일의 확장자. **한 곳에서만 적는다** — 받는 자리의 `accept`와 "이게 압축
 * 파일인가"를 가르는 판정이 갈리면, 고를 수는 있는데 안 열리는 파일이 생긴다.
 */
export const ZIP_EXTENSION = '.zip'

/**
 * 사진 받는 자리가 받는 것. **압축 파일과 사진 파일을 같은 입구로 받는다** — 학생이
 * 둘 중 무엇을 들고 오는지 미리 정할 수 없다.
 */
export const IMAGE_ACCEPT = `image/*,${ZIP_EXTENSION}`

/** 범주 하나에 몇 장이 들어오는가. */
export interface UploadCount {
  readonly category: string
  readonly count: number
}

/**
 * 학생에게 보여줄 요약 — "범주 3개 · 개 12장, 고양이 15장, 새 9장".
 *
 * **굽기 전에 이걸 확인시킨다.** 중첩 흡수는 조용히 틀릴 수 있는 유일한 자리인데,
 * 이 목록이 그걸 시끄럽게 만든다 (엑셀 시트 고르기와 같은 자리다).
 *
 * `_unlabeled`는 맨 뒤다 — 범주가 아니라 상태이고, 범주들 사이에 섞여 있으면
 * 학생이 그것도 범주 하나로 읽는다.
 */
export function summarizeUpload(items: readonly UploadItem[]): readonly UploadCount[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  return [...counts]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => {
      if (left.category === IMAGE_UNLABELED) return 1
      if (right.category === IMAGE_UNLABELED) return -1
      return left.category.localeCompare(right.category)
    })
}
