/**
 * manifest / settings / runs / portfolio 의 타입 정의 - .mlpx 스키마의 단일 출처.
 * 런타임 검증도 여기서 담당한다 (.mlpx는 외부에서 들어오는 파일이다).
 * 명세: docs/mlpx-spec.md
 *
 * 두 가지 규칙이 이 파일 전체를 지배한다.
 *
 * 1. **object는 전부 looseObject다.** zod 기본값 strip은 모르는 필드를 소리 없이 지운다.
 *    중첩된 곳까지 전부 loose여야 한다. 최상위만 열어 두면 metrics 안의 새 지표가 사라진다.
 *
 * 2. **어휘(enum)는 엄격하다.** 상위 버전 파일은 formatVersion 검사에서 이미 거부되므로
 *    (project/migrate.ts) 여기까지 내려온 파일은 항상 같은 버전이다. 따라서 모르는 값은
 *    미래의 값이 아니라 깨진 값이다.
 *    대가로 **어휘가 늘어나는 변경은 FORMAT_VERSION 증가와 마이그레이션을 요구한다.**
 *    tests/schema.spec.ts가 어휘를 고정해 두고 있어서 잊고 지나갈 수 없다.
 *
 * 예외는 축이 다른 것뿐이다. algorithm 이름과 model.format은 알고리즘 등록부에 속하고
 * 등록부 변경은 포맷 변경이 아니다. 그래서 검증하지 않는다 (mlpx-spec.md 6.2).
 */

import { z } from 'zod'

import { ClientError } from '../errors'
import { MAX_STUDENT_ID_LENGTH, MAX_STUDENT_NAME_LENGTH } from '../limits'
import { TRAINING_LOCATIONS } from '../ml/backend'

/** 이 앱이 읽고 쓰는 포맷 버전. 마이그레이션 체인의 종착점이다. */
export const FORMAT_VERSION = 1

/** 과제 유형. 자동 판정하지 않는다 - 학생이 고른다 (mlpx-spec.md 1.1). */
export const TASK_TYPES = ['classification', 'regression', 'clustering'] as const

/** 데이터 타입. 업로드한 파일에서 자동 판정된다. */
export const DATA_TYPES = ['tabular', 'image', 'audio', 'text'] as const

/** 결측치 처리. */
export const MISSING_STRATEGIES = ['drop', 'mean', 'median', 'mostFrequent', 'zero'] as const

/** 수치 스케일링. */
export const SCALING_METHODS = ['none', 'standard', 'minmax', 'robust'] as const

/** 범주형 인코딩. */
export const CATEGORICAL_ENCODINGS = ['none', 'onehot', 'ordinal'] as const

/**
 * 분할 방식.
 *
 * kfold는 여기 없다. 폴드마다 학습·평가가 생기면 trainIndices/testIndices의 모양 자체가
 * 달라져서 어차피 구조 변경이고, 그때 FORMAT_VERSION이 올라간다.
 */
export const SPLIT_METHODS = ['holdout'] as const

/** 개별 학습의 결과. 실패한 것도 비교표에 남는다 (mlpx-spec.md 5). */
export const RUN_STATUSES = ['done', 'failed'] as const

export type TaskType = (typeof TASK_TYPES)[number]
export type DataType = (typeof DATA_TYPES)[number]
export type RunStatus = (typeof RUN_STATUSES)[number]

/**
 * 앱이 만들어 넣는 시각. 오프셋을 허용해 +09:00 형태도 받는다.
 *
 * 사용자 데이터가 아니라 우리가 쓴 값이므로 형식을 강제해도 안전하다.
 * trainedAt은 표절 판단의 단서이기도 하다 (mlpx-spec.md 7.3).
 */
const timestamp = z.iso.datetime({ offset: true })

/**
 * 사용자 데이터에서 온 문자열 - 컬럼명, 클래스 라벨, 알고리즘 id.
 *
 * **어떤 문자열이든 받는다.** 한글·공백·특수문자가 오는 것이 정상이다.
 * 여기에 검증을 걸면 멀쩡한 데이터가 거부된다 (mlpx-spec.md 10).
 */
const userString = z.string()

/** 알 수 없는 구조를 그대로 통과시키는 자리. 하이퍼파라미터 값이 대표적이다. */
const opaqueRecord = z.record(z.string(), z.unknown())

// ---------------------------------------------------------------- manifest

export const studentSchema = z.looseObject({
  studentId: z.string().optional(),
  name: z.string().optional(),
})

/** 남의 파일에서 시작했을 때만 기록된다 (mlpx-spec.md 7.3). */
export const derivedFromSchema = z.looseObject({
  projectId: z.uuid(),
  at: timestamp,
  hadResults: z.boolean(),
  hadPortfolio: z.boolean(),
})

export const manifestSchema = z.looseObject({
  formatVersion: z.int().positive(),
  appVersion: z.string(),
  projectId: z.uuid(),
  name: userString,
  createdAt: timestamp,
  updatedAt: timestamp,
  student: studentSchema.optional(),
  derivedFrom: derivedFromSchema.optional(),
  taskType: z.enum(TASK_TYPES),
  dataType: z.enum(DATA_TYPES),
  locale: z.string(),
})

// ---------------------------------------------------------------- settings

export const datasetRefSchema = z.looseObject({
  /** zip 안의 경로. 원본 바이트는 손대지 않는다 (해시 재계산 때문). */
  path: z.string(),
  originalFileName: userString,
  hasHeader: z.boolean(),
  encoding: z.string(),
})

export const preprocessingSchema = z.looseObject({
  missing: z.enum(MISSING_STRATEGIES),
  scaling: z.enum(SCALING_METHODS),
  categoricalEncoding: z.enum(CATEGORICAL_ENCODINGS),
})

export const splitSchema = z.looseObject({
  method: z.enum(SPLIT_METHODS),
  testSize: z.number().gt(0).lt(1),
  stratify: z.boolean(),
  /** 항상 저장하고 항상 쓴다. 재현 가능성이 교육용 도구의 생명이다. */
  randomState: z.int(),
})

export const settingsSchema = z.looseObject({
  dataset: datasetRefSchema,
  features: z.array(userString),
  /** 군집화에는 없다. 과제 유형에 따라 선택 항목이다. */
  target: userString.optional(),
  preprocessing: preprocessingSchema,
  split: splitSchema,
  selectedAlgorithms: z.array(userString),
  /** 알고리즘 id -> 하이퍼파라미터. 학생이 안 건드려도 실제 쓰인 값을 전부 기록한다. */
  hyperparameters: z.record(z.string(), opaqueRecord),
})

// -------------------------------------------------------------------- runs

export const perClassSchema = z.looseObject({
  label: userString,
  precision: z.number(),
  recall: z.number(),
  f1: z.number(),
  support: z.int(),
})

export const confusionMatrixSchema = z.looseObject({
  labels: z.array(userString),
  matrix: z.array(z.array(z.int())),
})

export const featureImportanceSchema = z.looseObject({
  feature: userString,
  importance: z.number(),
})

/**
 * 이 run을 만든 학습 엔진.
 *
 * **재실행 대조는 엔진을 넘지 않는다** (architecture.md 3.2). 배포 경로가 둘이라
 * 학생이 Pages에서 학습하고 교사가 도커 설치본에서 대조하는 일이 생기는데, 엔진이 다르면
 * 숫자가 갈려 무고한 학생이 위조를 의심받는다. 그래서 무엇으로 만들었는지를 남긴다.
 *
 * kind는 등록부에 속하므로 z.enum으로 막지 않는다 - 엔진 추가는 포맷 변경이 아니다.
 */
export const engineSchema = z.looseObject({
  kind: z.string(),
  version: z.string(),
})

/**
 * 실패 사유.
 *
 * code는 백엔드 ErrorCode이거나 클라이언트 코드다. 목록을 여기 복제하지 않는다 -
 * 백엔드 errors.py와 로케일의 일치는 CI가 이미 강제하고 있고, 세 번째 사본을
 * 만들면 그것부터 어긋난다.
 */
export const failureSchema = z.looseObject({
  code: z.string(),
  params: opaqueRecord.optional(),
})

/**
 * 모델 파일에 대한 참조.
 *
 * format은 검증하지 않는다. 포맷 계층은 모델 안을 들여다보지 않고 어떻게 해석할지만
 * 적어 둔다. 모르는 형식이면 파일은 열리고 그 모델로 예측만 못 한다 (mlpx-spec.md 6.2).
 */
export const modelRefSchema = z.looseObject({
  format: z.string(),
  path: z.string(),
  includesPreprocessing: z.boolean(),
  sizeBytes: z.int().nonnegative(),
})

/**
 * 모델 하나의 학습 결과.
 *
 * model이 없는 것은 정상이다 - 크기 예산에서 밀리면 지표만 남는다 (mlpx-spec.md 5.1).
 */
export const runSchema = z
  .looseObject({
    id: z.string(),
    algorithm: userString,
    hyperparameters: opaqueRecord,
    computedBy: z.enum(TRAINING_LOCATIONS),
    trainedAt: timestamp,
    status: z.enum(RUN_STATUSES),
    metrics: z.record(z.string(), z.number()).optional(),
    perClass: z.array(perClassSchema).optional(),
    confusionMatrix: confusionMatrixSchema.optional(),
    featureImportance: z.array(featureImportanceSchema).optional(),
    engine: engineSchema.optional(),
    failure: failureSchema.optional(),
    model: modelRefSchema.optional(),
  })
  .refine((run) => run.status !== 'failed' || run.failure !== undefined, {
    // 실패한 run은 사유가 있어야 한다. 학생이 무엇이 왜 안 됐는지 알아야
    // 다음 선택을 할 수 있다 (mlpx-spec.md 5).
    path: ['failure'],
    error: 'required',
  })

/** 학습 시점의 설정 스냅샷. 묶음 전체가 공유한다. */
export const batchSettingsSchema = z.looseObject({
  features: z.array(userString),
  target: userString.optional(),
  preprocessing: preprocessingSchema,
  split: splitSchema,
  /**
   * 분할을 클라이언트가 계산해 서버에 함께 보낸다.
   * 양쪽이 각자 계산하면 라이브러리 버전 차이로 테스트셋이 갈리고,
   * 그러면 같은 묶음인데 비교가 성립하지 않는다 (mlpx-spec.md 1.3).
   */
  trainIndices: z.array(z.int().nonnegative()),
  testIndices: z.array(z.int().nonnegative()),
})

/**
 * [학습] 한 번이 묶음 하나다. 같은 데이터·전처리·분할을 쓰므로
 * 공정한 비교가 구조적으로 보장된다.
 */
export const batchSchema = z.looseObject({
  id: z.string(),
  startedAt: timestamp,
  /** 직전 묶음 대비 무엇이 바뀌었는지. 설정 경로의 목록이다. */
  changed: z.array(z.string()).optional(),
  settings: batchSettingsSchema,
  preprocessor: z
    .looseObject({
      format: z.string(),
      path: z.string(),
    })
    .optional(),
  runs: z.array(runSchema),
})

export const runsFileSchema = z.looseObject({
  /** 새 프로젝트에는 없다. */
  batches: z.array(batchSchema).default([]),
})

// --------------------------------------------------------------- portfolio

/**
 * 문항 정의.
 *
 * 내장 템플릿은 id만 파일에 남기고 문구는 로케일에서 가져온다.
 * sections가 있는 것은 교사가 자기 문항을 쓴 경우이고, 그 문구는 애초에 번역 대상이
 * 아니므로 파일 안에 그대로 둔다 (mlpx-spec.md 8).
 */
export const portfolioTemplateSchema = z.looseObject({
  id: z.string(),
  sections: z
    .array(
      z.looseObject({
        id: z.string(),
        title: userString,
      }),
    )
    .optional(),
})

export const portfolioSchema = z.looseObject({
  template: portfolioTemplateSchema,
  /** 문항 id -> 학생이 쓴 글. */
  answers: z.record(z.string(), z.string()).default({}),
})

// ---------------------------------------------------------------- document

/**
 * 파일 안의 JSON 넷을 메모리에서 함께 다루는 단위.
 *
 * 마이그레이션이 이 단위로 동작한다. 스키마 변경이 settings와 runs에 동시에 걸치는 것이
 * 정상이기 때문에 manifest만 넘겨서는 고칠 수 없다.
 */
export const projectDocumentSchema = z.looseObject({
  manifest: manifestSchema,
  settings: settingsSchema,
  runs: runsFileSchema,
  portfolio: portfolioSchema,
})

/**
 * 문서를 검증해 돌려준다. 실패하면 ClientError를 던진다.
 *
 * **마이그레이션을 마친 뒤에 부른다.** 구버전 파일은 현재 스키마를 만족하지 않는 것이
 * 당연하고, 순서를 뒤집으면 올려서 열 수 있는 파일이 전부 여기서 거부된다.
 */
export function parseProjectDocument(value: unknown): ProjectDocument {
  const result = projectDocumentSchema.safeParse(value)
  if (result.success) {
    return result.data
  }
  // 어느 필드가 왜 잘못됐는지 위치를 준다. 화면은 이 경로를 그대로 보여준다.
  const first = result.error.issues[0]
  throw new ClientError('PROJECT_FILE_INVALID', {
    path: first?.path.join('.') ?? '',
    issues: result.error.issues.length,
  })
}

// ------------------------------------------------------------- 폼 입력 전용

/**
 * 파일 파싱은 관대하게, 폼 입력은 엄격하게 (mlpx-spec.md 10).
 *
 * 아래 둘은 **입력 화면에서만** 쓴다. 파싱 경로에서 쓰면 안 된다 -
 * 상한을 넘는 학번이 든 남의 파일도 열려야 한다.
 */
export const studentIdInputSchema = z.string().trim().min(1).max(MAX_STUDENT_ID_LENGTH)

export const studentNameInputSchema = z.string().trim().min(1).max(MAX_STUDENT_NAME_LENGTH)

export type PerClass = z.infer<typeof perClassSchema>
export type ConfusionMatrix = z.infer<typeof confusionMatrixSchema>
export type FeatureImportance = z.infer<typeof featureImportanceSchema>
export type Student = z.infer<typeof studentSchema>
export type Manifest = z.infer<typeof manifestSchema>
export type DatasetRef = z.infer<typeof datasetRefSchema>
export type Preprocessing = z.infer<typeof preprocessingSchema>
export type Split = z.infer<typeof splitSchema>
export type Settings = z.infer<typeof settingsSchema>
export type Engine = z.infer<typeof engineSchema>
export type Failure = z.infer<typeof failureSchema>
export type ModelRef = z.infer<typeof modelRefSchema>
export type Run = z.infer<typeof runSchema>
export type Batch = z.infer<typeof batchSchema>
export type RunsFile = z.infer<typeof runsFileSchema>
export type Portfolio = z.infer<typeof portfolioSchema>
export type ProjectDocument = z.infer<typeof projectDocumentSchema>
