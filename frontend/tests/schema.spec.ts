/**
 * .mlpx 스키마의 계약.
 *
 * 두 가지를 지킨다.
 * - 모르는 **필드**는 살아남는다 (구버전이 저장해도 새 필드가 지워지지 않는다)
 * - 모르는 **어휘**는 거부된다 (같은 버전인데 모르는 값이면 그건 깨진 값이다)
 */

import { describe, expect, it } from 'vitest'

import { SOURCE_ENCODINGS } from '../src/data/encoding'
import { isClientError } from '../src/errors'
import { TRAINING_LOCATIONS } from '../src/ml/backend'
import {
  CATEGORICAL_ENCODINGS,
  DATA_TYPES,
  FORMAT_VERSION,
  MISSING_STRATEGIES,
  MODEL_OMISSION_REASONS,
  RUN_STATUSES,
  SCALING_METHODS,
  SPLIT_METHODS,
  TASK_TYPES,
  manifestSchema,
  parseProjectDocument,
  runSchema,
  runsFileSchema,
  settingsSchema,
  studentIdInputSchema,
} from '../src/project/schema'

const manifest = {
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
  features: ['sepal_length', 'petal_length'],
  target: 'species',
  preprocessing: { missing: 'drop', scaling: 'standard', categoricalEncoding: 'onehot' },
  split: { method: 'holdout', testSize: 0.2, stratify: true, randomState: 42 },
  runtime: 'mljs',
  selectedAlgorithms: [{ algorithm: 'decision_tree' }],
  hyperparameters: {
    decision_tree: { mljs: { maxDepth: 5 }, 'server-sklearn': { max_depth: null } },
  },
}

const run = {
  id: 'run-3',
  algorithm: 'logistic_regression',
  hyperparameters: { C: 1.0 },
  computedBy: 'browser',
  trainedAt: '2026-08-04T10:30:04Z',
  status: 'done',
  metrics: { accuracy: 0.9333 },
}

const document = {
  manifest,
  settings,
  runs: { batches: [] },
  portfolio: { template: { id: 'default-v1' }, answers: {} },
}

describe('어휘 고정', () => {
  it('어휘를 바꿨다면 FORMAT_VERSION을 올리고 마이그레이션을 추가했는가', () => {
    // 이 테스트가 깨졌다면 값을 고치기 전에 다음을 확인하라.
    // 1. FORMAT_VERSION을 올렸는가
    // 2. project/migrate.ts에 마이그레이션 함수를 추가했는가
    // 어휘가 늘어나면 구버전 앱이 못 여는 파일이 생긴다. 그게 의도한 동작이다.
    //
    // **스키마가 z.enum으로 쓰는 배열이 전부 여기 있어야 한다.** 아래 둘은 schema.ts가
    // 아니라 data/encoding.ts와 ml/backend.ts에 산다 - 그 모듈을 고치는 사람에게는
    // 파일 어휘를 늘리고 있다는 신호가 없으므로, 오히려 여기 있는 것이 더 중요하다.
    expect({
      FORMAT_VERSION,
      TASK_TYPES,
      DATA_TYPES,
      MISSING_STRATEGIES,
      SCALING_METHODS,
      CATEGORICAL_ENCODINGS,
      SPLIT_METHODS,
      RUN_STATUSES,
      MODEL_OMISSION_REASONS,
      SOURCE_ENCODINGS,
      TRAINING_LOCATIONS,
    }).toEqual({
      FORMAT_VERSION: 1,
      TASK_TYPES: ['classification', 'regression', 'clustering'],
      DATA_TYPES: ['tabular', 'image', 'audio', 'text'],
      MISSING_STRATEGIES: ['drop', 'mean', 'median', 'mostFrequent', 'zero'],
      SCALING_METHODS: ['none', 'standard', 'minmax', 'robust'],
      CATEGORICAL_ENCODINGS: ['none', 'onehot', 'ordinal'],
      SPLIT_METHODS: ['holdout'],
      RUN_STATUSES: ['done', 'failed'],
      MODEL_OMISSION_REASONS: ['overBudget', 'tooLarge', 'engineUnsupported'],
      SOURCE_ENCODINGS: ['utf-8', 'cp949', 'utf-16le', 'utf-16be'],
      TRAINING_LOCATIONS: ['browser', 'server'],
    })
  })
})

describe('모르는 필드', () => {
  it('최상위에서 살아남는다', () => {
    const parsed = manifestSchema.parse({ ...manifest, futureField: 'keep me' })
    expect(parsed.futureField).toBe('keep me')
  })

  it('중첩된 안쪽에서도 살아남는다', () => {
    const parsed = settingsSchema.parse({
      ...settings,
      preprocessing: { ...settings.preprocessing, outlierRemoval: 'iqr' },
    })
    expect(parsed.preprocessing.outlierRemoval).toBe('iqr')
  })

  it('지표는 이름을 모르는 것도 그대로 받는다', () => {
    const parsed = runSchema.parse({ ...run, metrics: { accuracy: 0.9, futureScore: 0.5 } })
    expect(parsed.metrics).toEqual({ accuracy: 0.9, futureScore: 0.5 })
  })
})

describe('모르는 어휘', () => {
  it('과제 유형이 목록에 없으면 거부한다', () => {
    expect(manifestSchema.safeParse({ ...manifest, taskType: 'timeseries' }).success).toBe(false)
  })

  it('데이터 타입이 목록에 없으면 거부한다', () => {
    expect(manifestSchema.safeParse({ ...manifest, dataType: 'video' }).success).toBe(false)
  })

  it('실행 위치가 목록에 없으면 거부한다', () => {
    expect(runSchema.safeParse({ ...run, computedBy: 'cloud' }).success).toBe(false)
  })

  it('업로드 인코딩이 목록에 없으면 거부한다', () => {
    const withSource = (sourceEncoding: string) => ({
      ...settings,
      dataset: { ...settings.dataset, sourceEncoding },
    })
    expect(settingsSchema.safeParse(withSource('cp949')).success).toBe(true)
    expect(settingsSchema.safeParse(withSource('euc-kr')).success).toBe(false)
  })

  it('모델이 빠진 사유가 목록에 없으면 거부한다', () => {
    expect(runSchema.safeParse({ ...run, modelOmitted: 'overBudget' }).success).toBe(true)
    expect(runSchema.safeParse({ ...run, modelOmitted: 'tooLarge' }).success).toBe(true)
    expect(runSchema.safeParse({ ...run, modelOmitted: '몰라' }).success).toBe(false)
    // 합계 예산과 개별 상한을 하나로 뭉치던 옛 어휘다. 처방이 서로 달라서 갈랐다.
    expect(runSchema.safeParse({ ...run, modelOmitted: 'sizeBudget' }).success).toBe(false)
  })
})

describe('끝난 run은 결과를 들고 있다', () => {
  const without = (value: object, key: string): Record<string, unknown> => {
    const copy: Record<string, unknown> = { ...value }
    delete copy[key]
    return copy
  }

  it('성공했는데 지표가 없으면 거부한다', () => {
    // 위 규칙과 대칭이다. 비교표에 빈 줄이 생기는 것을 스키마에서 막는다.
    expect(runSchema.safeParse(without(run, 'metrics')).success).toBe(false)
  })

  it('실패한 run에는 지표가 없어도 된다', () => {
    const failed = {
      ...without(run, 'metrics'),
      status: 'failed',
      failure: { code: 'JOB_FAILED' },
    }
    expect(runSchema.safeParse(failed).success).toBe(true)
  })
})

describe('사용자 데이터', () => {
  it('한글·공백·특수문자가 든 컬럼명을 받는다', () => {
    const parsed = settingsSchema.parse({
      ...settings,
      features: ['꽃받침 길이', 'petal/length', '학생 #1'],
      target: '품종 (species)',
    })
    expect(parsed.features).toHaveLength(3)
    expect(parsed.target).toBe('품종 (species)')
  })

  it('모르는 알고리즘 이름을 받는다 - 등록부는 포맷의 관심사가 아니다', () => {
    expect(runSchema.safeParse({ ...run, algorithm: 'gradient_boosting' }).success).toBe(true)
  })

  it('모르는 모델 형식을 받는다 - 파일은 열리고 예측만 못 한다', () => {
    const parsed = runSchema.parse({
      ...run,
      model: {
        format: 'onnx-v1',
        path: 'model/run-3.onnx',
        includesPreprocessing: true,
        sizeBytes: 4096,
      },
    })
    expect(parsed.model?.format).toBe('onnx-v1')
  })
})

describe('없어도 되는 것', () => {
  it('군집화에는 target이 없다', () => {
    const clustering: Record<string, unknown> = { ...settings }
    delete clustering.target
    expect(settingsSchema.safeParse(clustering).success).toBe(true)
  })

  it('학번과 이름은 선택 입력이다', () => {
    expect(manifestSchema.safeParse({ ...manifest, student: {} }).success).toBe(true)
  })

  it('예산에서 밀린 run은 model 없이 지표만 남는다', () => {
    expect(runSchema.safeParse(run).success).toBe(true)
  })

  it('새 프로젝트는 묶음이 없다', () => {
    expect(runsFileSchema.parse({}).batches).toEqual([])
  })
})

describe('있어야 하는 것', () => {
  it('실패한 run에는 사유가 있어야 한다', () => {
    const failed = { ...run, status: 'failed', metrics: undefined }
    expect(runSchema.safeParse(failed).success).toBe(false)
    expect(
      runSchema.safeParse({
        ...failed,
        failure: { code: 'JOB_TIMEOUT', params: { limitSeconds: 120 } },
      }).success,
    ).toBe(true)
  })

  it('randomState가 없으면 거부한다 - 재현이 불가능해진다', () => {
    const split: Record<string, unknown> = { ...settings.split }
    delete split.randomState
    expect(settingsSchema.safeParse({ ...settings, split }).success).toBe(false)
  })

  it('testSize는 0과 1 사이여야 한다', () => {
    for (const testSize of [0, 1, 1.5, -0.2]) {
      const split = { ...settings.split, testSize }
      expect(settingsSchema.safeParse({ ...settings, split }).success, `${testSize}`).toBe(false)
    }
  })
})

describe('parseProjectDocument', () => {
  it('온전한 문서를 통과시킨다', () => {
    expect(parseProjectDocument(document).manifest.projectId).toBe(manifest.projectId)
  })

  it('어디가 잘못됐는지 경로와 함께 알려준다', () => {
    const broken = {
      ...document,
      settings: { ...settings, split: { ...settings.split, testSize: 9 } },
    }
    try {
      parseProjectDocument(broken)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('PROJECT_FILE_INVALID')
      expect(error.params.path).toBe('settings.split.testSize')
    }
  })
})

describe('폼 입력은 엄격하다', () => {
  it('학번 상한을 넘으면 입력을 거부한다', () => {
    expect(studentIdInputSchema.safeParse('1'.repeat(21)).success).toBe(false)
    expect(studentIdInputSchema.safeParse('').success).toBe(false)
  })

  it('학번 형식을 강제하지 않는다 - 1-2-03 같은 체계가 실재한다', () => {
    expect(studentIdInputSchema.safeParse('1-2-03').success).toBe(true)
  })

  it('파일 파싱에는 그 상한이 걸리지 않는다', () => {
    const student = { studentId: '1'.repeat(40), name: '이'.repeat(50) }
    expect(manifestSchema.safeParse({ ...manifest, student }).success).toBe(true)
  })
})
