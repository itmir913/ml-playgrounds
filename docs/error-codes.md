# 코드 레퍼런스

> **단일 출처는 `backend/app/errors.py`다.** 이 문서는 사람이 읽기 위한 사본이다.
> 어긋나면 코드를 믿어라.
>
> `scripts/check_locales.py`가 `errors.py`와 로케일 파일의 **양방향 일치**를 강제한다.
> 코드를 추가하거나 지우면 **같은 커밋에서** `en.json`, `ko.json`, 이 문서를 함께 갱신한다.

명명 규칙: `{도메인}_{문제}` 대문자 스네이크. 이름과 값은 항상 같다(백엔드 테스트가 강제).

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

`TARGET_NOT_NUMERIC`은 **과제 유형을 대신 판정하는 것이 아니다**(`mlpx-spec.md` §0.1).
학생이 고른 것을 바꾸지 않고, 회귀로는 답이 나오지 않는다는 것만 말한다.

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

모든 `ErrorCode`에는 HTTP 상태가 하나씩 대응한다(`errors.py`의 `HTTP_STATUS`).
누락되면 테스트가 실패한다.

---

## 에러가 아닌 코드

같은 규칙(코드만 반환하고 번역은 프런트엔드)을 따르지만 실패가 아니므로 `ErrorCode`가 아니다.

**Stage — 진행 단계** (로케일 `stages.*`)
```
QUEUED → VALIDATING → PREPROCESSING → TRAINING → EVALUATING → DONE
                                                            ↘ FAILED
```

**무결성 확인 결과** (로케일 `fileHash.*` / `reproduction.*`)

```
파일 해시   UNCHANGED, MODIFIED, UNKNOWN
재실행      NOT_CHECKED, REPRODUCED, NOT_REPRODUCED, ENGINE_UNAVAILABLE
```

축이 둘이므로 열거형도 둘이다. 하나에 섞으면 화면에 `if` 분기가 생긴다.
확인 요청 자체는 성공했고 결과가 그중 하나일 뿐이므로 에러가 아니다.

**단일 출처는 `frontend/src/errors.ts`다** — `errors.py`에 없다. 서명을 만들지 않기로
하면서 확인이 전부 브라우저에서 끝나 백엔드가 관여하지 않기 때문이다
(`open-decisions.md` "무결성은 해시와 재실행 대조로 한다"). `check_locales.py`가 못 보는
자리라 `tests/locales.spec.ts`가 양방향 일치를 강제한다.

**`VERIFIED`처럼 보증으로 읽히는 낱말을 쓰지 마라** (`mlpx-spec.md` §7.3).
테스트가 이것도 검사한다.

---

## 프런트엔드 전용 코드 (로케일 `client.*`)

서버가 꺼져 있을 때는 서버가 코드를 줄 수 없다. 프로젝트 파일을 여는 것도 브라우저에서
끝나는 일이다. 이런 코드의 단일 출처는 `frontend/src/errors.ts`의 `CLIENT_ERROR_CODES`이고,
로케일의 `client.*`와 양방향으로 일치해야 한다(`tests/locales.spec.ts`가 강제).

**실행 위치**
```
SERVER_UNAVAILABLE, ALGORITHM_NOT_AVAILABLE_HERE, DATASET_TOO_LARGE_FOR_BROWSER,
IMAGE_TOO_LARGE_FOR_BROWSER, ENGINE_NOT_READY
```

**상한에 걸린 사유가 종류마다 갈린다** (2026-08-14). 막힌 이유는 같지만 **학생이 할 일이
다르다** — 표는 전처리에서 일부만 뽑고, 이미지는 데이터 단계에서 사진을 지운다. 한 문장으로
쓰면 한쪽은 없는 카드를 찾게 되므로 코드를 가른다. 어느 것으로 말할지는
`ml/backend.ts`의 `TOO_LARGE_REASON`이 정하고, `Record<DataType, …>`이라 **종류를
더하는 사람은 칸을 채워야 한다.**

**이미지 백본** — 가중치를 못 받았거나, 쓸 수 있는 TF.js 백엔드가 없거나, 워커가
메모리로 죽었거나, 등록부에 없는 백본을 가리키는 파일이다. 넷을 한 코드로 두는 이유는
학생이 할 일이 같아서이고, 무엇이 달랐는지는 기술 원문에 남는다.

**문구는 가장 흔한 원인을 향한다 — 내려받기 실패다.** 가중치를 우리가 서빙하지 않고
학생 브라우저가 원본에서 직접 받으므로(open-decisions.md "백본을 붙이는 방법"),
학교 방화벽이 막으면 여기서 걸린다. 그래서 문구가 인터넷 연결과 **선생님께 말하기**를
가리킨다 — 학생이 혼자 풀 수 있는 문제가 아닌 경우가 있다.
```
BACKBONE_UNAVAILABLE
```

**정본 크기가 백본과 다른 것은 여기서 나눈다** (2026-08-19, R6 감사 B-10). 원인이 사진이라
**다시 시도해도 영원히 같은 자리에서 죽고**, 그 상태에서 "인터넷 연결을 확인하세요"는
거짓말이다. 정상 경로로는 안 나온다 — 남이 만든 zip이나 손으로 고친 파일에서 온다.
```
IMAGE_CANONICAL_SIZE_MISMATCH
```

**이 모델을 이 데이터·과제에 쓸 수 없다**
```
ALGORITHM_NOT_FOR_DATA_TYPE, ALGORITHM_NOT_FOR_TASK_TYPE
```

위 둘이 실행 위치와 나뉘는 이유는 **학생이 할 수 있는 일이 다르기 때문**이다. 실행 위치는
"서버를 켜라 / 엔진을 준비하라"로 열리지만, 이쪽은 모델이나 과제 유형을 바꿔야 한다.
사유를 고를 때 **가장 근본적인 것을 준다**는 규칙이 여기서 나온다(`ml/experiment.ts`) —
이미지 데이터에 회귀를 고른 학생에게 "엔진이 준비되지 않았습니다"라고 답하면 안 된다.

**분할·층화** (`ml/split.ts`, `ml/sample.ts`, `ml/selection.ts`)
```
SPLIT_TOO_FEW_ROWS, SPLIT_STRATIFY_IMPOSSIBLE,
SPLIT_STRATIFY_TARGET_CONTINUOUS, STRATIFY_NOT_FOR_TASK_TYPE,
SAMPLE_STRATIFY_IMPOSSIBLE
```

앞 둘은 백엔드의 `SPLIT_INVALID`와 나뉜다. 저쪽은 **설정이 말이 안 되는 것**이고 이
둘은 **설정은 멀쩡한데 이 데이터로는 못 나누는 것**이다 — 학생이 고칠 자리가 설정이
아니라 데이터거나 비율이다.

뒤 둘은 **층화**에만 붙는다. `SPLIT_STRATIFY_TARGET_CONTINUOUS`는 타깃이 사실상
연속이라 층화가 성립하지 않는 것이고, `SPLIT_STRATIFY_IMPOSSIBLE`과 학생이 할 일이
정반대다 — 그쪽은 "그 값을 더 모아라"이고 이쪽은 "층화를 끄라"다
(`open-decisions.md` "층화는 갈리는 값에서만 뜻이 있다"). `STRATIFY_NOT_FOR_TASK_TYPE`은
이 과제 유형에서 층화가 뜻이 없다는 **화면의 잠금 이유**이지 던지는 코드가 아니다
(`ml/selection.ts`의 `stratifyBlock`).

`SAMPLE_STRATIFY_IMPOSSIBLE`은 **뽑을 줄 수가 라벨 종류를 감당 못 하는 것**이다
(`open-decisions.md` #22). 위 셋과 나누는 이유는 **원인이 데이터가 아니라 학생이 방금
정한 숫자**이기 때문이다 — 할 일이 "그 숫자를 올리거나 층화를 끄라"로 정확히 갈린다.
경계는 `Σ min(라벨 크기, MIN_SPLIT_ROWS)`이고, **던지는 자리와 화면의 잠금 이유 양쪽에
쓰인다** (`ml/sample.ts`의 `allocate`, `ml/selection.ts`의 `stratifyBlock`).

**군집화** (`ml/engines/mljs-kmeans.ts`)
```
CLUSTER_TOO_FEW_ROWS
```

데이터보다 군집이 많다. sklearn이 `n_samples=2 should be >= n_clusters=5`로 던지는
자리이고, 넘기면 학생은 데이터에 없는 유령 중심점을 "찾은 군집"으로 본다 — 실패가
아니라 조용히 틀린 숫자다. `SPLIT_TOO_FEW_ROWS`와 나누는 이유는 **학생이 할 일이
다르기 때문**이다: 그쪽은 데이터를 더 모으는 길뿐이고, 이쪽은 군집 수를 줄이는 길이
함께 있다. 군집화는 아직 브라우저에만 있어 `client.*`이고, 서버가 군집을 학습하게
되면(V6) 같은 판정을 서버도 하므로 `backend/app/errors.py` 쪽으로 옮겨 간다.

**평가·예측 데이터 받기** (`data/columns.ts`, `ml/split.ts`, `ml/predict.ts`)
```
TEST_DATASET_COLUMN_MISSING, TEST_DATASET_NO_USABLE_ROWS,
PREDICT_DATASET_COLUMN_MISSING
```

정본 열과의 대조는 브라우저에서만 한다(`mlpx-spec.md` §0.3 — 서버는 확정된 정본과
분할 인덱스만 받는다). `TEST_DATASET_NO_USABLE_ROWS`는 테스트 데이터로 채점할 행이 하나도
없는 것(전처리가 전부 걸렀거나 `provided`인데 비었다)이고, **훈련 데이터가 비었다는
말과 나눈다** — 뭉치면 학생이 멀쩡한 훈련 데이터를 들여다본다.
`PREDICT_DATASET_COLUMN_MISSING`은 요구하는 열이 정본 열 전체가 아니라 특성 열의
합집합이라 `TEST_DATASET_COLUMN_MISSING`과 다른 코드이고, **파일을 받을 때와 예측
직전 두 자리**에서 잡힌다(`open-decisions.md` "붙일 때 본 것을 예측 직전에 다시 본다").

**평가용 사진 꾸러미 받기** (`data/image/test-set.ts`)
```
TEST_IMAGES_NEED_CATEGORIES, TEST_IMAGES_CATEGORY_MISSING,
TEST_IMAGES_CATEGORY_UNKNOWN, TEST_IMAGES_UNLABELED
```

**던지는 코드가 아니라 화면의 잠금·거절 이유다** — `STRATIFY_NOT_FOR_TASK_TYPE`과 같은
자리이고, 같은 목록에 두는 이유도 같다(이유 문장이 사는 곳이 `client.*` 하나여야 한다).
규칙은 `open-decisions.md` "평가용 zip (`split.method = 'provided'`)"이 갖는다 —
**관용적으로 받지 않고 예측 가능하게 거부한다.** 모르는 범주는 채점할 수 없고 빠진
범주는 재현율이 정의되지 않는다.

`TEST_IMAGES_NEED_CATEGORIES`는 **자리 자체의 잠금**이다(대조할 목록이 없다).
나머지 셋은 **학생이 할 일로 나뉜다** — 빠진 범주는 "그 폴더를 채워라", 모르는 범주는
"그 폴더를 빼라", 폴더 없는 사진은 "폴더로 묶어라".

**사진 올리기** (`data/image/upload.ts`)
```
IMAGE_ZIP_INVALID, IMAGE_ZIP_NO_IMAGES, IMAGE_TOO_MANY_PHOTOS,
IMAGE_PHOTOS_EXCEED_STORAGE, IMAGE_CATEGORY_NAME_INVALID
```

`IMAGE_ZIP_INVALID`가 `PROJECT_FILE_NOT_ZIP`과 나뉘는 이유는 **학생이 할 일이 다르기**
때문이다 — 그쪽은 프로젝트 파일이고 이쪽은 방금 만든 사진 꾸러미다. `IMAGE_ZIP_NO_IMAGES`는
맥·윈도가 넣는 부스러기만 남은 경우까지 포함한다("0장을 받았습니다"로 조용히 끝내면
학생은 올린 줄 안다). `IMAGE_CATEGORY_NAME_INVALID`는 **이름을 다듬어 받지 않는다** —
다듬으면 서로 다른 폴더 둘이 한 범주로 합쳐질 수 있고, 그건 라벨이 조용히 바뀌는 것이다.
`IMAGE_TOO_MANY_PHOTOS`는 담을 수 있는 장수(`limits.ts`의 `MAX_IMAGE_COUNT`)를 넘긴
것이고, **굽기 전에 판정한다**(`project/images.ts`의 `imageOverflow`) — 백본을 돌린 뒤에
거절하면 학생은 기다린 시간을 통째로 버린다. **자리마다 따로 센다**: 훈련용과 예측용은
표에서 훈련 파일과 테스트 파일이 각자 상한에 걸리는 것과 같다.

`IMAGE_PHOTOS_EXCEED_STORAGE`는 **그 기기에 자리가 없는 것**이고 같은 자리에서 함께
판정한다 (`open-decisions.md` "이미지가 들어갈 자리는 굽기 전에 묻는다"). 셋이 서로
나뉘는 이유는 전부 **학생이 할 일이 다르기** 때문이다.

| 코드 | 무엇이 모자란가 | 학생이 할 일 |
|---|---|---|
| `IMAGE_TOO_MANY_PHOTOS` | 이 앱이 정한 장수. **어느 기기에서나 같다** | 올리는 수를 줄인다 |
| `IMAGE_PHOTOS_EXCEED_STORAGE` | **그 기기의 남은 자리.** 학생마다 다르다 | 사진을 줄이거나 담은 것을 지운다 |
| `STORAGE_QUOTA_EXCEEDED` | 같은 자리인데 **저장을 누른 뒤**다 | 자리를 비운다 |

**예상으로 판정한다** — 정본은 아직 안 구웠으므로 장수 × 장당(형식 등록부의
`estimatedBytes` + 백본의 `embeddingDim` × 4)이다. 판정하는 문턱은 우리 상수가 아니라
**브라우저가 보고하는 쿼터**다.

**프로젝트 파일 열기**
```
PROJECT_FILE_NOT_ZIP, PROJECT_FILE_ENTRY_MISSING, PROJECT_FILE_INVALID,
PROJECT_FILE_VERSION_TOO_NEW, PROJECT_FILE_VERSION_UNSUPPORTED
```

**모델 실행 / 저장소**
```
MODEL_FORMAT_UNSUPPORTED, MODEL_FILE_INVALID, MODEL_NEEDS_DATASET, STORAGE_QUOTA_EXCEEDED
```

앞의 셋은 전부 **파일은 멀쩡히 열리고 그 모델로 예측만 못 하는** 경우이고, 셋으로 나눈
이유는 학생이 할 일이 다르기 때문이다 — 앱을 최신으로 바꾼다 / 다시 학습한다 /
데이터를 가진 파일로 다시 연다 (`mlpx-spec.md` §5.0, §5.2).

**예측 입력** (`ml/predict.ts`)
```
PREDICTION_INPUT_INCOMPLETE
```

채우지 않은 칸이 있는 채로 [예측]을 눌렀다. **전처리기의 대체값으로 조용히 채우지
않는다** — 학생은 자기가 넣은 값으로 예측했다고 믿는데 실제로는 학습셋의 평균이 들어간다.
결측 전략 `none`을 시끄럽게 거부하는 것과 같은 판단이다. 예측은 언제나 브라우저에서만
하므로(`mlpx-spec.md` §0.2) 서버에는 이 코드가 없다.

**빈 칸과 없는 열은 다른 코드다.** 열 자체가 없으면 `PREDICT_DATASET_COLUMN_MISSING`이다
(파일을 받을 때와 같은 코드 — 학생이 할 일이 "파일을 다시 올린다"로 같다). 일괄 예측에서
파일을 받은 뒤 학생이 특성을 바꿔 재학습하면 이 자리에 온다
(`open-decisions.md` "붙일 때 본 것을 예측 직전에 다시 본다").

**포트폴리오** (`project/portfolio-sources.ts`, `views/PortfolioView.vue`)
```
PORTFOLIO_TEMPLATE_UNAVAILABLE, PORTFOLIO_TOO_LARGE
```

앞은 **내장 양식을 못 받은 것**이다. `public/`의 정적 파일인데도 네트워크를 타므로
(`mlpx-spec.md` §8.7) 오프라인이나 학교망에서 실패할 수 있다. 조용히 빈손으로 돌아가지
않는 이유는 누른 사람이 무슨 일이 일어났는지 알아야 하기 때문이고, **그때도 [빈 양식에서
시작]은 그대로 있다** — 바닥이 프리셋이 아닌 이유가 이것이다.

뒤는 **글과 첨부를 합친 상한**을 넘긴 것이다 (`limits.ts`의 `MAX_PORTFOLIO_BYTES`,
`mlpx-spec.md` §8.6.1). 제약이 아니라 폭주 방지턱이다 — 손으로 쓴 글은 여기 안 닿고,
실제로 걸리는 것은 붙여넣기 한 번에 들어오는 거대한 텍스트다.

**경고 — 실패가 아니다** (`ml/engines/mljs.ts`의 svm·logistic 트레이너)
```
SVM_NOT_CONVERGED
LOGISTIC_NOT_CONVERGED
KMEANS_NOT_CONVERGED
```

셋 다 "반복 예산 안에 멈추지 못했다"이고 sklearn이 `ConvergenceWarning`을 내는
자리다. 지표도 모델도 나온다 — 덜 다듬어졌다는 사실 하나가 덧붙는다.

**다만 뒤집었을 때의 뜻이 다르다.** 로지스틱은 경고가 없으면 최적점 근방이지만,
SMO는 정지 조건이 휴리스틱이라 **경고가 없어도 최적점 근방이라는 보증이 없다**
(`mlpx-spec.md` §5.9, `open-decisions.md` #26). 같은 자리를 쓴다고 같은 세기의
주장은 아니다.

**`KMEANS_NOT_CONVERGED`는 등록되지 않은 채 V3를 통과했다.** 코드 문자열이 트레이너에만
있었고 목록에도 로케일에도 없어서, 학생 화면에 번역되지 않은 키가 그대로 갈 수 있었다.
막았어야 할 장치 셋이 전부 비껴갔다 — `warningSchema.code`가 `z.string()`이고,
로케일 검사 둘은 `CLIENT_WARNING_CODES`를 **훑으므로** 목록에 없는 코드를 볼 수 없다.
그래서 **만드는 쪽에 열거형을 세웠다**: `ml/engines/mljs.ts`의 `EngineWarning.code`가
`ClientWarningCode`라 목록에 없는 코드는 컴파일에서 걸린다. 읽는 쪽(`warningSchema`)은
그대로 `z.string()`이다 — 미래 버전이 만든 코드가 든 `.mlpx`가 안 열리면 안 된다.

**목록이 따로다** (`errors.ts`의 `CLIENT_WARNING_CODES`). 로케일은 같은 `client.*`를
쓴다 — 그 네임스페이스가 가리키는 것은 "실패"가 아니라 **프런트엔드가 만든 코드**이고
이것도 그것이다. 나눈 이유는 **자리가 다르기 때문**이다: 이 코드는 `run.warning`에
`status: 'done'`과 함께 오고, `failure`에는 못 온다(`mlpx-spec.md` §5.9). 한 목록에
담으면 "이 코드가 실패인가"를 이름으로 판정하게 되고 그건 반드시 틀린다.

**마지막 그물**
```
UNEXPECTED_ERROR
```
우리가 코드로 만들어 두지 않은 실패가 화면까지 올라올 때 쓴다. 브라우저가 던지는
`DOMException`, 남의 라이브러리가 던지는 것들이 여기 들어온다. `JOB_FAILED`와 나누는
이유는 **그건 학습에 대한 말**이라서다 — 저장이 실패했는데 "학습에 실패했습니다"가 뜨면
학생은 엉뚱한 것을 다시 한다.

원문은 문장 안에 넣지 않고 `detail` 파라미터로 따로 실어 화면이 기술 정보로 붙인다
(`failureDetail`). 번역되지 않는 남의 영어 문장이므로 우리 문장과 섞이면 안 된다.

**표 파일 가져오기** (`data/table.ts`, `data/xlsx.ts`)
```
DATASET_FILE_TYPE_UNSUPPORTED, DATASET_SHEET_NOT_FOUND
```

이 둘이 `client.*`인 이유는 **서버가 이것들을 볼 일이 없기 때문**이다. 프런트엔드가
업로드 파일을 UTF-8 CSV로 정규화해서 보내므로 서버는 확장자도 시트도 모른다.

---

## 프런트엔드가 함께 쓰는 백엔드 코드 (로케일 `errors.*`)

같은 검증을 양쪽이 한다. 파일을 여는 것은 브라우저지만(CLAUDE.md §1.1) 서버도 받은
데이터를 다시 검증해야 하므로 **같은 실패가 두 곳에서 난다.**

```
DATASET_PARSE_FAILED, DATASET_EMPTY, DATASET_ENCODING_UNSUPPORTED,
DATASET_TOO_MANY_ROWS, DATASET_TOO_MANY_COLUMNS
```

이때 **코드를 새로 만들지 않는다.** `client.*`에 같은 이름을 복제하면 같은 문장이 두
네임스페이스에 생기고 번역이 갈라진다. 단일 출처는 여전히 `errors.py`이며, 프런트엔드
쪽 목록은 `frontend/src/errors.ts`의 `SHARED_ERROR_CODES`다.

화면은 네임스페이스를 직접 조립하지 말고 `errorMessageKey(code)`를 쓴다.

`MODEL_FORMAT_UNSUPPORTED`는 파일 열기 실패와 성격이 다르다. **파일은 멀쩡히 열리고
그 모델로 예측만 못 한다.** → `mlpx-spec.md`

`MODEL_FILE_INVALID`는 그것과 또 다르다. 형식은 아는데 내용이 그 형식이 아닌 것이고,
**학생이 할 일이 갈리기 때문에 코드를 나눈다** — 앞엣것은 앱을 최신으로 바꾸면 되고
이건 다시 학습해야 한다. 전처리기가 바뀌어 특성 개수가 안 맞는 경우도 여기다.

**`errors.*`에 섞지 마라.** CI가 `errors.*`와 `ErrorCode`의 양방향 일치를 강제하므로
백엔드에 없는 코드를 `errors.*`에 넣으면 실패한다. 반대로 백엔드에 **있는** 코드를
프런트엔드가 던져야 한다면 `client.*`에 복제하지 말고 아래를 따른다.

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
