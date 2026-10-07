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

import { unzipSync, type UnzipFileFilter, type Unzipped } from 'fflate'

import { ClientError } from '@/errors'
import { IMAGE_ZIP_SLICE_BYTES } from '@/limits'
import { IMAGE_UNLABELED } from '@/project/format'
import { yieldToScreen } from '@/screen'
import { isNoiseName, normalizeEntryName } from '../archive-entries'
import { decodeZipNames, type ZipNameOptions } from '../zip-names'
import { categoryFolderKey, isValidCategoryName } from './canonical'
import { isImageSourcePath } from './formats'

/** 구울 후보 한 장. 아직 사진인지 아닌지는 모른다 — 그건 구워 봐야 안다. */
export interface UploadItem {
  /**
   * 압축 파일 안에서의 경로. **유일하다.**
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
 * 압축 파일이 준 경로를 **우리 규칙 하나로** 맞춘다. **입구에서 한 번만 한다** —
 * 아래 함수들이 각자 다듬으면 반드시 한쪽만 고쳐진다. 규칙 자체는 `.mlpx` 읽기와 한 벌이다
 * (`data/archive-entries.ts`의 `normalizeEntryName`).
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
 */
function normalizePath(path: string): string {
  return normalizeEntryName(path)
}

/**
 * 압축 프로그램과 OS가 넣는 부스러기. **조용히 버린다.** 이름 목록은 `.mlpx` 읽기와 한
 * 벌이다(`data/archive-entries.ts`의 `isNoiseName`).
 *
 * 맥에서 압축하면 `__MACOSX/`가 반드시 생기고, 그걸 폴더로 읽으면 뜻 모를 범주가 하나
 * 뜬다. 윈도의 `desktop.ini`는 범주 안에 있으면 사진 한 장으로 세어졌고, 루트에 있으면
 * 한 겹 벗기기를 막아 **범주 둘이 감싼 폴더 이름 하나로 합쳐졌다**(2026-09-28 감사 G G-2).
 * 무는 검사: `image-upload-zip.spec.ts`의 *"desktop.ini"* 두 줄.
 */
function isJunk(path: string): boolean {
  return isNoiseName(path)
}

/**
 * 한 겹 감싸진 압축 파일을 벗긴다. **한 번만이다.**
 *
 * **윈도우 탐색기에서 폴더를 우클릭해 압축하면 반드시 이 모양이 나온다** — 거부하면
 * 교실에서 가장 흔한 zip이 통째로 막히고, 학생은 자기가 늘 하던 방법이 왜 안 되는지
 * 알 수 없다.
 *
 * 벗기는 조건이 둘인 이유는 **감싼 폴더와 범주 폴더가 겉보기에 같기** 때문이다.
 * `개/`만 든 zip은 범주가 하나인 정상적인 압축 파일이지 감싸진 것이 아니다 — 그래서
 * 벗긴 뒤에도 폴더가 남아 있을 때만 벗긴다.
 *
 * **`.mlpx` 읽기(`format.ts`의 `isWrapped`)와 증인이 다르다 — 일부러다.** 저쪽은 파일 구조를
 * 알아서 "그 폴더에 `manifest.json`이 있다"를 증인으로 세운다. 사진 zip에는 그런 이름이
 * 없으므로 "벗긴 뒤에도 폴더가 남는가"가 증인이다. 잡음을 빼고 판정하는 것은 같다.
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
 * **폴더 이름을 라벨로 읽는가.** 화면이 정한다 — 부르는 곳이 **반드시** 적는다(기본값으로
 * 숨기면 새 화면이 말없이 한쪽 규칙을 탄다).
 *
 * 이름은 Keras `image_dataset_from_directory`의 `labels='inferred'`(최상위 폴더 = 범주)와
 * `labels=None`(라벨 없음) 관행이다. `None`은 닫힌 문자열 `'none'`으로 둔다.
 *
 * - `'inferred'`: 최상위 폴더가 범주이고 그 이름을 검사한다. 폴더 없이 놓인 파일은
 *   `fallbackCategory`(없으면 `_unlabeled`)로 간다. 데이터 화면·전처리 화면.
 * - `'none'`: 전부 `_unlabeled`이고 **이름을 검사하지 않는다.** 예측 화면 — 쓰지도 않는
 *   폴더 이름 때문에 예측 zip이 거절되던 결함이 있었다(#38 결정 7).
 *
 * 둘 다 부스러기 버리기·이름 되살리기·정규화·한 겹 벗기기는 한 벌이고, `path`는 그대로
 * 유일한 열쇠다. 무는 검사: `image-upload-zip.spec.ts`의 *"라벨을 읽지 않으면"*,
 * `image-predict-labels.spec.ts`.
 */
export type ImageLabels =
  | {
      readonly labels: 'inferred'
      readonly fallbackCategory?: string
      /** 프로젝트에 이미 있는 범주. 대소문자만 다른 폴더를 거절하는 대조표다 (R43-5 B-1 재판단). */
      readonly known?: readonly string[]
    }
  | { readonly labels: 'none' }

/** 경로마다 범주를 단다. `'inferred'`면 이름을 검사하고, 하나라도 안 되면 통째로 던진다. */
function labelItems(
  rows: readonly { readonly path: string; readonly file: File }[],
  reading: ImageLabels,
): readonly UploadItem[] {
  if (reading.labels === 'none') {
    return rows.map((row) => ({ ...row, category: IMAGE_UNLABELED }))
  }
  const fallback = reading.fallbackCategory ?? IMAGE_UNLABELED
  const items = rows.map((row) => ({ ...row, category: categoryOf(row.path, fallback) }))
  requireValidCategories(new Set(items.map((item) => item.category)), reading.known ?? [])
  return items
}

/**
 * 범주로 쓸 수 있는 이름인지 전부 확인한다. **하나라도 안 되면 통째로 거부한다.**
 *
 * 다듬어서 받지 않는 이유는, 다듬으면 서로 다른 폴더 둘이 한 범주로 합쳐질 수 있고
 * 그건 **라벨이 조용히 바뀌는 것**이기 때문이다. 학생이 할 일은 폴더 이름을 고쳐
 * 다시 압축하는 것이고, 그건 화면이 이름을 대 주면 할 수 있는 일이다.
 */
function requireValidCategories(categories: Iterable<string>, known: readonly string[]): void {
  // **대소문자만 다른 폴더도 거부한다** (R43-5 B-1, `categoryFolderKey`). 윈도우에서 풀면 한 폴더라
  // 다시 올릴 때 라벨이 합쳐진다. **이미 있는 범주와도 견준다** — `cat`이 있는 프로젝트에 `Cat/`을
  // 올리면 범주가 하나 더 생겼다(재판단). 같은 철자는 그 범주에 더하는 것이라 받는다. 접어 넣지 않고
  // 거절하는 것은 위와 같은 까닭이다 — 이름을 대 주면 학생이 고친다. 열쇠의 Set으로 세어 선형이다.
  // 옛 파일이 `cat`·`Cat`을 함께 가졌으면 둘 다 그 범주에 더하는 것이다 — 열쇠가 있고 철자도 있으면 받는다.
  const knownKeys = new Set(known.map(categoryFolderKey))
  const knownNames = new Set(known)
  const folders = new Set<string>()
  for (const category of categories) {
    if (category === IMAGE_UNLABELED) continue
    const folder = categoryFolderKey(category)
    if (
      isValidCategoryName(category) &&
      !folders.has(folder) &&
      (!knownKeys.has(folder) || knownNames.has(category))
    ) {
      folders.add(folder)
      continue
    }
    throw new ClientError('IMAGE_CATEGORY_NAME_INVALID', { name: category })
  }
}

/**
 * zip을 푼다. **워커를 띄우지 않는다** (`.mlpx` 읽기의 `format.ts` `unzipEntries`와 같은 판단,
 * open-decisions.md 68의 판례).
 *
 * fflate의 비동기 `unzip`은 비압축 512KB 이상이고 압축률이 0.8 이하인 deflate 엔트리를
 * `inflate()`로 넘겨 `blob:` 워커를 띄운다 — 무압축 BMP·TIFF가 든 사진 zip이 그 모양이다.
 * 워커 생성이 막히면 날것의 오류가 새어 "알 수 없는 오류"가 되고, 워커가 답하지 않으면
 * **읽기가 끝나지 않아 화면의 진행 잠금이 영영 안 풀린다**(2026-09-28 감사 G G-3). 그 대신
 * 메인 스레드가 inflate한다 — jpeg·png처럼 이미 압축된 사진은 비동기 API 안에서도 원래
 * 메인 스레드에서 풀렸다. 큰 BMP zip이 화면을 오래 얼리지 않게 **조각으로 풀고 사이마다
 * 양보한다.** 무는 검사: `image-upload-zip.spec.ts`의 *"워커를 띄우지 않는다"*.
 */
async function unzipEntries(bytes: Uint8Array): Promise<Unzipped> {
  // 목록만 먼저 읽는다 — 아무것도 안 푸므로 중앙 디렉터리를 한 번 훑는 값이다.
  const slices: Set<string>[] = []
  let slice = new Set<string>()
  let sliceBytes = 0
  unzipSyncOrInvalid(bytes, (file) => {
    slice.add(file.name)
    sliceBytes += file.originalSize
    if (sliceBytes >= IMAGE_ZIP_SLICE_BYTES) {
      slices.push(slice)
      slice = new Set()
      sliceBytes = 0
    }
    return false
  })
  if (slice.size > 0) slices.push(slice)

  // **조각마다 풀고 화면에 양보한다** (`screen.ts`의 `yieldToScreen`, 2026-09-28 코드 소유자).
  // 한 번에 풀면 사진 상한에 가까운 BMP zip에서 메인 스레드가 수 초 막혔다 — 조각은
  // `IMAGE_ZIP_SLICE_BYTES`만큼이라 한 번 막히는 시간이 그 크기로 묶인다. 결과는 한 번에 푼
  // 것과 같다 — 목록 순서대로 이어 붙이므로 이름 되살리기·벗기기가 보는 전체 목록이 그대로다.
  // 무는 검사: `image-upload-zip.spec.ts`의 *"조각으로 풀어도 한 번에 푼 것과 같다"*.
  const unzipped: Unzipped = {}
  for (const names of slices) {
    await yieldToScreen()
    Object.assign(
      unzipped,
      unzipSyncOrInvalid(bytes, (file) => names.has(file.name)),
    )
  }
  return unzipped
}

/** 고른 엔트리만 푼다. 깨진 zip은 학생이 알아들을 코드로 바꾼다. */
function unzipSyncOrInvalid(bytes: Uint8Array, filter: UnzipFileFilter): Unzipped {
  try {
    return unzipSync(bytes, { filter })
  } catch {
    // zip이 아니거나 깨졌다. 어느 쪽이든 학생이 할 일은 다시 압축하는 것이다.
    throw new ClientError('IMAGE_ZIP_INVALID')
  }
}

/**
 * 사진 압축 파일(zip)을 읽는다. **굽기 전에 학생에게 보여줄 것이 여기서 나온다.**
 *
 * 규칙은 open-decisions.md "zip 읽기 규칙 다섯"이고 순서가 뜻을 갖는다 — 부스러기를
 * 먼저 버려야 `__MACOSX/`가 "루트의 폴더"로 세어지지 않는다.
 *
 * **사진은 확장자로 가린다** (open-decisions.md 108, `formats.ts`의 `IMAGE_SOURCE_EXTENSIONS`). 전에는
 * 안 가리고 굽는 워커에 맡겨, 라벨 `txt`·`csv`가 장수 상한과 자리 판정에 세어졌다. 가린 것은 범주 이름을
 * 읽기 **전에** 빼고(사진 아닌 파일의 폴더 이름이 업로드를 거절하지 않게) 수만 돌려준다 — 화면이 말한다.
 * 목록 안인데 못 읽는 사진은 전처럼 워커가 한 장씩 돌려준다.
 */
export async function readImageZip(
  bytes: Uint8Array,
  reading: ImageLabels,
  names: ZipNameOptions = {},
): Promise<ImageReading> {
  const unzipped = await unzipEntries(bytes)
  const raw = Object.entries(unzipped)
  /**
   * **이름을 먼저 되살린다** (`data/zip-names.ts`). 윈도 탐색기가 만든 압축 파일은
   * 인코딩을 안 적어서 한글 폴더 이름이 `»¡°£³×¸ð`로 온다 — 그대로 두면 아래
   * `requireValidCategories`가 저 글자들을 **통과시켜** 깨진 이름의 범주가 생긴다.
   * 라벨을 안 읽어도(`'none'`) 되살린다 — `path`가 구운 결과를 되찾는 열쇠다.
   */
  const decoded = decodeZipNames(
    raw.map(([path]) => path),
    names,
  )
  const entries = raw
    // **경로를 먼저 우리 규칙으로 맞춘다.** 부스러기 판정도 정규화된 경로로 해야
    // `__MACOSX\`처럼 구분자가 다른 것을 놓치지 않는다.
    .map(([, content], index) => [normalizePath(decoded[index]!), content] as const)
    .filter(
      // 디렉터리 엔트리는 내용이 없다. 빈 폴더는 범주가 되지 않는다 - 범주 목록은
      // settings가 따로 갖는다 (open-decisions.md "범주는 폴더가 갖고").
      // **길이 0인 파일도 버린다 — `.mlpx` 읽기와 일부러 다르다.** 빈 파일은 사진일 수
      // 없다. 저쪽(`format.ts`의 `isArchiveNoise`)은 잘린 엔트리가 변조의 흔적이라 남긴다.
      ([path, content]) => !path.endsWith('/') && content.length > 0 && !isJunk(path),
    )
  // 사진이 아닌 것은 한 겹 벗기기 **전에** 뺀다 — 루트의 `readme.txt`가 감싼 폴더를 벗기지 못하게 하지 않는다.
  const images = entries.filter(([path]) => isImageSourcePath(path))
  if (images.length === 0) throw new ClientError('IMAGE_ZIP_NO_IMAGES')

  const paths = unwrapOnce(images.map(([path]) => path))
  const rows = paths.map((path, index) => {
    const content = images[index]?.[1] ?? new Uint8Array()
    // 바이트를 여기서 한 번 감싼다. 실제로 읽는 것은 워커다.
    return { path, file: new File([content], path) }
  })
  return { items: labelItems(rows, reading), notImages: entries.length - images.length }
}

/**
 * 파일 고르기·끌어다 놓기로 들어온 것들을 읽는다. zip이 아닌 쪽의 입구다.
 *
 * **폴더를 통째로 고르면 `webkitRelativePath`에 구조가 들어 있다** — 그러면 zip과 같은
 * 규칙으로 라벨이 나온다. 파일 몇 장만 고른 경우에는 구조가 없고, 그건 떨어뜨린 자리로
 * 간다.
 */
export function readImageFiles(files: readonly File[], reading: ImageLabels): ImageReading {
  // 폴더로 안 고른 파일에는 이 값이 빈 문자열이고, 브라우저 밖(검사)에서는 아예 없다.
  // **zip과 같은 규칙으로 맞춘다** — 맥에서 폴더를 끌어다 놓으면 여기도 NFD로 온다.
  // 사진이 아닌 것도 zip처럼 벗기기 전에 뺀다(open-decisions.md 108).
  const relative = (file: File): string => normalizePath(file.webkitRelativePath || file.name)
  const real = files.filter((file) => !isJunk(relative(file)))
  const kept = real.filter((file) => isImageSourcePath(relative(file)))
  const paths = unwrapOnce(kept.map(relative))

  const rows = kept.map((file, index) => {
    const path = paths[index] ?? file.name
    return {
      path,
      // **이름을 경로로 바꿔 단다.** 바이트는 안 읽는다 - 같은 데이터를 가리키는 새
      // 껍데기일 뿐이다.
      file: file.name === path ? file : new File([file], path),
    }
  })
  return { items: labelItems(rows, reading), notImages: real.length - kept.length }
}

/**
 * 읽은 사진과 **사진이 아니라 건너뛴 파일의 수**(open-decisions.md 108). 부스러기(`__MACOSX`·`.DS_Store`)는
 * 학생이 고른 것이 아니라 세지 않는다.
 */
export interface ImageReading {
  readonly items: readonly UploadItem[]
  readonly notImages: number
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
