# 결정됨 — 배포 뒤: 감사와 문서 (2026-08-17 ~ 2026-08-30)

> `open-decisions.md`의 **결정됨**이다. 색인은 그 허브에 있다.
>
> **통독하지 마라.** 다른 문서나 코드가 제목으로 가리킬 때 그 항목만 편다.
> **제목은 주소다 — 한 번 적은 제목을 바꾸지 마라.**

> **상태 한 줄과, 제목이 물음일 때만 결론 한 줄을 둔다.** 경위는 같은 제목 아래 `docs/cases/open-decisions.md`에 있다.

### 저장소가 미래에서 온 것도 예측 가능하게 거부한다 (2026-08-30)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

### 미리보기 N행은 훑은 행이 아니라 남긴 행이다 (2026-08-30)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

### 표시 분량도 limits.ts가 갖는다 — 이름이 겹치면 상수가 갈린다 (2026-08-30)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

### 저장은 화면을 먼저 바꾸고, 실패는 알림과 상태 표시줄이 말한다 (2026-08-30)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

### 32. 프로젝트 파일 크기 경고 (2026-08-19 결정 · 2026-08-27 구현)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 섰나 (2026-08-27)

### 39. 멈추기가 끝난 것을 남긴다 (2026-08-26)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 1. 포맷은 안 움직인다

#### 2. 막고 있는 것은 자리가 아니라 짐이다

#### 3. 조립은 한 곳이다

#### 4. 0개면 아무것도 안 남긴다

#### 5. 멈추기 전에 한 번 묻는다

#### 6. 함께 가자던 것은 떼어 둔다

#### 무엇이 섰나 (2026-08-26, `41c7fe2`)

#### 7. 워커가 죽어도, 떠나도 끝난 것을 남긴다 (2026-09-29, 코드 소유자)

### 38. 바깥에 내놓는 규정은 앱이 데리고 간다 (2026-08-26)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 1. 정본은 앱 저장소의 `frontend/public/legal/`이다

#### 2. 앱에는 전문을 안 넣는다. 링크 한 줄만 넣는다

#### 3. 방침이 말하는 것은 앱이다. 랜딩은 아니다

#### 4. 표기·언어·배포처

#### 무엇이 섰나 (2026-08-26)

### 들어오는 라이선스는 허용 목록이 막고, 나가는 PR은 템플릿이 묻는다 (2026-08-21)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 문제였나

#### 정한 것 셋

#### 이 검사가 못 보는 것 — 넷

### 17. 한셀 xlsx 폴백의 실제 재현 — 결정됨: 실물로 재현하고 픽스처로 고정했다 (2026-08-21)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 1. ExcelJS가 정말 실패하는가 — **던진다**

#### 2. SheetJS는 그 파일을 제대로 읽는가 — **읽는다**

#### 무엇을 남겼나

### 폴백은 값이 아니라 엑셀이 그려 준 글자를 학생 데이터로 만들고 있었다 (2026-08-21)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 문제였나

#### 왜 아무도 못 봤나 — **그 길에 검사가 없었다**

#### 고친 것

### 37. ExcelJS가 업고 오는 암호화 폴리필을 떼어낼 것인가 — 결정됨: 안 뗀다 (2026-08-21)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이었나

#### 왜 안 떼는가 — 실측 넷

#### 다시 열리는 조건

### 나눠 주는 남의 코드는 산출물이 세어서 고지한다 (2026-08-20)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 문제였나

#### 정한 것 넷

#### 안 하기로 한 것과, 확인만 한 것

### MB는 십진 백만이다 — 우리가 붙인 이름과 우리가 센 값이 같아야 한다 (2026-08-20)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 문제였나

#### 왜 미루면 안 되는가 — 틀리는 방향이 나쁘다

#### 결정 — 십진으로 맞춘다

#### 치르는 값 — 상한 셋이 4.8% 작아진다

#### "MiB"라고 쓰지 않는다

#### 엇갈리는 자리 하나 — 알고 고른다

#### 무엇이 이것을 지키는가

### 이미지가 들어갈 자리는 굽기 전에 묻는다 — 새 상한이 아니라 앞당기기다 (2026-08-20)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 문제였나

#### 이름이 낡았다

#### 결정 — 있는 검사를 앞으로 당긴다

#### 넘으면 거절한다

#### 어휘를 새로 세운다

#### §4의 "스위치가 끈다"를 좁힌다

#### 여기서 안 하는 것 둘

#### 무엇이 이것을 지키는가

### 문서를 나누되 주소는 안 바꾼다 — 허브와 색인 (2026-08-20)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 문제였나

#### 무엇이 이것을 어렵게 만드는가

#### 결정 — 파일은 나뉘고 주소는 그대로다

#### 무엇이 이것을 지키는가

#### 무엇을 안 하나

### 이미지의 행 순서를 기기에서 떼고, 그 순서를 파일이 기억한다 (2026-08-19) — R1 B-5·B-1
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 무엇이 틀렸나

#### 결정

#### 왜 "옛 순서를 지킨다"가 선택지가 아닌가

#### `FORMAT_VERSION`은 안 오른다

#### 해시 목록을 통째로 안 적는 이유

### 상한은 **누가 정했느냐**로 갈리고, 우리 기기가 정한 것은 끌 수 있다 (2026-08-19)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 1. 축은 "무엇이 이 숫자를 붙잡고 있나"다


**전수 분류 (164개).** 값은 여기 옮겨 적지 않는다 — 코드가 출처다.
**이 표는 손으로 세는 것이라 낡는다** — 실제로 **두 번** 낡았다(44 → 52 → 73). 두 번째는
분류를 옮기면서 칸의 수만 고치고 이 총계를 안 고쳐서다. **이제 검사가 총계도 센다.**

| 분류 | 상수 |
|---|---|
| **우리 기기가 정했다** (39) | `MAX_DATASET_ROWS` · `MAX_IMAGE_COUNT` · `MAX_DATASET_COLUMNS` · `BROWSER_ROW_LIMIT` · `MLJS_*_ROW_LIMIT` 아홉(표) · `MLJS_IMAGE_*_ROW_LIMIT` 여덟 · **`PYODIDE_*_ROW_LIMIT` 여덟(표) · `PYODIDE_IMAGE_*_ROW_LIMIT` 일곱** ("scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다") · `PREDICT_PAGE_SIZE` · `IMAGE_PREDICT_PAGE_SIZE` · `MAX_PORTFOLIO_BYTES` |
| **파일이 나간 뒤가 요구한다** (7) | `MAX_CATEGORY_NAME_LENGTH`(윈도우 260자 경로) · `MAX_FILE_NAME_LENGTH`(글자 수 — 윈도우 경로) · `MAX_FILE_NAME_BYTES`(UTF-8 바이트 — 운영체제의 한 이름 한계) · `MAX_MODEL_BYTES` · `MODEL_BUDGET_BYTES` · `SILHOUETTE_BUDGET_MS`(§1.3) · `MAX_ARCHIVE_ENTRIES`(zip 끝 레코드의 16비트 칸 — ZIP64 없이, ".mlpx 한 파일의 엔트리 수는 ZIP64 없이 쓸 수 있는 만큼이다") |
| **계산 자체가 요구한다** (4) | `MIN_SPLIT_ROWS` · `MIN_SILHOUETTE_SAMPLE` · `MIN_CLASSIFICATION_CATEGORIES`(갈릴 것이 없으면 분류가 성립하지 않는다) · `NEURAL_PARALLEL_CHUNK_ROWS`(기울기 합산 정본의 조각 크기 — 값이 바뀌면 모델이 바뀐다, "학습을 코어로 가른다") |
| **교실을 보고 골랐다** (3) | `MAX_STUDENT_ID_LENGTH` · `MAX_STUDENT_NAME_LENGTH` · `TEST_SIZE_RANGE` |
| **알림이다** (1) | `PROJECT_FILE_WARN_BYTES` — §3의 100MB 경고 |
| **상한이 아니다** (110) | **산점도 일곱**(`DATA_SCATTER_POINT_LIMIT`·`CLUSTER_SCATTER_POINT_LIMIT`·`REGRESSION_SCATTER_POINT_LIMIT` — 그리는 점의 묶음이고 값은 같아도 다른 상수다, 마지막은 "97. 학습한 회귀 모델을 그림으로 보일 것인가" · `SCATTER_DENSE_ROWS`·`SCATTER_CELL_GROWTH`·`SCATTER_DENSITY_STEPS`·`SCATTER_DENSITY_INK_MAX` — 거르기와 진하기 단계, "94. 그림이 드문 것을 숨기는가") · **`PYODIDE_DOWNLOAD_BYTES`·`PYODIDE_BOOT_MS`**(화면이 고르기 전에 말하는 준비 비용) · **sklearn 예상 시간 열여덟**(`PYODIDE_*_BASELINE_MS` 열다섯 · `PYODIDE_RANDOM_FOREST_TREES_MS` · `PYODIDE_RANDOM_FOREST_BASELINE_TREES` · `PYODIDE_KMEANS_CLUSTERS_MS` · `PYODIDE_LOGISTIC_REGRESSION_MAX_ITER_FACTOR` — 두 엔진의 성질이 달라 순수 JS 표를 못 빌린다, 로드맵 4단계) · 예상 시간 서른여덟(`SILHOUETTE_MS_PER_PAIR_FEATURE` 포함)(`MLJS_*_BASELINE_MS` 아홉 · `MLJS_IMAGE_NEURAL_NETWORK_BASELINE_MS` · `MLJS_IMAGE_DECISION_TREE_BASELINE_MS` · `MLJS_IMAGE_RANDOM_FOREST_BASELINE_MS` · `MLJS_IMAGE_SVM_BASELINE_MS`(사진 셋은 실측, "그러면 상한은 시간으로 정하는 것이 아니다"의 넷째 실측) · `MLJS_IMAGE_NAIVE_BAYES_BASELINE_MS` · `MLJS_IMAGE_LOGISTIC_REGRESSION_BASELINE_MS` · `MLJS_IMAGE_KNN_BASELINE_MS` · `MLJS_IMAGE_KMEANS_BASELINE_MS`(사진 넷은 개발 PC [사진만 훑기] 두 회차의 평균) · `MLJS_LOGISTIC_REGRESSION_MAX_ITER_MS` · `MLJS_KMEANS_CLUSTERS_MS` · `MLJS_KMEANS_BASELINE_CLUSTERS` · `MLJS_NEURAL_NETWORK_WEIGHTS_MS` · `MLJS_NEURAL_NETWORK_BASELINE_LAYERS` · `MLJS_NEURAL_NETWORK_BASELINE_NEURONS` · `BASELINE_COLUMNS` · `MLJS_RANDOM_FOREST_BASELINE_TREES` · `MLJS_LOGISTIC_REGRESSION_BASELINE_MAX_ITER` · `CALIBRATION_BASELINE_MS` · **`BASELINE_CLASSES` · `MLJS_NEURAL_NETWORK_BASELINE_CLASSES` · `MLJS_*_CLASSES_MS` 여섯**(클래스 수 배수표 — 빈 칸은 배수를 안 건다, "88. 학습 예상 시간이 클래스 수를 보는가") · `TRAINING_ESTIMATE_COARSE_FROM_SECONDS` · `TRAINING_ESTIMATE_COARSE_STEP_SECONDS`) · 솔버 설정 둘(`NEURAL_MAX_EPOCHS`·`NEURAL_BATCH_SIZE` — sklearn `MLPClassifier`의 기본값 그대로다) · 표시 분량 열일곱(`METRIC_FRACTION_DIGITS`·`FLOAT_NOISE_PRECISION`·`STAT_SIGNIFICANT_DIGITS`·`PERCENT_FRACTION_DIGITS`·`SIZE_FRACTION_DIGITS` — 화면의 자릿수, 결정문 64 · `PREP_PREVIEW_FEATURE_COUNT`·`IMAGE_GRID_PAGE_SIZE`·`TABLE_PREVIEW_ROW_COUNT`·`PREP_PREVIEW_ROW_COUNT`·`CLUSTER_MEMBER_PAGE_SIZE`·`CLUSTER_NEIGHBOR_ROW_COUNT`·`CLUSTER_REPRESENTATIVE_COUNT`·`COLUMN_SAMPLE_COUNT`·`HASH_PREVIEW_LENGTH`·`HISTOGRAM_BIN_LIMIT`·`CATEGORY_BAR_LIMIT`·`LOSS_CURVE_TICK_COUNT`) · 가공 규격 열(`ZIP_DEFLATE_LEVEL` — 포트폴리오 묶음이 쓴다, 결정문 64 · `IMAGE_WEBP_QUALITY`·`IMAGE_JPEG_QUALITY`·`IMAGE_WEBP_ESTIMATED_BYTES`·`IMAGE_JPEG_ESTIMATED_BYTES`·`MAX_ATTACHMENT_EDGE`·`MAX_FAILURE_DETAIL_LENGTH`·`MAX_ERROR_VALUE_LENGTH`·**`TREE_V2_MIN_BYTES_PER_NODE`·`TREE_V2_MIN_BYTES_PER_LEAF_CLASS`** — JSON 문법이 정하는 하한이고, 담기 전에 거절하는 문이 이 둘로 선다, "큰 모델은 만들기 전에 거절한다") · 동작 시간 일곱(`TOAST_DURATION_MS`·`AUTOSAVE_DELAY_MS`·`AUTOSAVE_MAX_WAIT_MS`·`SCROLL_TOP_DURATION_MS`·`TRAINING_ELAPSED_VISIBLE_AFTER_MS`·`TRAINING_ELAPSED_TICK_MS`·`TAB_LOCK_REPLY_WINDOW_MS`) · 계수와 단위 셋(`STORAGE_SAFETY_FACTOR`·`BYTES_PER_KB`·`BYTES_PER_MB`) · 성능 계수 다섯 — **결과와 무관하고 속도만 가른다**(병렬 넷 `PARALLEL_WORKER_CAP`·`MLJS_NEURAL_PARALLEL_MIN_WEIGHT_ROWS`·`MLJS_FOREST_PARALLEL_MIN_TREE_ROWS`·`MLJS_KNN_PARALLEL_MIN_ROW_PRODUCT` — 실측 사다리의 무릎과 교차점들, "학습을 코어로 가른다" · `IMAGE_ZIP_SLICE_BYTES` — 사진 zip을 조각으로 풀고 화면에 양보하는 크기, 측정은 `docs/cases/mlpx-spec.md`의 판례) |
#### 1.1 초안에서 넷을 옮기고 이름 하나를 고쳤다 (R6 감사)

#### 1.2 `IMAGE_PREDICT_PAGE_SIZE`를 기기 줄로 옮겼다 (2026-08-30, R13-3 감사 C-1)

#### 1.3 `SILHOUETTE_BUDGET_MS`를 파일 줄로 옮겼다 (2026-09-01, 코드 소유자)

#### 2. off 스위치는 **우리 기기가 정한 것 전부**를 끈다

#### 3. `.mlpx` 전체 크기는 **막지 않는다.** 대신 100MB에서 말한다

#### 4. 내보내기는 무조건 성공해야 한다

### ~~31. 테스트 데이터 개수를 sklearn과 같은 함수로 셀 것인가~~ — **결정됨: 따른다 (2026-08-19)**
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 층화도 따라간다 — 그리고 "같은 함수"가 어디까지인지 적는다 (2026-08-19, R6 감사 B-1)

### 본체 없는 첨부는 **저장을 막지 않고 참조를 떼어낸다** (2026-08-18)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

### 타깃의 자료형 문제는 **고르는 것을 막지 않고 말한다** (2026-08-18)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 결정 — `targetIssue`는 **이유이지 금지가 아니다**

#### 왜 다른 갈래가 아닌가

#### 남는 것

### 백본 입력 범위가 그래프의 계약과 어긋났다 — 고치고, 새 id로 좌표계를 가른다 (2026-08-17)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 결정

#### 왜 다른 갈래가 아닌가

#### 남는 것 — 고쳐도 안 돌아오는 것

#### 버전을 올리는 것은 지시받았다

#### 새 id는 `mobilenet-v2-r2`다

### 예시 데이터셋은 바깥에 있고, 앱은 주소만 갖는다 (2026-08-30)
**[결정]** 경위: `docs/cases/open-decisions.md`의 같은 제목.

#### 1. 앱에 싣지 않는다 — 주소만 갖는다

#### 2. 여기서는 절대 주소가 맞다 — `legal.ts`와 갈리는 자리다

#### 3. 자리는 첫 화면의 버튼 아래 한 줄이다

#### 4. 링크가 사는 순서 — 지금은 404가 정상이다

