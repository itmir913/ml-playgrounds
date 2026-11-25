/**
 * 채점 자료의 기록 (`project/grading-record.ts`, open-decisions.md 122).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { summarizeCanonical } from '../src/data/summary/handler'
import { readProject, type ProjectFile } from '../src/project/format'
import {
  contentOf,
  OMITTED,
  RECORDED,
  tablesOf,
  type RecordedTables,
} from '../src/project/grading-record'
import {
  experimentSchema,
  experimentSettingsSchema,
  imageSettingsSchema,
  imageSnapshotSchema,
  manifestSchema,
  portfolioSchema,
  runSchema,
  settingsSchema,
  tabularSettingsSchema,
  tabularSnapshotSchema,
} from '../src/project/schema'
import { emptyProjectFile, projectFile, projectFileWithTestDataset } from './fixtures/project'
import { trainedIrisProject } from './fixtures/trained'
import { writeProjectBytes } from './fixtures/write'

const SCHEMAS = {
  manifest: manifestSchema,
  settings: settingsSchema,
  tabularSettings: tabularSettingsSchema,
  imageSettings: imageSettingsSchema,
  experiment: experimentSchema,
  experimentSettings: experimentSettingsSchema,
  tabularSnapshot: tabularSnapshotSchema,
  imageSnapshot: imageSnapshotSchema,
  run: runSchema,
  portfolio: portfolioSchema,
} as const

async function contentFrom(file: ProjectFile) {
  const { bytes } = await writeProjectBytes(file, '# 포트폴리오\n')
  const read = await readProject(bytes)
  const tables: RecordedTables = {}
  for (const { role, body, hasHeader } of tablesOf(read.project)) {
    tables[role] = {
      summary: summarizeCanonical({ bytes: body.bytes, hasHeader }),
      failure: null,
    }
  }
  return contentOf(read, tables)
}

describe('기록이 싣는 것', () => {
  it.each(Object.keys(SCHEMAS) as (keyof typeof SCHEMAS)[])(
    '스키마의 키는 싣거나 뺀다고 적혀 있다 (%s)',
    (name) => {
      const written = [...RECORDED[name], ...OMITTED[name]].sort()
      expect(written).toEqual(Object.keys(SCHEMAS[name].shape).sort())
    },
  )

  it('모르는 키는 안 싣는다', async () => {
    const base = projectFile()
    const manifest = { ...base.document.manifest, planted: 'x'.repeat(10) }
    const content = await contentFrom({ ...base, document: { ...base.document, manifest } })
    expect(JSON.stringify(content)).not.toContain('planted')
  })

  it('실험과 점수를 싣고 분할은 개수만, 모델은 형식과 크기만 싣는다', async () => {
    const content = await contentFrom(await trainedIrisProject(['decision_tree', 'mlp']))
    expect(content.experimentCount).toBe(1)
    const [first] = content.experiments
    expect(first?.number).toBe(1)
    expect(first?.trainCount).toBeGreaterThan(0)
    expect(first?.runs.length).toBeGreaterThan(0)
    expect(first?.runs[0]?.metrics).toHaveProperty('accuracy')
    expect(first?.fitted).toMatchObject({ columns: expect.any(Array) })
    expect(Object.keys(first?.runs[0]?.model ?? {}).sort()).toEqual(['format', 'sizeBytes'])
    const text = JSON.stringify(content)
    for (const key of ['trainIndices', 'testIndices', '"scale"', '"fill"', 'threshold']) {
      expect(text, key).not.toContain(key)
    }
  })

  it('표마다 행과 열을 싣는다', async () => {
    const content = await contentFrom(projectFileWithTestDataset())
    const tables = content.data['tables'] as Record<string, { summary: { rowCount: number } }>
    expect(tables['dataset']?.summary.rowCount).toBe(1)
    expect(tables['testDataset']?.summary.rowCount).toBe(1)
    expect(tables['predictDataset']).toBeNull()
  })

  it('첫 실험의 changed는 null이고 빈 목록은 빈 목록이다', async () => {
    const base = projectFile()
    const [one] = base.document.runs.experiments
    const experiments = [one!, { ...one!, id: 'experiment-2', changed: [] }]
    const content = await contentFrom({
      ...base,
      document: { ...base.document, runs: { experiments } },
    })
    expect(content.experiments.map((each) => (each as Record<string, unknown>)['changed'])).toEqual(
      [null, []],
    )
  })

  it('사진 프로젝트는 범주별 장수를 싣고 표 자리가 없다', async () => {
    const path = join(process.cwd(), 'tests', 'fixtures', 'legacy', '0.35.5', 'image.mlpx')
    const read = await readProject(new Uint8Array(readFileSync(path)))
    expect(tablesOf(read.project)).toEqual([])
    const content = contentOf(read, {})
    const data = content.data as {
      imageCount: number
      unlabeledCount: number
      categoryCounts: { category: string; count: number }[]
    }
    expect(data.imageCount).toBeGreaterThan(0)
    const labeled = data.categoryCounts.reduce((sum, one) => sum + one.count, 0)
    expect(labeled + data.unlabeledCount).toBe(data.imageCount)
    expect(data).not.toHaveProperty('tables')
    expect(content.experimentCount).toBeGreaterThan(0)
    for (const each of content.experiments) expect(each.fitted).toBeNull()
    expect(JSON.stringify(content)).not.toContain('rowKeys')
  })

  it('아무것도 안 한 제출물도 낸다', async () => {
    const content = await contentFrom(emptyProjectFile())
    expect(content.experimentCount).toBe(0)
    expect(content.lastTrainedAt).toBeNull()
    expect(content.settings.data).toHaveProperty('target', null)
  })
})
