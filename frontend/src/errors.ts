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
  'IMAGE_TOO_LARGE_FOR_BROWSER',
  'ENGINE_NOT_READY',
  // **`ENGINE_NOT_READY`와 갈라 놓은 한시적인 짝이다** (docs/error-codes.md).
  // 앞엣것은 "준비하면 된다"는 뜻인데, 준비를 켤 자리가 아직 없는 엔진에도 그 문장이
  // 나가고 있었다. 배선이 붙는 날 `RuntimeSpec.preparable`을 참으로 바꾸고 이것을 지운다.
  'ENGINE_NOT_WIRED',

  // 이미지 백본 - ml/embed/*
  // 백본을 준비하지 못했다: 가중치를 못 받았거나, 쓸 수 있는 TF.js 백엔드가 없거나,
  // 워커가 통째로 죽었다(메모리). **셋을 나누지 않는 이유는 학생이 할 일이 같기
  // 때문이다** - 다시 시도하는 것뿐이고, 무엇이 달랐는지는 교사가 읽을 기술 원문에 있다.
  // 등록부에 없는 백본을 가리키는 옛 파일도 여기로 온다.
  'BACKBONE_UNAVAILABLE',
  /**
   * 정본이 백본이 요구하는 크기가 아니다.
   *
   * **`BACKBONE_UNAVAILABLE`과 나누는 이유는 학생이 할 일이 다르기 때문이다** (R6 감사
   * B-10). 저쪽 문구는 *"인터넷 연결을 확인하세요"*인데 여기 원인은 사진이라 **다시
   * 시도해도 영원히 같은 자리에서 죽는다.** 정상 경로로는 안 나오고, 남이 만든 zip이나
   * 손으로 고친 파일에서 온다.
   */
  'IMAGE_CANONICAL_SIZE_MISMATCH',

  // 사진 올리기 - data/image/upload.ts
  // zip이 아니거나 깨졌다. PROJECT_FILE_NOT_ZIP과 나누는 이유는 학생이 할 일이 다르기
  // 때문이다 - 그쪽은 프로젝트 파일이고 이쪽은 방금 만든 사진 압축 파일이다.
  'IMAGE_ZIP_INVALID',
  // 압축 파일 안에 사진이 될 만한 파일이 하나도 없다. 맥/윈도가 넣는 부스러기만 남은
  // 경우도 여기다 - "0장을 받았습니다"로 조용히 끝내면 학생은 올린 줄 안다.
  'IMAGE_ZIP_NO_IMAGES',
  // 담을 수 있는 장수를 넘겼다 (limits.ts의 MAX_IMAGE_COUNT, project/images.ts).
  // **굽기 전에 판정한다** - 넘긴 채로 받아 두면 백본이 이미 돌았고 학생은 몇 분을
  // 버린 뒤에야 지우기부터 하게 된다. 표의 데이터셋 상한과 같은 자리다.
  'IMAGE_TOO_MANY_PHOTOS',
  /**
   * 이만큼은 이 기기에 안 들어간다 (project/storage.ts의 `roomShortfall`,
   * open-decisions.md "이미지가 들어갈 자리는 굽기 전에 묻는다").
   *
   * **`STORAGE_QUOTA_EXCEEDED`와 나누는 이유는 학생이 할 일이 다르기 때문이다.**
   * 저쪽은 저장을 누른 뒤에 나고 할 일이 "자리를 비워라"인데, 여기는 **아직 아무것도
   * 안 구운 시점**이고 할 일이 **"올릴 사진을 줄여라"**다.
   *
   * **위 `IMAGE_TOO_MANY_PHOTOS`와도 다르다** — 그쪽은 이 앱이 정한 장수이고 어느
   * 기기에서나 같다. 이쪽은 **그 기기의 남은 자리**라 학생마다 다르고, 사진을 지우면
   * 늘어난다.
   */
  'IMAGE_PHOTOS_EXCEED_STORAGE',
  // 폴더 이름을 범주로 쓸 수 없다 (data/image/canonical.ts의 isValidCategoryName).
  // **고쳐서 받지 않는다** - 이름을 다듬으면 서로 다른 폴더 둘이 한 범주로 합쳐질 수
  // 있고, 그건 라벨이 조용히 바뀌는 것이다.
  'IMAGE_CATEGORY_NAME_INVALID',
  /**
   * 사진 분류인데 **갈릴 것이 없다** - 라벨 붙은 범주가 둘 미만이다
   * (`ml/training-source.ts`, open-decisions.md "이미지 프로젝트의 데이터 화면").
   * `_unlabeled`는 범주가 아니라 상태라 안 센다.
   *
   * **이것이 유형 카드의 잠금을 대신한다** (architecture.md §10.5, 2026-09-03 교실 보고).
   * 고르는 자리는 안 잠그고 **저지르는 자리**가 세운다.
   *
   * **`SPLIT_TOO_FEW_ROWS`와 나누는 이유는 학생이 할 일이 다르기 때문이다.** 그쪽은
   * "사진을 더 모아라"인데 이쪽은 **"범주를 만들고 사진을 옮겨라"**다 - 사진은 이미
   * 충분히 있을 수 있고, 실제로 화면에 보인다. 라벨 없는 사진을 안 세는 탓에 그쪽이
   * *"데이터가 0개"*라고 말하는데, **사진 여섯 장을 보고 있는 학생에게 그건 틀린
   * 문장이다.**
   *
   * **범주가 하나인 경우는 전에 아무 데도 판정이 없었다.** 카드가 잠그고 있어서
   * [학습하기]에 닿은 적이 없었기 때문이다.
   */
  'IMAGE_TOO_FEW_CATEGORIES',

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
  // 참조형인데 원본 데이터가 파일에 없다 (mlpx-spec.md 5.0). 위 둘과 또 다르다 -
  // 모델도 형식도 멀쩡하고 없는 것은 dataset/이라, 학생이 할 일은 데이터를 가진
  // 파일로 다시 여는 것이다.
  'MODEL_NEEDS_DATASET',

  // 예측 입력 - ml/predict.ts
  // 채우지 않은 칸이 있다. **전처리기의 대체값으로 조용히 채우지 않는다** - 학생은
  // 자기가 넣은 값으로 예측했다고 믿는데 실제로는 훈련 데이터의 평균이 들어간다.
  // 예측은 브라우저에서만 하므로(mlpx-spec.md 0.2) 이 코드는 서버에 없다.
  'PREDICTION_INPUT_INCOMPLETE',

  // 표 파일 가져오기 - 서버는 정규화된 CSV만 보므로 이 둘은 서버에 없다 (data/table.ts)
  'DATASET_FILE_TYPE_UNSUPPORTED',
  'DATASET_SHEET_NOT_FOUND',

  // 브라우저 저장소 - project/storage.ts
  'STORAGE_QUOTA_EXCEEDED',
  /**
   * 이 브라우저에 담긴 저장소가 이 앱보다 새 것이다 (open-decisions.md "저장소가
   * 미래에서 온 것도 예측 가능하게 거부한다").
   *
   * **`PROJECT_FILE_VERSION_TOO_NEW`의 저장소 판이다** — 학생이 할 일이 같다. 앱을
   * 최신으로 올리는 것뿐이고, **그 사이 데이터는 그대로 있다.** 배포를 되돌리면
   * 그 교실 전원이 이것을 만나므로, 어휘 없이 두면 영어 원문과 **빈 목록**이 뜬다.
   */
  'STORAGE_VERSION_TOO_NEW',

  // 우리가 코드로 만들어 두지 않은 실패의 마지막 그물.
  // JOB_FAILED와 나누는 이유는 그건 학습에 대한 말이기 때문이다 - 저장이 실패했는데
  // "학습에 실패했습니다"가 뜨면 학생은 엉뚱한 것을 다시 한다.
  'UNEXPECTED_ERROR',

  // 훈련 데이터/테스트 데이터 분할 - ml/split.ts
  // 분할은 클라이언트만 계산한다(mlpx-spec.md 0.3). 서버는 인덱스를 받기만 하므로
  // 이 둘은 backend/app/errors.py 에 없다.
  'SPLIT_TOO_FEW_ROWS',
  'SPLIT_STRATIFY_IMPOSSIBLE',
  // 타깃이 사실상 연속이다. **SPLIT_STRATIFY_IMPOSSIBLE과 나누는 이유는 학생이 할 일이
  // 정반대이기 때문이다** - 그쪽은 "그 값을 더 모아라"이고 이쪽은 "끄라"다. 소수 하나가
  // 두 번 나오는 데이터는 없으므로 뭉치면 불가능한 조언을 하게 된다
  // (open-decisions.md "층화는 갈리는 값에서만 뜻이 있다").
  'SPLIT_STRATIFY_TARGET_CONTINUOUS',
  // 훈련이나 테스트 몫이 **범주 수보다 적다** - sklearn `StratifiedShuffleSplit`이
  // `The test_size = N should be greater or equal to the number of classes = K`로
  // 던지는 그 자리다 (2026-09-01 R18 감사 B-4, sklearn 1.9로 대조).
  //
  // **위 둘과 나누는 이유는 학생이 할 일이 또 다르기 때문이다** - `IMPOSSIBLE`은 그 값의
  // 데이터가 원래 적어서 "더 모아라"이고, `TARGET_CONTINUOUS`는 "꺼라"인데, 이쪽은
  // **학생이 방금 움직인 비율** 때문이라 "비율을 조정하라"다. 뭉치면 고칠 수 있는 것을
  // 못 고친다.
  //
  // **범주 하나가 몫에서 빠지는 것 자체는 여기서 안 막는다.** 10범주에 시험 20장이면
  // 던지지 않지만 빠지는 범주는 여전히 생길 수 있다 - **sklearn도 그렇다.** 실제로
  // 2/98을 5%로 나누면 저쪽도 소수 라벨을 시험에서 뺀다(같은 감사에서 대조했다).
  // 거기서 우리만 던지면 **구조를 표준 라이브러리에 맞춘다는 §2를 우리가 어긴다.**
  'SPLIT_STRATIFY_SHARE_TOO_SMALL',
  // 층화를 켠 채로 뽑을 행 수가 너무 적다 - ml/sample.ts (open-decisions.md #22).
  // **SPLIT_STRATIFY_IMPOSSIBLE과 나누는 이유는 학생이 할 일이 다르기 때문이다** -
  // 그쪽은 데이터에 그 값이 원래 적어서 "더 모아라"이고, 이쪽은 학생이 방금 정한 숫자가
  // 작아서 "그 숫자를 올리거나 층화를 꺼라"다. 뭉치면 고칠 수 있는 것을 못 고친다.
  'SAMPLE_STRATIFY_IMPOSSIBLE',
  // 이 과제 유형에서는 층화가 뜻이 없다 - 던지는 코드가 아니라 **화면의 잠금 이유**다
  // (ml/selection.ts의 stratifyBlock). 같은 목록에 두는 이유는 ALGORITHM_NOT_FOR_TASK_TYPE과
  // 같다 - 이유 문장이 사는 곳이 client.* 하나여야 한다.
  'STRATIFY_NOT_FOR_TASK_TYPE',

  // 군집화 - ml/engines/mljs-kmeans.ts
  // 데이터보다 군집이 많다. sklearn이 `n_samples should be >= n_clusters`로 던지는 자리다.
  // **SPLIT_TOO_FEW_ROWS와 나누는 이유는 학생이 할 일이 다르기 때문이다** - 이쪽은 군집
  // 수를 줄이는 길이 함께 있다. 그쪽은 데이터를 더 모으는 것인데, **이미지 분류에서는
  // "라벨을 붙여라"다** - 라벨 없는 사진은 세지 않으므로 사진이 있어도 쓸 수 있는 것이
  // 0이 된다 (2026-09-02 교실 보고). 그래서 두 문구가 **"학습에 쓸 수 있는"**이라고
  // 말한다. 지금은 군집화가 브라우저에만
  // 있어서 클라이언트 전용이고, 서버가 군집을 학습하게 되면 backend/app/errors.py 쪽으로
  // 옮겨 간다 (아래 CLIENT_WARNING_CODES의 사정과 같다).
  'CLUSTER_TOO_FEW_ROWS',

  // 테스트 데이터(test.csv) 받기 - data/columns.ts
  // 정본 열과의 대조는 브라우저에서만 한다(mlpx-spec.md 0.3의 분할과 같은 이유 -
  // 서버는 이미 확정된 정본과 분할 인덱스만 받는다).
  'TEST_DATASET_COLUMN_MISSING',
  // 테스트 데이터로 채점할 행이 하나도 없다 - ml/split.ts. 전처리(결측 규칙)가 전부
  // 걸러냈거나 테스트 데이터가 아예 없는 채로 provided인 경우다. **훈련 데이터가 비었다는
  // 말과 나눈다** - 같은 코드로 뭉치면 학생이 멀쩡한 훈련 데이터를 들여다본다.
  'TEST_DATASET_NO_USABLE_ROWS',

  // 테스트용 사진 받기 - data/image/test-set.ts
  // (open-decisions.md "테스트용 zip (`split.method = 'provided'`)").
  // **던지는 코드가 아니라 화면의 잠금·거절 이유다** - STRATIFY_NOT_FOR_TASK_TYPE과 같은
  // 자리이고, 같은 목록에 두는 이유도 같다: 이유 문장이 사는 곳이 client.* 하나여야 한다.
  //
  // 범주가 아직 없어 대조할 목록이 없다. **자리 자체가 잠긴다** - 열어 두면 학생이
  // 올린 뒤에야 거절당한다.
  'TEST_IMAGES_NEED_CATEGORIES',
  // 아래 둘은 **어긋난 방향마다 나눈다** - 빠진 범주는 "그 폴더를 채워라"이고 모르는
  // 범주는 "그 폴더를 빼라"라 학생이 할 일이 다르다. 뭉치면 고칠 수 있는 것을 못 고친다.
  'TEST_IMAGES_CATEGORY_MISSING',
  'TEST_IMAGES_CATEGORY_UNKNOWN',
  // 폴더 없이 담긴 사진이 섞여 있다. 정답이 없으므로 채점이 성립하지 않는다.
  // **위 둘과 나누는 이유는 할 일이 "폴더로 묶어라"이기 때문이다.**
  'TEST_IMAGES_UNLABELED',

  // 예측 데이터(predict.csv) 받기 - data/columns.ts, 그리고 예측 직전 - ml/predict.ts
  // 요구하는 열이 정본 열 전체가 아니라 특성 열의 합집합이라 TEST_DATASET_COLUMN_MISSING과
  // 다른 코드다 (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다").
  // **자리가 둘인 유일한 코드다.** 받을 때 본 것이 예측할 때도 맞다는 보장이 없다 -
  // 학생이 그 사이에 특성을 바꿔 재학습하면 predictPage가 같은 코드로 다시 잡는다
  // (open-decisions.md "붙일 때 본 것을 예측 직전에 다시 본다"). 빈 칸
  // (PREDICTION_INPUT_INCOMPLETE)과는 끝까지 나눈다 - 학생이 할 일이 다르다.
  'PREDICT_DATASET_COLUMN_MISSING',

  // 포트폴리오 - project/portfolio-sources.ts, views/PortfolioView.vue
  // 내장 양식을 못 받았다. **같은 오리진의 정적 파일인데도 네트워크를 탄다**
  // (mlpx-spec.md §8.7) - 오프라인이거나 학교망이 막았을 수 있다. 조용히 빈손으로
  // 돌아가지 않는 이유는 누른 사람이 무슨 일이 일어났는지 알아야 하기 때문이고,
  // 그때도 [빈 양식에서 시작]은 그대로 있다.
  'PORTFOLIO_TEMPLATE_UNAVAILABLE',
  // 글이 상한을 넘겼다 (limits.ts의 MAX_PORTFOLIO_BYTES, mlpx-spec.md §8.6.1).
  // **제약이 아니라 폭주 방지턱이다** - 손으로 쓴 글은 여기 안 닿고, 실제로 걸리는
  // 것은 붙여넣기 한 번에 들어오는 거대한 텍스트다. 상한이 없으면 안 걸리는 것이
  // 아니라 저장이 실패하는 모양으로 터진다.
  'PORTFOLIO_TOO_LARGE',
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
  // 결측 전략이 'none'인데 고른 열에 빈 칸이 있다. 브라우저가 학습하든 서버로 보내든
  // 같은 판정이다 - 빈 칸을 그대로 모델에 넣을 방법이 양쪽 다 없다.
  'FEATURE_HAS_MISSING',
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
 * 성공한 run에 붙는 사실. **에러가 아니다** (mlpx-spec.md 5.9).
 *
 * 로케일은 `client.*`를 그대로 쓴다 - 네임스페이스가 가리키는 것은 "실패"가 아니라
 * "프런트엔드가 만든 코드"이고, 이 코드도 그것이다. 목록을 나누는 이유는 **자리가 다르기
 * 때문**이다: `run.warning`은 `status: 'done'`과 함께 오고 `failure`는 아니다. 한 목록에
 * 담으면 "이 코드가 실패인가"를 이름으로 판정하게 되고, 그건 반드시 틀린다.
 *
 * 서버가 학습한 run도 같은 자리를 쓰게 되면 그때는 backend/app/errors.py 쪽으로 옮겨
 * 간다 - 지금은 브라우저에서만 나온다.
 */
export const CLIENT_WARNING_CODES = [
  // SMO가 반복 예산 안에 수렴하지 못했다. 계수는 나왔고 지표도 나왔다 - 덜 다듬어졌을 뿐이다.
  'SVM_NOT_CONVERGED',
  // 경사하강이 스텝 예산 안에 최적점에 못 닿았다. sklearn의 ConvergenceWarning 자리다
  // (mlpx-spec.md 5.9).
  'LOGISTIC_NOT_CONVERGED',
  // Lloyd 반복이 max_iter 안에 중심점을 고정하지 못했다. 중심점도 군집 번호도 나온다 -
  // 조금 더 돌리면 미세하게 움직일 뿐이다. sklearn도 같은 자리에서 ConvergenceWarning을 낸다.
  'KMEANS_NOT_CONVERGED',
  // 손실이 더 안 줄어들기 전에 에폭 상한에 닿았다. 가중치도 지표도 나온다 - 덜 배웠을
  // 뿐이다. sklearn `MLPClassifier`가 ConvergenceWarning을 내는 그 자리다.
  'NEURAL_NOT_CONVERGED',
  /**
   * 위와 **같은 조건이고 학생이 할 일만 다르다** (2026-09-03).
   *
   * **회귀에서는 전처리 스케일링이 답이 아니다.** 실측에서 그것을 켜면 되레 나빠졌다 —
   * 같은 데이터에서 R²가 −0.20에서 **−10.2**가 됐다. 특성을 표준화하면 은닉층의 활성이
   * 작아져 타깃 크기에 닿는 데 더 오래 걸린다. 분류에서는 정확히 반대다(0.40 → 1.00).
   *
   * **그래서 코드를 나눈다.** 하나로 두면 문구가 둘 중 한쪽에 거짓말을 하고, 그건 이
   * 저장소가 로지스틱에서 이미 한 번 겪은 막다른 길이다
   * (`open-decisions.md` "로지스틱 회귀 솔버를 sklearn과 같은 구조로 바꾼다").
   */
  'NEURAL_REGRESSION_NOT_CONVERGED',
  /**
   * **훈련 데이터의 타깃이 한 종류뿐이다 — 갈라 볼 것이 없다** (2026-09-03 교실 판단,
   * `ml/experiment.ts`). 위의 넷과 달리 **모델의 성질이 아니라 데이터의 성질**이라
   * 엔진이 아니라 실험 층이 붙인다.
   *
   * **실패로 만들지 않는다.** 학습은 실제로 돌고 지표도 나온다 — 재 보니 정확도 100%,
   * F1 100%, 혼동 행렬 1×1이었다. **그 100%가 위험한 것이다**: 교실에서 100%는 실패가
   * 아니라 성공으로 읽히고, 유일한 단서인 특이도 0%를 중학생이 읽어내지 못한다.
   * *"정확도 100%인데 왜 쓸모없을까"*는 그 자체로 좋은 수업 장면이라 거절하지 않고
   * **점수 옆에 세운다.**
   *
   * **사진의 `IMAGE_TOO_FEW_CATEGORIES`와 자리가 다르다.** 그쪽은 거절이다 — 사진에는
   * 이 주의를 미리 보여줄 열 목록이 없고, 표에는 전처리 화면이 *"타깃에 값이 한
   * 종류뿐이라 예측할 것이 없습니다"*를 이미 띄운다. **판정은 같고 처방이 갈린다.**
   *
   * **훈련 몫을 본다. 열 전체가 아니다.** 열이 한 종류면 훈련 몫도 반드시 한 종류이므로
   * 전처리 화면의 주의가 뜬 경우를 모두 덮고, **분할이 만든 한 종류짜리 훈련 몫**까지
   * 잡는다 — 그건 그 화면이 알 수 없던 것이다.
   */
  'TARGET_TOO_FEW_CLASSES',
] as const

export type ClientWarningCode = (typeof CLIENT_WARNING_CODES)[number]

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

/**
 * 로케일 문장에 보간되는 값.
 *
 * **스칼라만 받는다.** 한때 `string[]`도 받았는데, 그 배열을 문장에 넣는 자리가
 * 아무 데도 없어서 Vue가 `JSON.stringify(값, null, 2)`로 폈다 — 학생이 받은 문장이
 * `테스트 데이터 파일에 훈련 데이터의 열이 없습니다. ([\n  "수면시간"\n])`였다
 * (2026-08-29 전 경로 감사). **목록은 던지는 쪽이 이어 붙여서 준다** — 무엇으로
 * 잇는지는 그 문장이 아는 것이고, 이 계층은 문장을 모른다.
 *
 * 백엔드의 `ParamValue`는 `list[str]`도 보낸다. 그것을 받는 날 **여기가 아니라
 * 그 응답을 푸는 자리에서 문자열로 바꾼다** — 안 그러면 같은 실패가 다시 난다.
 */
export type ClientErrorParams = Record<string, string | number | boolean>

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
 * 잡은 예외를 **화면에 보일 로케일 키와 파라미터**로 바꾼다.
 *
 * 알림도 학습 화면의 상태 줄도 같은 실패를 보여주므로 **변환이 한 곳이어야 한다.**
 * 두 벌이면 한쪽만 고쳐져서, 토스트에는 사유가 뜨는데 화면에는 "실패했습니다"만
 * 남는 상태가 생긴다.
 *
 * 우리 코드가 아니면 `UNEXPECTED_ERROR`로 떨어지고 **원문은 버리지 않고 detail로**
 * 함께 실린다 (open-decisions.md "학습 실패는 교사가 읽을 수 있게 전달한다").
 */
export function toMessage(error: unknown): { key: string; params: ClientErrorParams } {
  return isClientError(error)
    ? { key: error.messageKey, params: error.params }
    : { key: errorMessageKey('UNEXPECTED_ERROR'), params: failureDetail(error) }
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
