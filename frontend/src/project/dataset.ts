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

import { columnNames } from '@/data/columns'
import type { ImportedTable } from '@/data/table'
import { TABULAR_DATASET_PATH, type ProjectFile } from './format'
import type { DatasetRef } from './schema'

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
  const features = document.settings.features.filter((name) => names.has(name))
  const target =
    document.settings.target !== undefined && names.has(document.settings.target)
      ? document.settings.target
      : undefined

  const droppedColumns = [
    ...document.settings.features.filter((name) => !names.has(name)),
    ...(document.settings.target !== undefined && !names.has(document.settings.target)
      ? [document.settings.target]
      : []),
  ]

  const dataset: DatasetRef = {
    path: TABULAR_DATASET_PATH,
    originalFileName: options.fileName,
    hasHeader: options.hasHeader,
    // 정본은 언제나 UTF-8 CSV다. 올라온 파일이 무엇이었는지는 따로 남는다.
    encoding: 'utf-8',
    ...(imported.sourceEncoding === null ? {} : { sourceEncoding: imported.sourceEncoding }),
  }

  return {
    project: {
      document: {
        ...document,
        manifest: { ...document.manifest, updatedAt: options.now },
        settings: { ...document.settings, dataset, features, target },
        // mlpx-spec.md §4.3. 모델도 함께 버린다 - 남으면 고아가 된다.
        runs: { ...document.runs, experiments: [] },
      },
      dataset: { bytes: imported.bytes, hash: imported.hash },
      models: new Map(),
    },
    droppedExperiments: document.runs.experiments.length,
    droppedColumns,
  }
}
