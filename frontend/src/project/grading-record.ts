/**
 * 제출물 하나를 **채점 자료의 기록**으로 옮긴다 (open-decisions.md 122). 순수 함수다.
 *
 * **골라 싣는다.** 스키마의 object는 전부 looseObject라 모르는 키가 문서에 살아 있다 — 펴서 빼면 남이 손댄 파일의
 * 큰 덩어리가 그대로 나간다. 싣는 키(`RECORDED`)와 빼는 키(`OMITTED`)는 아래 표이고, 스키마에 키가 늘면
 * `grading-record.spec.ts`의 *"스키마의 키는 싣거나 뺀다고 적혀 있다"*가 운다.
 *
 * **없는 값은 `null`이다.** 줄마다 키 집합이 갈리지 않게 한다. 학번·이름만 `""`다.
 */

import type { TableSummary } from '@/data/summary/protocol'
import type { ClientErrorParams } from '@/errors'
import { lossCurveOf } from '@/ml/loss-curve'
import { experimentPreprocessor } from '@/ml/preprocess'
import { storedMetricsMatchMatrix } from '@/ml/reproduce'
import { experimentOrder } from '@/ml/results'

import { IMAGE_UNLABELED, type Dataset, type ProjectFile, type ReadResult } from './format'
import { countByCategory, readImages, testCountByCategory } from './images'
import { attachmentsOf, orphanAnswers, portfolioSections } from './portfolio'
import { tabularDataOf, type DataType, type Experiment, type Run } from './schema'

/** 기록의 모양이 바뀌면 올린다. **`.mlpx` 포맷 버전과 무관하다** (open-decisions.md 122). */
export const GRADING_RECORD_VERSION = 1

/** 스키마의 키 가운데 그대로 싣는 것. */
export const RECORDED = {
  manifest: [
    'formatVersion',
    'appVersion',
    'projectId',
    'name',
    'createdAt',
    'updatedAt',
    'kind',
    'taskType',
    'dataType',
    'locale',
  ],
  settings: ['split', 'nSamples', 'runtime', 'selectedAlgorithms', 'hyperparameters'],
  tabularSettings: [
    'dataset',
    'testDataset',
    'predictDataset',
    'features',
    'target',
    'preprocessing',
  ],
  imageSettings: ['dataset', 'testDataset', 'predictDataset', 'categories', 'backboneId'],
  experiment: ['id', 'startedAt', 'changed'],
  experimentSettings: ['taskType', 'runtime', 'selectedAlgorithms', 'split', 'nSamples'],
  tabularSnapshot: ['features', 'target', 'preprocessing'],
  imageSnapshot: ['categories', 'backboneId', 'categoryCounts', 'unlabeledCount', 'rowsHash'],
  run: [
    'id',
    'algorithm',
    'hyperparameters',
    'computedBy',
    'trainedAt',
    'status',
    'metrics',
    'perClass',
    'confusionMatrix',
    'featureImportance',
    'engine',
    'failure',
    'warning',
    'modelOmitted',
    'modelOmittedDetail',
  ],
  portfolio: ['answerFormat'],
} as const

/** 그대로 싣지 않는 것 — 다른 모양으로 옮기거나(괄호) 뺀다. */
export const OMITTED = {
  /** `studentIdInFile`·`studentNameInFile`로. */
  manifest: ['student'],
  /** 종류별 표로. */
  settings: ['data'],
  tabularSettings: [],
  imageSettings: [],
  /** `settings`는 아래 표로, 전처리기는 열 종류만, `runs`는 하나씩. */
  experiment: ['settings', 'preprocessor', 'runs'],
  /** 분할 행 번호는 개수만. */
  experimentSettings: ['data', 'trainIndices', 'testIndices'],
  tabularSnapshot: [],
  imageSnapshot: ['rowKeys'],
  /** 모델은 형식과 크기만. */
  run: ['model'],
  /** 문항마다로. */
  portfolio: ['template', 'answers', 'attachments'],
} as const

type Json = Record<string, unknown>

function pick(value: object, keys: readonly string[]): Json {
  const source = value as Json
  return Object.fromEntries(keys.map((key) => [key, source[key] ?? null]))
}

/** 표 하나의 요약과, 못 냈을 때의 사유. 표가 없으면 자리 자체가 `null`이다. */
export interface RecordedTable {
  readonly summary: TableSummary | null
  readonly failure: { readonly code: string; readonly params: ClientErrorParams } | null
}

export const TABLE_ROLES = ['dataset', 'testDataset', 'predictDataset'] as const
export type TableRole = (typeof TABLE_ROLES)[number]
export type RecordedTables = Partial<Record<TableRole, RecordedTable>>

/** 요약할 표들. 사진 프로젝트와 표를 아직 안 올린 프로젝트는 비어 있다. */
export function tablesOf(
  project: ProjectFile,
): { readonly role: TableRole; readonly body: Dataset; readonly hasHeader: boolean }[] {
  const data = tabularDataOf(project.document)
  if (data === null) return []
  return TABLE_ROLES.flatMap((role) => {
    const reference = data[role]
    const body = project[role]
    return reference && body ? [{ role, body, hasHeader: reference.hasHeader }] : []
  })
}

interface KindRecord {
  readonly settings: readonly string[]
  readonly snapshot: readonly string[]
  readonly data: (project: ProjectFile, tables: RecordedTables) => Json
  readonly fitted: (experiment: Experiment, project: ProjectFile) => Json | null
}

/** 종류마다의 기록. `Record<DataType, …>`이라 종류를 더하면 칸을 채워야 한다. */
const KINDS: Readonly<Record<DataType, KindRecord>> = {
  tabular: {
    settings: RECORDED.tabularSettings,
    snapshot: RECORDED.tabularSnapshot,
    data: (_project, tables) => ({
      // 학생이 올린 본체의 크기. 표가 없거나 요약을 못 냈으면 `null`이다.
      rowCount: tables.dataset?.summary?.rowCount ?? null,
      columnCount: tables.dataset?.summary?.columnCount ?? null,
      tables: Object.fromEntries(TABLE_ROLES.map((role) => [role, tables[role] ?? null])),
    }),
    // **실험이 실제로 본 열 종류다.** 표본이나 결측 처리로 파일 전체의 종류와 다를 수 있다. 구한 수치는 안 싣는다.
    fitted: (experiment, project) => {
      const preprocessor = experimentPreprocessor(experiment, project.models)
      if (preprocessor === null) return null
      return {
        columns: preprocessor.columns.map(({ name, kind }) => ({ name, kind })),
        excludedColumns: preprocessor.excludedColumns,
      }
    },
  },
  image: {
    settings: RECORDED.imageSettings,
    snapshot: RECORDED.imageSnapshot,
    data: (project) => {
      const counts = countByCategory(project)
      return {
        imageCount: readImages(project).length,
        categoryCounts: listed(counts, (name) => name !== IMAGE_UNLABELED),
        unlabeledCount: counts.get(IMAGE_UNLABELED) ?? 0,
        testImageCount: readImages(project, 'test').length,
        testCategoryCounts: listed(testCountByCategory(project), () => true),
        predictImageCount: readImages(project, 'predict').length,
      }
    },
    fitted: () => null,
  },
}

function listed(counts: ReadonlyMap<string, number>, keep: (name: string) => boolean): Json[] {
  return [...counts]
    .filter(([name]) => keep(name))
    .map(([category, count]) => ({ category, count }))
}

export type SubmissionContent = ReturnType<typeof contentOf>

/** 읽은 제출물에서 낸 내용. 교사의 고침·마감·묶음은 여기 없다 — `grading-bundle.ts`가 얹는다. */
export function contentOf(read: ReadResult, tables: RecordedTables) {
  const { project, integrity } = read
  const { manifest, settings, runs, portfolio } = project.document
  const kind = KINDS[manifest.dataType]
  const order = experimentOrder(runs.experiments)
  const allRuns = runs.experiments.flatMap((experiment) => experiment.runs)
  const trainedAt = allRuns.map((run) => run.trainedAt).sort(byTime)
  return {
    project: pick(manifest, RECORDED.manifest),
    integrity: {
      status: integrity.status,
      contentHash: integrity.contentHash,
      computedContentHash: integrity.computedContentHash,
      changedEntries: integrity.entries.filter((entry) => entry.state !== 'UNCHANGED'),
    },
    data: kind.data(project, tables),
    settings: {
      ...pick(settings, RECORDED.settings),
      data: pick(settings.data, kind.settings),
    },
    experimentCount: runs.experiments.length,
    runCount: allRuns.length,
    lastTrainedAt: trainedAt.at(-1) ?? null,
    experiments: runs.experiments.map((experiment) => ({
      number: order.get(experiment.id) ?? null,
      ...pick(experiment, RECORDED.experiment),
      settings: {
        ...pick(experiment.settings, RECORDED.experimentSettings),
        data: pick(experiment.settings.data, kind.snapshot),
      },
      trainCount: experiment.settings.trainIndices.length,
      testCount: experiment.settings.testIndices.length,
      fitted: kind.fitted(experiment, project),
      runs: experiment.runs.map((run) => runOf(run, project)),
    })),
    portfolio: {
      ...pick(portfolio, RECORDED.portfolio),
      templateLocale: portfolio.template.locale ?? null,
      sections: portfolioSections(portfolio).map((section) => ({
        id: section.id,
        title: section.title,
        description: section.description ?? null,
        answer: section.answer,
        characters: charactersOf(section.answer),
        attachments: attachmentsOf(portfolio, section.id),
      })),
      orphanAnswers: orphanAnswers(portfolio),
    },
  }
}

function byTime(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right)
}

function runOf(run: Run, project: ProjectFile) {
  return {
    ...pick(run, RECORDED.run),
    id: run.id,
    metrics: run.metrics ?? null,
    model: run.model ? { format: run.model.format, sizeBytes: run.model.sizeBytes } : null,
    lossCurve:
      run.model === undefined
        ? null
        : (lossCurveOf(run.model.format, project.models.get(run.model.path))?.map(
            (point) => point.loss,
          ) ?? null),
    accuracyMatchesMatrix: storedMetricsMatchMatrix(run) ?? null,
  }
}

/** 앞뒤 공백을 뗀 글자 수. **코드 포인트로 센다** — 이모지 하나가 둘로 세이지 않는다. */
function charactersOf(answer: string): number {
  return [...answer.trim()].length
}
