/**
 * .mlpx 저장 -> 열기.
 *
 * CLAUDE.md 4가 필수로 못 박은 것 - 왕복 무손실, 마이그레이션, 상한 초과 시의 동작.
 * 여기서 가장 중요한 것은 **데이터셋 바이트가 비트 단위로 같은가**다.
 * 그게 깨지면 무결성 검증 전체가 무의미해진다.
 */

import { unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { MAX_MODEL_BYTES } from '../src/limits'
import {
  ENTRY,
  MLPX_EXTENSION,
  type ProjectFile,
  projectFileName,
  readProject,
  selectModels,
  writeProject,
} from '../src/project/format'
import { FORMAT_VERSION, type Batch, type Manifest, type Run } from '../src/project/schema'

const manifest: Manifest = {
  formatVersion: FORMAT_VERSION,
  appVersion: '0.1.0',
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  name: '붓꽃 품종 분류',
  createdAt: '2026-08-04T09:00:00Z',
  updatedAt: '2026-08-04T10:30:00Z',
  taskType: 'classification',
  dataType: 'tabular',
  locale: 'ko',
}

const settings = {
  dataset: {
    path: 'dataset/data.csv',
    originalFileName: 'iris_data_final(1).csv',
    hasHeader: true,
    encoding: 'utf-8',
  },
  features: ['꽃받침 길이', 'petal_length'],
  target: '품종',
  preprocessing: { missing: 'drop', scaling: 'standard', categoricalEncoding: 'onehot' } as const,
  split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 } as const,
  selectedAlgorithms: ['decision_tree', 'svm'],
  hyperparameters: { decision_tree: { max_depth: null }, svm: { C: 1.0 } },
}

function run(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    algorithm: 'decision_tree',
    hyperparameters: { max_depth: null },
    computedBy: 'browser',
    trainedAt: '2026-08-04T10:30:04Z',
    status: 'done',
    metrics: { accuracy: 0.9333 },
    model: {
      format: 'mlpx-tree-v1',
      path: `model/${id}.json`,
      includesPreprocessing: false,
      sizeBytes: 1284,
    },
    ...overrides,
  }
}

function batch(id: string, runs: Run[]): Batch {
  return {
    id,
    startedAt: '2026-08-04T10:30:00Z',
    settings: {
      features: settings.features,
      target: settings.target,
      preprocessing: settings.preprocessing,
      split: settings.split,
      trainIndices: [0, 2, 3],
      testIndices: [1],
    },
    preprocessor: { format: 'mlpx-preprocess-v1', path: `model/preprocessor-${id}.json` },
    runs,
  }
}

/** CRLF와 BOM, 한글이 든 CSV. 이 바이트가 그대로 돌아와야 한다. */
const datasetBytes = new TextEncoder().encode('﻿꽃받침,품종\r\n5.1,setosa\r\n')

function projectFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  const first = batch('batch-1', [run('run-1')])
  return {
    document: {
      manifest,
      settings,
      runs: { batches: [first] },
      portfolio: { template: { id: 'default-v1' }, answers: { motivation: '꽃이 좋아서' } },
    },
    dataset: datasetBytes,
    models: new Map([
      ['model/run-1.json', new TextEncoder().encode('{"tree":[]}')],
      ['model/preprocessor-batch-1.json', new TextEncoder().encode('{"columns":[]}')],
    ]),
    ...overrides,
  }
}

const markdown = '# 나의 AI 모델 정리\n'

async function roundTrip(project: ProjectFile): Promise<ProjectFile> {
  const { bytes } = await writeProject(project, markdown)
  return readProject(bytes)
}

function filler(size: number): Uint8Array {
  return new Uint8Array(size).fill(65)
}

describe('왕복', () => {
  it('문서가 그대로 돌아온다', async () => {
    const reopened = await roundTrip(projectFile())
    expect(reopened.document).toEqual(projectFile().document)
  })

  it('데이터셋 바이트가 비트 단위로 같다 - BOM과 CRLF까지', async () => {
    const reopened = await roundTrip(projectFile())
    // Array로 펴서 비교한다. jsdom과 node의 Uint8Array는 realm이 달라
    // toEqual이 내용과 무관하게 어긋난다.
    expect(Array.from(reopened.dataset)).toEqual(Array.from(datasetBytes))
  })

  it('한글 컬럼명과 클래스 라벨이 살아남는다', async () => {
    const reopened = await roundTrip(projectFile())
    expect(reopened.document.settings.features).toEqual(['꽃받침 길이', 'petal_length'])
    expect(reopened.document.settings.target).toBe('품종')
  })

  it('실패한 run이 사유와 함께 남는다', async () => {
    const failed = run('run-2', {
      status: 'failed',
      algorithm: 'svm',
      metrics: undefined,
      model: undefined,
      failure: { code: 'JOB_TIMEOUT', params: { limitSeconds: 120 } },
    })
    const project = projectFile()
    project.document.runs.batches = [batch('batch-1', [run('run-1'), failed])]
    const reopened = await roundTrip(project)
    const reopenedRun = reopened.document.runs.batches[0]?.runs[1]
    expect(reopenedRun?.status).toBe('failed')
    expect(reopenedRun?.failure?.code).toBe('JOB_TIMEOUT')
  })

  it('묶음이 없는 새 프로젝트도 왕복한다', async () => {
    const project = projectFile({ models: new Map() })
    project.document.runs.batches = []
    const reopened = await roundTrip(project)
    expect(reopened.document.runs.batches).toEqual([])
  })

  it('모르는 필드가 살아남는다', async () => {
    const project = projectFile()
    const extended = { ...project.document.manifest, futureField: 'keep me' }
    project.document = { ...project.document, manifest: extended }
    const reopened = await roundTrip(project)
    expect(reopened.document.manifest.futureField).toBe('keep me')
  })

  it('portfolio.md가 파일에 들어간다 - 도구 없이 받은 사람도 읽는다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    expect(new TextDecoder().decode(entries[ENTRY.portfolioMarkdown])).toBe(markdown)
  })
})

describe('모르는 엔트리', () => {
  it('쓰레기 엔트리는 다시 저장할 때 사라진다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries['__MACOSX/._manifest.json'] = new Uint8Array([1, 2, 3])
    entries['.DS_Store'] = new Uint8Array([4, 5])

    const reopened = await readProject(zipSync(entries))
    const written = unzipSync((await writeProject(reopened, markdown)).bytes)
    expect(Object.keys(written)).not.toContain('__MACOSX/._manifest.json')
    expect(Object.keys(written)).not.toContain('.DS_Store')
  })

  it('아무도 가리키지 않는 고아 모델이 청소된다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries['model/run-9.json'] = new TextEncoder().encode('{"orphan":true}')

    const reopened = await readProject(zipSync(entries))
    expect(reopened.models.has('model/run-9.json')).toBe(false)
  })
})

describe('모델 참조가 어긋난 파일', () => {
  it('모델 파일이 없으면 지표만 남기고 파일은 열린다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/run-1.json']

    const reopened = await readProject(zipSync(entries))
    const reopenedRun = reopened.document.runs.batches[0]?.runs[0]
    expect(reopenedRun?.model).toBeUndefined()
    expect(reopenedRun?.metrics?.accuracy).toBe(0.9333)
  })

  it('전처리기가 없으면 그 묶음의 모델도 쓸 수 없다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['model/preprocessor-batch-1.json']

    const reopened = await readProject(zipSync(entries))
    expect(reopened.document.runs.batches[0]?.preprocessor).toBeUndefined()
    expect(reopened.document.runs.batches[0]?.runs[0]?.model).toBeUndefined()
  })
})

describe('크기 예산', () => {
  it('개별 상한을 넘는 모델은 빠지고 저장은 성공한다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const result = await writeProject(project, markdown)
    expect(result.dropped).toHaveLength(1)
    expect(result.dropped[0]?.reason).toBe('tooLarge')
    expect(result.bytes.length).toBeGreaterThan(0)

    const reopened = await readProject(result.bytes)
    expect(reopened.document.runs.batches[0]?.runs[0]?.model).toBeUndefined()
    expect(reopened.document.runs.batches[0]?.runs[0]?.metrics?.accuracy).toBe(0.9333)
  })

  it('예산이 차면 오래된 묶음부터 빠진다', () => {
    const project = projectFile()
    project.document.runs.batches = [
      batch('batch-1', [run('run-1')]),
      batch('batch-2', [run('run-2')]),
    ]
    project.models = new Map([
      ['model/run-1.json', filler(60)],
      ['model/preprocessor-batch-1.json', filler(10)],
      ['model/run-2.json', filler(60)],
      ['model/preprocessor-batch-2.json', filler(10)],
    ])

    // 예산 100바이트에는 최신 묶음(전처리기 10 + 모델 60)만 들어간다.
    const { kept, dropped } = selectModels(project.document, project.models, 100, 60)
    expect([...kept]).toEqual(['model/preprocessor-batch-2.json', 'model/run-2.json'])
    expect(dropped.map((model) => model.path)).toEqual(['model/run-1.json'])
    expect(dropped[0]?.reason).toBe('overBudget')
  })

  it('작은 모델은 여러 회차가 남는다 - 계수 몇 개짜리를 버릴 이유가 없다', () => {
    const project = projectFile()
    project.document.runs.batches = [
      batch('batch-1', [run('run-1')]),
      batch('batch-2', [run('run-2')]),
    ]
    project.models = new Map([
      ['model/run-1.json', filler(10)],
      ['model/preprocessor-batch-1.json', filler(10)],
      ['model/run-2.json', filler(10)],
      ['model/preprocessor-batch-2.json', filler(10)],
    ])

    const { kept, dropped } = selectModels(project.document, project.models, 100, 60)
    expect(kept.size).toBe(4)
    expect(dropped).toEqual([])
  })

  it('쓸 모델이 하나도 없으면 전처리기도 담지 않는다', async () => {
    const project = projectFile()
    project.models.set('model/run-1.json', filler(MAX_MODEL_BYTES + 1))

    const written = unzipSync((await writeProject(project, markdown)).bytes)
    expect(Object.keys(written)).not.toContain('model/preprocessor-batch-1.json')
  })
})

describe('열 수 없는 파일', () => {
  it('zip이 아니면 거부한다', async () => {
    await expect(readProject(new TextEncoder().encode('not a zip at all'))).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_NOT_ZIP',
    )
  })

  it('필수 엔트리가 없으면 무엇이 없는지 알려준다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries[ENTRY.manifest]

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_ENTRY_MISSING' &&
        error.params.entry === ENTRY.manifest,
    )
  })

  it('데이터셋이 없으면 거부한다 - 재학습도 해시 재계산도 불가능하다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    delete entries['dataset/data.csv']

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_ENTRY_MISSING' &&
        error.params.entry === 'dataset/data.csv',
    )
  })

  it('JSON이 깨졌으면 어느 엔트리인지 알려준다', async () => {
    const { bytes } = await writeProject(projectFile(), markdown)
    const entries = unzipSync(bytes)
    entries[ENTRY.settings] = new TextEncoder().encode('{ broken')

    await expect(readProject(zipSync(entries))).rejects.toSatisfy(
      (error: unknown) =>
        isClientError(error) &&
        error.code === 'PROJECT_FILE_INVALID' &&
        error.params.path === ENTRY.settings,
    )
  })

  it('상위 버전 파일은 거부한다', async () => {
    const project = projectFile()
    project.document = {
      ...project.document,
      manifest: { ...manifest, formatVersion: FORMAT_VERSION + 1 },
    }
    const { bytes } = await writeProject(project, markdown)

    await expect(readProject(bytes)).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'PROJECT_FILE_VERSION_TOO_NEW',
    )
  })
})

describe('projectFileName', () => {
  it('학번과 이름이 있으면 앞에 붙는다', () => {
    const named = { ...manifest, student: { studentId: '10203', name: '홍길동' } }
    expect(projectFileName(named)).toBe(`10203_홍길동_붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('없으면 프로젝트 이름만 남는다 - 학생이 저장할 때 스스로 알아챈다', () => {
    expect(projectFileName(manifest)).toBe(`붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('하이픈이 든 학번을 지키지 않으면 안 된다', () => {
    const named = { ...manifest, student: { studentId: '1-2-03' } }
    expect(projectFileName(named)).toBe(`1-2-03_붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('파일명에 쓸 수 없는 문자를 지운다', () => {
    const risky = { ...manifest, name: 'a/b\\c:d*e?f"g<h>i|j' }
    expect(projectFileName(risky)).toBe(`abcdefghij${MLPX_EXTENSION}`)
  })

  it('비어 있는 조각은 통째로 뺀다 - _ 만 남는 이름을 만들지 않는다', () => {
    const spaced = { ...manifest, student: { studentId: '   ', name: '홍길동' } }
    expect(projectFileName(spaced)).toBe(`홍길동_붓꽃품종분류${MLPX_EXTENSION}`)
  })

  it('전부 비면 projectId 앞자리를 쓴다', () => {
    expect(projectFileName({ ...manifest, name: '///' })).toBe(`550e8400${MLPX_EXTENSION}`)
  })

  it('긴 이름은 자른다', () => {
    const long = { ...manifest, name: '가'.repeat(300) }
    expect(projectFileName(long).length).toBeLessThan(120)
  })
})
