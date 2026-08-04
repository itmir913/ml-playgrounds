/**
 * 프런트엔드의 모든 크기·개수 상한. 백엔드의 config.py(환경 변수)와 대칭이다.
 *
 * 숫자를 코드 안에 직접 쓰지 마라 (CLAUDE.md 1.5). 여기 상수 하나만 바꾸면
 * 전부 반영돼야 한다. 이미지 데이터가 들어오는 V5에서 값이 크게 달라진다.
 */

const MB = 1024 * 1024

/**
 * 브라우저에서 학습할 수 있는 행 수의 상한.
 *
 * WASM 런타임의 메모리와 체감 대기 시간에서 오는 값이며 서버 상한과는 무관하다.
 * 실제 값은 학습 엔진을 정한 뒤 저사양 학교 PC에서 측정해 조정한다.
 */
export const BROWSER_ROW_LIMIT = 5000

/**
 * 모델 하나를 .mlpx에 담을 수 있는 최대 크기.
 *
 * 이걸 넘는 모델은 담지 않고 지표만 남긴다. 저장 자체는 성공한다.
 */
export const MAX_MODEL_BYTES = 5 * MB

/**
 * 한 프로젝트 파일에 담는 모델 전체의 합계 예산.
 *
 * 최신 묶음부터 채우고 예산이 떨어지면 오래된 것부터 뺀다.
 * 나머지 공간은 데이터셋 몫이다 (서버 업로드 상한이 50MB이므로 넉넉하지 않다).
 */
export const MODEL_BUDGET_BYTES = 20 * MB

/**
 * 프로젝트 파일이 이 크기를 넘으면 경고한다. **막지는 않는다.**
 *
 * 하드 캡으로 두면 데이터셋 하나만으로 상한을 넘는 경우에 저장이 실패한다.
 * 실제로 내용을 버리는 것은 모델 예산뿐이다.
 */
export const PROJECT_FILE_WARN_BYTES = 50 * MB

/**
 * 저장 전 여유 공간 검사의 안전 계수.
 *
 * 브라우저가 보고하는 여유 공간은 근사값이고, 압축·인덱스 때문에 실제 점유는 더 크다.
 */
export const STORAGE_SAFETY_FACTOR = 1.5

/** 저장 파일명의 최대 길이(확장자 제외). 긴 이름을 거부하지 않고 잘라 쓴다. */
export const MAX_FILE_NAME_LENGTH = 100

/** 학번 입력 상한. 자유 문자열이다 - 1-2-03 같은 체계가 실재한다 (mlpx-spec.md 7). */
export const MAX_STUDENT_ID_LENGTH = 20

/** 이름 입력 상한. */
export const MAX_STUDENT_NAME_LENGTH = 30
