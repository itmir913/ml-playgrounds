/**
 * .mlpx 스키마의 계약.
 *
 * 두 가지를 지킨다.
 * - 모르는 **필드**는 살아남는다 (구버전이 저장해도 새 필드가 지워지지 않는다)
 * - 모르는 **어휘**는 거부된다 (같은 버전인데 모르는 값이면 그건 깨진 값이다)
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import {
  DATA_COMPARABLE_KEYS,
  DATA_SCHEMAS,
  DATA_TYPES,
  FORMAT_VERSION,
  PROJECT_KIND_ML,
  experimentSettingsSchema,
  manifestSchema,
  parseProjectDocument,
  runSchema,
  runsFileSchema,
  settingsSchema,
  studentIdInputSchema,
  dataSettings,
} from '../src/project/schema'

const manifest = {
  formatVersion: FORMAT_VERSION,
  appVersion: '0.0.0',
  projectId: '550e8400-e29b-41d4-a716-446655440000',
  name: '붓꽃 품종 분류',
  createdAt: '2026-08-04T09:00:00Z',
  updatedAt: '2026-08-04T10:30:00Z',
  taskType: 'classification',
  dataType: 'tabular',
  locale: 'ko',
}

const settings = {
  data: {
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'iris_data_final(1).csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features: ['sepal_length', 'petal_length'],
    target: 'species',
    preprocessing: { missing: 'drop', scaling: 'standard', categoricalEncoding: 'onehot' },
  },
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
  runs: { experiments: [] },
  portfolio: { template: { sections: [] }, answers: {} },
}

/**
 * **어휘 고정은 tests/schema-version.spec.ts로 옮겼다.**
 *
 * 목록만 못 박는 것으로는 부족했다 - 배포 뒤에 어휘를 바꾸고 버전을 안 올리는 것이
 * 진짜 위험이고, 배포 전에 버전을 올리는 것은 그 반대 방향의 낭비다. 두 방향을 함께
 * 보려면 버전마다의 지문이 필요해서 파일을 나눴다.
 */

describe('답을 무엇으로 썼는지가 파일에 적힌다', () => {
  it('안 적힌 파일은 지금 형식으로 본다 - 이 필드가 생기기 전의 파일이다', () => {
    // 그때 답은 전부 서식 없는 글이었다.
    expect(parseProjectDocument(document).portfolio.answerFormat).toBe('plain-v1')
  })

  it('적힌 대로 읽는다', () => {
    const written = {
      ...document,
      portfolio: { ...document.portfolio, answerFormat: 'plain-v1' },
    }
    expect(parseProjectDocument(written).portfolio.answerFormat).toBe('plain-v1')
  })

  it('모르는 형식은 거부한다 - 우리가 못 읽는 글을 읽은 척하지 않는다', () => {
    const written = { ...document, portfolio: { ...document.portfolio, answerFormat: 'rich-v1' } }
    expect(() => parseProjectDocument(written)).toThrow()
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
      data: {
        ...settings.data,
        preprocessing: { ...settings.data.preprocessing, outlierRemoval: 'iqr' },
      },
    })
    expect(dataSettings('tabular', parsed).preprocessing.outlierRemoval).toBe('iqr')
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

  it('과제 유형이 아예 없는 것은 정상이다 - 아직 안 골랐다는 뜻이다', () => {
    // 기본값을 두면 학생이 고른 분류와 아무도 안 고른 분류가 구분되지 않는다
    // (open-decisions.md "기계학습 유형은 모델을 고르는 자리에서 고른다").
    const { taskType, ...withoutTaskType } = manifest
    expect(taskType).toBeDefined()
    const parsed = manifestSchema.safeParse(withoutTaskType)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.taskType).toBeUndefined()
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
      data: { ...settings.data, dataset: { ...settings.data.dataset, sourceEncoding } },
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

describe('프로젝트 종류', () => {
  it('없으면 machineLearning으로 채워진다 - 이 필드가 없던 파일은 전부 그것이다', () => {
    const older: Record<string, unknown> = { ...manifest }
    delete older.kind
    expect(manifestSchema.parse(older).kind).toBe(PROJECT_KIND_ML)
  })

  it('읽은 문서에는 항상 값이 있다 - 그래서 저장할 때도 항상 적힌다', () => {
    expect(parseProjectDocument(document).manifest.kind).toBe(PROJECT_KIND_ML)
  })

  it('적혀 있으면 그 값을 쓴다', () => {
    const parsed = manifestSchema.parse({ ...manifest, kind: PROJECT_KIND_ML })
    expect(parsed.kind).toBe(PROJECT_KIND_ML)
  })

  it('모르는 종류도 통과시킨다 - 어휘가 아니라 등록부 축이다', () => {
    // 판정은 종류 등록부의 일이고 그때 할 말은 "파일이 깨졌습니다"가 아니라
    // "이 종류를 이 앱은 모릅니다"다 (open-decisions.md #20). 스키마가 여기서
    // 거부하면 그 구분이 영영 불가능해진다.
    const parsed = manifestSchema.parse({ ...manifest, kind: 'programming' })
    expect(parsed.kind).toBe('programming')
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

  it('새 프로젝트는 실험이 없다', () => {
    expect(runsFileSchema.parse({}).experiments).toEqual([])
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

  /**
   * **`settings.data`는 판별 필드가 없는 유니온이다** - 어느 쪽으로 읽을지는
   * `manifest.dataType`이 정하는데(mlpx-spec.md §3) 그건 설정 밖에 있다. 그래서 zod
   * 혼자서는 어긋난 짝을 못 잡고, 통과시키면 파일이 열린 다음에 `dataSettings`가
   * 날것의 ZodError를 던져 화면이 선다. 우리 앱이 만들 수 없는 파일이다.
   */
  it('표라고 적고 이미지 설정을 넣으면 거부한다', () => {
    const broken = {
      ...document,
      settings: { ...settings, data: DATA_SCHEMAS.image.initial() },
    }
    try {
      parseProjectDocument(broken)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('PROJECT_FILE_INVALID')
      expect(String(error.params.path)).toMatch(/^settings\.data/)
    }
  })

  it('이미지라고 적고 표 설정을 넣으면 거부한다', () => {
    const broken = { ...document, manifest: { ...manifest, dataType: 'image' } }
    try {
      parseProjectDocument(broken)
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (!isClientError(error)) return
      expect(error.code).toBe('PROJECT_FILE_INVALID')
    }
  })

  it('짝이 맞으면 통과한다 - 이미지도 마찬가지다', () => {
    const image = {
      ...document,
      manifest: { ...manifest, dataType: 'image' },
      settings: { ...settings, data: DATA_SCHEMAS.image.initial() },
    }
    expect(parseProjectDocument(image).manifest.dataType).toBe('image')
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

/**
 * 데이터 종류별 설정을 가른 뒤 생긴 규칙들 (open-decisions.md "설정 스키마를 데이터
 * 종류별로 가른다").
 */
describe('데이터 종류별 설정', () => {
  const kindFields = (pick: 'settings' | 'snapshot') =>
    DATA_TYPES.flatMap((dataType) => Object.keys(DATA_SCHEMAS[dataType][pick].shape))

  it('종류마다 스키마 둘이 다 있다 - 없으면 그 파일을 읽을 방법이 없다', () => {
    for (const dataType of DATA_TYPES) {
      expect(DATA_SCHEMAS[dataType].settings, dataType).toBeDefined()
      expect(DATA_SCHEMAS[dataType].snapshot, dataType).toBeDefined()
    }
  })

  /**
   * **변경 이력이 `settings.data`를 평평하게 펴기 때문이다** (`ml/experiment.ts`의
   * `comparable`). 이름이 겹치면 편 자리에서 하나가 다른 하나를 조용히 덮고, 그러면
   * 학생이 바꾼 것이 목록에서 사라진다.
   */
  it('종류별 필드는 공통 필드와 이름이 겹치지 않는다', () => {
    const common = new Set([
      ...Object.keys(settingsSchema.shape).filter((key) => key !== 'data'),
      ...Object.keys(experimentSettingsSchema.shape).filter((key) => key !== 'data'),
      // comparable에서 selectedAlgorithms가 눕는 이름이다 (mlpx-spec.md §4).
      'algorithms',
    ])
    const clashes = [...kindFields('settings'), ...kindFields('snapshot')].filter((key) =>
      common.has(key),
    )
    expect(clashes, '종류별 필드 이름이 공통 필드와 겹친다').toEqual([])
  })

  it('스냅샷 필드가 전부 비교 목록에 있다 - 빠지면 그 변경이 안 뜬다', () => {
    const missing = kindFields('snapshot').filter((key) => !DATA_COMPARABLE_KEYS.includes(key))
    expect(missing).toEqual([])
  })

  /**
   * 시작값이 자기 스키마와 어긋나면 **만들자마자 못 여는 프로젝트**가 나온다. 그리고
   * 그 실패를 만나는 것은 만든 학생이 아니라 파일을 받은 교사다 - 저장은 성공하고
   * 여는 쪽에서 죽는다.
   */
  it('종류마다 시작값이 자기 스키마를 통과한다', () => {
    for (const dataType of DATA_TYPES) {
      const kind = DATA_SCHEMAS[dataType]
      expect(() => kind.settings.parse(kind.initial()), dataType).not.toThrow()
    }
  })

  /**
   * **값이 아니라 만드는 함수여야 하는 이유다.** 값 하나를 등록부에 두면 프로젝트
   * 여럿이 같은 배열을 가리키고, 한 프로젝트에서 특성이나 범주를 고치면 다른
   * 프로젝트가 따라 바뀐다. 격리해서 돌리면 통과하고 여럿을 만들 때만 무너지는 종류다.
   */
  it('시작값은 부를 때마다 새것이다 - 프로젝트끼리 같은 객체를 안 나눠 쓴다', () => {
    for (const dataType of DATA_TYPES) {
      const first = DATA_SCHEMAS[dataType].initial()
      const second = DATA_SCHEMAS[dataType].initial()
      expect(first, dataType).not.toBe(second)
      for (const [key, value] of Object.entries(first)) {
        if (typeof value !== 'object' || value === null) continue
        expect(value, `${dataType}.${key}`).not.toBe((second as Record<string, unknown>)[key])
      }
    }
  })
})
