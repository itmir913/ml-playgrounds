/**
 * 정본 사진이 프로젝트에 앉고, 범주 사이를 옮겨 다니는 자리. 표의 `project/dataset.ts`에
 * 해당한다.
 *
 * **라벨은 경로가 갖는다** (mlpx-spec.md §1.2). 그래서 "범주를 옮긴다"가 곧 **맵의 열쇠를
 * 바꾸는 것**이고 바이트는 손도 안 댄다 — 이름이 정본 바이트의 해시라서 가능한 일이다.
 *
 * **범주 목록은 폴더가 표현하지 못하는 둘만 갖는다** — 빈 범주와 순서
 * (open-decisions.md "범주는 폴더가 갖고, 목록과 순서는 `settings`가 갖는다").
 * 매핑 테이블이 아니다. 둘이 갈리면 **폴더가 이긴다.**
 */

import {
  CANONICAL_EXTENSION,
  categoryOfEntry,
  imageEntryPath,
  isValidCategoryName,
  type ImageRole,
} from '@/data/image/canonical'
import { removeEmbeddings } from '@/project/embeddings'
import { IMAGE_DATA_DIR, IMAGE_UNLABELED, type ProjectFile } from '@/project/format'
import { IMAGE_JPEG_QUALITY } from '@/limits'
import { dataSettings, type Settings } from '@/project/schema'

/** 프로젝트 안에 앉아 있는 정본 한 장. */
export interface ImageEntry {
  /** 정본 바이트의 SHA-256. 프로젝트 안에서 이 사진의 신원이다. */
  readonly hash: string
  /** 지금 들어 있는 폴더. `_unlabeled`면 아직 라벨을 안 붙였다. */
  readonly category: string
  readonly path: string
  readonly bytes: Uint8Array
}

/**
 * 그 자리에 있는 사진들. **순서는 경로순이라 열 때마다 같다** — 격자가 열 때마다 다르게
 * 서면 학생은 사진이 바뀌었다고 읽는다.
 */
export function readImages(
  project: ProjectFile | null,
  role: ImageRole = 'data',
): readonly ImageEntry[] {
  if (!project) return []
  const entries: ImageEntry[] = []
  for (const [path, bytes] of [...project.images].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const category = categoryOfEntry(role, path)
    if (category === null) continue
    const name = path.slice(path.lastIndexOf('/') + 1)
    const hash = name.slice(0, name.length - CANONICAL_EXTENSION.length)
    entries.push({ hash, category, path, bytes })
  }
  return entries
}

/**
 * 화면에 세울 범주 목록. **`_unlabeled`는 안 들어간다** — 범주가 아니라 상태다.
 *
 * **둘이 갈리면 폴더가 이긴다.** 폴더에 있는데 목록에 없는 범주는 뒤에 붙이고, 목록에만
 * 있는 것은 **빈 범주로 남긴다.** 학생이 zip을 직접 열어 폴더를 넣는 일은 실제로
 * 일어나고(파이썬 관행과 같은 구조라 더 그렇다), 그때 **사진이 있는데 화면에 안 보이는
 * 쪽이 더 나쁘다.**
 */
export function imageCategories(project: ProjectFile | null): readonly string[] {
  if (!project) return []
  const listed = dataSettings('image', project.document.settings).categories
  const seen = new Set(listed)
  const extra = readImages(project)
    .map((entry) => entry.category)
    .filter((category) => category !== IMAGE_UNLABELED && !seen.has(category))
  return [...listed, ...new Set(extra)]
}

/** 범주마다 몇 장인가. 라벨 없는 것도 센다 — 화면이 그 칸을 따로 그린다. */
export function countByCategory(project: ProjectFile | null): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const category of imageCategories(project)) counts.set(category, 0)
  counts.set(IMAGE_UNLABELED, 0)
  for (const entry of readImages(project)) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  }
  return counts
}

/**
 * 설정과 사진을 함께 바꾼 새 프로젝트. **원본을 고치지 않는다** — 확정 전에 되돌릴 것이
 * 있어야 한다.
 */
function withImages(
  project: ProjectFile,
  images: Map<string, Uint8Array>,
  data: Record<string, unknown>,
  now: string,
): ProjectFile {
  const { document } = project
  return {
    ...project,
    images,
    document: {
      ...document,
      manifest: { ...document.manifest, updatedAt: now },
      // **여기서만 단언한다.** `settings.data`의 타입이 아직 유니온이 아니라 표의 것이다
      // (`schema.ts`의 `oneOf`) — 읽는 쪽은 `dataSettings('image', …)`가 파싱해서
      // 좁히므로, 좁혀지지 않는 자리는 이 쓰기 하나뿐이다.
      settings: { ...document.settings, data: data as Settings['data'] },
    },
  }
}

/** 굽고 나온 것 한 장과 그것이 갈 자리. */
export interface BakedImage {
  readonly hash: string
  readonly bytes: Uint8Array
  readonly category: string
}

export interface AddedImages {
  readonly project: ProjectFile
  readonly added: number
  /**
   * 이미 있던 사진이라 안 들어간 장수.
   *
   * **이름이 곧 내용이라 저절로 걸러진다** — 같은 zip을 두 번 올려도 장수가 두 배가 되지
   * 않는다. 그래도 세어서 말한다: 조용히 넘기면 학생은 40장을 올렸는데 12장만 늘어난
   * 것을 고장으로 본다.
   */
  readonly duplicates: number
}

export interface AddImagesOptions {
  /** 정본 한 변. 백본 등록부가 준다 (`ml/backbones.ts`). */
  readonly canonicalSize: number
  /** ISO 8601. manifest.updatedAt에 찍는다. */
  readonly now: string
}

/**
 * 구운 정본들을 프로젝트에 앉힌다.
 *
 * **이미 있는 사진은 자리를 안 옮긴다.** 같은 해시가 다른 범주에 이미 있으면 그건 학생이
 * 이전에 정한 라벨이고, 다시 올렸다는 이유로 덮으면 **분류해 둔 것이 조용히 풀린다.**
 *
 * `dataset` 참조는 여기서 선다 — **정본을 구운 조건이 그때의 사실로 파일에 남는다**
 * (open-decisions.md "이미지 프로젝트의 `settings.data`는 무엇을 갖는가").
 */
export function addImages(
  project: ProjectFile,
  baked: readonly BakedImage[],
  options: AddImagesOptions,
): AddedImages {
  const previous = dataSettings('image', project.document.settings)
  const images = new Map(project.images)
  const known = new Set(readImages(project).map((entry) => entry.hash))

  let added = 0
  let duplicates = 0
  const categories = [...previous.categories]
  for (const image of baked) {
    if (known.has(image.hash)) {
      duplicates += 1
      continue
    }
    known.add(image.hash)
    added += 1
    images.set(imageEntryPath('data', image.hash, image.category), image.bytes)
    if (
      image.category !== IMAGE_UNLABELED &&
      isValidCategoryName(image.category) &&
      !categories.includes(image.category)
    ) {
      categories.push(image.category)
    }
  }

  const data = {
    ...previous,
    categories,
    dataset: {
      path: IMAGE_DATA_DIR,
      canonicalSize: options.canonicalSize,
      jpegQuality: IMAGE_JPEG_QUALITY,
    },
  }
  return { project: withImages(project, images, data, options.now), added, duplicates }
}

/**
 * 사진들을 다른 범주로 옮긴다. **바이트는 안 움직인다** — 맵의 열쇠만 바뀐다.
 *
 * `_unlabeled`에서 꺼내는 것도, 범주끼리 옮기는 것도, 다시 라벨을 떼는 것도 전부 이
 * 함수다 (open-decisions.md "`_unlabeled`는 이름 바꾸기가 아니라 '전부 ○○로 옮기기'다").
 */
export function moveImages(
  project: ProjectFile,
  hashes: readonly string[],
  to: string,
  now: string,
): ProjectFile {
  const moving = new Set(hashes)
  const images = new Map(project.images)
  for (const entry of readImages(project)) {
    if (!moving.has(entry.hash) || entry.category === to) continue
    images.delete(entry.path)
    images.set(imageEntryPath('data', entry.hash, to), entry.bytes)
  }

  const previous = dataSettings('image', project.document.settings)
  const categories =
    to === IMAGE_UNLABELED || previous.categories.includes(to)
      ? previous.categories
      : [...previous.categories, to]
  return withImages(project, images, { ...previous, categories }, now)
}

/**
 * 사진을 프로젝트에서 아주 뺀다. **범주를 없애는 것과 다르다** — 그쪽은 라벨만 뗀다.
 *
 * **지운 것은 이력에 남는다.** 실험 스냅샷이 범주별 장수를 들고 있어서, 지우고 다시
 * 학습하면 결과 화면이 "사진 수가 달라졌다"고 말한다 (open-decisions.md "장수가
 * 스냅샷에 있어야 하는 이유"). 그게 없으면 도구가 "직전과 같은 설정"이라고 거짓말한다.
 */
export function removeImages(
  project: ProjectFile,
  hashes: readonly string[],
  now: string,
): ProjectFile {
  const removing = new Set(hashes)
  const images = new Map(project.images)
  for (const entry of readImages(project)) {
    if (removing.has(entry.hash)) images.delete(entry.path)
  }
  // **범주 목록은 안 건드린다.** 마지막 한 장을 지웠다고 범주가 사라지면, 학생이
  // 사진을 바꿔 넣으려던 것뿐인데 만들어 둔 칸이 함께 없어진다.
  const previous = dataSettings('image', project.document.settings)
  // 임베딩은 그 사진의 것이라 함께 나간다 (mlpx-spec.md §1.3). 안 지우면 IndexedDB에
  // 아무 사진의 것도 아닌 벡터가 계속 쌓인다.
  const pruned = removeEmbeddings(project, hashes)
  return withImages({ ...pruned, images }, images, { ...previous }, now)
}

/**
 * 빈 범주를 만든다. **사진 없이도 남아야 한다** — zip은 빈 폴더를 표현하지 못하므로
 * 목록이 그것을 갖는다. 수업 중에 만든 것이 저장하고 열었더니 없는 것은 교실에서 사고다.
 */
export function addCategory(project: ProjectFile, name: string, now: string): ProjectFile {
  const previous = dataSettings('image', project.document.settings)
  if (previous.categories.includes(name)) return project
  const data = { ...previous, categories: [...previous.categories, name] }
  return withImages(project, project.images, data, now)
}

/**
 * 범주 이름을 바꾼다. 그 안의 사진이 함께 따라간다.
 *
 * **옛 실험 기록의 라벨은 안 바뀐다.** 그때의 이름은 그때의 사실이라 그대로 두는 것이
 * 맞고, 달라졌다는 것은 변경 이력이 말한다 (`ml/changes.ts`).
 */
export function renameCategory(
  project: ProjectFile,
  from: string,
  to: string,
  now: string,
): ProjectFile {
  const previous = dataSettings('image', project.document.settings)
  const images = new Map(project.images)
  for (const entry of readImages(project)) {
    if (entry.category !== from) continue
    images.delete(entry.path)
    images.set(imageEntryPath('data', entry.hash, to), entry.bytes)
  }
  const categories = previous.categories.map((category) => (category === from ? to : category))
  return withImages(project, images, { ...previous, categories }, now)
}

/**
 * 범주를 없앤다. **사진은 안 지운다 — 라벨만 뗀다.**
 *
 * 지우는 것으로 만들면 범주 하나를 잘못 눌러 40장이 사라지고, 되돌릴 방법이 다시
 * 올리는 것뿐이다. 라벨만 떼면 `_unlabeled`에 그대로 있어서 학생이 다시 넣을 수 있다.
 */
export function removeCategory(project: ProjectFile, name: string, now: string): ProjectFile {
  const hashes = readImages(project)
    .filter((entry) => entry.category === name)
    .map((entry) => entry.hash)
  const moved = moveImages(project, hashes, IMAGE_UNLABELED, now)
  const previous = dataSettings('image', moved.document.settings)
  const categories = previous.categories.filter((category) => category !== name)
  return withImages(moved, moved.images, { ...previous, categories }, now)
}
