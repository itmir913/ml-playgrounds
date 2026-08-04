/**
 * 프런트엔드에서만 판정되는 오류 코드.
 *
 * 백엔드가 관여하지 않는 실패가 있다. 서버가 꺼져 있을 때, 그리고 프로젝트 파일을
 * 브라우저에서 열 때가 그렇다. 이런 코드는 backend/app/errors.py 에 없고 있어서도 안 된다.
 * CI가 로케일의 errors.* 와 백엔드 ErrorCode의 양방향 일치를 강제하기 때문이다.
 *
 * 로케일 네임스페이스는 client.* 이며, 이 배열과 키 집합이 정확히 일치해야 한다(테스트가 강제).
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

  // 브라우저 저장소 - project/storage.ts
  'STORAGE_QUOTA_EXCEEDED',
] as const

export type ClientErrorCode = (typeof CLIENT_ERROR_CODES)[number]

/** 로케일 문장에 보간되는 값. 백엔드의 ParamValue와 같은 규칙이다. */
export type ClientErrorParams = Record<string, string | number | boolean | string[]>

/**
 * 프런트엔드의 유일한 오류 타입.
 *
 * message에는 코드만 넣는다. 사람이 읽는 문장은 화면이 t(`client.${code}`, params)로 만든다.
 * 백엔드가 자연어를 만들지 않는 것과 같은 이유다 - 언어는 표시 시점에 정해진다.
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
}

export function isClientError(error: unknown): error is ClientError {
  return error instanceof ClientError
}
