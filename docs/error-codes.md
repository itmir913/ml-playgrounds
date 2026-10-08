# 코드 레퍼런스

> **단일 출처는 `backend/app/errors.py`(백엔드)와 `frontend/src/errors.ts`(프런트엔드)다.** 이 문서는
> 사람이 읽기 위한 목록이다. 어긋나면 코드를 믿어라. **코드를 왜 나눴는지**는 `docs/cases/error-codes.md`.

- 명명 규칙: `{도메인}_{문제}` 대문자 스네이크. 이름과 값은 항상 같다(백엔드 테스트가 강제).
- 코드를 추가하거나 지우면 **같은 커밋에서** `locales/`의 모든 로케일 파일을, `client.*`면 이 문서도 함께 갱신한다.
  `scripts/check_locales.py`와 `tests/locales.spec.ts`가 양방향 일치를, `locales.spec`이 이 문서에서 `client.*` 코드의 누락을 막는다 — 코드마다 학생이 할 일의 설명이 붙어 있어서다.
  그 밖의 목록은 이 문서에 베끼지 않고 코드를 가리킨다.
- **코드는 학생이 할 일이 다를 때 나눈다.** 할 일이 같으면 한 코드로 두고 차이는 기술 원문에 남긴다.
- 모든 `ErrorCode`에는 HTTP 상태가 하나씩 대응한다(`errors.py`의 `HTTP_STATUS`).
- 무결성 확인 결과에 **`VERIFIED`처럼 보증으로 읽히는 낱말을 쓰지 마라** (`mlpx-spec.md` §7.3).

---

## ErrorCode — 실패 (로케일 `errors.*`)

**목록은 `backend/app/errors.py`의 `ErrorCode`다.** 여기 베끼지 않는다. 도메인 접두사(`REQUEST_`·`DATASET_`·
`TARGET_`·`FEATURE_`·`SPLIT_`·`JOB_`·`SERVER_`·`SESSION_` 등)가 묶음이고, HTTP 상태는 같은 파일의 `HTTP_STATUS`다.
세션의 수명은 WebSocket 연결 수명이다(`architecture.md` §2.2).

## 에러가 아닌 코드

- **Stage — 진행 단계** (로케일 `stages.*`): `backend/app/errors.py`의 `Stage`. 실패하면 어느 단계에서든 `FAILED`로 간다.
- **무결성 확인 결과** (로케일 `fileHash.*` / `entryHash.*` / `reproduction.*`): `frontend/src/errors.ts`의
  `FILE_HASH_STATUSES` · `ENTRY_HASH_STATUSES` · `REPRODUCTION_STATUSES`. 각 값의 뜻은 그 상수의 주석에 있다.

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
**프로젝트 파일 한 개에 담는 수** (`project/format.ts`의 `archiveEntryCount` — 사진 추가·포트폴리오 첨부·내보내기)
```
PROJECT_FILE_TOO_MANY_ENTRIES
```
**같은 한계를 학습이 더할 모델 파일이 넘긴다** (`project/format.ts`의 `requireRoomForTraining` — [학습하기]가 시작하기 전)
```
PROJECT_FILE_TOO_MANY_ENTRIES_TO_TRAIN
```
**교사의 포트폴리오 묶음 zip이 같은 한계를 넘는다** (`project/portfolio-bundle.ts`의 `bundleOf`)
```
PORTFOLIO_BUNDLE_TOO_MANY_ENTRIES
```
상한 해제로 안 풀린다 — 문구가 [상한 해제]를 부르지 않는다 (`open-decisions.md` ".mlpx 한 파일의 엔트리 수는 ZIP64 없이 쓸 수 있는 만큼이다").
**모델 실행 / 저장소**
```
MODEL_FORMAT_UNSUPPORTED, MODEL_FILE_INVALID, MODEL_NEEDS_DATASET, STORAGE_QUOTA_EXCEEDED,
STORAGE_VERSION_TOO_NEW
```
**참조형 모델이 학습 때의 행을 못 되세운다** (`ml/images.ts`의 `imageTrainingRows` — 학습 뒤 사진이 바뀌었다)
```
MODEL_TRAINING_DATA_CHANGED
```
데이터가 없는 `MODEL_NEEDS_DATASET`과 학생이 할 일이 다르다 — 이것은 다시 학습한다 (`mlpx-spec.md` §5.1).
**저장소가 다른 탭에 막혔다** (`project/storage.ts` — 실패가 아니라 기다리는 동안의 알림)
```
STORAGE_BLOCKED
```
**고른 파일을 못 읽었다** (`project/download.ts`의 `readFileBytes`·`readFileText`)
```
FILE_UNREADABLE
```
**앱이 필요할 때 받는 코드 조각을 못 받았다** (배포 뒤 옛 탭의 없는 청크, 끊긴 연결 — `open-decisions.md` 86)
```
SCREEN_LOAD_FAILED
```
라우트 화면(`router/index.ts`의 가드 — 이동은 아무것도 안 바꾸고 선다), 화면 안의 지연 부품, 지연 라이브러리(엑셀 파서, 임베딩 워커의 TF.js)가 모두 이 코드다. 청크 실패인지는 `errors.ts`의 `isChunkLoadError` 하나가 가린다 — `toMessage`가 그것으로 이 코드를 고르고, 실패를 다른 코드로 바꾸는 자리(`data/xlsx.ts`의 파서 순회, `ml/embed/handler.ts`)도 같은 판정을 먼저 본다. 엑셀은 어느 파서든 청크를 못 받으면 폴백으로 넘기지 않고 이 코드로 멈춘다(폴백은 날짜를 다른 시간대로 읽는다) — 파서를 받았는데 파일을 못 읽어 폴백으로 넘기는 것은 그대로다. TF.js는 다음 백엔드로 넘기고, 하나도 못 띄웠는데 청크 실패가 있었을 때만 이 코드다. 워커 스크립트 자체를 못 받은 것은 이 코드가 아니다 — 그 워커의 코드다. 외부 원본에서 받는 Pyodide는 우리 청크가 아니라 `ENGINE_BOOT_FAILED`다. `tests/chunk-load-failure.spec.ts`가 문다.
**예측 입력** (`ml/predict.ts`)
```
PREDICTION_INPUT_INCOMPLETE
PREDICTION_INPUT_NOT_NUMBER
```
빈 칸과 숫자가 아닌 값은 끝까지 나누고, 쉼표 숫자는 받지 않는다 — 예측에서만 숫자로 읽으면 같은 글자를 학습과 예측이 다르게 해석한다.
**값이 너무 커서 계산이 넘친다** (`ml/preprocess.ts`의 `fitPreprocessor`)
```
FEATURE_VALUE_TOO_LARGE
```
수치 특성의 대체값·중심·폭이 부동소수 범위를 넘어 유한하지 않으면 학습 전에 멈춘다. 안 막으면 그 열이 통째로 NaN이나 0이 되어 학습이 **완료로 끝나고 틀린 점수를 내고**, 저장된 전처리기에 적힌 `null`은 다시 열 때 스키마가 거부한다 (R43-4 B-1). 브라우저 전처리기의 판정이라 백엔드 `ErrorCode`에는 없다. `tests/preprocess.spec.ts`가 문다.
**포트폴리오** (`project/portfolio-sources.ts`, `views/PortfolioView.vue`)
```
PORTFOLIO_TEMPLATE_UNAVAILABLE, PORTFOLIO_TOO_LARGE
```
**경고 — 실패가 아니다** (`CLIENT_WARNING_CODES`. `ml/engines/mljs.ts`의 svm·logistic·k_means·neural 트레이너)
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
화면 부품에서 잡히지 않고 빠져나온 오류(렌더, 지연 부품의 로더)는 전역 오류 처리기(`app-errors.ts`)가 `pushError`로 알린다 — 우리 오류면 그 코드이고, 청크 실패면 `SCREEN_LOAD_FAILED`이고, 아니면 이 코드와 원문이다. 라우트 화면의 청크 실패는 가드가 먼저 잡아 스스로 말하므로 여기 안 온다 (`open-decisions.md` 85·86).
**표 파일 가져오기** (`data/table.ts`, `data/xlsx.ts`)
```
DATASET_FILE_TYPE_UNSUPPORTED, DATASET_SHEET_NOT_FOUND
DATASET_EXCEL_ENCRYPTED_OR_LEGACY
DATASET_ENCODING_UNKNOWN
```
암호가 걸린 xlsx와 옛 .xls는 한 코드다 — 둘 다 OLE2 상자이고 학생이 할 일(새 xlsx나 csv로 다시 저장)이 같다 (`open-decisions.md` 71).
`DATASET_ENCODING_UNKNOWN`은 CSV가 UTF-8도 그 UI 언어의 코드 페이지도 아니어서 문자 인코딩을 알 수 없는 것이고, 할 일은 엑셀의 "CSV UTF-8"로 다시 저장하는 것이다 (`open-decisions.md` 102). BOM이 말해 준 인코딩을 못 읽는 `DATASET_ENCODING_UNSUPPORTED`(공유 코드)와 다르다.


## 프런트엔드가 함께 쓰는 백엔드 코드 (로케일 `errors.*`)

**목록은 `frontend/src/errors.ts`의 `SHARED_ERROR_CODES`다.**

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
  로케일 파일들의 보간 변수가 서로 다르면 CI가 잡는다.
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
