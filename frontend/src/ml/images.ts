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

import type { TrainingRows } from '@/ml/predict'
import { targetValues, transform, type Dataset, type Preprocessor } from '@/ml/preprocess'
import type { BackboneSpec } from '@/ml/backbones'
import { IMAGE_UNLABELED, type ProjectFile } from '@/project/format'
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
 */
export function pendingEmbeddings(
  project: ProjectFile | null,
  have: ReadonlySet<string>,
): readonly ImageEntry[] {
  return readImages(project).filter((entry) => !have.has(entry.hash))
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
}

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
    },
    hashes: entries.map((entry) => entry.hash),
  }
}

/**
 * 참조형 모델(KNN)이 요구하는 학습 행을 이미지에서 되세운다 (mlpx-spec.md §5.0).
 *
 * **못 세우면 `null`이다.** 사진이 학습 뒤에 늘거나 줄었으면 `trainIndices`가 가리키는
 * 자리가 다른 사진이 되고, 그러면 **이웃이 한 장씩 밀린 채로 답만 멀쩡히 나온다.**
 * 그 상태를 잡는 것이 스냅샷의 장수다 — 그 값이 있어야 하는 이유가 여기서 한 번 더 선다
 * (open-decisions.md "장수가 스냅샷에 있어야 하는 이유").
 *
 * **남는 구멍은 같은 수를 지우고 더한 경우 하나다.** 그 경우까지 닫으려면 엔트리 목록의
 * 해시가 필요하고, 그건 학생이 읽을 수 없는 값이라 미뤄 두었다.
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
  const counts = countByCategory(project)
  const sameCounts =
    snapshot.unlabeledCount === (counts.get(IMAGE_UNLABELED) ?? 0) &&
    snapshot.categories.length === snapshot.categoryCounts.length &&
    snapshot.categories.every(
      (category, index) => snapshot.categoryCounts[index] === (counts.get(category) ?? 0),
    )
  if (!sameCounts) return null

  const source = imageTrainingSource(project, vectors, backbone, taskType)
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
