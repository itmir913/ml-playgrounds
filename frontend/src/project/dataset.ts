/**
 * 확정한 표를 프로젝트에 붙인다.
 *
 * **순수 함수다.** 저장은 부르는 쪽이 한다 — 여기서 IndexedDB를 만지면 "붙였을 때
 * 무엇이 지워지는가"를 화면 없이 확인할 수 없다.
 *
 * 여기가 지키는 것은 하나다 — **데이터가 바뀌면 기존 실험을 전부 지운다**
 * (mlpx-spec.md §4.3). 참조형 모델(KNN·SVM)은 `dataset/data.csv`의 **행 번호**를
 * 가리키므로, 표가 바뀌면 그 번호가 다른 것을 가리켜 **조용히 틀린 예측**을 한다.
 * 지표도 다른 데이터 기준이라 비교 자체가 성립하지 않는다.
 */

import { acceptPredictDataset, alignTestDataset, columnNames, toDataset } from '@/data/columns'
import { parseCsvText } from '@/data/csv'
import { toCanonicalCsv } from '@/data/serialize'
import type { ImportedTable } from '@/data/table'
import { hashBytes } from '@/hash'
import type { Dataset } from '@/ml/preprocess'
import {
  PREDICT_DATASET_PATH,
  TABULAR_DATASET_PATH,
  TEST_DATASET_PATH,
  type Dataset as StoredDataset,
  type ProjectFile,
} from './format'
import { dataSettings, tabularDataOf, type DatasetRef } from './schema'

/**
 * 정본 CSV를 학습 계층이 쓰는 표로 읽는다. 표가 없으면 `null`이다 - 정상 상태다.
 *
 * **파싱 결과를 정본 바이트에 매달아 둔다.** 화면은 체크박스 하나를 누를 때마다
 * 프로젝트 문서를 통째로 갈아 끼우는데(shallowRef라 그래야 한다) 그때마다 5천 줄을
 * 다시 파싱하면 교실 PC에서 클릭이 끊긴다. 정본은 확정된 뒤로 바뀌지 않으므로
 * (open-decisions.md "정본 데이터셋은 언제나 UTF-8 CSV다") 바이트가 같으면 표도 같다.
 *
 * `hasHeader`는 키에 안 넣는다. 표를 바꾸는 유일한 경로인 `applyDataset`이 바이트와
 * 함께 새로 만들기 때문에, 머리글 판단만 따로 바뀌는 일이 없다.
 */
const parsed = new WeakMap<StoredDataset, Dataset>()

export function readDataset(project: ProjectFile | null): Dataset | null {
  const reference = tabularDataOf(project?.document)?.dataset
  const stored = project?.dataset
  if (!stored || !reference) return null

  const cached = parsed.get(stored)
  if (cached) return cached

  const table = toDataset(parseCsvText(new TextDecoder().decode(stored.bytes)), reference.hasHeader)
  parsed.set(stored, table)
  return table
}

/** readDataset과 같은 캐시 규칙, 예측 데이터(predict.csv)를 위한 것. */
const parsedPredict = new WeakMap<StoredDataset, Dataset>()

/**
 * 예측 데이터를 학습 계층이 쓰는 표로 읽는다. 아직 파일을 안 올렸으면 `null`이다 -
 * 정상 상태다 (mlpx-spec.md §1.1).
 */
export function readPredictDataset(project: ProjectFile | null): Dataset | null {
  const reference = tabularDataOf(project?.document)?.predictDataset
  const stored = project?.predictDataset
  if (!stored || !reference) return null

  const cached = parsedPredict.get(stored)
  if (cached) return cached

  const table = toDataset(parseCsvText(new TextDecoder().decode(stored.bytes)), reference.hasHeader)
  parsedPredict.set(stored, table)
  return table
}

/** readDataset과 같은 캐시 규칙, 평가 데이터(test.csv)를 위한 것. */
const parsedTest = new WeakMap<StoredDataset, Dataset>()

/**
 * 평가 데이터를 학습 계층이 쓰는 표로 읽는다. `split.method`가 `provided`가 아니면
 * `null`이다 - 정상 상태다.
 */
export function readTestDataset(project: ProjectFile | null): Dataset | null {
  const reference = tabularDataOf(project?.document)?.testDataset
  const stored = project?.testDataset
  if (!stored || !reference) return null

  const cached = parsedTest.get(stored)
  if (cached) return cached

  const table = toDataset(parseCsvText(new TextDecoder().decode(stored.bytes)), reference.hasHeader)
  parsedTest.set(stored, table)
  return table
}

export interface AppliedDataset {
  readonly project: ProjectFile
  /** 지워진 실험 수. 0이 아니면 화면이 붙이기 전에 학생에게 알려야 한다. */
  readonly droppedExperiments: number
  /** 새 표에 없어서 선택에서 빠진 열 이름들. 조용히 사라지면 안 된다. */
  readonly droppedColumns: readonly string[]
}

export interface ApplyOptions {
  /** 학생이 올린 파일의 이름. 정본 경로가 아니라 기록이다. */
  readonly fileName: string
  /** 첫 줄이 머리글인가. 학생이 미리보기를 보고 고른다. */
  readonly hasHeader: boolean
  /** ISO 8601. manifest.updatedAt에 찍는다. */
  readonly now: string
}

export function applyDataset(
  project: ProjectFile,
  imported: ImportedTable,
  options: ApplyOptions,
): AppliedDataset {
  const { document } = project
  const names = new Set(columnNames(imported.grid, options.hasHeader))

  // 열 선택은 **살아남은 것만** 남긴다. 통째로 비우면 오타 하나 고치려고 CSV를 다시
  // 올린 학생이 고르기를 처음부터 다시 한다. 없는 열을 남겨 두는 것은 더 나쁘다 -
  // 학습이 시작된 뒤에야 터진다.
  // 표 화면에서만 부른다. 이미지 프로젝트가 여기 오면 그건 배선 버그이므로 던지는 쪽이 맞다.
  const previous = dataSettings('tabular', document.settings)
  const features = previous.features.filter((name) => names.has(name))
  const target =
    previous.target !== undefined && names.has(previous.target) ? previous.target : undefined

  const droppedColumns = [
    ...previous.features.filter((name) => !names.has(name)),
    ...(previous.target !== undefined && !names.has(previous.target) ? [previous.target] : []),
  ]

  const dataset: DatasetRef = {
    path: TABULAR_DATASET_PATH,
    originalFileName: options.fileName,
    hasHeader: options.hasHeader,
    // 정본은 언제나 UTF-8 CSV다. 올라온 파일이 무엇이었는지는 따로 남는다.
    encoding: 'utf-8',
    ...(imported.sourceEncoding === null ? {} : { sourceEncoding: imported.sourceEncoding }),
  }

  // **평가·예측 데이터도 함께 뗀다.** 참조만 남고 본체가 없으면 writeProject가 거부해
  // **그 프로젝트를 저장도 내보내기도 못 하게 된다** (mlpx-spec.md §1 "함께 있고 함께
  // 없다"). 그리고 정본 열이 통째로 바뀐 마당에 옛 test.csv는 어차피 대조를 다시
  // 통과해야 하는 파일이라, 들고 있어 봐야 학습이 시작된 뒤에 터진다.
  const data = { ...previous, dataset, features, target }
  delete data.testDataset
  delete data.predictDataset

  const settings = {
    ...document.settings,
    data,
    // 평가 데이터가 없어졌으므로 분할 방식도 되돌아간다 - provided인 채로 두면
    // 학습이 평가할 것을 못 찾는다 (ml/split.ts).
    split: { ...document.settings.split, method: 'holdout' as const },
  }

  return {
    project: {
      document: {
        ...document,
        manifest: { ...document.manifest, updatedAt: options.now },
        settings,
        // mlpx-spec.md §4.3. 모델도 함께 버린다 - 남으면 고아가 된다.
        runs: { ...document.runs, experiments: [] },
      },
      dataset: { bytes: imported.bytes, hash: imported.hash },
      testDataset: undefined,
      predictDataset: undefined,
      models: new Map(),
      // 표 프로젝트라 사진이 없다. 빈 맵이 정상이다.
      images: new Map(),
      // **첨부는 데이터 종류와 무관하다** - 표 프로젝트에도 있다 (mlpx-spec.md §8.6.1).
      // 여기서 버리면 문서의 참조만 남아 학생이 포트폴리오에 붙인 사진이 조용히 사라진다.
      attachments: project.attachments,
      embeddings: new Map(),
    },
    droppedExperiments: document.runs.experiments.length,
    droppedColumns,
  }
}

export interface AppliedTestDataset {
  readonly project: ProjectFile
  /** 지워진 실험 수. 0이 아니면 화면이 붙이기 전에 학생에게 알려야 한다. */
  readonly droppedExperiments: number
}

export interface ApplyTestOptions {
  /** 학생이 올린 파일의 이름. 정본 경로가 아니라 기록이다. */
  readonly fileName: string
  /** 첫 줄이 머리글인가. 학생이 미리보기를 보고 고른다. */
  readonly hasHeader: boolean
  /** ISO 8601. manifest.updatedAt에 찍는다. */
  readonly now: string
}

/**
 * 평가 데이터를 프로젝트에 붙인다. **정본(`data.csv`)의 열 전체와 이름으로 대조한다**
 * (`alignTestDataset`, mlpx-spec.md §1.1) - 특성만 대조하면 특성이 나중에 늘 때마다
 * 받아 둔 파일이 조용히 무효가 진다.
 *
 * **저장하는 바이트는 정본 순서로 다시 세운 것이다.** 열 순서가 달라도 이름으로
 * 재배열하므로, 여기서부터 나가는 test.csv는 항상 머리글이 있고 data.csv와 같은
 * 열 순서를 갖는다.
 *
 * **붙이면 지금까지의 실험을 전부 지운다** - `applyDataset`과 같은 사유다. 평가셋이
 * 바뀌면 그 위의 점수가 전부 다른 것을 잰 값이 된다
 * (open-decisions.md "학습용과 평가용 파일이 따로일 수 있다").
 *
 * 정본이 아직 없거나 타깃이 안 정해졌으면 부르면 안 된다 - 화면이 그 전에 막는다
 * (타깃이 있어야 정본 열 목록에 뜻이 생긴다).
 */
export function applyTestDataset(
  project: ProjectFile,
  imported: ImportedTable,
  options: ApplyTestOptions,
): AppliedTestDataset {
  const { document } = project
  const canonical = readDataset(project)
  // 화면이 그 전에 막는다 - 정본이 있어야 대조할 열 목록이 있다. 호출부 버그다.
  if (!canonical) throw new Error('applyTestDataset: no canonical dataset')

  const aligned = alignTestDataset(imported.grid, options.hasHeader, canonical.columns)
  const bytes = toCanonicalCsv([aligned.columns, ...aligned.rows])

  const testDataset: DatasetRef = {
    path: TEST_DATASET_PATH,
    originalFileName: options.fileName,
    // 저장하는 바이트는 언제나 머리글(정본 열 이름)로 시작한다 - 올린 파일에
    // 머리글이 없었어도 여기서부터는 있다.
    hasHeader: true,
    encoding: 'utf-8',
    ...(imported.sourceEncoding === null ? {} : { sourceEncoding: imported.sourceEncoding }),
  }

  return {
    project: {
      document: {
        ...document,
        manifest: { ...document.manifest, updatedAt: options.now },
        settings: {
          ...document.settings,
          data: { ...dataSettings('tabular', document.settings), testDataset },
          split: { ...document.settings.split, method: 'provided' },
        },
        runs: { ...document.runs, experiments: [] },
      },
      dataset: project.dataset,
      testDataset: { bytes, hash: hashBytes(bytes) },
      // **예측 데이터는 그대로 둔다.** 점수와 무관하므로 지울 이유가 없고, 여기서
      // 떨어뜨리면 참조만 남아 저장이 막힌다 (mlpx-spec.md §1).
      predictDataset: project.predictDataset,
      models: new Map(),
      // 표 프로젝트라 사진이 없다. 빈 맵이 정상이다.
      images: new Map(),
      // **첨부는 데이터 종류와 무관하다** - 표 프로젝트에도 있다 (mlpx-spec.md §8.6.1).
      // 여기서 버리면 문서의 참조만 남아 학생이 포트폴리오에 붙인 사진이 조용히 사라진다.
      attachments: project.attachments,
      embeddings: new Map(),
    },
    droppedExperiments: document.runs.experiments.length,
  }
}

export interface AppliedPredictDataset {
  readonly project: ProjectFile
}

export interface ApplyPredictOptions {
  /** 학생이 올린 파일의 이름. 정본 경로가 아니라 기록이다. */
  readonly fileName: string
  /** 첫 줄이 머리글인가. 학생이 미리보기를 보고 고른다. */
  readonly hasHeader: boolean
  /** ISO 8601. manifest.updatedAt에 찍는다. */
  readonly now: string
  /**
   * 있는지 **확인할** 열. **특성 열의 합집합이다 - 정본 열 전체가 아니다**
   * (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다"). 화면이 지금 보이는
   * 모델들의 실험을 모아 만든다 (`ml/predict.ts`의 `mergeFields`).
   *
   * **저장할 열이 아니다.** 여기 없는 열도 파일에 그대로 담긴다 (아래).
   */
  readonly requiredColumns: readonly string[]
}

/**
 * 예측 데이터를 프로젝트에 붙인다. **`applyTestDataset`과 결정적으로 다른 점 하나** -
 * **실험을 지우지 않는다.** 예측 데이터는 점수에 영향을 주지 않는다 - `.mlpx`에는
 * 담기지만(학생이 올린 데이터라서, mlpx-spec.md §0) 학습에도 채점에도 안 쓰인다.
 * `split.method`도 건드리지 않는다.
 *
 * `requiredColumns`(특성 열의 합집합)가 다 있는지 본다(`acceptPredictDataset`) - 타깃
 * 열은 요구하지 않는다.
 *
 * **저장하는 것은 올린 열 전부다 - 요구한 열만이 아니다**
 * (open-decisions.md "검사는 특성 열, 저장은 올린 열 전부"). 요구 목록은 학생이 특성을
 * 바꿀 때마다 달라지므로, 여기서 나머지를 버리면 이미 붙인 파일이 그 순간 조용히
 * 무효가 된다. 열 순서도 올린 그대로다.
 *
 * **머리글은 언제나 붙는다** - `applyTestDataset`과 같은 이유로, 여기서부터 나가는
 * predict.csv는 첫 줄이 열 이름이다.
 */
export function applyPredictDataset(
  project: ProjectFile,
  imported: ImportedTable,
  options: ApplyPredictOptions,
): AppliedPredictDataset {
  const { document } = project

  const accepted = acceptPredictDataset(imported.grid, options.hasHeader, options.requiredColumns)
  const bytes = toCanonicalCsv([accepted.columns, ...accepted.rows])

  const predictDataset: DatasetRef = {
    path: PREDICT_DATASET_PATH,
    originalFileName: options.fileName,
    // 저장하는 바이트는 언제나 머리글(열 이름)로 시작한다 - 올린 파일에 머리글이
    // 없었어도 여기서부터는 있다(그때 이름은 columnNames가 만든 엑셀식 이름이다).
    hasHeader: true,
    encoding: 'utf-8',
    ...(imported.sourceEncoding === null ? {} : { sourceEncoding: imported.sourceEncoding }),
  }

  return {
    project: {
      document: {
        ...document,
        manifest: { ...document.manifest, updatedAt: options.now },
        settings: {
          ...document.settings,
          data: { ...dataSettings('tabular', document.settings), predictDataset },
        },
        // 실험은 그대로다 - 예측 데이터는 점수에 영향을 주지 않는다.
      },
      dataset: project.dataset,
      testDataset: project.testDataset,
      predictDataset: { bytes, hash: hashBytes(bytes) },
      models: project.models,
      images: project.images,
      attachments: project.attachments,
      embeddings: project.embeddings,
    },
  }
}

/**
 * 예측 데이터를 뗀다. **실험은 원래부터 안 지운다** - 붙일 때와 같은 이유다.
 */
export function removePredictDataset(project: ProjectFile, now: string): AppliedPredictDataset {
  const { document } = project
  if (document.settings.data.predictDataset === undefined) {
    // 이미 없다. 지울 것도 없다.
    return { project }
  }

  const data = { ...document.settings.data }
  delete data.predictDataset
  const settings = { ...document.settings, data }

  return {
    project: {
      document: {
        ...document,
        manifest: { ...document.manifest, updatedAt: now },
        settings,
      },
      dataset: project.dataset,
      testDataset: project.testDataset,
      predictDataset: undefined,
      models: project.models,
      images: project.images,
      attachments: project.attachments,
      embeddings: project.embeddings,
    },
  }
}

/**
 * 평가 데이터를 뗀다. `split.method`를 `holdout`으로 되돌린다.
 *
 * **떼도 실험을 전부 지운다** - `applyTestDataset`과 같은 사유다.
 */
export function removeTestDataset(project: ProjectFile, now: string): AppliedTestDataset {
  const { document } = project
  if (document.settings.data.testDataset === undefined) {
    // 이미 없다. 지울 것도 없다 - 호출부 버그가 아니라 조용히 아무 일도 안 한다.
    return { project, droppedExperiments: 0 }
  }

  const data = { ...document.settings.data }
  delete data.testDataset
  const settings = {
    ...document.settings,
    data,
    split: { ...document.settings.split, method: 'holdout' as const },
  }

  return {
    project: {
      document: {
        ...document,
        manifest: { ...document.manifest, updatedAt: now },
        settings,
        runs: { ...document.runs, experiments: [] },
      },
      dataset: project.dataset,
      testDataset: undefined,
      // 예측 데이터는 그대로 둔다 - `applyTestDataset`과 같은 이유다.
      predictDataset: project.predictDataset,
      models: new Map(),
      // 표 프로젝트라 사진이 없다. 빈 맵이 정상이다.
      images: new Map(),
      // **첨부는 데이터 종류와 무관하다** - 표 프로젝트에도 있다 (mlpx-spec.md §8.6.1).
      // 여기서 버리면 문서의 참조만 남아 학생이 포트폴리오에 붙인 사진이 조용히 사라진다.
      attachments: project.attachments,
      embeddings: new Map(),
    },
    droppedExperiments: document.runs.experiments.length,
  }
}
