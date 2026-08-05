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

import { SOURCE_ENCODINGS } from '../data/encoding'
import { ClientError } from '../errors'
import { MAX_STUDENT_ID_LENGTH, MAX_STUDENT_NAME_LENGTH } from '../limits'
import { TRAINING_LOCATIONS } from '../ml/backend'

/** 이 앱이 읽고 쓰는 포맷 버전. 마이그레이션 체인의 종착점이다. */
export const FORMAT_VERSION = 1

/**
 * 이 앱이 만드는 프로젝트의 종류. **manifest.kind의 값이고 지금은 이것 하나뿐이다.**
 *
 * 값에 제품명을 넣지 않는다 - 제품명은 아직 미결이고(open-decisions.md #20) 파일에 박힌
 * 값은 나중에 못 바꾼다. 가리키는 것은 앱이 아니라 활동의 종류다.
 */
export const PROJECT_KIND_ML = 'machineLearning'

/** 과제 유형. 자동 판정하지 않는다 - 학생이 고른다 (mlpx-spec.md 1.1). */
/**
 * 내장 포트폴리오 템플릿의 id. 문항 문구는 파일이 아니라 로케일에 있다
 * (mlpx-spec.md §8) - 그래야 교사가 어떤 언어로 열어도 읽힌다.
 */
export const DEFAULT_PORTFOLIO_TEMPLATE_ID = 'default-v1'

/**
 * 내장 템플릿의 문항과 **그 순서.**
 *
 * 순서가 여기 있는 이유는 로케일 파일이 순서를 보장하지 않기 때문이다. 학생이 쓴
 * 글은 문항 id로 저장되므로(`portfolio.answers`) 이 배열을 고쳐도 글은 안 사라지지만,
 * **id를 바꾸면 사라진다.** 이름을 바꾸고 싶으면 로케일 문구만 고쳐라.
 */
export const DEFAULT_PORTFOLIO_SECTIONS = [
  'topic',
  'motivation',
  'data',
  'preprocessing',
  'model',
  'result',
  'reflection',
] as const

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

/**
 * 학습은 성공했는데 모델이 파일에 없는 이유.
 *
 * **없는 것과 왜 없는지는 다른 질문이다.** 학생에게는 전부 "예측할 수 없습니다"로
 * 보이지만 할 일이 다르다 (mlpx-spec.md 4.2).
 *
 * - `overBudget` - 파일 합계 예산에서 밀렸다. **다시 학습하면 되살아난다** (최신 묶음부터
 *   채우므로). 이 프로젝트의 옛 묶음을 지워도 된다.
 * - `tooLarge` - 모델 하나가 개별 상한을 넘었다. **다시 학습해도 소용없다** - 나무 개수를
 *   줄이는 식으로 모델 자체를 작게 만들어야 한다.
 * - `engineUnsupported` - 그 실행 방법에 아직 직렬화기가 없다. 지금 할 수 있는 일이 없다.
 *
 * 앞의 둘을 하나로 뭉치면 랜덤포레스트를 크게 돌린 학생에게 "다시 학습하세요"라고 답하고,
 * 학생은 같은 실패를 반복한다. **어휘를 나누는 이유는 구분이 가능해서가 아니라 화면이
 * 서로 다른 지시를 해야 하기 때문이다.**
 *
 * 전처리기가 없어 묶음째 빠지는 경우는 여기 없다. 그건 "모델을 왜 안 담았나"가 아니라
 * "이 파일이 어긋나 있다"는 다른 축이고, 정상 경로로는 나오지 않는다 (format.ts의
 * selectModels가 모델을 담을 때 전처리기를 항상 함께 담는다).
 *
 * status가 'done'이고 model이 없을 때만 의미가 있다.
 */
export const MODEL_OMISSION_REASONS = ['overBudget', 'tooLarge', 'engineUnsupported'] as const

export type TaskType = (typeof TASK_TYPES)[number]
export type DataType = (typeof DATA_TYPES)[number]
export type RunStatus = (typeof RUN_STATUSES)[number]
export type ModelOmissionReason = (typeof MODEL_OMISSION_REASONS)[number]

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
  /**
   * 이 프로젝트가 어떤 종류의 포트폴리오인가. **taskType·dataType보다 위의 축이다** -
   * 그 둘은 kind가 machineLearning일 때만 뜻을 갖는다 (mlpx-spec.md 2).
   *
   * **z.enum이 아니다.** 어휘가 아니라 등록부 축이므로 종류를 더하는 것은 포맷 변경이
   * 아니고, algorithm 이름·model.format과 같은 예외에 속한다 (mlpx-spec.md 10).
   * 그래서 모르는 값도 스키마는 통과시킨다 - 판정은 종류 등록부의 일이다.
   *
   * **값이 하나뿐인데도 적는 이유는 파일이 자기가 무엇인지 말해야 하기 때문이다.**
   * 확장자는 파일 밖에 있어 학생이 바꾸고 LMS가 바꾸면 사라진다. 어긋나면 이쪽이 이긴다.
   *
   * 없으면 machineLearning이다 - 이 필드가 없던 시절의 파일은 실제로 전부 그것이라
   * 마이그레이션 함수가 필요 없다. 종류가 둘 이상이 될 때 따라오는 것(검사 순서,
   * 모르는 종류의 에러 코드, 종류별 체인)은 open-decisions.md #20에 있다.
   */
  kind: z.string().default(PROJECT_KIND_ML),
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
  /** 정본의 인코딩. **언제나 'utf-8'이다** - 가져오기 시점에 정규화된다. */
  encoding: z.string(),
  /**
   * 업로드된 파일이 무엇이었는지. **화면 표시용이고 정본과 무관하다.**
   *
   * 엑셀에는 없다. 이 값이 없으면 한글이 깨져 보일 때 학생도 교사도 판정이 틀린 건지
   * 원본이 깨진 건지 구분할 수 없다 - "CP949로 읽었습니다"는 교실에서 값을 하는 정보다.
   */
  sourceEncoding: z.enum(SOURCE_ENCODINGS).optional(),
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
  /**
   * 아직 표를 올리지 않은 프로젝트에는 **없다.** 정상 상태다
   * (open-decisions.md "데이터 없는 프로젝트는 정상 상태다").
   *
   * 이것과 zip 안의 `dataset/` 본체는 **함께 있고 함께 없다** (mlpx-spec.md §1).
   */
  dataset: datasetRefSchema.optional(),
  features: z.array(userString),
  /** 군집화에는 없다. 과제 유형에 따라 선택 항목이다. */
  target: userString.optional(),
  preprocessing: preprocessingSchema,
  split: splitSchema,
  /**
   * 묶음 전체의 기본 실행 방법 id (ml/backend.ts의 RUNTIMES).
   *
   * 학생이 화면 위에서 한 번 고르는 값이다. 저장되지 않으면 프로젝트를 닫았다 열 때
   * 그 선택이 사라진다.
   */
  runtime: z.string(),
  /**
   * 학습할 모델들. **모델마다 실행 방법을 따로 고를 수 있다.**
   *
   * runtime이 없으면 위 기본을 따른다 - 학생 대부분은 안 건드린다. 그래도 축을 열어
   * 두는 이유는 셋이다.
   *
   * 1. **엔진은 원래부터 섞였다.** 그 방법으로 못 도는 알고리즘은 자동으로 넘어가고
   *    (open-decisions.md "실행 방법은 하나의 목록이다") 그래서 run.engine을 기록한다.
   *    도구가 말없이 섞는 것을 허용하면서 학생이 일부러 섞는 것만 막을 근거가 없다.
   * 2. **묶음이 보장하는 것은 같은 데이터·전처리·분할이다.** 엔진은 그 목록에 없었다.
   * 3. **배열이라 같은 알고리즘이 두 번 들어갈 수 있다.** "같은 결정트리인데 엔진이
   *    다르면 숫자가 왜 다른가"는 이 도구가 줄 수 있는 가장 좋은 수업 장면이다.
   */
  selectedAlgorithms: z.array(
    z.looseObject({
      algorithm: userString,
      runtime: z.string().optional(),
    }),
  ),
  /**
   * 알고리즘 id -> **실행 방법 id** -> 하이퍼파라미터.
   *
   * **실행 방법 축이 반드시 있어야 한다.** ml.js는 `maxDepth`, sklearn은 `max_depth`로
   * 어휘가 다르고, 같은 sklearn 둘은 어휘가 같은데 숫자가 갈린다
   * (open-decisions.md "실행 방법은 하나의 목록이다"). 알고리즘 하나로만 키를 잡으면
   * 학생이 실행 방법을 바꿨을 때 맞춰 둔 값이 **조용히 무시되고** 기본값으로 돈다 -
   * 화면에는 여전히 그 값이 떠 있는 채로.
   *
   * 자가호스팅 서버가 자기 알고리즘 목록을 알려주게 되면(로드맵 8단계) 파라미터 어휘가
   * 서버마다 달라지므로 이 축이 더 크게 값을 한다.
   */
  hyperparameters: z.record(z.string(), z.record(z.string(), opaqueRecord)),
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
    /** model이 없는 이유. 있으면 화면이 학생에게 무엇을 할 수 있는지 말할 수 있다. */
    modelOmitted: z.enum(MODEL_OMISSION_REASONS).optional(),
  })
  .refine((run) => run.status !== 'failed' || run.failure !== undefined, {
    // 실패한 run은 사유가 있어야 한다. 학생이 무엇이 왜 안 됐는지 알아야
    // 다음 선택을 할 수 있다 (mlpx-spec.md 5).
    path: ['failure'],
    error: 'required',
  })
  .refine((run) => run.status !== 'done' || run.metrics !== undefined, {
    // 성공했는데 지표가 없으면 비교표에 빈 줄이 생긴다. 위 규칙과 대칭이다 -
    // 끝난 run은 성공이든 실패든 무엇 때문에 그렇게 됐는지를 반드시 들고 있다.
    path: ['metrics'],
    error: 'required',
  })

/** 학습 시점의 설정 스냅샷. 묶음 전체가 공유한다. */
export const batchSettingsSchema = z.looseObject({
  /**
   * 이 묶음을 돌린 과제 유형. **manifest에 있는 것을 믿으면 안 된다.**
   *
   * taskType은 학생이 언제든 바꿀 수 있는데(mlpx-spec.md 0.1) manifest에는 현재 값만
   * 남는다. 그러면 분류로 돌린 옛 묶음과 회귀로 돌린 새 묶음이 비교표에 나란히 서고,
   * accuracy와 r2가 같은 열에 뜬다. 지표 키를 보고 역추론할 수도 있지만 그건 추측이다.
   */
  taskType: z.enum(TASK_TYPES),
  /** 이 묶음의 기본 실행 방법. 모델별로 덮어쓴 것은 아래 selectedAlgorithms에 있다. */
  runtime: z.string(),
  /**
   * 학습을 **요청한** 모델과 실행 방법. 스냅샷이므로 runtime이 항상 채워져 있다 -
   * 기록을 읽는 쪽이 기본값 규칙을 알아야 한다면 그건 스냅샷이 아니다.
   *
   * 실제로 무엇이 돌았는지는 각 run의 computedBy와 engine에 있다. **둘이 다를 수
   * 있다** - 요청한 방법으로 못 도는 알고리즘은 자동으로 넘어가기 때문이고,
   * 그 차이 자체가 화면이 "이건 왜 딴 데서 돌았나"를 설명할 근거다.
   */
  selectedAlgorithms: z.array(
    z.looseObject({
      algorithm: userString,
      runtime: z.string(),
    }),
  ),
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
