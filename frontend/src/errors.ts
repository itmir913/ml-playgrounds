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

export const CLIENT_ERROR_CODES = [
  // 학습 실행 위치 - ml/backend.ts
  'SERVER_UNAVAILABLE',
  'ALGORITHM_NOT_AVAILABLE_HERE',
  'DATASET_TOO_LARGE_FOR_BROWSER',

  // 프로젝트 파일 열기 - project/format.ts, project/migrate.ts
  'PROJECT_FILE_NOT_ZIP',
  'PROJECT_FILE_ENTRY_MISSING',
  'PROJECT_FILE_INVALID',
  'PROJECT_FILE_VERSION_TOO_NEW',
  'PROJECT_FILE_VERSION_UNSUPPORTED',

  // 모델 실행 - 파일은 멀쩡히 열리고 그 모델로 예측만 못 한다 (mlpx-spec.md 6)
  'MODEL_FORMAT_UNSUPPORTED',

  // 표 파일 가져오기 - 서버는 정규화된 CSV만 보므로 이 둘은 서버에 없다 (data/table.ts)
  'DATASET_FILE_TYPE_UNSUPPORTED',
  'DATASET_SHEET_NOT_FOUND',

  // 브라우저 저장소 - project/storage.ts
  'STORAGE_QUOTA_EXCEEDED',
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

/** 재실행 대조 결과. 대조는 run을 만든 엔진으로만 한다 (architecture.md 3.2). */
export const REPRODUCTION_STATUSES = [
  'NOT_CHECKED',
  'REPRODUCED',
  'NOT_REPRODUCED',
  'ENGINE_UNAVAILABLE',
] as const

export type FileHashStatus = (typeof FILE_HASH_STATUSES)[number]
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
