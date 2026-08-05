/**
 * 프런트엔드가 던지는 오류 코드.
 *
 * 두 종류가 있고, 로케일 네임스페이스가 다르다.
 *
 * **client.*** - 백엔드가 관여하지 않는 실패. 서버가 꺼져 있을 때, 프로젝트 파일을
 * 브라우저에서 열 때, 엑셀 시트를 고를 때가 그렇다. 이런 코드는 backend/app/errors.py
 * 에 없고 있어서도 안 된다. CI가 로케일의 errors.* 와 백엔드 ErrorCode의 양방향
 * 일치를 강제하기 때문이다.
 *
 * **errors.*** - 백엔드가 정의한 코드 중 **프런트엔드도 같은 판정을 하는 것**.
 * 데이터셋 검증이 여기 해당한다. 파일을 여는 것은 브라우저지만(CLAUDE.md 1.1) 서버도
 * 받은 데이터를 다시 검증해야 하므로 같은 실패가 양쪽에서 난다. 코드를 새로 만들면
 * 같은 문장이 두 네임스페이스에 중복되고 번역이 갈라진다. 그래서 백엔드 코드를
 * 그대로 쓴다 - 단일 출처는 여전히 backend/app/errors.py다.
 */

import { MAX_FAILURE_DETAIL_LENGTH } from './limits'

export const CLIENT_ERROR_CODES = [
  // 모델을 고를 수 없는 이유 - ml/algorithms.ts, ml/backend.ts
  // 우선순위가 곧 순서다: 데이터 타입 > 과제 유형 > 실행 위치 (mlpx-spec.md 0.1)
  'ALGORITHM_NOT_FOR_DATA_TYPE',
  'ALGORITHM_NOT_FOR_TASK_TYPE',
  'SERVER_UNAVAILABLE',
  'ALGORITHM_NOT_AVAILABLE_HERE',
  'DATASET_TOO_LARGE_FOR_BROWSER',
  'ENGINE_NOT_READY',

  // 프로젝트 파일 열기 - project/format.ts, project/migrate.ts
  'PROJECT_FILE_NOT_ZIP',
  'PROJECT_FILE_ENTRY_MISSING',
  'PROJECT_FILE_INVALID',
  'PROJECT_FILE_VERSION_TOO_NEW',
  'PROJECT_FILE_VERSION_UNSUPPORTED',

  // 모델 실행 - 파일은 멀쩡히 열리고 그 모델로 예측만 못 한다 (mlpx-spec.md 6)
  'MODEL_FORMAT_UNSUPPORTED',
  // 형식은 아는데 내용이 그 형식이 아니다. 위와 나누는 이유는 학생이 할 일이 다르기
  // 때문이다 - 위는 앱을 최신으로 바꾸면 되고, 이건 다시 학습해야 한다 (mlpx-spec.md 5.3).
  'MODEL_FILE_INVALID',

  // 표 파일 가져오기 - 서버는 정규화된 CSV만 보므로 이 둘은 서버에 없다 (data/table.ts)
  'DATASET_FILE_TYPE_UNSUPPORTED',
  'DATASET_SHEET_NOT_FOUND',

  // 브라우저 저장소 - project/storage.ts
  'STORAGE_QUOTA_EXCEEDED',

  // 우리가 코드로 만들어 두지 않은 실패의 마지막 그물.
  // JOB_FAILED와 나누는 이유는 그건 학습에 대한 말이기 때문이다 - 저장이 실패했는데
  // "학습에 실패했습니다"가 뜨면 학생은 엉뚱한 것을 다시 한다.
  'UNEXPECTED_ERROR',

  // 학습셋/평가셋 분할 - ml/split.ts
  // 분할은 클라이언트만 계산한다(mlpx-spec.md 0.3). 서버는 인덱스를 받기만 하므로
  // 이 둘은 backend/app/errors.py 에 없다.
  'SPLIT_TOO_FEW_ROWS',
  'SPLIT_STRATIFY_IMPOSSIBLE',
] as const

/**
 * 백엔드와 공유하는 코드. 로케일에서 errors.* 로 찾는다.
 *
 * 여기 이름은 반드시 backend/app/errors.py 의 ErrorCode에 있어야 한다
 * (tests/locales.spec.ts가 로케일을 통해 강제한다).
 */
export const SHARED_ERROR_CODES = [
  // 표 파일 파싱·검증 - data/csv.ts, data/xlsx.ts, data/table.ts
  'DATASET_PARSE_FAILED',
  'DATASET_EMPTY',
  'DATASET_ENCODING_UNSUPPORTED',
  'DATASET_TOO_MANY_ROWS',
  'DATASET_TOO_MANY_COLUMNS',

  // 전처리 - ml/preprocess.ts
  // 브라우저에서 학습하든 서버로 보내든 같은 판정이 양쪽에서 난다.
  'COLUMN_NOT_FOUND',
  'FEATURE_NOT_SELECTED',
  'FEATURE_ALL_MISSING',
  'TARGET_NOT_SELECTED',
  // 회귀인데 대상 열이 수치가 아니다. 브라우저가 학습하든 서버로 보내든 같은 판정이다.
  'TARGET_NOT_NUMERIC',
  // 분할 인덱스가 데이터셋 범위를 벗어났다. 클라이언트가 계산해 서버로 보내는 값이라
  // (mlpx-spec.md 0.3) 받는 쪽도 같은 판정을 한다.
  'SPLIT_INDEX_OUT_OF_RANGE',

  // 학습 자체의 실패 - ml/metrics.ts, ml/engines/
  'ALGORITHM_UNSUPPORTED',
  // 손잡이 값이 눈금 밖이다 - ml/hyperparams.ts. 브라우저가 학습하든 서버로 보내든
  // 같은 판정이고, 서버도 자기 서술로 같은 코드를 낸다.
  'HYPERPARAM_OUT_OF_RANGE',
  'JOB_FAILED',
  // 학생이 학습을 멈춘 것. 브라우저에서는 워커 terminate가, 서버에서는 취소 요청이
  // 같은 뜻이므로 코드가 하나다 (ml/worker/client.ts).
  'JOB_CANCELLED',
] as const

/**
 * 무결성 확인 결과. **에러가 아니라 상태다** - 확인 자체는 성공했고 결과가 그중 하나다.
 *
 * 축이 둘이라 열거형도 둘이다. 하나로 합치면 화면에 if 분기가 생긴다.
 * 확인이 전부 브라우저에서 끝나므로(open-decisions.md "무결성은 해시와 재실행 대조로 한다")
 * 백엔드 errors.py에는 이 어휘가 없다.
 *
 * **VERIFIED처럼 보증으로 읽히는 낱말을 쓰지 마라.** 도구가 보증할 수 있는 것보다 강한
 * 말이고, 교사가 그 말을 믿기 시작하면 허술한 탐지기가 판단을 대신하게 된다
 * (mlpx-spec.md 7.3).
 */
export const FILE_HASH_STATUSES = ['UNCHANGED', 'MODIFIED', 'UNKNOWN'] as const

/**
 * 엔트리 하나하나의 대조 결과. 파일 전체 상태(FILE_HASH_STATUSES)와 축이 다르다.
 *
 * 해시가 실제로 값을 하는 자리가 여기다 - "runs.json은 바뀌었고 dataset/은 그대로"는
 * 교사에게 넘길 신호로서 쓸모가 있다 (mlpx-spec.md 7.2). 파일 전체가 MODIFIED라는
 * 말만으로는 학생에게도 교사에게도 할 수 있는 일이 없다.
 */
export const ENTRY_HASH_STATUSES = ['UNCHANGED', 'MODIFIED', 'ADDED', 'REMOVED'] as const

/** 재실행 대조 결과. 대조는 run을 만든 엔진으로만 한다 (architecture.md 3.2). */
export const REPRODUCTION_STATUSES = [
  'NOT_CHECKED',
  'REPRODUCED',
  'NOT_REPRODUCED',
  'ENGINE_UNAVAILABLE',
] as const

export type FileHashStatus = (typeof FILE_HASH_STATUSES)[number]
export type EntryHashStatus = (typeof ENTRY_HASH_STATUSES)[number]
export type ReproductionStatus = (typeof REPRODUCTION_STATUSES)[number]

export type ClientOnlyErrorCode = (typeof CLIENT_ERROR_CODES)[number]
export type SharedErrorCode = (typeof SHARED_ERROR_CODES)[number]
export type ClientErrorCode = ClientOnlyErrorCode | SharedErrorCode

/** 로케일 문장에 보간되는 값. 백엔드의 ParamValue와 같은 규칙이다. */
export type ClientErrorParams = Record<string, string | number | boolean | string[]>

function isSharedErrorCode(code: ClientErrorCode): code is SharedErrorCode {
  return (SHARED_ERROR_CODES as readonly string[]).includes(code)
}

/**
 * 코드를 로케일 키로 바꾼다. 화면은 이 결과를 t()에 넣는다.
 *
 * 네임스페이스를 화면이 직접 조립하면 공유 코드를 client.* 에서 찾다가 조용히
 * 키 문자열이 그대로 보인다. 판정은 여기 한 곳에서만 한다.
 */
export function errorMessageKey(code: ClientErrorCode): string {
  return `${isSharedErrorCode(code) ? 'errors' : 'client'}.${code}`
}

/**
 * 프런트엔드의 유일한 오류 타입.
 *
 * message에는 코드만 넣는다. 사람이 읽는 문장은 화면이 t(errorMessageKey(code), params)로
 * 만든다. 백엔드가 자연어를 만들지 않는 것과 같은 이유다 - 언어는 표시 시점에 정해진다.
 */
export class ClientError extends Error {
  readonly code: ClientErrorCode
  readonly params: ClientErrorParams

  constructor(code: ClientErrorCode, params: ClientErrorParams = {}) {
    super(code)
    this.name = 'ClientError'
    this.code = code
    this.params = params
  }

  /** 이 오류를 보여줄 로케일 키. */
  get messageKey(): string {
    return errorMessageKey(this.code)
  }
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError
}

/**
 * 우리 어휘가 아닌 실패에 붙이는 기술 정보.
 *
 * **에러 코드를 라이브러리 결함 수만큼 늘리지 않기 위한 것이다.** 결함마다 코드를 새로
 * 만들면 로케일 파일 둘과 errors.py까지 그 수만큼 끌려다닌다. 대신 코드는 JOB_FAILED로
 * 두고 원문을 여기 실어 보낸다.
 *
 * **이 값은 주 메시지가 아니다.** 남의 라이브러리가 던진 영어 문장이라 번역되지 않고,
 * 화면은 t()로 만든 문장을 먼저 보여준 뒤 이것을 기술 정보로 따로 붙여야 한다
 * (CLAUDE.md 1.4). 사람이 읽는 문장을 코드 대신 쓰는 것이 아니라, 코드로는 담을 수 없는
 * 것을 버리지 않고 남기는 것이다.
 *
 * 스택은 담지 않는다. 학생 파일에 우리 코드 구조를 흘릴 이유가 없다.
 */
export function failureDetail(error: unknown): ClientErrorParams {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const trimmed = message.trim().slice(0, MAX_FAILURE_DETAIL_LENGTH)
  return trimmed === '' ? {} : { detail: trimmed }
}

const KNOWN_CODES: ReadonlySet<string> = new Set<string>([
  ...CLIENT_ERROR_CODES,
  ...SHARED_ERROR_CODES,
])

/**
 * 경계를 넘어온 문자열을 코드로 바꾼다. 모르는 것은 JOB_FAILED다.
 *
 * Web Worker의 postMessage도 서버의 JSON도 **타입을 넘기지 못한다.** 그쪽에서
 * ClientError로 던진 것이 이쪽에는 그냥 string으로 도착하므로, 캐스팅으로 넘기면
 * 로케일에 없는 키가 화면에 그대로 노출된다. 여기서 한 번 좁힌다.
 */
export function toClientErrorCode(value: string): ClientErrorCode {
  return KNOWN_CODES.has(value) ? (value as ClientErrorCode) : 'JOB_FAILED'
}
