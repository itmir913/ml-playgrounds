/**
 * 마이그레이션 체인.
 *
 * 여기서 지키는 약속은 하나다 - **하위 버전은 열리고 상위 버전은 막힌다.**
 * 집에서 만든 파일을 학교 PC에서 열었을 때 조용히 깨지는 일이 없어야 한다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import {
  MIGRATIONS,
  type Migration,
  type RawDocument,
  applyMigrations,
  migrateProjectDocument,
  readFormatVersion,
} from '../src/project/migrate'
import { FORMAT_VERSION } from '../src/project/schema'

const document = {
  manifest: {
    formatVersion: FORMAT_VERSION,
    appVersion: '0.0.0',
    projectId: '550e8400-e29b-41d4-a716-446655440000',
    name: '붓꽃 품종 분류',
    createdAt: '2026-08-04T09:00:00Z',
    updatedAt: '2026-08-04T10:30:00Z',
    taskType: 'classification',
    dataType: 'tabular',
    locale: 'ko',
  },
  settings: {
    data: {
      dataset: {
        path: 'dataset/data.csv',
        originalFileName: 'iris.csv',
        hasHeader: true,
        encoding: 'utf-8',
      },
      features: ['sepal_length'],
      target: 'species',
      preprocessing: { missing: 'drop', scaling: 'standard', categoricalEncoding: 'onehot' },
    },
    split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
    runtime: 'mljs',
    selectedAlgorithms: [{ algorithm: 'decision_tree' }],
    hyperparameters: { decision_tree: { mljs: { maxDepth: 5 } } },
  },
  runs: { experiments: [] },
  portfolio: { template: { sections: [] }, answers: {} },
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return isClientError(error) ? error.code : `unexpected: ${String(error)}`
  }
  return 'no error'
}

describe('등록부', () => {
  it('FORMAT_VERSION보다 낮은 모든 버전에 올릴 방법이 있다', () => {
    // 버전을 올리면서 마이그레이션 함수를 빠뜨리면 여기서 걸린다.
    const missing: number[] = []
    for (let version = 1; version < FORMAT_VERSION; version += 1) {
      if (!MIGRATIONS[version]) missing.push(version)
    }
    expect(missing).toEqual([])
  })
})

describe('readFormatVersion', () => {
  it('정수 버전을 읽는다', () => {
    expect(readFormatVersion(document)).toBe(FORMAT_VERSION)
  })

  it('읽을 수 없으면 null이다', () => {
    expect(readFormatVersion(null)).toBeNull()
    expect(readFormatVersion([])).toBeNull()
    expect(readFormatVersion({})).toBeNull()
    expect(readFormatVersion({ manifest: {} })).toBeNull()
    expect(readFormatVersion({ manifest: { formatVersion: '1' } })).toBeNull()
    expect(readFormatVersion({ manifest: { formatVersion: 1.5 } })).toBeNull()
    expect(readFormatVersion({ manifest: { formatVersion: 0 } })).toBeNull()
  })
})

describe('applyMigrations', () => {
  const chain: Record<number, Migration> = {
    1: (raw) => ({ ...raw, one: true }),
    2: (raw) => ({ ...raw, two: true }),
  }

  it('버전 순서대로 적용한다', () => {
    const order: number[] = []
    const recording: Record<number, Migration> = {
      1: (raw) => {
        order.push(1)
        return raw
      },
      2: (raw) => {
        order.push(2)
        return raw
      },
    }
    applyMigrations({ manifest: { formatVersion: 1 } }, 1, 3, recording)
    expect(order).toEqual([1, 2])
  })

  it('formatVersion을 체인이 올려 준다 - 함수가 잊어도 된다', () => {
    const result = applyMigrations({ manifest: { formatVersion: 1 } }, 1, 3, chain)
    expect((result.manifest as RawDocument).formatVersion).toBe(3)
    expect(result.one).toBe(true)
    expect(result.two).toBe(true)
  })

  it('올릴 것이 없으면 그대로 돌려준다', () => {
    const raw = { manifest: { formatVersion: 2 } }
    expect(applyMigrations(raw, 2, 2, chain)).toBe(raw)
  })

  /**
   * **가짜 체인이 진짜와 같은 모양이어야 한다.** 얕게 더하기만 하는 변환은 원본을 안
   * 건드리므로 복제 여부를 못 가른다. 곧 올 진짜 마이그레이션(백본 개명)은
   * `settings.data.backboneId`와 실험 스냅샷마다의 `backboneId`를 고치는 일이라
   * **중첩된 객체를 다시 쓰는 모양**이고, 거기서 안쪽을 제자리에서 고치는 실수가
   * 정확히 이 복제가 막는 실수다.
   */
  it('제자리에서 고치는 변환이 있어도 입력을 안 건드린다', () => {
    const inPlace: Record<number, Migration> = {
      1: (raw) => {
        const settings = raw.settings as { data: { backboneId: string } }
        settings.data.backboneId = '바뀐백본'
        return raw
      },
    }
    const raw = { manifest: { formatVersion: 1 }, settings: { data: { backboneId: '원래백본' } } }

    const result = applyMigrations(raw, 1, 2, inPlace)

    expect((result.settings as { data: { backboneId: string } }).data.backboneId).toBe('바뀐백본')
    expect(raw.settings.data.backboneId).toBe('원래백본')
  })

  it('중간 단계가 비어 있으면 거부한다', () => {
    const broken: Record<number, Migration> = { 1: (raw) => raw }
    expect(codeOf(() => applyMigrations({ manifest: {} }, 1, 3, broken))).toBe(
      'PROJECT_FILE_VERSION_UNSUPPORTED',
    )
  })
})

describe('migrateProjectDocument', () => {
  it('같은 버전 문서를 그대로 통과시킨다', () => {
    expect(migrateProjectDocument(document).manifest.name).toBe('붓꽃 품종 분류')
  })

  it('상위 버전은 거부한다', () => {
    const future = { ...document, manifest: { ...document.manifest, formatVersion: 999 } }
    try {
      migrateProjectDocument(future)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('PROJECT_FILE_VERSION_TOO_NEW')
      // 화면이 "파일 999, 지금 1"을 보여줄 수 있어야 한다.
      expect(error.params.fileVersion).toBe(999)
      expect(error.params.appVersion).toBe(FORMAT_VERSION)
    }
  })

  it('버전을 읽을 수 없으면 거부한다', () => {
    const cases: unknown[] = [
      { ...document, manifest: { ...document.manifest, formatVersion: 0 } },
      { ...document, manifest: { ...document.manifest, formatVersion: '1' } },
      { ...document, manifest: {} },
    ]
    for (const broken of cases) {
      expect(codeOf(() => migrateProjectDocument(broken))).toBe('PROJECT_FILE_VERSION_UNSUPPORTED')
    }
  })

  it('문서가 객체가 아니면 거부한다', () => {
    expect(codeOf(() => migrateProjectDocument('not a document'))).toBe('PROJECT_FILE_INVALID')
  })

  it('버전은 맞는데 내용이 깨졌으면 검증에서 걸린다', () => {
    const broken = {
      ...document,
      settings: {
        ...document.settings,
        data: { ...document.settings.data, features: 'not an array' },
      },
    }
    expect(codeOf(() => migrateProjectDocument(broken))).toBe('PROJECT_FILE_INVALID')
  })

  it('입력을 변형하지 않는다', () => {
    const before = JSON.stringify(document)
    migrateProjectDocument(document)
    expect(JSON.stringify(document)).toBe(before)
  })
})
