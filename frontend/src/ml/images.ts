/**
 * 이미지 프로젝트를 **표 문제로 바꾸는 자리**
 * (open-decisions.md "이미지 학습은 표 문제로 바꿔서 푼다").
 *
 * ```
 * 사진 → 임베딩 → 열 이름을 붙인 표 → runExperiment (그대로)
 * ```
 *
 * **여기가 이미지 학습의 전부다.** 알고리즘도 분할도 지표도 새로 만드는 것이 없다 —
 * 임베딩이 숫자 표이므로 지금 있는 것들이 그 위에서 그대로 돈다.
 *
 * **다만 파일에 남는 것은 이 표가 아니다.** 실험 기록에 `f0…f1279`가 적히면 학생이
 * 고른 것도 아니고 다시 열었을 때 뜻도 없는 값이 남는다. 그래서 스냅샷을 따로 짓는다.
 */

import { ClientError } from '@/errors'
import { interpreterFor, type LoadContext } from '@/ml/models'
import type { TrainingRows } from '@/ml/predict'
import { targetValues, transform, type Dataset, type Preprocessor } from '@/ml/preprocess'
import type { BackboneSpec } from '@/ml/backbones'
import { IMAGE_UNLABELED, type ProjectFile } from '@/project/format'
import type { ImageRole } from '@/data/image/canonical'
import { hashText } from '@/hash'
import { countByCategory, imageCategories, readImages, type ImageEntry } from '@/project/images'
import { dataSnapshot, type Experiment, type Settings, type TaskType } from '@/project/schema'

/**
 * 임베딩 표의 타깃 열 이름.
 *
 * **화면에 안 나온다.** 학생이 고르는 열이 아니라 우리가 만든 표의 칸 이름이고,
 * 파일에도 안 남는다(스냅샷이 따로 있다). 그래서 번역하지 않는다.
 */
export const IMAGE_LABEL_COLUMN = 'label'

/** 임베딩 한 축의 열 이름. `f0`부터 센다 — 0부터가 파이썬 관행이다. */
export function embeddingColumns(dim: number): string[] {
  return Array.from({ length: dim }, (_, index) => `f${index}`)
}

/**
 * 아직 임베딩이 없는 사진들. **학습을 누를 때 이만큼만 뽑는다** (mlpx-spec.md §1.3).
 *
 * 사진을 올릴 때 뽑으면 학습을 한 번도 안 할 학생이 백본 12.4MB를 받고 기다린다.
 *
 * **`role`이 필수 인자다.** 기본값을 두었더니 예측 화면이 훈련 자리를 보고 있었고,
 * 두 집합의 교집합이 언제나 비어서 **예측 사진의 임베딩을 한 장도 안 뽑았다**
 * (V11 R1 감사 A-2). 자리를 안 밝히면 컴파일이 깨지는 편이 낫다 —
 * `trainableRowCount`의 `nSamples`와 같은 이유다 (`docs/rule-coverage.md`).
 */
export function pendingEmbeddings(
  project: ProjectFile | null,
  have: ReadonlySet<string>,
  role: ImageRole,
): readonly ImageEntry[] {
  return readImages(project, role).filter((entry) => !have.has(entry.hash))
}

/** 예측할 사진들을 모델에 넣을 표로 만든 것. */
export interface ImagePredictTable {
  /** 학습 때와 같은 열 이름이다 — 전처리기가 이름으로 찾는다. */
  readonly columns: readonly string[]
  /** `photos`와 **자리가 같다.** 벡터가 없는 사진은 빈 행이다 */
  readonly rows: readonly (readonly string[])[]
  /**
   * 벡터가 없어 행을 못 지은 사진. **부르는 쪽은 이 사진들의 답을 내지 않는다.**
   *
   * 예전에는 없는 자리를 0 벡터로 메웠다. 그러면 사진이 몇 장이든 **모든 모델이 모든
   * 사진에 같은 답**을 주고, 예외도 경고도 없이 "모델이 잘 못 배웠나 보다"로 읽힌다
   * (V11 R1 감사 A-2). 없는 것은 없는 것으로 둔다.
   */
  readonly missing: ReadonlySet<string>
}

/**
 * 예측할 사진들의 표. **학습과 같은 열 이름을 쓴다** — 좌표계가 갈릴 자리가 없다.
 *
 * 순수 함수로 둔 이유는 화면에 두면 "없는 벡터를 어떻게 다루는가"를 아무 검사도 안 보기
 * 때문이다. 실제로 그 자리가 조용히 틀렸다.
 */
export function imagePredictTable(
  photos: readonly ImageEntry[],
  vectors: ReadonlyMap<string, Float32Array>,
  backbone: BackboneSpec,
): ImagePredictTable {
  const missing = new Set<string>()
  const rows = photos.map((photo) => {
    const vector = vectors.get(photo.hash)
    if (vector === undefined) {
      missing.add(photo.hash)
      return []
    }
    // 숫자를 문자열로 한 번 왕복한다 — `Dataset`의 칸이 문자열이다 (imageTrainingSource와 같다).
    return Array.from(vector, (value) => String(value))
  })
  return { columns: embeddingColumns(backbone.embeddingDim), rows, missing }
}

export interface ImageTrainingSource {
  /** 임베딩 한 장이 한 행이다. 행 번호가 곧 분할 인덱스다. */
  readonly dataset: Dataset
  /**
   * 계산에 쓰는 설정. **`data`가 표의 모양이다** — 나머지(분할·실행 방법·모델·
   * 하이퍼파라미터)는 프로젝트의 것을 그대로 쓴다.
   */
  readonly settings: Settings
  /** 파일에 남는 기록. 계산에 쓴 표가 아니라 범주와 백본이다. */
  readonly snapshot: Experiment['settings']['data']
  /**
   * 표의 행 번호 -> 사진 해시. **결과 화면이 사진을 되찾는 길이다** — 군집 결과는
   * 산점도가 아니라 사진 그리드이고(open-decisions.md #28-8), 거기서 행 번호를
   * 사진으로 되돌려야 한다.
   */
  readonly hashes: readonly string[]
  /**
   * 표의 행 번호 -> 그 사진의 범주. `hashes`와 **같은 목록에서** 나온다 — 행마다의 열쇠
   * (`rowKeysOf`)를 따로 거른 목록으로 지으면, 빠진 사진 하나 뒤로 열쇠가 한 칸씩 밀려
   * 엉뚱한 사진을 가리킨다 (2단계 계획 감사 2판 C-1).
   */
  readonly rowCategories: readonly string[]
}

/** 행마다의 열쇠 하나의 바이트 수 (mlpx-spec.md §5.1). 포맷 규격이라 `limits.ts`가 아니다. */
const ROW_KEY_BYTES = 8

/** 이진 문자열을 짓는 덩어리. **인자로 통째로 펼치지 않는다** — 32,500장에서 콜 스택이 넘쳤다. */
const BINARY_CHUNK = 0x2000

/**
 * 사진 한 장의 열쇠 — `sha256(범주 + "\n" + 사진 해시)`의 앞 8바이트, 16진수 (mlpx-spec.md §5.1).
 *
 * **범주가 열쇠에 든다.** 범주를 옮긴 훈련 사진은 다른 열쇠가 되어 못 찾고, 그것이 곧
 * "옮긴 훈련 사진은 예측을 거부한다"(open-decisions.md 111)다. 따로 대조하는 장치가 없다.
 */
export function rowKeyOf(category: string, hash: string): string {
  return hashText(`${category}${SEPARATOR}${hash}`).slice(0, ROW_KEY_BYTES * 2)
}

/**
 * 표의 행마다의 열쇠를 이어 붙여 base64 하나로 (mlpx-spec.md §5.1). **표를 지은 그 목록에서**
 * 짓는다 — `ImageTrainingSource`를 받는 것이 그 보장이다.
 *
 * `imageTrainingSource` 안에서 안 짓는 이유는 군집 패널 두 곳도 그 함수를 부르기 때문이다 —
 * 안에서 지으면 열쇠가 필요 없는 호출이 5,000장에 16–41ms를 치른다(계획 감사 1판 C-2).
 */
export function rowKeysOf(source: Pick<ImageTrainingSource, 'hashes' | 'rowCategories'>): string {
  const bytes = new Uint8Array(source.hashes.length * ROW_KEY_BYTES)
  source.hashes.forEach((hash, row) => {
    const key = rowKeyOf(source.rowCategories[row] ?? '', hash)
    for (let at = 0; at < ROW_KEY_BYTES; at += 1) {
      bytes[row * ROW_KEY_BYTES + at] = Number.parseInt(key.slice(at * 2, at * 2 + 2), 16)
    }
  })
  let binary = ''
  for (let start = 0; start < bytes.length; start += BINARY_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + BINARY_CHUNK))
  }
  return btoa(binary)
}

/**
 * `rowKeysOf`의 짝. 행마다의 열쇠(16진수)를 돌려준다. **못 풀면 `null`이다** — 남이 고친 파일이다.
 *
 * 스키마에서 모양을 막지 않는다. 그 칸 하나로 파일 전체가 `PROJECT_FILE_INVALID`가 되는 것보다
 * 그 모델 하나가 `MODEL_TRAINING_DATA_CHANGED`로 꺼지는 편이 낫다(계획 감사 1판 C-6).
 */
export function readRowKeys(text: string): string[] | null {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    return null
  }
  if (binary.length % ROW_KEY_BYTES !== 0) return null
  const keys: string[] = []
  for (let start = 0; start < binary.length; start += ROW_KEY_BYTES) {
    let key = ''
    for (let at = start; at < start + ROW_KEY_BYTES; at += 1) {
      key += binary.charCodeAt(at).toString(16).padStart(2, '0')
    }
    keys.push(key)
  }
  return keys
}

/**
 * 행 순서의 지문 (mlpx-spec.md §5.1). **순서에 민감해야 한다** — 같은 사진들이라도
 * 자리가 바뀌면 다른 값이어야 그 변화를 잡는다.
 *
 * **구분자를 넣는다.** 그냥 이어 붙이면 `["ab","cd"]`와 `["abc","d"]`가 같은 글자가
 * 된다. 지금은 길이가 고정된 16진수라 안 겹치지만, 겹치는 날 조용히 틀린다.
 */
export function rowsHashOf(hashes: readonly string[]): string {
  return hashText(hashes.join(SEPARATOR))
}

/** 지문을 만들 때 해시 사이에 넣는 글자. 해시에는 안 나오는 문자라야 한다. */
const SEPARATOR = '\n'

/**
 * 학습에 넘길 것을 짓는다.
 *
 * **분류는 라벨 붙은 사진만 쓴다.** 라벨 없는 사진은 학습에 안 들어가고, 그건 표에서
 * 타깃이 빈 행이 `usableRows`에서 빠지는 것과 같다. **군집은 전부 쓴다** — 범주에
 * 상관없이 올린 사진 전체가 대상이다 (open-decisions.md "이미지 프로젝트의 데이터 화면").
 *
 * **임베딩이 없는 사진은 빠진다.** 부르는 쪽이 `pendingEmbeddings`로 먼저 채우므로
 * 정상 경로에서는 하나도 없고, 그래도 여기서 조용히 빼는 이유는 **한 장 때문에 학습
 * 전체가 막히는 것이 더 나쁘기** 때문이다.
 */
export function imageTrainingSource(
  project: ProjectFile,
  vectors: ReadonlyMap<string, Float32Array>,
  backbone: BackboneSpec,
  taskType: TaskType,
): ImageTrainingSource {
  const isClustering = taskType === 'clustering'
  const entries = readImages(project).filter(
    (entry) => vectors.has(entry.hash) && (isClustering || entry.category !== IMAGE_UNLABELED),
  )

  const columns = embeddingColumns(backbone.embeddingDim)
  const rows = entries.map((entry) => {
    const vector = vectors.get(entry.hash)
    // **숫자를 문자열로 한 번 왕복한다.** `Dataset`의 칸이 문자열이라서다. float32 값의
    // 문자열은 그대로 되돌아오므로 정밀도는 안 잃는다.
    const cells = vector === undefined ? [] : Array.from(vector, (value) => String(value))
    return isClustering ? cells : [...cells, entry.category]
  })

  const counts = countByCategory(project)
  const categories = imageCategories(project)

  return {
    dataset: {
      columns: isClustering ? columns : [...columns, IMAGE_LABEL_COLUMN],
      rows,
    },
    settings: {
      ...project.document.settings,
      data: {
        features: columns,
        // 군집에는 타깃이 없다. 스키마에서 선택 항목이다.
        ...(isClustering ? {} : { target: IMAGE_LABEL_COLUMN }),
        /**
         * **셋 다 꺼진 값이다.** 임베딩에는 빈 칸이 없고 범주형 열도 없다. 스케일링이
         * 이미지에서 무슨 뜻인지는 아직 안 정했고(open-decisions.md "이미지 학습의
         * 모양"), 정해지기 전에 뭔가를 켜 두면 그게 기본값으로 굳는다.
         */
        preprocessing: { missing: 'none', scaling: 'none', categoricalEncoding: 'onehot' },
      },
    },
    snapshot: {
      // 스키마가 읽고 쓸 배열이라 복사본을 준다 — 위 목록은 읽기 전용이다.
      categories: [...categories],
      backboneId: backbone.id,
      // **순서가 `categories`와 같아야 한다** (schema.ts). 다르면 이력이 엉뚱한 범주의
      // 장수가 바뀌었다고 말한다.
      categoryCounts: categories.map((category) => counts.get(category) ?? 0),
      unlabeledCount: counts.get(IMAGE_UNLABELED) ?? 0,
      // **행 번호가 무엇을 가리키는지의 기록이다** (mlpx-spec.md §5.1). 장수는 두 방향
      // 이동을 못 잡는다 - 되세울 때 이 값을 다시 계산해 대조한다.
      rowsHash: rowsHashOf(entries.map((entry) => entry.hash)),
    },
    hashes: entries.map((entry) => entry.hash),
    rowCategories: entries.map((entry) => entry.category),
  }
}

/**
 * 테스트용 사진의 표. **훈련 표와 같은 열 이름을 쓴다** — 전처리기가 이름으로 찾는다.
 *
 * **`split.method`가 `provided`일 때만 뜻이 있다.** 그 어휘를 세우는 것은
 * `applyTestImages`이고(project/images.ts), 떼면 `clearTestImages`가 `holdout`으로
 * 되돌린다. 그래서 여기서 그 어휘를 다시 보지 않는다 — 두 곳이 판정하면 갈린다.
 *
 * **군집화에는 없다.** 나누지 않으므로 채점할 자리가 없다 (architecture.md §3.6).
 * 표도 같다 — `plan.ts`의 `testFromProvided`가 `!isClustering`을 달고 있다.
 *
 * **비어 있으면 `null`이다.** 사진은 있는데 임베딩이 없는 경우가 여기 걸리는데,
 * 그때 빈 표를 주면 학습이 0행으로 채점하고 지표가 NaN인 채 끝난다. `null`이면
 * `TEST_DATASET_NO_USABLE_ROWS`로 곱게 선다.
 */
export function imageTestDataset(
  project: ProjectFile,
  vectors: ReadonlyMap<string, Float32Array>,
  backbone: BackboneSpec,
  taskType: TaskType,
): Dataset | null {
  if (taskType === 'clustering') return null

  const rows: string[][] = []
  for (const entry of readImages(project, 'test')) {
    // 라벨 없는 사진은 채점할 정답이 없다. 입구가 이미 막지만(data/image/test-set.ts)
    // 여기서도 세지 않는다 - 훈련 표가 같은 자리에서 같은 것을 뺀다.
    if (entry.category === IMAGE_UNLABELED) continue
    const vector = vectors.get(entry.hash)
    if (vector === undefined) continue
    rows.push([...Array.from(vector, (value) => String(value)), entry.category])
  }

  if (rows.length === 0) return null
  return { columns: [...embeddingColumns(backbone.embeddingDim), IMAGE_LABEL_COLUMN], rows }
}

/**
 * 참조형 모델(KNN)이 요구하는 훈련 행을 이미지에서 되세운다 (mlpx-spec.md §5.0·§5.1).
 *
 * **열쇠(`rowKeys`)가 적힌 실험은 열쇠로 찾는다** (open-decisions.md 111, `trainingRowsByKeys`).
 * 그러면 사진을 더해도 같은 행이다. 아래는 **열쇠가 없는 실험**(이 필드 전의 파일, 옛 앱이
 * 학습한 실험)의 경로다.
 *
 * **못 세우면 `null`이다.** 사진이 학습 뒤에 늘거나 줄었으면 `trainIndices`가 가리키는
 * 자리가 다른 사진이 되고, 그러면 **이웃이 한 장씩 밀린 채로 답만 멀쩡히 나온다.**
 * 그 상태를 잡는 것이 스냅샷의 장수다 — 그 값이 있어야 하는 이유가 여기서 한 번 더 선다
 * (open-decisions.md "장수가 스냅샷에 있어야 하는 이유").
 *
 * **장수만으로는 원리적으로 못 가르는 것이 있다** (V11 R1 감사 B-1). 사진 A를
 * 개→고양이로, B를 고양이→개로 옮기면 **범주별 장수가 하나도 안 변하는데** 경로가 바뀌어
 * 행 순서는 바뀐다. 그래서 스냅샷의 `rowsHash`를 다시 계산해 대조한다 — **두 방향 이동은
 * 교실에서 흔하다**("이거 둘이 서로 바뀌었네").
 *
 * **더 옛 파일에는 `rowsHash`도 없다.** 그때는 장수만 본다. 그 구멍은 그 실험에서는 닫을 방법이
 * 없다 — 그 순서를 아무도 안 적어 두었다 (mlpx-spec.md §5.1). 다시 학습하면 열쇠가 적힌다.
 *
 * **장수는 표에 드는 사진만 센다.** 분류의 라벨 없는 사진은 표에 없는데 그 장수까지 대조하니,
 * 예측 전에 미분류 사진 한 장을 올렸을 뿐인데 모델이 꺼졌다.
 *
 * **임베딩이 빠진 사진이 있으면 못 세운다.** `imageTrainingSource`는 그 사진을 조용히 건너뛰고,
 * 그러면 뒤의 행 번호가 한 칸씩 당겨진다 — 지문이 없는 옛 실험에서는 아무도 못 잡는다.
 * **백본이 다르면 벡터가 다른 좌표계다.** 둘 다 이 함수의 검사가 문다(`image-training.spec.ts`).
 *
 * `null`을 받은 쪽은 `MODEL_TRAINING_DATA_CHANGED`로 끈다 — 사진이 있으므로 데이터가 없는 것이 아니다.
 */
export function imageTrainingRows(
  project: ProjectFile,
  experiment: Experiment,
  preprocessor: Preprocessor,
  backbone: BackboneSpec,
  vectors: ReadonlyMap<string, Float32Array>,
  taskType: TaskType,
): TrainingRows | null {
  const snapshot = dataSnapshot('image', experiment.settings)
  if (snapshot.backboneId !== backbone.id) return null
  if (snapshot.rowKeys !== undefined) {
    return trainingRowsByKeys(
      project,
      experiment,
      preprocessor,
      backbone,
      vectors,
      snapshot.rowKeys,
    )
  }

  const isClustering = taskType === 'clustering'
  const counts = countByCategory(project)
  const sameCounts =
    (!isClustering || snapshot.unlabeledCount === (counts.get(IMAGE_UNLABELED) ?? 0)) &&
    snapshot.categories.length === snapshot.categoryCounts.length &&
    snapshot.categories.every(
      (category, index) => snapshot.categoryCounts[index] === (counts.get(category) ?? 0),
    )
  if (!sameCounts) return null

  const source = imageTrainingSource(project, vectors, backbone, taskType)
  const eligible = readImages(project).filter(
    (entry) => isClustering || entry.category !== IMAGE_UNLABELED,
  )
  if (source.hashes.length !== eligible.length) return null

  // **적혀 있으면 순서까지 본다.** 장수가 같아도 자리가 바뀌었으면 행 번호의 뜻이 달라진다.
  if (snapshot.rowsHash !== undefined && snapshot.rowsHash !== rowsHashOf(source.hashes)) {
    return null
  }

  const { trainIndices } = experiment.settings
  if (trainIndices.some((index) => index >= source.dataset.rows.length)) return null

  const target = source.dataset.columns[source.dataset.columns.length - 1]
  if (target !== IMAGE_LABEL_COLUMN) return null

  return {
    indices: trainIndices,
    // 인코딩은 아무 일도 안 한다 — 임베딩에는 범주형 열이 없다.
    features: transform(preprocessor, source.dataset, trainIndices, 'onehot'),
    target: targetValues(source.dataset, trainIndices, target),
  }
}

/**
 * 열쇠로 훈련 행을 되세운다 (mlpx-spec.md §5.1, open-decisions.md 111).
 *
 * **`trainIndices`가 가리키는 열쇠만 찾는다.** 그래서 훈련에 안 쓴 사진(테스트 몫·표본 밖)은
 * 지우거나 옮겨도 상관없고, 훈련 사진을 지우거나 범주를 옮기면 열쇠가 없어 `null`이다.
 * 장수·`rowsHash`는 안 본다 — 그것이 사진 추가를 막던 장치다.
 *
 * **번호는 원래 번호를 그대로 돌려준다.** 모델 파일의 `trainIndices`가 이 번호로 행을 고르고
 * (`reference.ts`의 `loadReferenceModel`), 거리 동점도 이 번호로 가른다(`worse`). 다시 매기면
 * 모델이 제 행을 못 찾는다. 무는 검사: `image-row-keys.spec.ts`의 *"사진을 더해도 답이 같다"*.
 */
function trainingRowsByKeys(
  project: ProjectFile,
  experiment: Experiment,
  preprocessor: Preprocessor,
  backbone: BackboneSpec,
  vectors: ReadonlyMap<string, Float32Array>,
  rowKeys: string,
): TrainingRows | null {
  const keys = readRowKeys(rowKeys)
  if (keys === null) return null

  // 열쇠 -> 지금 사진. **겹치면 고르지 않는다** — 64비트라 사실상 없지만, 있으면 조용히 틀린다.
  const byKey = new Map<string, ImageEntry | null>()
  // 라벨 없는 사진도 짓는다 — 열쇠에 범주(`_unlabeled`)가 들어 훈련 행의 열쇠와 겹칠 수 없다.
  for (const entry of readImages(project, 'data')) {
    const key = rowKeyOf(entry.category, entry.hash)
    byKey.set(key, byKey.has(key) ? null : entry)
  }

  const rows: string[][] = []
  for (const index of experiment.settings.trainIndices) {
    const key = keys[index]
    const entry = key === undefined ? undefined : byKey.get(key)
    if (!entry) return null
    const vector = vectors.get(entry.hash)
    if (vector === undefined) return null
    // `imageTrainingSource`와 같은 왕복이다 — `Dataset`의 칸이 문자열이다.
    rows.push([...Array.from(vector, (value) => String(value)), entry.category])
  }

  const dataset: Dataset = {
    columns: [...embeddingColumns(backbone.embeddingDim), IMAGE_LABEL_COLUMN],
    rows,
  }
  const positions = rows.map((_, position) => position)
  return {
    indices: experiment.settings.trainIndices,
    // 인코딩은 아무 일도 안 한다 — 임베딩에는 범주형 열이 없다.
    features: transform(preprocessor, dataset, positions, 'onehot'),
    target: targetValues(dataset, positions, IMAGE_LABEL_COLUMN),
  }
}

/**
 * 이미지 모델 하나를 읽을 맥락. **못 세운 행을 빈 맥락으로 넘기지 않는다.**
 *
 * 빈 맥락이면 해석기가 `MODEL_NEEDS_DATASET`을 던지고, 사진 한 장 더한 학생에게
 * "이 파일에는 데이터가 없다"고 말한다. 사진은 있다 — 바뀐 것이다 (mlpx-spec.md §5.1).
 * 행이 필요 없는 형식은 행이 없어도 그대로 읽는다. 무는 검사: `image-training.spec.ts`.
 */
export function imageLoadContext(rows: TrainingRows | null, format: string): LoadContext {
  if (rows) return { trainingRows: rows }
  if (interpreterFor(format)?.needsTrainingRows) {
    throw new ClientError('MODEL_TRAINING_DATA_CHANGED')
  }
  return {}
}
