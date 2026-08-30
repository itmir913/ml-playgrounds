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
  categoryOfEntry,
  IMAGE_ROLES,
  imageEntryPath,
  isValidCategoryName,
  type ImageRole,
} from '@/data/image/canonical'
import {
  CANONICAL_FORMATS,
  canonicalFormatOfPath,
  type CanonicalFormat,
  type CanonicalFormatId,
} from '@/data/image/formats'
import { removeEmbeddings } from '@/project/embeddings'
import {
  IMAGE_DATA_DIR,
  IMAGE_PREDICT_DIR,
  IMAGE_TEST_DIR,
  IMAGE_UNLABELED,
  type ProjectFile,
} from '@/project/format'
import { MAX_IMAGE_COUNT } from '@/limits'
import { dataSettings, type Settings } from '@/project/schema'

/** 프로젝트 안에 앉아 있는 정본 한 장. */
export interface ImageEntry {
  /** 정본 바이트의 SHA-256. 프로젝트 안에서 이 사진의 신원이다. */
  readonly hash: string
  /** 지금 들어 있는 폴더. `_unlabeled`면 아직 라벨을 안 붙였다. */
  readonly category: string
  readonly path: string
  readonly bytes: Uint8Array
  /**
   * 이 한 장의 형식. **확장자가 갖는 사실이다** (mlpx-spec.md §1.2) — 화면이 Blob을
   * 만들 때도, 임베딩이 디코딩할 때도 여기서 온다. `settings.data`의 `format`은 그
   * 자리를 마지막으로 구운 조건이라 섞인 프로젝트에서 절반이 틀린다.
   */
  readonly format: CanonicalFormat
}

/**
 * 그 자리에 있는 사진들. **순서는 경로순이라 열 때마다 같다** — 격자가 열 때마다 다르게
 * 서면 학생은 사진이 바뀌었다고 읽는다.
 *
 * **코드 단위로 비교한다. `localeCompare`를 쓰지 마라** (V11 R1 감사 B-5). 그쪽은 인자
 * 없이 부르면 **그 런타임의 기본 로케일**을 쓰는데, 체코에서 `ch`는 한 글자이고
 * 스웨덴에서 `Ä`는 `z` 뒤다. 이 순서는 사람에게 보여주는 정렬이 아니라 **좌표계**다 —
 * 참조형 모델의 `trainIndices`가 가리키는 자리이고(mlpx-spec.md §5.1), 그것이 브라우저
 * 설정에 딸려 있으면 같은 파일이 기기마다 다른 뜻을 갖는다.
 *
 * 범주를 화면에 세우는 순서는 여기서 안 온다 — `settings.data.categories`가 갖는다.
 */
export function readImages(
  project: ProjectFile | null,
  role: ImageRole = 'data',
): readonly ImageEntry[] {
  if (!project) return []
  const entries: ImageEntry[] = []
  for (const [path, bytes] of [...project.images].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const category = categoryOfEntry(role, path)
    const format = canonicalFormatOfPath(path)
    if (category === null || format === null) continue
    const name = path.slice(path.lastIndexOf('/') + 1)
    const hash = name.slice(0, name.length - format.extension.length)
    entries.push({ hash, category, path, bytes, format })
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

/**
 * 두 사진 **사이의 것 전부** (양끝 포함). 화면에서 shift+클릭이 부른다
 * (open-decisions.md "Shift+클릭으로 범위를 고른다").
 *
 * **순서는 넘겨받은 목록이 정한다** — 그 목록이 곧 격자에 선 순서라, 여기서 다시
 * 정렬하면 학생이 보는 것과 다른 범위가 나온다. 쪽 나눔은 보는 단위일 뿐이므로
 * 넘어온 목록에 그대로 들어 있다.
 *
 * **둘 중 하나라도 목록에 없으면 빈 배열이다.** 사진이 지워지거나 다른 범주로 옮겨진
 * 뒤에 옛 기준점으로 범위를 세면 **조용히 엉뚱한 묶음**이 나온다 — 그 자리는 부르는
 * 쪽에서 기준점을 새로 잡는다.
 *
 * 어느 쪽을 먼저 눌렀는지는 상관없다. 학생은 위에서 아래로도, 아래에서 위로도 고른다.
 */
export function hashesBetween(
  entries: readonly ImageEntry[],
  from: string,
  to: string,
): readonly string[] {
  const start = entries.findIndex((entry) => entry.hash === from)
  const end = entries.findIndex((entry) => entry.hash === to)
  if (start < 0 || end < 0) return []
  const [first, last] = start <= end ? [start, end] : [end, start]
  return entries.slice(first, last + 1).map((entry) => entry.hash)
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

/** 상한을 넘겼을 때 학생에게 말해야 하는 숫자들. 문장이 셋 다 쓴다. */
export interface ImageOverflow {
  /** 이 자리에 이미 있는 장수. */
  readonly current: number
  /** 이번에 넣으려는 장수. */
  readonly incoming: number
  readonly limit: number
}

/**
 * 이만큼 더 담을 수 있는가. 담을 수 있으면 `null`이다.
 *
 * **막는 것은 학습이 아니라 업로드다** (open-decisions.md #13의 "이미지의 상한").
 * 그래서 이 판정은 **굽기 전에** 불린다 — 5,000장을 넘긴 뒤에 알려 주면 백본이 이미
 * 돌았고 학생은 몇 분을 버린 뒤 지우기부터 해야 한다.
 *
 * **자리마다 따로 센다** (`ImageRole`). 표에서 훈련 파일과 테스트 파일이 각자
 * `MAX_DATASET_ROWS`에 걸리는 것과 같다 — 예측하러 올린 사진이 훈련용 자리를 깎으면,
 * 학생은 안 건드린 데이터가 줄어든 것으로 읽는다.
 *
 * **중복은 못 뺀다.** 같은 사진인지는 정본 바이트의 해시라 굽고 나서야 안다. 상한은
 * 굽기 전에 서는 것이고, 보수적으로 틀리는 쪽이 옳다.
 */
export function imageOverflow(
  project: ProjectFile | null,
  incoming: number,
  role: ImageRole = 'data',
  limit: number = MAX_IMAGE_COUNT,
): ImageOverflow | null {
  const current = readImages(project, role).length
  return current + incoming > limit ? { current, incoming, limit } : null
}

/**
 * 사진 몇 장이 자리를 얼마나 차지할지의 예상. **굽기 전에 쿼터를 묻는 데 쓴다**
 * (open-decisions.md "이미지가 들어갈 자리는 굽기 전에 묻는다").
 *
 * **장수 × 장당으로 센다.** 원본 파일 크기 합은 안 쓴다 — 정본이 원본보다 대개 훨씬
 * 작아서 **될 것도 막는다.**
 *
 * **장당은 정본 + 임베딩이다.** 둘 다 저장소에 실제로 앉는다(`totalBytes`가 둘 다 센다).
 *
 * **임베딩 몫은 상수가 아니라 유도다** — `embeddingDim × Float32Array`의 원소 크기다.
 * 백본을 바꾸면 차원이 바뀌므로, 숫자로 적어 두면 그날 조용히 틀린다.
 * 정본 몫은 형식마다 달라 형식 등록부가 갖는다(`data/image/formats.ts`).
 *
 * **형식은 받는다. 여기서 고르지 않는다** — 고르는 것은 요청마다 한 번이고
 * (`data/image/bake.ts`의 `detectCanonicalFormat`), 한 요청 안의 사진들은 같은 형식이다.
 */
export function estimatedImageBytes(
  incoming: number,
  format: CanonicalFormat,
  embeddingDim: number,
): number {
  const perImage = format.estimatedBytes + embeddingDim * Float32Array.BYTES_PER_ELEMENT
  return incoming * perImage
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

/**
 * 테스트용 사진을 붙인다. **`addImages`에 두 가지를 더한다** — 분할을 `provided`로 돌리고
 * **지금까지의 실험을 전부 지운다.**
 *
 * **표의 `applyTestDataset`과 같은 처방이다** (`project/dataset.ts`). 테스트 데이터가 바뀌면
 * 그 위의 점수가 전부 **다른 것을 잰 값**이 되고, 나란히 놓인 비교표가 거짓말을 한다.
 * 모델도 함께 버린다 — run이 사라지면 그 모델은 아무도 안 가리키는 본체가 되어 어차피
 * `writeProject`가 떨어뜨린다.
 *
 * **받아도 되는지는 여기서 안 본다.** 범주 대조는 화면 밖의 순수 함수가 하고
 * (`data/image/test-set.ts`), 화면이 그 이유를 보여준 뒤에만 여기로 온다.
 */
export function applyTestImages(
  project: ProjectFile,
  baked: readonly BakedImage[],
  options: AddImagesOptions,
): AddedImages & { readonly droppedExperiments: number } {
  const added = addImages(project, baked, { ...options, role: 'test' })
  const { document } = added.project
  return {
    ...added,
    droppedExperiments: document.runs.experiments.length,
    project: {
      ...added.project,
      document: {
        ...document,
        settings: {
          ...document.settings,
          split: { ...document.settings.split, method: 'provided' },
        },
        runs: { ...document.runs, experiments: [] },
      },
      models: new Map(),
    },
  }
}

/**
 * 테스트용 사진을 전부 떼고 분할을 되돌린다. **위의 거울상이다.**
 *
 * **되돌릴 길이 없으면 올리는 것 자체가 덫이다** — 표에서 [②]를 골랐다가 [①]로 되돌아갈
 * 수 있는 것과 같다 (`views/preprocess/TabularPrepPanel.vue`의 `chooseHoldout`).
 *
 * 참조는 `removeImages`가 마지막 한 장이 사라질 때 스스로 뗀다. 여기서 더하는 것은
 * **분할을 `holdout`으로 돌리는 것**과 **실험을 지우는 것** 둘이다 — 앞엣것을 안 하면
 * 테스트 사진이 없는 `provided`가 남아 학습이 채점할 것을 못 찾는다.
 *
 * **떼도 실험을 전부 지운다** (R11 감사 B-5, 2026-08-28). `applyTestImages`와 같은
 * 사유이고 표의 `removeTestDataset`이 이미 그렇게 하고 있었다 — **이 함수만 안 하고
 * 있었다.** 안 지우면 provided로 채점한 점수와 holdout으로 채점한 점수가 한 비교표에
 * 나란히 서고, 그건 서로 다른 것을 잰 값이다.
 */
export function clearTestImages(project: ProjectFile, now: string): ProjectFile {
  const hashes = readImages(project, 'test').map((entry) => entry.hash)
  const removed = removeImages(project, hashes, now, 'test')
  const { document } = removed
  return {
    ...removed,
    document: {
      ...document,
      settings: {
        ...document.settings,
        split: { ...document.settings.split, method: 'holdout' },
      },
      runs: { ...document.runs, experiments: [] },
    },
    models: new Map(),
  }
}

/**
 * 자리마다 짝이 되는 참조 필드와 폴더 경로 (mlpx-spec.md §1.2).
 *
 * **참조와 본체는 함께 있고 함께 없다** — 사진을 앉히면서 참조를 안 세우면
 * `writeProject`가 저장을 거부한다.
 */
const ROLE_REFERENCE: Readonly<Record<ImageRole, { field: string; path: string }>> = {
  data: { field: 'dataset', path: IMAGE_DATA_DIR },
  test: { field: 'testDataset', path: IMAGE_TEST_DIR },
  predict: { field: 'predictDataset', path: IMAGE_PREDICT_DIR },
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
  /**
   * 무엇으로 구웠는가. **워커가 정해서 결과와 함께 준다** (`data/image/client.ts`) —
   * 여기서 다시 고르지 않는다. 브라우저가 WebP를 못 구우면 jpg로 내려간 그 사실이
   * 경로의 확장자와 `settings.data`에 함께 적혀야 한다.
   */
  readonly format: CanonicalFormatId
  /**
   * 어느 자리에 앉히나. 기본은 훈련 데이터다.
   *
   * **`predict`에는 라벨이 없다** (mlpx-spec.md §1.2) — 범주 폴더가 한 겹 없고, 그래서
   * 범주 목록도 안 건드린다. 답을 모르는 사진이라 범주에 넣을 수가 없다.
   */
  readonly role?: ImageRole
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
  const role = options.role ?? 'data'
  const format = CANONICAL_FORMATS[options.format]
  const previous = dataSettings('image', project.document.settings)
  const images = new Map(project.images)
  // **같은 자리 안에서만 같은 사진이다.** 훈련에 쓴 사진을 예측으로 올리는 것은
  // 학생이 일부러 하는 일이고("이 사진은 뭐라고 답하지?"), 그때 없는 것으로 다루면
  // 아무 일도 안 일어난 것처럼 보인다.
  const known = new Set(readImages(project, role).map((entry) => entry.hash))

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
    images.set(imageEntryPath(role, image.hash, image.category, format), image.bytes)
    // 예측 자리에는 라벨이 없다. 범주 목록을 건드릴 일도 없다.
    if (
      role !== 'predict' &&
      image.category !== IMAGE_UNLABELED &&
      isValidCategoryName(image.category) &&
      !categories.includes(image.category)
    ) {
      categories.push(image.category)
    }
  }

  const reference = {
    path: ROLE_REFERENCE[role].path,
    canonicalSize: options.canonicalSize,
    format: format.id,
    quality: format.quality,
  }
  const data = { ...previous, categories, [ROLE_REFERENCE[role].field]: reference }
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
    // **엔트리의 형식을 그대로 쓴다.** 옮기는 것은 폴더뿐이고 바이트는 손대지 않으므로,
    // 여기서 지금의 기본 형식을 쓰면 jpg 정본이 `.webp` 이름을 뒤집어쓴다.
    images.set(imageEntryPath('data', entry.hash, to, entry.format), entry.bytes)
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
  role: ImageRole = 'data',
): ProjectFile {
  const removing = new Set(hashes)
  const images = new Map(project.images)
  for (const entry of readImages(project, role)) {
    if (removing.has(entry.hash)) images.delete(entry.path)
  }
  // **범주 목록은 안 건드린다.** 마지막 한 장을 지웠다고 범주가 사라지면, 학생이
  // 사진을 바꿔 넣으려던 것뿐인데 만들어 둔 칸이 함께 없어진다.
  const previous = dataSettings('image', project.document.settings)

  /**
   * **마지막 한 장을 지우면 참조도 함께 나간다.**
   *
   * 참조와 본체는 함께 있고 함께 없다 (mlpx-spec.md §1). 참조만 남으면
   * `writeProject`가 저장을 거부하고 `loadProject`는 그 프로젝트를 **아예 안 열어
   * 준다** — 사진을 다 지운 학생이 다음 차시에 빈 목록을 만나게 된다.
   */
  const data = { ...previous }
  const { field } = ROLE_REFERENCE[role]
  const left = [...images.keys()].some((path) => path.startsWith(ROLE_REFERENCE[role].path))
  if (!left) delete data[field]

  /**
   * 임베딩은 그 사진의 것이라 함께 나간다 (mlpx-spec.md §1.3). 안 지우면 IndexedDB에
   * 아무 사진의 것도 아닌 벡터가 계속 쌓인다.
   *
   * **다만 자리를 넘어 지우면 안 된다.** 같은 해시가 두 자리에 사는 것은 정상이고
   * 이 모듈이 그렇게 적어 두었다 — *"훈련에 쓴 사진을 예측으로 올리는 것은 학생이
   * 일부러 하는 일이다."* 해시로만 지우던 때는 **예측 자리에서 한 장을 지우면
   * 훈련 자리에 그대로 앉아 있는 사진의 벡터가 함께 나갔다.**
   *
   * 그러면 `imageTrainingSource`가 벡터 없는 사진을 행에서 빼므로 **군집 결과의
   * 사진 격자에서 그 장이 조용히 없어지고**, 참조형 모델은 `rowsHash`가 어긋나
   * 답을 안 낸다 — 학생 눈에는 멀쩡한 모델이 갑자기 침묵한다 (2026-08-31 사각 감사 A-1).
   */
  const remaining = { ...project, images }
  const stillUsed = new Set(
    IMAGE_ROLES.flatMap((one) => readImages(remaining, one).map((entry) => entry.hash)),
  )
  const orphaned = hashes.filter((hash) => !stillUsed.has(hash))
  const pruned = removeEmbeddings(project, orphaned)
  return withImages({ ...pruned, images }, images, data, now)
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
    // **엔트리의 형식을 그대로 쓴다.** 옮기는 것은 폴더뿐이고 바이트는 손대지 않으므로,
    // 여기서 지금의 기본 형식을 쓰면 jpg 정본이 `.webp` 이름을 뒤집어쓴다.
    images.set(imageEntryPath('data', entry.hash, to, entry.format), entry.bytes)
  }
  const renamed = previous.categories.map((category) => (category === from ? to : category))
  // **같은 이름이 두 벌 서지 않는다.** `to`가 이미 목록에 있으면 두 범주가 합쳐지는
  // 것이고, 그때 이름이 둘이면 스냅샷의 `categoryCounts`에도 같은 칸이 둘 생긴다.
  // `addCategory`와 `moveImages`는 이미 `includes`로 막는데 여기만 안 막고 있었다
  // (2026-08-30, R12 감사 C-2). 화면의 `nameTaken`이 유일한 방어선이었다.
  const categories = renamed.filter((category, index) => renamed.indexOf(category) === index)
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
