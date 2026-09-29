# 코드 레퍼런스

> **단일 출처는 `backend/app/errors.py`(백엔드)와 `frontend/src/errors.ts`(프런트엔드)다.** 이 문서는
> 사람이 읽기 위한 목록이다. 어긋나면 코드를 믿어라. **코드를 왜 나눴는지**는 `docs/cases/error-codes.md`.

- 명명 규칙: `{도메인}_{문제}` 대문자 스네이크. 이름과 값은 항상 같다(백엔드 테스트가 강제).
- 코드를 추가하거나 지우면 **같은 커밋에서** `en.json`, `ko.json`, 이 문서를 함께 갱신한다.
  `scripts/check_locales.py`와 `tests/locales.spec.ts`가 양방향 일치를, `locales.spec`이 이 문서의 누락을 막는다.
- **코드는 학생이 할 일이 다를 때 나눈다.** 할 일이 같으면 한 코드로 두고 차이는 기술 원문에 남긴다.
- 모든 `ErrorCode`에는 HTTP 상태가 하나씩 대응한다(`errors.py`의 `HTTP_STATUS`).
- 무결성 확인 결과에 **`VERIFIED`처럼 보증으로 읽히는 낱말을 쓰지 마라** (`mlpx-spec.md` §7.3).

---

## ErrorCode — 실패 (로케일 `errors.*`)

**요청**
```
REQUEST_INVALID, ROUTE_NOT_FOUND, METHOD_NOT_ALLOWED
```
**데이터셋**
```
DATASET_TOO_LARGE, DATASET_EMPTY, DATASET_PARSE_FAILED,
DATASET_ENCODING_UNSUPPORTED, DATASET_TOO_MANY_ROWS, DATASET_TOO_MANY_COLUMNS
```
**설정**
```
COLUMN_NOT_FOUND, TARGET_NOT_SELECTED, TARGET_NOT_NUMERIC, TARGET_SINGLE_CLASS,
TARGET_TOO_MANY_CLASSES, FEATURE_NOT_SELECTED, FEATURE_ALL_MISSING, FEATURE_HAS_MISSING,
ALGORITHM_UNSUPPORTED, HYPERPARAM_OUT_OF_RANGE, SPLIT_INVALID,
SPLIT_INDEX_OUT_OF_RANGE
```
**작업**
```
JOB_NOT_FOUND, JOB_TIMEOUT, JOB_MEMORY_EXCEEDED, JOB_CANCELLED, JOB_FAILED
```
**서버**
```
SERVER_DISK_INSUFFICIENT, SERVER_BUSY, SERVER_INTERNAL_ERROR
```
**세션** (수명 = WebSocket 연결 수명, `architecture.md` §2.2)
```
SESSION_NOT_FOUND, SESSION_EXPIRED, SESSION_LIMIT_REACHED
```

## 에러가 아닌 코드

**Stage — 진행 단계** (로케일 `stages.*`)
```
QUEUED → VALIDATING → PREPROCESSING → TRAINING → EVALUATING → DONE
                                                            ↘ FAILED
```
**무결성 확인 결과** (로케일 `fileHash.*` / `reproduction.*`, 출처 `frontend/src/errors.ts`)
```
파일 해시   UNCHANGED, MODIFIED, UNKNOWN
재실행      NOT_CHECKED, REPRODUCED, NOT_REPRODUCED, ENGINE_UNAVAILABLE
```

## 프런트엔드 전용 코드 (로케일 `client.*`)

**실행 위치**
```
SERVER_UNAVAILABLE, ALGORITHM_NOT_AVAILABLE_HERE, DATASET_TOO_LARGE_FOR_BROWSER,
IMAGE_TOO_LARGE_FOR_BROWSER, ENGINE_NOT_READY, ENGINE_BOOT_FAILED
```
**이미지 백본** (가중치를 못 받았거나 백엔드·메모리·등록부 문제)
```
BACKBONE_UNAVAILABLE
```
**정본 크기가 백본과 다른 사진**
```
IMAGE_CANONICAL_SIZE_MISMATCH
```
**이 모델을 이 데이터·과제에 쓸 수 없다**
```
ALGORITHM_NOT_FOR_DATA_TYPE, ALGORITHM_NOT_FOR_TASK_TYPE
```
**분할·층화** (`ml/split.ts`, `ml/sample.ts`, `ml/selection.ts`)
```
SPLIT_TOO_FEW_ROWS, SPLIT_STRATIFY_IMPOSSIBLE,
SPLIT_STRATIFY_TARGET_CONTINUOUS, SPLIT_STRATIFY_SHARE_TOO_SMALL,
STRATIFY_NOT_FOR_TASK_TYPE, SAMPLE_STRATIFY_IMPOSSIBLE
```
**군집화** (`ml/engines/mljs-kmeans.ts`)
```
CLUSTER_TOO_FEW_ROWS
```
**테스트·예측 데이터 받기** (`data/columns.ts`, `ml/split.ts`, `ml/predict.ts`)
```
TEST_DATASET_COLUMN_MISSING, TEST_DATASET_NO_USABLE_ROWS, TEST_DATASET_TARGET_NOT_NUMERIC,
PREDICT_DATASET_COLUMN_MISSING
```
**테스트용 사진 받기** (`data/image/test-set.ts`)
```
TEST_IMAGES_NEED_CATEGORIES, TEST_IMAGES_CATEGORY_MISSING,
TEST_IMAGES_CATEGORY_UNKNOWN, TEST_IMAGES_UNLABELED
```
**사진 올리기** (`data/image/upload.ts`)
```
IMAGE_ZIP_INVALID, IMAGE_ZIP_NO_IMAGES, IMAGE_TOO_MANY_PHOTOS,
IMAGE_PHOTOS_EXCEED_STORAGE, IMAGE_CATEGORY_NAME_INVALID
```
**사진 분류를 시작할 때** (`ml/training-source.ts`)
```
IMAGE_TOO_FEW_CATEGORIES
```
**프로젝트 열기**
```
PROJECT_OPEN_ELSEWHERE
```
**프로젝트 파일 열기**
```
PROJECT_FILE_NOT_ZIP, PROJECT_FILE_ENTRY_MISSING, PROJECT_FILE_INVALID,
PROJECT_FILE_VERSION_TOO_NEW, PROJECT_FILE_VERSION_UNSUPPORTED
```
**모델 실행 / 저장소**
```
MODEL_FORMAT_UNSUPPORTED, MODEL_FILE_INVALID, MODEL_NEEDS_DATASET, STORAGE_QUOTA_EXCEEDED,
STORAGE_VERSION_TOO_NEW
```
**예측 입력** (`ml/predict.ts`)
```
PREDICTION_INPUT_INCOMPLETE
PREDICTION_INPUT_NOT_NUMBER
```
빈 칸과 숫자가 아닌 값은 끝까지 나누고, 쉼표 숫자는 받지 않는다 — 예측에서만 숫자로 읽으면 같은 글자를 학습과 예측이 다르게 해석한다.
**포트폴리오** (`project/portfolio-sources.ts`, `views/PortfolioView.vue`)
```
PORTFOLIO_TEMPLATE_UNAVAILABLE, PORTFOLIO_TOO_LARGE
```
**경고 — 실패가 아니다** (`ml/engines/mljs.ts`의 svm·logistic·k_means·neural 트레이너)
```
SVM_NOT_CONVERGED
LOGISTIC_NOT_CONVERGED
KMEANS_NOT_CONVERGED
NEURAL_NOT_CONVERGED
NEURAL_REGRESSION_NOT_CONVERGED
```
**여섯째는 모델이 아니라 데이터를 말한다** (`ml/experiment.ts`)
```
TARGET_TOO_FEW_CLASSES
```
**회귀의 상수 타깃** (`ml/experiment.ts`)
```
TARGET_NO_VARIANCE
```
**마지막 그물**
```
UNEXPECTED_ERROR
```
**표 파일 가져오기** (`data/table.ts`, `data/xlsx.ts`)
```
DATASET_FILE_TYPE_UNSUPPORTED, DATASET_SHEET_NOT_FOUND
DATASET_EXCEL_ENCRYPTED_OR_LEGACY
```
암호가 걸린 xlsx와 옛 .xls는 한 코드다 — 둘 다 OLE2 상자이고 학생이 할 일(새 xlsx나 csv로 다시 저장)이 같다 (`open-decisions.md` 71).


## 프런트엔드가 함께 쓰는 백엔드 코드 (로케일 `errors.*`)

```
DATASET_PARSE_FAILED, DATASET_EMPTY, DATASET_ENCODING_UNSUPPORTED,
DATASET_TOO_MANY_ROWS, DATASET_TOO_MANY_COLUMNS
```

- **코드를 새로 만들지 않는다.** `client.*`에 복제하지 말고 `SHARED_ERROR_CODES`에 둔다.
- 화면은 네임스페이스를 직접 조립하지 말고 `errorMessageKey(code)`를 쓴다.
- **`errors.*`에 백엔드에 없는 코드를 섞지 마라.**

---

## 응답 형식

```json
{
  "error": {
    "code": "DATASET_TOO_LARGE",
    "params": { "limitMb": 50, "actualMb": 83 }
  }
}
```

- `params`의 키는 로케일 파일의 보간 변수와 1:1로 맞춘다.
  두 로케일의 보간 변수가 다르면 CI가 잡는다.
- `params`에 담기는 것은 숫자와 **사용자 데이터**(컬럼명, 클래스 라벨)뿐이다.
  번역 대상 문장을 담지 마라.
- 실패든 성공이든 응답 모양은 항상 같다. `params`가 없어도 빈 객체로 나간다.

```
errors.DATASET_TOO_LARGE = "데이터 파일이 너무 큽니다. (최대 {limitMb}MB, 현재 {actualMb}MB)"
```

WebSocket 진행 이벤트도 같은 원칙을 따른다.

```json
{ "jobId": "87fd39", "stage": "TRAINING", "progress": 0.42 }
```
