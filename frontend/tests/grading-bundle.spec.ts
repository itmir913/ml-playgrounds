/**
 * 채점 자료의 묶음 (`project/grading-bundle.ts`, open-decisions.md 122).
 */

import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { parseCanonicalCsv } from '../src/data/csv'
import { METRIC_DISPLAY } from '../src/ml/metrics'
import { readProject, type ProjectFile } from '../src/project/format'
import {
  GRADING_LINES,
  GRADING_RESERVED,
  GRADING_RUNS,
  GRADING_SUBMISSIONS,
  gradingBundleOf,
  METRIC_COLUMNS,
  README_FILE_KEYS,
  README_NOTE_KEYS,
  RUN_COLUMNS,
  SUBMISSION_COLUMNS,
  type GradingEntry,
} from '../src/project/grading-bundle'
import { contentOf } from '../src/project/grading-record'
import ko from '../src/locales/ko.json'
import { projectFile } from './fixtures/project'
import { writeProjectBytes } from './fixtures/write'

const OPTIONS = {
  translate: (key: string) => `[${key}]`,
  locale: 'ko',
  deadline: null,
  now: '2026-11-25T00:00:00.000Z',
}

function titled(name: string, updatedAt?: string): ProjectFile {
  const base = projectFile()
  const { student, ...rest } = base.document.manifest
  void student
  const manifest = { ...rest, name, ...(updatedAt === undefined ? {} : { updatedAt }) }
  return { ...base, document: { ...base.document, manifest } }
}

async function entryOf(
  label: string,
  file: ProjectFile,
  extra: Partial<GradingEntry> = {},
): Promise<GradingEntry> {
  const { bytes } = await writeProjectBytes(file, '# 포트폴리오\n')
  const read = await readProject(bytes)
  const { document, attachments } = read.project
  return {
    label,
    fileSizeBytes: bytes.length,
    file: { document, attachments },
    content: contentOf(read, {}),
    ...extra,
  }
}

async function unpack(entries: readonly GradingEntry[], options = {}) {
  const blob = gradingBundleOf(entries, { ...OPTIONS, ...options })
  return unzipSync(new Uint8Array(await blob.arrayBuffer()))
}

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes)

function rows(bytes: Uint8Array | undefined): Record<string, string>[] {
  const [head, ...body] = parseCanonicalCsv(bytes!)
  return body.map((row) => Object.fromEntries(head!.map((name, index) => [name, row[index] ?? ''])))
}

const IDENTITY = ['studentId', 'studentName', 'studentIdInFile', 'studentNameInFile'] as const
const BROKEN: GradingEntry = {
  label: 'broken.mlpx',
  fileSizeBytes: 3,
  failure: { code: 'PROJECT_FILE_NOT_ZIP' },
}

describe('채점 자료 묶음', () => {
  it('지표 열은 등록부와 같다', () => {
    const registered = Object.values(METRIC_DISPLAY).flatMap((list) => list.map((one) => one.name))
    expect([...METRIC_COLUMNS]).toEqual(registered)
  })

  it('학번과 이름은 늘 있고 비면 빈 글자다', async () => {
    const files = await unpack([await entryOf('a.mlpx', titled('붓꽃')), BROKEN])
    const lines = text(files[GRADING_LINES]).trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      const record = JSON.parse(line) as Record<string, unknown>
      for (const key of IDENTITY) expect(record[key], key).toBe('')
    }
    for (const row of rows(files[GRADING_SUBMISSIONS])) {
      for (const key of IDENTITY) expect(row[key], key).toBe('')
    }
    for (const row of rows(files[GRADING_RUNS])) {
      expect(row['studentId']).toBe('')
      expect(row['studentName']).toBe('')
    }
    expect(text(files[GRADING_SUBMISSIONS])).not.toMatch(/undefined|null/)
  })

  it('고친 값과 파일의 값을 함께 싣는다', async () => {
    const base = projectFile()
    const manifest = { ...base.document.manifest, student: { studentId: '1', name: '가' } }
    const file = { ...base, document: { ...base.document, manifest } }
    const files = await unpack([
      await entryOf('a.mlpx', file, { studentId: '2', studentName: '나' }),
    ])
    expect(rows(files[GRADING_SUBMISSIONS])[0]).toMatchObject({
      studentId: '2',
      studentName: '나',
      studentIdInFile: '1',
      studentNameInFile: '가',
    })
  })

  it('JSONL의 줄은 project.json과 같다', async () => {
    const files = await unpack([await entryOf('a.mlpx', titled('붓꽃'))])
    const line: unknown = JSON.parse(text(files[GRADING_LINES]))
    expect(JSON.parse(text(files['붓꽃/project.json']))).toEqual(line)
    expect(files['붓꽃/document.md']).toBeDefined()
  })

  it('못 읽은 제출물도 사유와 함께 한 줄이다', async () => {
    const files = await unpack([await entryOf('a.mlpx', titled('붓꽃')), BROKEN])
    expect(rows(files[GRADING_SUBMISSIONS])[1]).toMatchObject({
      source: 'broken.mlpx',
      folder: '',
      failure: 'PROJECT_FILE_NOT_ZIP',
    })
  })

  it('맨 위 파일과 같은 이름의 폴더를 안 만든다', async () => {
    const entries = await Promise.all(
      GRADING_RESERVED.map((name) => entryOf(`${name}.mlpx`, titled(name.toUpperCase()))),
    )
    const files = await unpack(entries)
    const tops = Object.keys(files).map((path) => path.split('/')[0]!.toUpperCase())
    for (const name of GRADING_RESERVED) {
      expect(tops.filter((top) => top === name.toUpperCase())).toHaveLength(1)
    }
  })

  it('쉼표·따옴표·줄바꿈이 든 값이 되읽힌다', async () => {
    const studentName = '홍,"길"\n동'
    const files = await unpack([await entryOf('a.mlpx', titled('a,"b"'), { studentName })])
    expect(rows(files[GRADING_SUBMISSIONS])[0]).toMatchObject({ studentName, projectName: 'a,"b"' })
  })

  it('마감은 판정과 초과 분이 같은 경계를 쓴다', async () => {
    const deadline = new Date(2026, 10, 20, 23, 59).getTime()
    const at = (ms: number) => new Date(deadline + ms).toISOString()
    const entries = await Promise.all([
      entryOf('in.mlpx', titled('in', at(59_999))),
      entryOf('out.mlpx', titled('out', at(60_000))),
    ])
    const found = rows((await unpack(entries, { deadline }))[GRADING_SUBMISSIONS])
    expect(found.map((row) => [row['deadlineVerdict'], row['minutesLate']])).toEqual([
      ['onTime', ''],
      ['late', '1'],
    ])
  })

  it('열 머리는 겹치지 않는다', () => {
    expect(new Set(SUBMISSION_COLUMNS).size).toBe(SUBMISSION_COLUMNS.length)
    expect(new Set(RUN_COLUMNS).size).toBe(RUN_COLUMNS.length)
  })

  it('README는 로케일의 문장을 빠짐없이 쓴다', () => {
    const used = [...README_FILE_KEYS, ...README_NOTE_KEYS].map((key) => key.split('.').at(-1))
    expect([...used, 'title'].sort()).toEqual(Object.keys(ko.inspect.gradingReadme).sort())
  })
})
