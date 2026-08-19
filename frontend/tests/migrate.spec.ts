/**
 * 마이그레이션 체인.
 *
 * 여기서 지키는 약속은 하나다 - **하위 버전은 열리고 상위 버전은 막힌다.**
 * 집에서 만든 파일을 학교 PC에서 열었을 때 조용히 깨지는 일이 없어야 한다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { withoutComments } from './fixtures/source'

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

/**
 * **v1 -> v2: 백본 id 개정** (mlpx-spec.md §9.1).
 *
 * 첫 마이그레이션이다. 지키는 것은 어휘가 아니라 **같은 문자열이 뜻하는 좌표계**다 —
 * v1의 `mobilenet-v2`로 뽑은 벡터는 화소를 `[-3,1]`로 밀어 넣은 것이라 새 것과 섞이면
 * 안 된다 (open-decisions.md "백본 입력 범위가 그래프의 계약과 어긋났다").
 *
 * **진짜 입구로 태운다** — `migrateProjectDocument`는 파일을 여는 길이 실제로 부르는
 * 함수이고, zod 검증까지 지나야 통과다.
 */
describe('v1 -> v2 백본 id 개정', () => {
  const V1_ID = 'mobilenet-v2'
  const V2_ID = 'mobilenet-v2-r2'

  /** v1이 만든 이미지 프로젝트. **실험 하나가 들어 있다** - 스냅샷이 이 검사의 절반이다. */
  function imageV1(backboneId: string): RawDocument {
    return {
      manifest: {
        ...document.manifest,
        formatVersion: 1,
        taskType: 'classification',
        dataType: 'image',
      },
      settings: {
        data: { categories: ['개', '고양이'], backboneId },
        split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
        runtime: 'mljs',
        selectedAlgorithms: [{ algorithm: 'knn' }],
        hyperparameters: {},
      },
      runs: {
        experiments: [
          {
            id: 'experiment-1',
            startedAt: '2026-08-14T09:00:00Z',
            settings: {
              taskType: 'classification',
              runtime: 'mljs',
              selectedAlgorithms: [{ algorithm: 'knn', runtime: 'mljs' }],
              data: {
                categories: ['개', '고양이'],
                backboneId,
                categoryCounts: [2, 2],
                unlabeledCount: 0,
              },
              split: { method: 'holdout', testSize: 0.5, stratify: true, randomState: 42 },
              nSamples: 4,
              trainIndices: [0, 1],
              testIndices: [2, 3],
            },
            runs: [],
          },
        ],
      },
      portfolio: document.portfolio,
    }
  }

  function backbonesOf(raw: RawDocument): readonly unknown[] {
    const opened = migrateProjectDocument(raw)
    const settings = opened.settings.data as { backboneId?: unknown }
    return [
      settings.backboneId,
      ...opened.runs.experiments.map(
        (experiment) => (experiment.settings.data as { backboneId?: unknown }).backboneId,
      ),
    ]
  }

  it('지금 설정과 모든 실험 스냅샷이 함께 올라온다', () => {
    // 스냅샷을 빼먹으면 결과 화면이 옛 id로 임베딩을 찾다가 빈손이 된다.
    expect(backbonesOf(imageV1(V1_ID))).toEqual([V2_ID, V2_ID])
  })

  it('모르는 id는 그대로 둔다 - 우리가 안 만든 값을 우리 이름으로 덮지 않는다', () => {
    expect(backbonesOf(imageV1('someone-elses-backbone'))).toEqual([
      'someone-elses-backbone',
      'someone-elses-backbone',
    ])
  })

  it('표 프로젝트는 안 건드린다 - 그 자리에 백본이 없다', () => {
    const v1 = { ...document, manifest: { ...document.manifest, formatVersion: 1 } }
    const opened = migrateProjectDocument(v1)
    expect(opened.settings.data).toEqual(document.settings.data)
  })

  /**
   * **등록부를 안 읽고 글자를 박은 이유가 이것이다.** `DEFAULT_BACKBONE_ID`를 읽으면
   * 셋째 백본이 등록되는 날 옛 파일이 그 백본의 것으로 둔갑한다 - 벡터는 한 번도 거기서
   * 나온 적이 없는데도.
   */
  it('올라가는 곳이 등록부의 기본값이 아니라 못 박힌 v2 id다', () => {
    expect(backbonesOf(imageV1(V1_ID))[0]).toBe('mobilenet-v2-r2')
  })
})

/**
 * **마이그레이션은 등록부를 안 읽는다** (R6 감사 B-5).
 *
 * `V2_BACKBONE_ID`를 `DEFAULT_BACKBONE_ID`로 바꿔도 **오늘은 같은 값이라 아무 검사도
 * 안 운다.** 그런데 셋째 백본이 등록되는 날 그 한 줄이 **옛 파일을 그 백본의 것으로
 * 둔갑시킨다** — 벡터는 한 번도 거기서 나온 적이 없는데도.
 *
 * 값으로는 못 가르므로 **글자로 본다.** `backbones.spec.ts`가 `fetch-backbone.mjs`를
 * 읽는 것과 같은 방식이고, 같은 한계를 갖는다 — 줄이 거기 있는지만 본다.
 */
describe('마이그레이션은 지금의 등록부에 기대지 않는다', () => {
  const SOURCE = withoutComments(
    readFileSync(join(process.cwd(), 'src', 'project', 'migrate.ts'), 'utf-8'),
  ).join(String.fromCharCode(10))

  it('훑을 소스를 실제로 찾는다', () => {
    expect(SOURCE).toContain('MIGRATIONS')
  })

  it('백본 등록부를 import하지 않는다', () => {
    expect(
      SOURCE,
      [
        '마이그레이션이 등록부를 읽으면 옛 파일이 "지금의 기본 백본"으로 올라간다.',
        '  마이그레이션은 역사다 - 그때 무엇이었는지는 글자로 박아라.',
      ].join(String.fromCharCode(10)),
    ).not.toMatch(/from '.*ml\/backbones'/)
  })

  it('올라가는 id가 글자로 박혀 있다', () => {
    expect(SOURCE).toContain("'mobilenet-v2-r2'")
  })
})
