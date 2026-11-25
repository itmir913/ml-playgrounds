/**
 * **채점 자료를 묶는다** (open-decisions.md 122, architecture.md §8.21).
 *
 * 제출물마다 `project.json`이 원본이고 `submissions.jsonl`은 같은 객체를 줄마다, CSV 둘은 거기서 뽑은 열이다.
 * 파일 이름·열 머리·키는 번역하지 않는다(`i18n.md`). 번역하는 것은 `README.md`의 설명뿐이다.
 */

import { toCanonicalCsv } from '../data/serialize'
import type { ClientErrorParams } from '../errors'
import { deadlineEnd, deadlineToInput, deadlineVerdict, minutesLate } from './deadline'
import type { SubmissionContent } from './grading-record'
import { GRADING_RECORD_VERSION } from './grading-record'
import { jsonText } from './json-text'
import {
  BUNDLE_INDEX_COLUMNS,
  entriesOf,
  folderNames,
  zipBundle,
  type BundleEntry,
} from './portfolio-bundle'
import type { Translate } from './portfolio-text'

export const GRADING_README = 'README.md'
export const GRADING_SUBMISSIONS = 'submissions.csv'
export const GRADING_RUNS = 'runs.csv'
export const GRADING_LINES = 'submissions.jsonl'
const GRADING_RECORD = 'project.json'

/** 묶음 맨 위의 이름들. **제출물의 폴더가 이 이름을 못 갖는다.** */
export const GRADING_RESERVED = [
  GRADING_README,
  GRADING_SUBMISSIONS,
  GRADING_RUNS,
  GRADING_LINES,
] as const

/** **새 열은 맨 뒤에 붙인다** — 이미 받은 표를 읽는 스크립트가 열 자리로 읽을 수 있다. */
export const SUBMISSION_COLUMNS = [
  ...BUNDLE_INDEX_COLUMNS,
  'failure',
  'projectId',
  'sameProject',
  'createdAt',
  'updatedAt',
  'lastTrainedAt',
  'deadline',
  'deadlineVerdict',
  'minutesLate',
  'dataType',
  'taskType',
  'rowCount',
  'columnCount',
  'imageCount',
  'experimentCount',
  'runCount',
  'portfolioCharacters',
  'integrity',
  'fileSizeBytes',
] as const

/**
 * 지표 열. 등록부 밖의 지표는 JSON에만 있다. 점검은 지표 모듈을 들일 수 없어(`inspect-rules.spec.ts`) 이름을
 * 적고, `grading-bundle.spec.ts`의 *"지표 열은 등록부와 같다"*가 등록부와 대조한다.
 */
export const METRIC_COLUMNS = [
  'accuracy',
  'f1Macro',
  'r2',
  'rmse',
  'mae',
  'silhouette',
  'inertia',
] as const

/** 줄의 열쇠는 `source`·`experimentId`·`runId`다 — 한 실험에 같은 알고리즘이 둘일 수 있다. */
export const RUN_COLUMNS = [
  'folder',
  'source',
  'studentId',
  'studentName',
  'experimentNumber',
  'experimentId',
  'runId',
  'changed',
  'taskType',
  'algorithm',
  'computedBy',
  'status',
  'trainedAt',
  'trainCount',
  'testCount',
  'hyperparameters',
  'preprocessing',
  'split',
  ...METRIC_COLUMNS,
  'failure',
  'warning',
  'accuracyMatchesMatrix',
] as const

/** 묶음에 들어가는 제출물 하나. 못 읽은 것은 `failure`만 있다. */
export interface GradingEntry extends BundleEntry {
  readonly fileSizeBytes: number
  readonly content?: SubmissionContent
  readonly failure?: { readonly code: string; readonly params?: ClientErrorParams }
  readonly sameProject?: string
}

export interface GradingOptions {
  readonly translate: Translate
  readonly locale: string
  readonly deadline: number | null
  /** 낸 시각. */
  readonly now: string
}

type Cell = string | number | boolean | null | undefined | object

/** 칸 하나. 없는 값은 빈 칸, 객체와 배열은 JSON이다. */
function cell(value: Cell): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

function recordOf(entry: GradingEntry, folder: string | undefined, options: GradingOptions) {
  const manifest = entry.file?.document.manifest
  const updatedAt = manifest?.updatedAt
  const { deadline } = options
  return {
    recordVersion: GRADING_RECORD_VERSION,
    exportedAt: options.now,
    exportedByAppVersion: __APP_VERSION__,
    folder: folder ?? '',
    source: entry.label,
    fileSizeBytes: entry.fileSizeBytes,
    failure: entry.failure
      ? { code: entry.failure.code, params: entry.failure.params ?? null }
      : null,
    // **늘 있고 비면 빈 글자다** (open-decisions.md 122).
    studentId: entry.studentId?.trim() ?? '',
    studentName: entry.studentName?.trim() ?? '',
    studentIdInFile: manifest?.student?.studentId?.trim() ?? '',
    studentNameInFile: manifest?.student?.name?.trim() ?? '',
    sameProject: entry.sameProject ?? null,
    deadline:
      deadline === null
        ? null
        : {
            input: deadlineToInput(deadline),
            lateFrom: new Date(deadlineEnd(deadline)).toISOString(),
            verdict: updatedAt === undefined ? null : deadlineVerdict(updatedAt, deadline),
            minutesLate: updatedAt === undefined ? null : minutesLate(updatedAt, deadline),
          },
    project: entry.content?.project ?? null,
    integrity: entry.content?.integrity ?? null,
    data: entry.content?.data ?? null,
    settings: entry.content?.settings ?? null,
    experimentCount: entry.content?.experimentCount ?? null,
    runCount: entry.content?.runCount ?? null,
    lastTrainedAt: entry.content?.lastTrainedAt ?? null,
    experiments: entry.content?.experiments ?? null,
    portfolio: entry.content?.portfolio ?? null,
  }
}

type GradingRecord = ReturnType<typeof recordOf>

function submissionRow(record: GradingRecord): string[] {
  const project = record.project as Record<string, Cell> | null
  const values: Record<(typeof SUBMISSION_COLUMNS)[number], Cell> = {
    folder: record.folder,
    studentId: record.studentId,
    studentName: record.studentName,
    projectName: project?.['name'],
    source: record.source,
    studentIdInFile: record.studentIdInFile,
    studentNameInFile: record.studentNameInFile,
    failure: record.failure?.code,
    projectId: project?.['projectId'],
    sameProject: record.sameProject,
    createdAt: project?.['createdAt'],
    updatedAt: project?.['updatedAt'],
    lastTrainedAt: record.lastTrainedAt,
    deadline: record.deadline?.input,
    deadlineVerdict: record.deadline?.verdict,
    minutesLate: record.deadline?.minutesLate,
    dataType: project?.['dataType'],
    taskType: project?.['taskType'],
    rowCount: record.data?.['rowCount'] as Cell,
    columnCount: record.data?.['columnCount'] as Cell,
    imageCount: record.data?.['imageCount'] as Cell,
    experimentCount: record.experimentCount,
    runCount: record.runCount,
    portfolioCharacters: record.portfolio?.sections.reduce(
      (sum, section) => sum + section.characters,
      0,
    ),
    integrity: record.integrity?.status,
    fileSizeBytes: record.fileSizeBytes,
  }
  return SUBMISSION_COLUMNS.map((column) => cell(values[column]))
}

function runRows(record: GradingRecord): string[][] {
  return (record.experiments ?? []).flatMap((experiment) => {
    const settings = experiment.settings as Record<string, Cell>
    const data = settings['data'] as Record<string, Cell>
    const outer = experiment as Record<string, unknown>
    return experiment.runs.map((run) => {
      const own = run as Record<string, unknown>
      const metrics = Object.fromEntries(
        METRIC_COLUMNS.map((name) => [name, run.metrics?.[name]]),
      ) as Record<(typeof METRIC_COLUMNS)[number], number | undefined>
      const values: Record<(typeof RUN_COLUMNS)[number], Cell> = {
        folder: record.folder,
        source: record.source,
        studentId: record.studentId,
        studentName: record.studentName,
        experimentNumber: experiment.number,
        experimentId: outer['id'] as Cell,
        runId: run.id,
        changed: outer['changed'] as Cell,
        taskType: settings['taskType'],
        algorithm: own['algorithm'] as Cell,
        computedBy: own['computedBy'] as Cell,
        status: own['status'] as Cell,
        trainedAt: own['trainedAt'] as Cell,
        trainCount: experiment.trainCount,
        testCount: experiment.testCount,
        hyperparameters: own['hyperparameters'] as Cell,
        preprocessing: data['preprocessing'],
        split: settings['split'],
        ...metrics,
        failure: own['failure'] as Cell,
        warning: own['warning'] as Cell,
        accuracyMatchesMatrix: run.accuracyMatchesMatrix,
      }
      return RUN_COLUMNS.map((column) => cell(values[column]))
    })
  })
}

/** README의 문장들. **문장마다 키 하나다** (`i18n.md` 규칙 3). */
export const README_FILE_KEYS = [
  'inspect.gradingReadme.submissions',
  'inspect.gradingReadme.runs',
  'inspect.gradingReadme.lines',
  'inspect.gradingReadme.record',
  'inspect.gradingReadme.portfolio',
] as const

export const README_NOTE_KEYS = [
  'inspect.gradingReadme.data',
  'inspect.gradingReadme.empty',
  'inspect.gradingReadme.changed',
  'inspect.gradingReadme.deadline',
  'inspect.gradingReadme.clock',
  'inspect.gradingReadme.integrity',
  'inspect.gradingReadme.removed',
  'inspect.gradingReadme.kinds',
  'inspect.gradingReadme.importance',
  'inspect.gradingReadme.formula',
  'inspect.gradingReadme.privacy',
] as const

function readmeOf(translate: Translate): string {
  const lines = (keys: readonly string[]) => keys.map((key) => `- ${translate(key)}`)
  return [
    `# ${translate('inspect.gradingReadme.title')}`,
    '',
    ...lines(README_FILE_KEYS),
    '',
    ...lines(README_NOTE_KEYS),
    '',
    `- ${GRADING_SUBMISSIONS}: ${SUBMISSION_COLUMNS.join(', ')}`,
    `- ${GRADING_RUNS}: ${RUN_COLUMNS.join(', ')}`,
    '',
  ].join('\n')
}

export function gradingBundleOf(entries: readonly GradingEntry[], options: GradingOptions): Blob {
  const encode = (text: string) => new TextEncoder().encode(text)
  const read = entries.filter(
    (entry): entry is GradingEntry & Required<Pick<GradingEntry, 'file'>> =>
      entry.file !== undefined,
  )
  const names = folderNames(
    read.map((entry) => ({
      label: entry.label,
      ...(entry.studentId === undefined ? {} : { studentId: entry.studentId }),
      ...(entry.studentName === undefined ? {} : { studentName: entry.studentName }),
      title: entry.file.document.manifest.name,
    })),
    GRADING_RESERVED,
  )
  const folderOf = new Map<GradingEntry, string | undefined>(
    read.map((entry, index) => [entry, names[index]]),
  )
  const records = entries.map((entry) => recordOf(entry, folderOf.get(entry), options))

  const files: Record<string, Uint8Array> = {
    [GRADING_README]: encode(readmeOf(options.translate)),
    [GRADING_SUBMISSIONS]: toCanonicalCsv([[...SUBMISSION_COLUMNS], ...records.map(submissionRow)]),
    [GRADING_RUNS]: toCanonicalCsv([[...RUN_COLUMNS], ...records.flatMap(runRows)]),
    [GRADING_LINES]: encode(records.map((record) => `${JSON.stringify(record)}\n`).join('')),
  }
  for (const [index, entry] of entries.entries()) {
    const folder = folderOf.get(entry)
    if (!entry.file || folder === undefined) continue
    files[`${folder}/${GRADING_RECORD}`] = encode(`${jsonText(records[index]) ?? ''}\n`)
    Object.assign(
      files,
      entriesOf(entry.file, folder, options.translate, options.locale, {
        ...(entry.studentId === undefined ? {} : { studentId: entry.studentId }),
        ...(entry.studentName === undefined ? {} : { studentName: entry.studentName }),
      }),
    )
  }
  return zipBundle(files)
}
